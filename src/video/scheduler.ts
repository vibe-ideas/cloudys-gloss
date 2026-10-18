import { captionIndex, type Caption } from './captions';
import { needsChineseTranslation } from '../core/source-language';
import type { translateStream } from '../core/messaging';

export type SubtitleClient = { translate: typeof translateStream; cancel: (id: string) => void };
export type SubtitleLine = { original: string; translated: string; pending: boolean; error: string };
/** Current cue first, then fill a two-minute buffer in bounded batches. */
export class SubtitleScheduler {
  private captions: Caption[] = [];
  private cache = new Map<string, string>();
  private errors = new Map<string, string>();
  private pending?: { id: string; texts: string[]; generation: number; provisional: Set<string> };
  private generation = 0;
  private time = 0;
  private rate = 1;
  private failureUntil = 0;
  private enabled = true;
  private live = '';
  constructor(private client: SubtitleClient, private changed: (line: SubtitleLine) => void) {}
  setTrack(captions: Caption[]) { this.reset(); this.enabled = true; this.captions = captions; }
  setLive(text: string) {
    if (this.live === text) return;
    this.live = text;
    if (this.pending && !this.pending.texts.some(previous => text === previous || text.startsWith(previous + ' '))) this.abort();
    this.draw(); this.pump();
  }
  tick(time: number, seek = false, rate = 1) {
    if (!this.enabled) return;
    if (seek || Math.abs(time - this.time) > 5) this.abort();
    this.time = time; this.rate = Math.max(1, Math.min(rate, 3)); this.draw(); this.pump();
  }
  retry() { const text = this.current(); this.errors.delete(text); this.failureUntil = 0; this.draw(); this.pump(); }
  reset() { this.abort(); this.captions = []; this.live = ''; this.errors.clear(); this.failureUntil = 0; this.enabled = false; this.draw(); }
  destroy() { this.reset(); this.cache.clear(); }
  private current() { return this.captions.length ? this.captions[captionIndex(this.captions, this.time)]?.text ?? '' : this.live; }
  private abort() { this.generation++; if (this.pending) { for (const text of this.pending.provisional) this.cache.delete(text); this.client.cancel(this.pending.id); } this.pending = undefined; }
  private draw() {
    const original = this.enabled ? this.current() : '';
    this.changed({ original, translated: this.cache.get(original) ?? '', pending: !!original && needsChineseTranslation(original) && !this.cache.has(original) && !this.errors.has(original), error: this.errors.get(original) ?? '' });
  }
  private pump() {
    if (!this.enabled || this.pending) return;
    const current = this.current();
    const missing = (text: string) => text && !this.cache.has(text) && !this.errors.has(text) && needsChineseTranslation(text);
    const urgent = !!missing(current);
    const candidates: string[] = [];
    let firstMissing = Infinity;
    if (urgent) candidates.push(current);
    else if (this.captions.length && Date.now() >= this.failureUntil) {
      let index = captionIndex(this.captions, this.time);
      if (index < 0) { // In a gap, find the next cue without scanning a long video.
        let low = 0; let high = this.captions.length;
        while (low < high) { const mid = (low + high) >>> 1; if (this.captions[mid]!.start < this.time) low = mid + 1; else high = mid; } index = low;
      }
      for (let i = index; i < Math.min(this.captions.length, index + 64); i++) {
        const cue = this.captions[i]!; if (cue.start > this.time + 120 * this.rate) break;
        if (missing(cue.text)) { firstMissing = Math.min(firstMissing, cue.start); candidates.push(cue.text); }
      }
      // Once buffered, refill in batches instead of paying one API request for
      // every new cue at the far edge. Refill early when less than 30 s remains.
      if (candidates.length < 4 && firstMissing > this.time + 30 * this.rate) return;
    }
    let chars = 0;
    const texts = [...new Set(candidates)].filter(text => { chars += text.length; return chars <= 2400; }).slice(0, urgent ? 1 : 8);
    if (!texts.length) return;
    const job = { id: crypto.randomUUID(), texts, generation: this.generation, provisional: new Set<string>() }; this.pending = job;
    const active = () => this.enabled && job.generation === this.generation;
    const put = (text: string, translation: string) => {
      this.cache.delete(text); this.cache.set(text, translation);
      if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value!);
    };
    void this.client.translate(job.id, texts, (index, text, confirmed) => {
      if (active() && texts[index]) {
        if (confirmed) job.provisional.delete(texts[index]!); else job.provisional.add(texts[index]!);
        put(texts[index]!, text); this.draw();
      }
    }, { priority: texts.includes(current) ? 'visible' : 'prefetch' }).then(values => {
      if (active()) values.forEach((value, index) => put(texts[index]!, value));
    }).catch((error: unknown) => {
      if (active()) {
        this.failureUntil = Date.now() + 30000;
        for (const text of texts) { this.cache.delete(text); this.errors.set(text, error instanceof Error ? error.message : '字幕翻译失败'); if (this.errors.size > 500) this.errors.delete(this.errors.keys().next().value!); }
      }
    }).finally(() => {
      if (!active()) return;
      this.pending = undefined; this.draw();
      // Further prefetch is bounded to the same playback window.
      this.pump();
    });
  }
}
