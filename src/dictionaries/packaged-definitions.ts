import { z } from 'zod';
import { ConcurrencyQueue } from '../core/queue';
import { waitFor } from '../speech/pronunciation';
import type { LocalDefinition } from './store';

const indexSchema = z.object({ version: z.literal(1), ranges: z.array(z.object({
  first: z.string(), file: z.string().regex(/^\d{1,3}\.json$/),
})).min(1).max(256).refine(rows => rows.every((row, i) => !i || rows[i - 1]!.first < row.first)) });
const rowsSchema = z.array(z.tuple([z.string().max(100), z.string().max(4000)])).max(1024);

/** Only the selected range is loaded. Shared in background, independent of the model queue. */
export class PackagedDefinitions {
  private index?: Promise<z.infer<typeof indexSchema>>;
  private chunks = new Map<string, string>();
  private pending = new Map<string, Promise<string>>();
  private bytes = 0;
  private queue = new ConcurrencyQueue(2);
  private assetSignal = new AbortController().signal;
  constructor(private loader: (path: string) => Promise<string>, private budget = 256 * 1024) {}
  get cacheStats() { return { textBytes: this.bytes, chunks: this.chunks.size, pending: this.pending.size }; }
  private chunk(file: string) {
    const cached = this.chunks.get(file);
    if (cached !== undefined) { this.chunks.delete(file); this.chunks.set(file, cached); return Promise.resolve(cached); }
    const pending = this.pending.get(file);
    if (pending) return pending;
    const request = this.queue.run(() => this.loader(file), this.assetSignal).then(text => {
      if (text.length > 256 * 1024) throw new Error('词典分片过大');
      // Validate before caching; a failed asset can be loaded again.
      rowsSchema.parse(JSON.parse(text));
      const size = text.length * 2;
      if (size <= this.budget) {
        while (this.bytes + size > this.budget && this.chunks.size) {
          const oldest = this.chunks.keys().next().value!;
          this.bytes -= this.chunks.get(oldest)!.length * 2; this.chunks.delete(oldest);
        }
        this.chunks.set(file, text); this.bytes += size;
      }
      return text;
    }).finally(() => this.pending.delete(file));
    this.pending.set(file, request);
    return request;
  }
  async lookup(word: string, signal: AbortSignal): Promise<LocalDefinition[]> {
    signal.throwIfAborted();
    const key = word.normalize('NFC').trim().toLowerCase().replace(/\s+/gu, ' ');
    if (!/^[a-z][a-z0-9 .'&+/-]{0,99}$/.test(key) || /[\t\n\r]/u.test(word)) return [];
    this.index ??= this.loader('index.json').then(text => indexSchema.parse(JSON.parse(text)))
      .catch(error => { this.index = undefined; throw error; });
    const { ranges } = await waitFor(this.index, signal);
    let low = 0; let high = ranges.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (ranges[middle]!.first <= key) low = middle + 1; else high = middle;
    }
    const text = await waitFor(this.chunk(ranges[Math.max(0, low - 1)]!.file), signal);
    signal.throwIfAborted();
    const rows = JSON.parse(text) as [string, string][];
    const entry = rows.find(([headword]) => headword === key);
    return entry ? [{ dictionary: 'ECDICT · 通用英汉', headword: key, matchedAs: key, text: entry[1], truncated: false }] : [];
  }
}
