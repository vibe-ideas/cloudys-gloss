import type { PdfRect } from './layout';

export type PdfTypeset = { lines: string[]; fontSize: number; lineHeight: number; overflow: boolean };
export type TextMeasure = (text: string, size: number) => number;

/** Fit in page coordinates, not screen coordinates. Zoom therefore never
 * changes wrapping or requires a new model request. Full text stays in the
 * reader's detail view; fitting must never make it arbitrarily small. */
export function fitPdfText(text: string, box: PdfRect, originalSize: number, measure: TextMeasure): PdfTypeset {
  const size = Math.max(1, originalSize);
  // CJK is breakable between graphemes; Latin words should stay together when
  // possible. Intl.Segmenter also protects emoji and combining marks.
  const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const tokens = [...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text.replace(/\r\n?/g, '\n'))].map(value => value.segment);
  const units = tokens.flatMap(token => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(token)
    ? [...graphemes.segment(token)].map(value => value.segment) : [token]);
  const wrap = (fontSize: number) => {
    const lines: string[] = []; let line = '';
    const append = (unit: string) => {
      if (!line && /^\s+$/.test(unit)) return;
      if (line && measure(line + unit, fontSize) > box.width) {
        // Keep closing punctuation with a preceding character instead of
        // leaving a Chinese full stop alone at the start of the next line.
        if (/^[，。！？；：、）》」』】〕〉]/u.test(unit)) {
          const parts = [...graphemes.segment(line.trimEnd())].map(value => value.segment);
          const carry = parts.pop() ?? '';
          if (parts.length) lines.push(parts.join(''));
          line = carry;
        } else { lines.push(line.trimEnd()); line = ''; }
      }
      line += unit;
    };
    for (const unit of units) {
      if (unit === '\n') { lines.push(line.trimEnd()); line = ''; continue; }
      if (measure(unit, fontSize) > box.width) {
        for (const { segment } of graphemes.segment(unit)) append(segment);
      } else append(unit);
    }
    if (line || !lines.length) lines.push(line.trimEnd());
    return lines;
  };
  let result: PdfTypeset = { lines: [], fontSize: size, lineHeight: size, overflow: true };
  for (const ratio of [1, 0.95, 0.9, 0.85, 0.8]) {
    const fontSize = size * ratio;
    const lines = wrap(fontSize);
    const lineHeight = fontSize * (lines.length > 1 ? 1.18 : 1);
    const count = Math.max(0, Math.floor((box.height + 0.1) / lineHeight));
    const tooWide = lines.some(line => measure(line, fontSize) > box.width + 0.1);
    result = { lines: tooWide ? [] : lines.slice(0, count), fontSize, lineHeight, overflow: tooWide || lines.length > count };
    if (!result.overflow) return result;
  }
  return result;
}

/** Numeric-only fields never enter the model. For prose with numbers, keep the
 * original visible if the model drops or alters any numeric token. Date order
 * may change and translated month names may introduce an additional number. */
export function retainsPdfNumbers(source: string, translation: string): boolean {
  const numbers = (text: string) => (text.match(/[+-]?\d+(?:[,，]\d{3})*(?:\.\d+)?%?/g) ?? [])
    .map(value => value.replace(/[,，]/g, ''));
  const remaining = numbers(translation);
  return numbers(source).every(value => { const index = remaining.indexOf(value); if (index < 0) return false; remaining.splice(index, 1); return true; });
}
