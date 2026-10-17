// A cheap per-block heuristic, not a page-wide language decision. Long product
// names count as words rather than dozens of Latin letters, so Kubernetes does
// not outweigh a short Chinese explanation. Do not call a model for detection.
const latin = /[\p{Script=Latin}]/u;
const han = /\p{Script=Han}/gu;
const word = /[\p{Script=Latin}][\p{Script=Latin}\p{M}]*(?:['’][\p{Script=Latin}]+)*/gu;
const literals = /(`+)[\s\S]*?(?:\1(?!`)|$)|(?:https?:\/\/|ftp:\/\/|www\.)[^\s<>，。！？；（）]+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|(?:[A-Za-z]:\\|\.{1,2}\/|~\/|\/)[\p{L}\p{N}_.~%+@/\\-]+/gu;
const grammar = /^(?:a|an|the|is|are|was|were|be|been|will|would|can|could|should|must|has|have|had|do|does|did|please|you|your|we|they|this|that|it|how|what|why|when|where|which)$/i;

export function needsChineseTranslation(text: string): boolean {
  if (text.length < 2 || !latin.test(text)) return false;
  // Preserve existing handling of Western-language blocks. No allocation or
  // language scoring on the common all-English path.
  if (!/\p{Script=Han}/u.test(text)) return true;
  // Han characters also occur in Japanese/Korean; they alone are not evidence
  // of Chinese when these other scripts are present.
  if (/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text)) return true;
  const prose = text.replace(literals, ' ');
  const chinese = prose.match(han)?.length ?? 0;
  const words = [...prose.matchAll(word)];
  if (!words.length) return false;
  if (chinese < 2 || chinese < words.length) return true;
  // A genuine English sentence inside an otherwise Chinese block still needs
  // translation. Isolated names/abbreviations do not form a grammatical run.
  let run = 0; let grammatical = false; let end = 0;
  for (const match of words) {
    if (prose.slice(end, match.index).trim()) { run = 0; grammatical = false; }
    run++; grammatical ||= grammar.test(match[0]);
    if (run >= 4 && grammatical) return true;
    end = match.index + match[0].length;
  }
  return false;
}
