import type { SubtitleLine } from './scheduler';

export type HistoryEntry = SubtitleLine & { start: number };
/** Session-only history. Keep text in memory, but render only one small page. */
export class SubtitleHistory {
  private rows: HistoryEntry[] = [];
  private byTime = new Map<number, HistoryEntry>();
  private byText = new Map<string, Set<HistoryEntry>>();
  revision = 0;
  currentStart?: number;
  constructor(private limit = 1000) {}
  get entries(): readonly HistoryEntry[] { return this.rows; }
  indexAt(time: number) {
    let low = 0; let high = this.rows.length;
    while (low < high) { const mid = (low + high) >>> 1; if (this.rows[mid]!.start <= time) low = mid + 1; else high = mid; }
    return low - 1;
  }
  private unlink(row: HistoryEntry) {
    this.byTime.delete(row.start);
    const matches = this.byText.get(row.original); matches?.delete(row);
    if (!matches?.size) this.byText.delete(row.original);
  }
  observe(line: SubtitleLine) {
    const start = line.original ? line.start : undefined;
    if (this.currentStart !== start) { this.currentStart = start; this.revision++; }
    if (start === undefined || !Number.isFinite(start) || start < 0) return;
    const old = this.byTime.get(start);
    if (old && old.original === line.original && old.translated === line.translated && old.error === line.error && old.pending === line.pending) return;
    const row: HistoryEntry = { ...line, start };
    const index = this.indexAt(start);
    if (old) { this.unlink(old); this.rows[index] = row; }
    else this.rows.splice(index + 1, 0, row);
    this.byTime.set(start, row);
    const matches = this.byText.get(row.original) ?? new Set<HistoryEntry>(); matches.add(row); this.byText.set(row.original, matches);
    if (this.rows.length > this.limit) this.unlink(this.rows.splice(this.rows[0] === row ? 1 : 0, 1)[0]!);
    this.revision++;
  }
  update(text: string, translated: string, error = '', pending = false) {
    for (const row of this.byText.get(text) ?? []) {
      if (row.translated === translated && row.error === error && row.pending === pending) continue;
      row.translated = translated; row.error = error; row.pending = pending; this.revision++;
    }
  }
  clear() { this.rows = []; this.byTime.clear(); this.byText.clear(); this.currentStart = undefined; this.revision++; }
}

export function subtitleTime(time: number) {
  const seconds = Math.max(0, Math.floor(time));
  const minutes = Math.floor(seconds / 60);
  return `${minutes >= 60 ? `${Math.floor(minutes / 60)}:` : ''}${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
