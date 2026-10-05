import { MAX_PAGE_CHARACTERS, MAX_PAGE_PARAGRAPHS } from './text';

export type PdfRect = { x: number; y: number; width: number; height: number };
export type PdfTextStyle = { ascent?: number; descent?: number; vertical?: boolean; fontFamily?: string };
export type PdfLayoutViewport = { transform: readonly number[]; width: number; height: number };
export type PdfLayoutReason = 'item-limit' | 'character-limit' | 'block-limit' | 'invalid-viewport'
  | 'invalid-geometry' | 'missing-font-metrics' | 'unsupported-direction' | 'rotated-text'
  | 'skewed-text' | 'clipped-text' | 'overlapping-text' | 'long-text';
export type PdfLayoutBlock = {
  id: string;
  text: string;
  box: PdfRect;
  /** Conservative glyph-run bounds, not a measurement of individual glyph ink.
   * Only these rectangles may be masked; never mask the paragraph's whole box. */
  inkRects: PdfRect[];
  fontSize: number;
  lineHeight: number;
  translatable: boolean;
  layoutSafe: boolean;
  reasons: PdfLayoutReason[];
};
export type PdfLayout = { width: number; height: number; blocks: PdfLayoutBlock[]; truncated: boolean; reasons: PdfLayoutReason[] };
export const MAX_LAYOUT_ITEMS = 10000;
export const MAX_LAYOUT_TEXT_CHARACTERS = 3000;

type Matrix = [number, number, number, number, number, number];
type Run = { index: number; text: string; rect: PdfRect; start: number; end: number; baseline: number;
  fontSize: number; font: string; endOfLine: boolean; leadingSpace: boolean; trailingSpace: boolean; reasons: Set<PdfLayoutReason>; owner: number };
type Line = { runs: Run[]; fonts: Set<string>; text: string; box: PdfRect; baseline: number; fontSize: number };
type Row = { lines: Line[]; baseline: number; fontSize: number; tableLike: boolean };
type Draft = { block: PdfLayoutBlock; last: Line; row: number; rows: number; firstBaseline: number; lastTableLike: boolean };
const emptyRect = (): PdfRect => ({ x: 0, y: 0, width: 0, height: 0 });
const right = (rect: PdfRect) => rect.x + rect.width;
const bottom = (rect: PdfRect) => rect.y + rect.height;
const intersects = (a: PdfRect, b: PdfRect) => a.width > 0 && a.height > 0 && b.width > 0 && b.height > 0
  && Math.min(right(a), right(b)) - Math.max(a.x, b.x) > 0.1
  && Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y) > 0.1;
function union(a: PdfRect, b: PdfRect): PdfRect {
  const x = Math.min(a.x, b.x); const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(right(a), right(b)) - x, height: Math.max(bottom(a), bottom(b)) - y };
}
function matrix(value: unknown): Matrix | undefined {
  if (!Array.isArray(value) || value.length < 6) return;
  const values = value.slice(0, 6);
  if (values.every(value => typeof value === 'number' && Number.isFinite(value))) return values as Matrix;
}
function clip(rect: PdfRect, width: number, height: number): PdfRect {
  const x = Math.min(width, Math.max(0, rect.x)); const y = Math.min(height, Math.max(0, rect.y));
  return { x, y, width: Math.max(0, Math.min(width, right(rect)) - x), height: Math.max(0, Math.min(height, bottom(rect)) - y) };
}
function languageText(text: string) {
  if (!/\p{L}/u.test(text)) return false;
  if (/^(?:(?:https?|ftp):\/\/|www\.|mailto:)\S+$/i.test(text) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return false;
  if (!/\d/.test(text)) return true;
  const withoutCurrency = text.replace(/\b(?:USD|EUR|GBP|CNY|RMB|JPY|HKD|SGD|AUD|CAD|CHF|KRW|INR)\b/gi, '');
  return /\p{L}/u.test(withoutCurrency);
}

function geometry(raw: Record<string, unknown>, viewport: PdfLayoutViewport, transform: Matrix | undefined,
  styles: Readonly<Record<string, PdfTextStyle>>, reasons: Set<PdfLayoutReason>) {
  const own = matrix(raw.transform);
  if (!transform || !own || typeof raw.width !== 'number' || !Number.isFinite(raw.width) || raw.width < 0) {
    reasons.add(transform ? 'invalid-geometry' : 'invalid-viewport');
    return { rect: emptyRect(), start: 0, end: 0, baseline: 0, fontSize: 12 };
  }
  const [a, b, c, d, e, f] = own; const [va, vb, vc, vd, ve, vf] = transform;
  const origin = { x: va * e + vc * f + ve, y: vb * e + vd * f + vf };
  const along = { x: va * a + vc * b, y: vb * a + vd * b };
  const up = { x: va * c + vc * d, y: vb * c + vd * d };
  const fontSize = Math.hypot(up.x, up.y); const originalAdvance = Math.hypot(a, b);
  const advance = Math.hypot(along.x, along.y);
  if (!Number.isFinite(fontSize + advance + origin.x + origin.y) || fontSize <= 0 || advance <= 0 || originalAdvance <= 0) {
    reasons.add('invalid-geometry');
    return { rect: emptyRect(), start: 0, end: 0, baseline: 0, fontSize: 12 };
  }
  const style = typeof raw.fontName === 'string' ? styles[raw.fontName] : undefined;
  const validMetrics = typeof style?.ascent === 'number' && Number.isFinite(style.ascent) && style.ascent > 0 && style.ascent <= 3
    && typeof style.descent === 'number' && Number.isFinite(style.descent) && style.descent <= 0 && style.descent >= -3;
  if (!validMetrics) reasons.add('missing-font-metrics');
  const ascent = validMetrics ? style!.ascent! : 0.8; const descent = validMetrics ? style!.descent! : -0.2;
  if (style?.vertical || typeof raw.dir === 'string' && raw.dir !== 'ltr') reasons.add('unsupported-direction');
  if (along.x <= 0 || Math.abs(along.y) > advance * 0.01 || up.y >= 0) reasons.add('rotated-text');
  if (Math.abs(along.x * up.x + along.y * up.y) > advance * fontSize * 0.01) reasons.add('skewed-text');
  // width is an advance in PDF user space. Applying the viewport's linear
  // transform also includes /UserUnit, crop offsets and page rotation; using
  // viewport.scale here would silently lose /UserUnit.
  const dx = along.x / originalAdvance * raw.width; const dy = along.y / originalAdvance * raw.width;
  const corners = [ascent, descent].flatMap(offset => [
    { x: origin.x + up.x * offset, y: origin.y + up.y * offset },
    { x: origin.x + up.x * offset + dx, y: origin.y + up.y * offset + dy },
  ]);
  const margin = Math.min(0.75, fontSize * 0.04);
  const x = Math.min(...corners.map(point => point.x)) - margin; const y = Math.min(...corners.map(point => point.y)) - margin;
  const original = { x, y, width: Math.max(...corners.map(point => point.x)) + margin - x, height: Math.max(...corners.map(point => point.y)) + margin - y };
  if (![x, y, original.width, original.height].every(Number.isFinite)) {
    reasons.add('invalid-geometry');
    return { rect: emptyRect(), start: 0, end: 0, baseline: 0, fontSize };
  }
  const rect = clip(original, viewport.width, viewport.height);
  if (rect.x !== original.x || rect.y !== original.y || Math.abs(rect.width - original.width) > 0.01 || Math.abs(rect.height - original.height) > 0.01) reasons.add('clipped-text');
  if (raw.width === 0) reasons.add('invalid-geometry');
  return { rect, start: origin.x, end: origin.x + dx, baseline: origin.y, fontSize };
}

function addRun(line: Line, run: Run) {
  const previous = line.runs.at(-1)!;
  const space = (previous.trailingSpace || run.leadingSpace || run.start - previous.end > Math.min(run.fontSize, previous.fontSize) * 0.08)
    && !/\s$/.test(line.text) && !/^[,.;:!?，。；：！？]/.test(run.text);
  line.text += `${space ? ' ' : ''}${run.text}`;
  line.runs.push(run); line.fonts.add(run.font); line.box = union(line.box, run.rect); line.fontSize = Math.max(line.fontSize, run.fontSize);
}
function prose(line: Line) {
  return line.text.length >= 24 && (line.text.split(/\s+/).length >= 4 || !/\s/.test(line.text) && line.text.length >= 30);
}
function buildRows(runs: Run[]) {
  const bands: { runs: Run[]; baseline: number; fontSize: number }[] = [];
  for (const run of [...runs].sort((a, b) => a.baseline - b.baseline || a.start - b.start || a.index - b.index)) {
    const band = bands.at(-1);
    if (!band || Math.abs(band.baseline - run.baseline) > Math.min(band.fontSize, run.fontSize) * 0.25 || run.reasons.size || band.runs[0]!.reasons.size) {
      bands.push({ runs: [run], baseline: run.baseline, fontSize: run.fontSize });
    } else band.runs.push(run);
  }
  const rows: Row[] = [];
  for (const band of bands) {
    const row: Row = { lines: [], baseline: band.baseline, fontSize: band.fontSize, tableLike: false }; rows.push(row);
    // Minor baseline jitter must not reverse glyph runs or column order.
    for (const run of band.runs.sort((a, b) => a.start - b.start || a.index - b.index)) {
      let line = row.lines.at(-1); const previous = line?.runs.at(-1);
      const gap = previous ? run.start - previous.end : Infinity;
      if (line && previous && !previous.endOfLine && !previous.reasons.size && !run.reasons.size
        && gap >= -0.1 && gap <= Math.min(previous.fontSize, run.fontSize) * 0.75
        && Math.abs(previous.fontSize - run.fontSize) <= run.fontSize * 0.15) addRun(line, run);
      else { line = { runs: [run], fonts: new Set([run.font]), text: run.text, box: { ...run.rect }, baseline: run.baseline, fontSize: run.fontSize }; row.lines.push(line); }
    }
  }
  // Multiple short, aligned cells are ambiguous without a tagged structure
  // tree. Keep them independent. Long prose in two columns can still reflow
  // within each column; a heading/numeric cell makes its adjacent rows table-like.
  for (const row of rows) row.tableLike = row.lines.length > 1 && (row.lines.length !== 2 || row.lines.some(line => !prose(line)));
  const aligned = (a: Row, b: Row) => a.lines.length === b.lines.length && a.lines.length > 1
    && b.baseline - a.baseline <= Math.max(a.fontSize, b.fontSize) * 2
    && a.lines.every((line, index) => Math.abs(line.box.x - b.lines[index]!.box.x) <= line.fontSize * 0.75);
  for (let index = 1; index < rows.length; index++) if (rows[index - 1]!.tableLike && aligned(rows[index - 1]!, rows[index]!)) rows[index]!.tableLike = true;
  for (let index = rows.length - 2; index >= 0; index--) if (rows[index + 1]!.tableLike && aligned(rows[index]!, rows[index + 1]!)) rows[index]!.tableLike = true;
  return rows;
}

/** Build a bounded, independent layout IR from public PDF.js text data.
 * Pass the page's getViewport({ scale: 1 }); coordinates include its crop and
 * rotation. Unsafe geometry remains readable/translatable but cannot be masked. */
export function buildPdfLayout(items: readonly unknown[], styles: Readonly<Record<string, PdfTextStyle>>, viewport: PdfLayoutViewport): PdfLayout {
  const width = Number.isFinite(viewport.width) && viewport.width > 0 ? viewport.width : 0;
  const height = Number.isFinite(viewport.height) && viewport.height > 0 ? viewport.height : 0;
  const transform = width && height ? matrix(viewport.transform) : undefined;
  const result: PdfLayout = { width, height, blocks: [], truncated: false, reasons: [] };
  const reasons = new Set<PdfLayoutReason>(); const runs: Run[] = [];
  if (!transform) reasons.add('invalid-viewport');
  let characters = 0;
  const count = Math.min(items.length, MAX_LAYOUT_ITEMS);
  if (items.length > count) { result.truncated = true; reasons.add('item-limit'); }
  for (let index = 0; index < count; index++) {
    const raw = items[index];
    if (!raw || typeof raw !== 'object' || !('str' in raw) || typeof raw.str !== 'string') continue;
    const remaining = MAX_PAGE_CHARACTERS - characters;
    const clippedText = raw.str.length > remaining;
    const source = raw.str.slice(0, remaining); characters += source.length;
    if (clippedText) { result.truncated = true; reasons.add('character-limit'); }
    const text = source.replace(/\s+/g, ' ').trim();
    const item = raw as Record<string, unknown>;
    // PDF.js emits wide whitespace advances between table cells. They have no
    // ink and must not bridge the gutter or expand a translation mask.
    if (!text) {
      if (runs.length) { runs.at(-1)!.trailingSpace = true; if (item.hasEOL) runs.at(-1)!.endOfLine = true; }
      if (clippedText) break; continue;
    }
    const runReasons = new Set<PdfLayoutReason>();
    if (clippedText) runReasons.add('character-limit');
    if (text.length > MAX_LAYOUT_TEXT_CHARACTERS) runReasons.add('long-text');
    runs.push({ index, text, ...geometry(item, { ...viewport, width, height }, transform, styles, runReasons),
      font: typeof item.fontName === 'string' ? item.fontName : '', endOfLine: item.hasEOL === true,
      leadingSpace: /^\s/.test(source), trailingSpace: /\s$/.test(source), reasons: runReasons, owner: -1 });
    if (clippedText) break;
  }
  const rows = buildRows(runs); const drafts: Draft[] = [];
  let previous: Draft[] = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex]!; const current: Draft[] = [];
    for (const line of row.lines) {
      const ownReasons = new Set(line.runs.flatMap(run => [...run.reasons]));
      const candidate = previous.find(draft => {
        const gap = line.baseline - draft.last.baseline;
        const box = union(draft.block.box, line.box);
        return draft.row === rowIndex - 1 && !row.tableLike && !draft.lastTableLike && !ownReasons.size && draft.block.layoutSafe
          && languageText(line.text) && draft.block.translatable
          && gap >= Math.min(draft.last.fontSize, line.fontSize) * 0.7 && gap <= Math.max(draft.last.fontSize, line.fontSize) * 1.65
          && Math.abs(draft.last.box.x - line.box.x) <= line.fontSize * 0.6
          && Math.abs(draft.last.fontSize - line.fontSize) <= line.fontSize * 0.15
          && draft.block.text.length + 1 + line.text.length <= MAX_LAYOUT_TEXT_CHARACTERS
          && [...draft.last.fonts].some(font => line.fonts.has(font))
          && row.lines.every(peer => peer === line || !intersects(box, peer.box));
      });
      let draft: Draft;
      if (candidate) {
        draft = candidate; draft.block.text += ` ${line.text}`; draft.block.box = union(draft.block.box, line.box);
        draft.block.inkRects.push(...line.runs.map(run => run.rect));
        draft.rows++; draft.block.lineHeight = (line.baseline - draft.firstBaseline) / (draft.rows - 1);
        draft.last = line; draft.row = rowIndex; draft.lastTableLike = row.tableLike;
      } else {
        if (drafts.length >= MAX_PAGE_PARAGRAPHS) { result.truncated = true; reasons.add('block-limit'); break; }
        if (line.text.length > MAX_LAYOUT_TEXT_CHARACTERS) ownReasons.add('long-text');
        const block: PdfLayoutBlock = { id: `pdf-block-${line.runs[0]!.index}`, text: line.text, box: { ...line.box },
          inkRects: line.runs.map(run => run.rect), fontSize: line.fontSize, lineHeight: Math.max(line.fontSize, line.box.height),
          translatable: languageText(line.text) && !ownReasons.has('long-text') && !ownReasons.has('character-limit'),
          layoutSafe: ownReasons.size === 0, reasons: [...ownReasons] };
        draft = { block, last: line, row: rowIndex, rows: 1, firstBaseline: line.baseline, lastTableLike: row.tableLike };
        drafts.push(draft); result.blocks.push(block);
      }
      const owner = result.blocks.indexOf(draft.block);
      for (const run of line.runs) run.owner = owner;
      current.push(draft);
    }
    if (reasons.has('block-limit')) break;
    previous = current;
  }
  let outputCharacters = 0;
  for (let index = 0; index < result.blocks.length; index++) {
    const block = result.blocks[index]!;
    if (outputCharacters + block.text.length > MAX_PAGE_CHARACTERS) {
      result.truncated = true; reasons.add('character-limit');
      block.text = block.text.slice(0, MAX_PAGE_CHARACTERS - outputCharacters);
      block.layoutSafe = false; block.translatable = false; block.reasons.push('character-limit');
      result.blocks.length = block.text ? index + 1 : index;
      break;
    }
    outputCharacters += block.text.length;
  }
  // The paragraph envelope may contain a shorter neighbouring column or an
  // overlapping OCR layer. Check against every retained run, including runs
  // beyond the 200-block output cap. A y sweep avoids full pairwise scanning on
  // ordinary pages; both dimensions are bounded on pathological pages too.
  const ordered = [...runs].sort((a, b) => a.rect.y - b.rect.y); let cursor = 0; let active: Run[] = [];
  for (const { block, index } of result.blocks.map((block, index) => ({ block, index })).sort((a, b) => a.block.box.y - b.block.box.y)) {
    while (cursor < ordered.length && ordered[cursor]!.rect.y < bottom(block.box)) active.push(ordered[cursor++]!);
    active = active.filter(run => bottom(run.rect) > block.box.y);
    if (active.some(run => run.owner !== index && intersects(block.box, run.rect))) {
      block.layoutSafe = false; if (!block.reasons.includes('overlapping-text')) block.reasons.push('overlapping-text');
    }
    for (const reason of block.reasons) reasons.add(reason);
  }
  result.reasons = [...reasons];
  return result;
}
