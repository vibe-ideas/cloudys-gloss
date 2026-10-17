import type { WordCard } from './schema';

const han = /\p{Script=Han}/u;
const hanEnd = /\p{Script=Han}$/u;
const hanStart = /^\p{Script=Han}/u;
const westernEnd = /[\p{Script=Latin}\p{M}0-9%+#]$/u;
const westernStart = /^[\p{Script=Latin}0-9]/u;
// Protect literal content before spacing prose. Unclosed code spans/fences also
// stay literal. Ambiguous unspaced Chinese URL/path suffixes remain part of the
// address: guessing their boundary could corrupt a valid resource identifier.
const literals = /(`+)[\s\S]*?(?:\1(?!`)|$)|~~~[\s\S]*?(?:~~~|$)|(?:https?:\/\/|ftp:\/\/|file:\/\/|www\.)[^\s<>"`，。！？；：（）【】[\]()]+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|(?:[A-Za-z]:\\|\.{1,2}\/|~\/|\/)[\p{L}\p{N}_.~%+@/\\-]+/gu;

function prose(text: string) {
  return text
    .replace(/(\p{Script=Han})([\p{Script=Latin}0-9])/gu, '$1 $2')
    .replace(/([\p{Script=Latin}\p{M}0-9])(\p{Script=Han})/gu, '$1 $2')
    .replace(/((?:[0-9]%|[Cc]\+\+|[Cc]#))(\p{Script=Han})/gu, '$1 $2');
}

/** Plain-text spacing shared by streams, cached translations, PDFs and AI cards.
 * Does not collapse whitespace, rewrite punctuation, or touch English drafts.
 * Return the original near schema limits rather than truncate user content. */
export function chineseSpacing(text: string, maxLength = 20000): string {
  if (!han.test(text)) return text;
  const parts: string[] = [];
  let offset = 0;
  for (const match of text.matchAll(literals)) {
    const before = prose(text.slice(offset, match.index));
    const literal = match[0];
    const inlineCode = literal.startsWith('`') && !literal.includes('\n') && !literal.includes('\r');
    parts.push(before);
    if (hanEnd.test(before) && (inlineCode || westernStart.test(literal))) parts.push(' ');
    parts.push(literal);
    offset = match.index + literal.length;
    if (hanStart.test(text.slice(offset, offset + 2)) && (inlineCode || westernEnd.test(literal))) parts.push(' ');
  }
  parts.push(prose(text.slice(offset)));
  const result = parts.join('');
  return result.length <= maxLength ? result : text;
}

export function chineseCardSpacing(card: WordCard): WordCard {
  return {
    ...card,
    senses: card.senses.map(sense => ({ ...sense, meaning: chineseSpacing(sense.meaning, 1000) })),
    contextMeaning: chineseSpacing(card.contextMeaning, 2000),
    examples: card.examples.map(example => ({ ...example, zh: chineseSpacing(example.zh, 2000) })),
  };
}
