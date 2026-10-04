/** Select a single complete source sentence rather than inventing a different example sense. */
export function dictionaryExample(word: string, context: string): string | undefined {
  const selected = word.trim();
  if (!selected || /[\r\n\t]/u.test(selected) || typeof Intl.Segmenter !== 'function') return undefined;
  const literal = selected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const token = `[\\p{L}\\p{M}\\p{N}_'’\\-]`;
  const match = new RegExp(`(?<!${token})${literal}(?!${token})`, 'iu');
  const containing = [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(context)]
    .map(({ segment }) => segment.trim()).filter((sentence) => match.test(sentence));
  // Multiple occurrences in separate sentences lack a reliable selection-to-sentence mapping.
  if (containing.length !== 1) return undefined;
  const sentence = containing[0]!;
  const words = sentence.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? [];
  if (words.length > 25 || !/[.!?]["'”’\])}]*$/u.test(sentence)) return undefined;
  return sentence;
}
