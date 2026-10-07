import { z } from 'zod';
import { ConcurrencyQueue } from './queue';
import { findPronunciation, waitFor, type PronunciationDialect } from './pronunciation';

const ipaSchema = z.object({ us: z.string().max(200), uk: z.string().max(200), general: z.string().max(200).optional() });
const rangeSchema = z.array(z.object({ first: z.string(), file: z.string().regex(/^(us|uk)-\d+\.tsv$/) })).min(1).max(128)
  .refine(rows => rows.every((row, i) => i === 0 || rows[i - 1]!.first < row.first), 'Unsorted dictionary ranges');
const indexSchema = z.object({ version: z.literal(1), dialects: z.object({ us: rangeSchema, uk: rangeSchema }) });
const supplementSchema = z.object({ version: z.literal(1), entries: z.array(z.object({ word: z.string().min(1).max(200), ipa: ipaSchema })).max(10000) });
type Ipa = z.infer<typeof ipaSchema>;

/** Shared packaged assets; text cache budget excludes transient response buffers/JS overhead. */
export class PackagedPronunciationDictionary {
  private index?: Promise<z.infer<typeof indexSchema>>;
  private supplement?: Promise<Map<string, Ipa>>;
  private pending = new Map<string, Promise<string>>();
  private chunks = new Map<string, string>();
  private bytes = 0;
  private queue = new ConcurrencyQueue(2);
  private assetSignal = new AbortController().signal;

  constructor(private loader: (path: string) => Promise<string>, private budget = 768 * 1024) {}

  /** Diagnostic counters, without exposing text; also useful for reproducible budget tests. */
  get cacheStats() { return { textBytes: this.bytes, chunks: this.chunks.size, pending: this.pending.size }; }

  private getIndex() {
    return this.index ??= this.loader('ranges/index.json').then(text => indexSchema.parse(JSON.parse(text)))
      .catch(error => { this.index = undefined; throw error; });
  }

  private getSupplement() {
    return this.supplement ??= this.loader('technology.json').then(text => {
      const data = supplementSchema.parse(JSON.parse(text));
      return new Map(data.entries.map(entry => [entry.word, entry.ipa]));
    }).catch(error => { this.supplement = undefined; throw error; });
  }

  private chunk(file: string) {
    const cached = this.chunks.get(file);
    if (cached !== undefined) { this.chunks.delete(file); this.chunks.set(file, cached); return Promise.resolve(cached); }
    const pending = this.pending.get(file);
    if (pending) return pending;
    const request = this.queue.run(() => this.loader(`ranges/${file}`), this.assetSignal).then(text => {
      const bytes = text.length * 2;
      if (bytes <= this.budget) {
        while (this.bytes + bytes > this.budget && this.chunks.size) {
          const oldest = this.chunks.keys().next().value!;
          this.bytes -= this.chunks.get(oldest)!.length * 2; this.chunks.delete(oldest);
        }
        this.chunks.set(file, text); this.bytes += bytes;
      }
      return text;
    }).finally(() => { this.pending.delete(file); });
    this.pending.set(file, request);
    return request;
  }

  private async base(word: string, dialect: PronunciationDialect, signal: AbortSignal) {
    const index = await waitFor(this.getIndex(), signal);
    signal.throwIfAborted();
    const ranges = index.dialects[dialect];
    let low = 0; let high = ranges.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (ranges[middle]!.first <= word) low = middle + 1; else high = middle;
    }
    const file = ranges[Math.max(0, low - 1)]!.file;
    const text = await waitFor(this.chunk(file), signal);
    return findPronunciation(text, word);
  }

  async lookup(word: string, signal: AbortSignal): Promise<Ipa> {
    signal.throwIfAborted();
    const exact = word.normalize('NFC').trim().replace(/\s+/gu, ' ');
    if (!exact || exact.length > 200 || /[\t\n\r]/u.test(word)) return { us: '', uk: '' };
    const key = exact.toLowerCase();
    const [us, uk, extra] = await Promise.all([
      this.base(key, 'us', signal).catch(() => ''), this.base(key, 'uk', signal).catch(() => ''),
      waitFor(this.getSupplement(), signal).then(entries => entries.get(exact) ?? entries.get(key)).catch(() => undefined),
    ]);
    signal.throwIfAborted();
    // Keep established base variants. Only fill missing dialects; untagged IPA stays separate.
    return { us: us || extra?.us || '', uk: uk || extra?.uk || '', ...(extra?.general ? { general: extra.general } : {}) };
  }
}
