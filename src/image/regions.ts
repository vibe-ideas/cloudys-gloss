import { z } from 'zod';

export const ImageLineSchema = z.object({
  text: z.string().trim().min(1).max(4000), score: z.number().min(0).max(1),
  poly: z.array(z.tuple([z.number().finite(), z.number().finite()])).length(4),
});
export const ImageOcrSchema = z.object({
  image: z.object({ width: z.number().int().positive().max(24000), height: z.number().int().positive().max(24000) }),
  items: z.array(ImageLineSchema).max(1000),
});
export type ImageOcr = z.infer<typeof ImageOcrSchema>;
export type ImageLine = z.infer<typeof ImageLineSchema>;
export type ReadingLine = ImageLine & { translation?: string; error?: string; confirmed?: boolean };

export function localImageModel(baseUrl: string) {
  try {
    const url = new URL(baseUrl);
    return ['http:', 'https:'].includes(url.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}
export function imageTextNeedsTranslation(text: string) {
  if (/^[A-Za-z\d_$]+(?:[-_.][A-Za-z\d_$]+)+$/.test(text.trim())) return false;
  return /[a-zA-Z]{2}/.test(text) && !/^[\d\s.,/%+−–—():×=<>-]+$/.test(text);
}
export function imageOrdinaryWords(source: string) {
  const prose = source.replace(/`[^`]+`|https?:\/\/\S+|\b[\w.-]+(?:\/[\w.-]+)+|\b[\w-]+\.[\w.-]+\b/g, '');
  return [...new Set(prose.match(/\b[a-z]{2,}\b/g) ?? [])];
}
export function validateImageTranslation(source: string, translated: string) {
  if (!translated.trim() || translated.length > 20000) return false;
  if ((source.match(/[A-Za-z]+/g) ?? []).some(word => /^[a-z]{2,}$/.test(word)) && !/[\u3400-\u9fff]/u.test(translated)) return false;
  const ordinaryWords = imageOrdinaryWords(source);
  if (ordinaryWords.some(word => new RegExp(`\\b${word}\\b`, 'i').test(translated))) return false;
  const numbers = (text: string) => (text.match(/[+\-−]?\d+(?:[.,]\d+)*(?:\s*%)?/g) ?? []).map(value => value.replace(/\s/g, '').replace('−', '-')).sort();
  // Figure numbers, percentages, minus signs and repeated values cannot silently change.
  return JSON.stringify(numbers(source)) === JSON.stringify(numbers(translated));
}
export function lineGeometry(line: ImageLine, image: ImageOcr['image']) {
  const [a, b, , d] = line.poly;
  const width = Math.hypot(b![0] - a![0], b![1] - a![1]);
  const height = Math.hypot(d![0] - a![0], d![1] - a![1]);
  if (width < 2 || height < 2 || line.poly.some(([x, y]) => x < 0 || y < 0 || x > image.width || y > image.height)) return undefined;
  return { x: a![0], y: a![1], width, height, angle: Math.atan2(b![1] - a![1], b![0] - a![0]) * 180 / Math.PI };
}
