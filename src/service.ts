import { z } from 'zod';
import { cacheKey, ResultCache } from './cache';
import { ConcurrencyQueue } from './queue';
import { OpenAICompatibleProvider, type PronunciationProvider } from './provider';
import { WordCardSchema, type Settings } from './schema';

export class TranslationService {
  private queue = new ConcurrencyQueue();
  constructor(private cache = new ResultCache(), private ensureModel: (settings: Settings, signal: AbortSignal) => Promise<void> = async () => {}, private pronunciation?: PronunciationProvider) {}
  private key(settings: Settings, kind: string, value: unknown) {
    return cacheKey([settings.baseUrl, settings.model, settings.temperature, settings.apiKey, 'zh-CN', kind, value]);
  }
  async translate(settings: Settings, texts: string[], signal: AbortSignal, onItem?: (index: number, text: string, confirmed: boolean) => void) {
    this.queue.setLimit(settings.concurrency);
    const unique = [...new Set(texts)];
    const keys = await Promise.all(unique.map((text) => this.key(settings, 'translation-v4', text)));
    const values = await Promise.all(keys.map((key) => this.cache.get(key)));
    const results = new Map<string, string>();
    const emit = (source: string, text: string, confirmed: boolean) => {
      signal.throwIfAborted();
      texts.forEach((value, index) => { if (value === source) onItem?.(index, text, confirmed); });
    };
    const missing: string[] = [];
    unique.forEach((text, i) => {
      const cached = z.string().min(1).safeParse(values[i]);
      if (cached.success) { results.set(text, cached.data); emit(text, cached.data, true); } else missing.push(text);
    });
    if (missing.length) {
      const translations = await this.queue.run(async () => {
        await this.ensureModel(settings, signal);
        return new OpenAICompatibleProvider(settings).translate(missing, signal,
          onItem ? (index, text) => emit(missing[index]!, text, false) : undefined);
      }, signal);
      signal.throwIfAborted();
      await Promise.all(missing.map(async (text, i) => {
        results.set(text, translations[i]!);
        emit(text, translations[i]!, true);
        await this.cache.set(keys[unique.indexOf(text)]!, translations[i]!);
      }));
    }
    signal.throwIfAborted();
    return texts.map((text) => results.get(text)!);
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
