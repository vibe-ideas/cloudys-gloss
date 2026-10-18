import { z } from 'zod';

export type Caption = { start: number; end: number; text: string };
import { MAX_CAPTION_BYTES } from './protocol';
// Extension contexts must validate data without probing dynamic code execution.
z.config({ jitless: true });
const eventSchema = z.object({
  tStartMs: z.number().finite().min(0), dDurationMs: z.number().finite().min(0).optional(),
  aAppend: z.number().optional(), segs: z.array(z.object({ utf8: z.string().max(12000) })).max(400).optional(),
});
const jsonSchema = z.object({ events: z.array(eventSchema).max(30000) });
export function captionText(text: string) { return text.replace(/\s+/gu, ' ').trim(); }

/** Parse the player's JSON3, srv3 or legacy timedtext, never HTML. */
export function parseCaptions(raw: string): Caption[] {
  if (!raw.trim() || raw.length > MAX_CAPTION_BYTES) return [];
  const rows: Caption[] = [];
  try {
    if (raw.trimStart().startsWith('{')) {
      const parsed = jsonSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) return [];
      for (const event of parsed.data.events) {
        const text = captionText(event.segs?.map(segment => segment.utf8).join('') ?? '');
        if (!text) continue;
        const start = event.tStartMs / 1000;
        const end = start + Math.min((event.dDurationMs ?? 4000) / 1000, 30);
        const previous = rows.at(-1);
        // ASR can append words to the previous window instead of replacing it.
        if (event.aAppend && previous && start <= previous.end && end - previous.start <= 12 && previous.text.length + text.length < 500) {
          previous.text = captionText(previous.text + ' ' + text); previous.end = Math.max(previous.end, end);
        } else rows.push({ start, end, text });
      }
    } else {
      const xml = new DOMParser().parseFromString(raw, 'text/xml');
      if (xml.querySelector('parsererror') || !['timedtext', 'transcript'].includes(xml.documentElement.tagName)) return [];
      for (const node of Array.from(xml.querySelectorAll('p[t],text[start]')).slice(0, 30000)) {
        const milliseconds = node.tagName === 'p';
        const start = Number(node.getAttribute(milliseconds ? 't' : 'start')) / (milliseconds ? 1000 : 1);
        const duration = Number(node.getAttribute(milliseconds ? 'd' : 'dur') ?? (milliseconds ? '4000' : '4')) / (milliseconds ? 1000 : 1);
        const text = captionText(node.textContent ?? '');
        if (Number.isFinite(start) && start >= 0 && Number.isFinite(duration) && duration > 0 && text) rows.push({ start, end: start + Math.min(duration, 30), text });
      }
    }
  } catch { return []; }
  rows.sort((a, b) => a.start - b.start);
  return rows.filter((row, index) => row.text.length <= 1200 && row.end > row.start && !(index && rows[index - 1]!.start === row.start && rows[index - 1]!.text === row.text))
    .map((row, index, all) => ({ ...row, end: Math.min(row.end, all[index + 1]?.start ?? row.end) }))
    .filter(row => row.end > row.start);
}

/** Binary search: playback ticks never walk the complete subtitle track. */
export function captionIndex(captions: Caption[], time: number) {
  let low = 0; let high = captions.length;
  while (low < high) { const middle = (low + high) >>> 1; if (captions[middle]!.start <= time) low = middle + 1; else high = middle; }
  const index = low - 1;
  return index >= 0 && time < captions[index]!.end ? index : -1;
}
/** Combine adjacent unfinished lines into bounded phrases, rather than asking
 * the model to translate each ASR word. Preserve timing gaps and sentence ends. */
export function captionPhrases(captions: Caption[]): Caption[] {
  const phrases: Caption[] = [];
  for (const caption of captions) {
    const previous = phrases.at(-1);
    if (previous && caption.start - previous.end <= .25 && caption.end - previous.start <= 10 && previous.text.length + caption.text.length < 220 && !/[.!?。！？]["'’”)]?$/.test(previous.text)) {
      previous.text += ' ' + caption.text; previous.end = caption.end;
    } else phrases.push({ ...caption });
  }
  return phrases;
}
