import { z } from 'zod';
import { cacheKey, ResultCache } from './cache';
import { ConcurrencyQueue } from './queue';
import { OpenAICompatibleProvider, type PronunciationProvider } from './provider';
import { WordCardSchema, type Settings } from './schema';

type Priority = 'interactive' | 'visible' | 'prefetch';
type Subscriber = (text: string, confirmed: boolean) => void;
type Flight = {
  key: string; source: string; promise: Promise<string>; resolve(value: string): void; reject(error: unknown): void;
  listeners: Set<Subscriber>; latest?: { text: string; confirmed: boolean }; group: FlightGroup;
};
type FlightGroup = { controller: AbortController; entries: Flight[] };

export class TranslationService {
  private queue = new ConcurrencyQueue();
  private flights = new Map<string, Flight>();
  // The latest explicit retry owns the cache write, even if an older request
  // finishes later. Entries are removed when their owning request settles.
  private cacheOwners = new Map<string, Flight>();
  constructor(private cache = new ResultCache(), private ensureModel: (settings: Settings, signal: AbortSignal) => Promise<void> = async () => {}, private pronunciation?: PronunciationProvider) {}
  private key(settings: Settings, kind: string, value: unknown) {
    return cacheKey([settings.baseUrl, settings.model, settings.temperature, settings.apiKey, 'zh-CN', kind, value]);
  }
  private subscribe(entry: Flight, signal: AbortSignal, emit: Subscriber): Promise<string> {
    return new Promise((resolve, reject) => {
      const release = () => {
        signal.removeEventListener('abort', cancel);
        entry.listeners.delete(receive);
        if (entry.group.entries.every((item) => !item.listeners.size)) {
          entry.group.controller.abort(new DOMException('没有等待此译文的页面', 'AbortError'));
          for (const item of entry.group.entries) if (this.flights.get(item.key) === item) this.flights.delete(item.key);
        }
      };
      const cancel = () => { release(); reject(signal.reason); };
      const receive: Subscriber = (text, confirmed) => {
        if (signal.aborted) return;
        try { emit(text, confirmed); } catch (error) { release(); reject(error); }
      };
      entry.listeners.add(receive);
      signal.addEventListener('abort', cancel, { once: true });
      entry.promise.then((value) => { release(); resolve(value); }, (error) => { release(); reject(error); });
      if (signal.aborted) cancel();
      else if (entry.latest) receive(entry.latest.text, entry.latest.confirmed);
    });
  }
  private publish(entry: Flight, text: string, confirmed: boolean) {
    entry.latest = { text, confirmed };
    for (const listener of [...entry.listeners]) listener(text, confirmed);
  }
  private startGroup(group: FlightGroup, settings: Settings, bypassCache: boolean, priority: Priority) {
    const signal = group.controller.signal;
    void this.queue.run(async () => {
      // Another request may have filled the cache while this batch was queued.
      const values = bypassCache ? [] : await Promise.all(group.entries.map((entry) => this.cache.get(entry.key)));
      signal.throwIfAborted();
      const missing: Flight[] = [];
      group.entries.forEach((entry, index) => {
        const cached = z.string().min(1).safeParse(values[index]);
        if (cached.success) { this.publish(entry, cached.data, true); entry.resolve(cached.data); }
        else missing.push(entry);
      });
      if (!missing.length) return;
      await this.ensureModel(settings, signal);
      const translations = await new OpenAICompatibleProvider(settings).translate(missing.map((entry) => entry.source), signal,
        (index, text) => this.publish(missing[index]!, text, false));
      signal.throwIfAborted();
      await Promise.all(missing.map(async (entry, index) => {
        const text = translations[index]!;
        // Persist before settling so a newly arriving subscriber cannot miss
        // both the in-flight entry and its completed cache value.
        if (this.cacheOwners.get(entry.key) === entry) await this.cache.set(entry.key, text);
        this.publish(entry, text, true); entry.resolve(text);
      }));
    }, signal, priority).catch((error: unknown) => {
      for (const entry of group.entries) entry.reject(error);
    }).finally(() => {
      for (const entry of group.entries) {
        if (this.flights.get(entry.key) === entry) this.flights.delete(entry.key);
        if (this.cacheOwners.get(entry.key) === entry) this.cacheOwners.delete(entry.key);
      }
    });
  }
  async translate(settings: Settings, texts: string[], signal: AbortSignal, onItem?: (index: number, text: string, confirmed: boolean) => void, bypassCache = false, priority: Priority = 'visible') {
    signal.throwIfAborted();
    const operation = new AbortController();
    const cancel = () => operation.abort(signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
    try {
      return await this.translatePending(settings, texts, operation.signal, onItem, bypassCache, priority);
    } finally {
      signal.removeEventListener('abort', cancel);
      operation.abort(new DOMException('翻译操作已结束', 'AbortError'));
    }
  }
  private async translatePending(settings: Settings, texts: string[], signal: AbortSignal, onItem: ((index: number, text: string, confirmed: boolean) => void) | undefined, bypassCache: boolean, priority: Priority) {
    this.queue.setLimit(settings.concurrency);
    const unique = [...new Set(texts)];
    const keys = await Promise.all(unique.map((text) => this.key(settings, 'translation-v4', text)));
    const values = bypassCache ? [] : await Promise.all(keys.map((key) => this.cache.get(key)));
    const results = new Map<string, string>();
    const emit = (source: string, text: string, confirmed: boolean) => {
      signal.throwIfAborted();
      texts.forEach((value, index) => { if (value === source) onItem?.(index, text, confirmed); });
    };
    signal.throwIfAborted();
    const group: FlightGroup = { controller: new AbortController(), entries: [] };
    const pending: Promise<void>[] = [];
    unique.forEach((text, i) => {
      const cached = z.string().min(1).safeParse(values[i]);
      if (cached.success) {
        results.set(text, cached.data);
        try { emit(text, cached.data, true); } catch (error) { pending.push(Promise.reject(error)); }
        return;
      }
      const key = keys[i]!;
      let entry = bypassCache ? undefined : this.flights.get(key);
      if (!entry) {
        let resolve!: Flight['resolve']; let reject!: Flight['reject'];
        const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
        entry = { key, source: text, promise, resolve, reject, listeners: new Set(), group };
        group.entries.push(entry);
        // A retry always starts fresh, but subsequent ordinary cache misses can
        // subscribe to its newer result instead of superseding its cache write.
        this.flights.set(key, entry);
        this.cacheOwners.set(key, entry);
      } else this.queue.updatePriority(entry.group.controller.signal, priority);
      pending.push(this.subscribe(entry, signal, (value, confirmed) => emit(text, value, confirmed))
        .then((value) => { results.set(text, value); }));
    });
    if (group.entries.length) this.startGroup(group, settings, bypassCache, bypassCache ? 'interactive' : priority);
    await Promise.all(pending);
    signal.throwIfAborted();
    return texts.map((text) => results.get(text)!);
  }
  async translateInput(settings: Settings, text: string, signal: AbortSignal) {
    this.queue.setLimit(settings.concurrency);
    // Drafts are transient: share the interactive queue but never persist them
    // in the page-translation cache or reuse a Chinese translation for English.
    return this.queue.run(async () => {
      signal.throwIfAborted();
      await this.ensureModel(settings, signal);
      signal.throwIfAborted();
      const result = await new OpenAICompatibleProvider(settings).translateInput(text, signal);
      signal.throwIfAborted();
      return result;
    }, signal, 'interactive');
  }
  async dictionary(settings: Settings, word: string, context: string, signal: AbortSignal) {
    this.queue.setLimit(settings.concurrency);
    const key = await this.key(settings, 'dictionary-v2', [word, context]);
    const cached = WordCardSchema.safeParse(await this.cache.get(key));
    signal.throwIfAborted();
    if (cached.success) {
      if (!this.pronunciation) return cached.data;
      const ipa = await this.pronunciation.lookup(word, signal).catch(() => ({ us: '', uk: '' }));
      signal.throwIfAborted();
      return WordCardSchema.parse({ ...cached.data, ipa });
    }
    const card = await this.queue.run(async () => {
      await this.ensureModel(settings, signal);
      return new OpenAICompatibleProvider(settings, undefined, this.pronunciation).lookup(word, context, signal);
    }, signal, true);
    signal.throwIfAborted();
    await this.cache.set(key, card);
    return card;
  }
  test(settings: Settings, signal: AbortSignal) {
    this.queue.setLimit(settings.concurrency);
    return this.queue.run(async () => {
      await this.ensureModel(settings, signal);
      // Exercise the same streaming + validated plain-text fallback as page
      // translation, with enough source words to require Chinese output.
      return new OpenAICompatibleProvider(settings).translate(
        ['The weather is cloudy today, so please bring an umbrella.'], signal, () => {});
    }, signal, true);
  }
  clear() { return this.cache.clear(); }
}
