/** PDF text items are glyph runs, not paragraphs. Keep geometry until lines and
 * adjacent lines have been joined, and never join across a column-sized gap. */
export type PdfTextItem = { str: string; transform: number[]; width: number; height: number; hasEOL?: boolean };
type Line = { text: string; x: number; y: number; end: number; size: number };
export const MAX_PAGE_CHARACTERS = 100000;
export const MAX_PAGE_PARAGRAPHS = 200;
export function pdfParagraphs(items: unknown[]): { paragraphs: string[]; truncated: boolean } {
  const lines: Line[] = [];
  let current: Line | undefined;
  let characters = 0;
  let truncated = false;
  const flush = () => { if (current?.text.trim()) lines.push(current); current = undefined; };
  for (const raw of items) {
    if (!raw || typeof raw !== 'object' || !('str' in raw)) continue;
    const item = raw as PdfTextItem;
    if (typeof item.str !== 'string' || !Array.isArray(item.transform) || item.transform.length < 6) continue;
    const x = item.transform[4]!; const y = item.transform[5]!;
    const size = Math.abs(item.height) || Math.hypot(item.transform[2]!, item.transform[3]!) || 12;
    if (![x, y, size, item.width].every(Number.isFinite)) continue;
    if (characters + item.str.length > MAX_PAGE_CHARACTERS) { truncated = true; break; }
    characters += item.str.length;
    const text = item.str.replace(/\s+/g, ' ');
    if (!text.trim()) { if (item.hasEOL) flush(); continue; }
    const sameLine = current && Math.abs(current.y - y) < Math.max(current.size, size) * 0.35
      && x >= current.x - size && x - current.end < Math.max(current.size, size) * 3;
    if (!sameLine) { flush(); current = { text, x, y, end: x + item.width, size }; }
    else {
      const space = x - current!.end > size * 0.1 && !/\s$/.test(current!.text) && !/^\s|^[,.;:!?，。；：！？]/.test(text);
      current!.text += `${space ? ' ' : ''}${text}`;
      current!.end = Math.max(current!.end, x + item.width);
    }
    if (item.hasEOL) flush();
  }
  flush();
  const paragraphs: string[] = [];
  let previous: Line | undefined;
  for (const line of lines) {
    const last = paragraphs.length - 1;
    const joins = previous && last >= 0 && previous.y > line.y && previous.y - line.y <= Math.max(previous.size, line.size) * 1.65
      && Math.abs(previous.x - line.x) <= line.size * 1.5 && previous.size < line.size * 1.2 && line.size < previous.size * 1.2
      && paragraphs[last]!.length + line.text.length < 3000;
    if (joins) paragraphs[last] = `${paragraphs[last]} ${line.text.trim()}`;
    else {
      // A pathological unbroken glyph run is still bounded by the public model
      // request limit. Slice at whitespace where possible, without dropping text.
      let remaining = line.text.trim();
      while (remaining) {
        if (paragraphs.length >= MAX_PAGE_PARAGRAPHS) { truncated = true; break; }
        let end = Math.min(3000, remaining.length);
        if (remaining.length > end) { const space = remaining.lastIndexOf(' ', end); if (space > end / 2) end = space; }
        paragraphs.push(remaining.slice(0, end).trim()); remaining = remaining.slice(end).trim();
      }
      if (truncated && paragraphs.length >= MAX_PAGE_PARAGRAPHS) break;
    }
    previous = line;
  }
  return { paragraphs, truncated };
}

export function pdfBatches(texts: string[]): number[][] {
  const batches: number[][] = []; let batch: number[] = []; let characters = 0;
  texts.forEach((text, index) => {
    if (batch.length && (batch.length >= 8 || characters + text.length > 5000)) { batches.push(batch); batch = []; characters = 0; }
    batch.push(index); characters += text.length;
  });
  if (batch.length) batches.push(batch);
  return batches;
}
