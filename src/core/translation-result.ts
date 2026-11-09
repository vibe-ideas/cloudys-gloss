export function isTranslation(text: string, source: string) {
  const wrapper = /^\s*\{\s*["']?(?:texts?|translations)["']?\s*:/u;
  const original = source.trim().replace(/\s+/gu, ' ');
  const words = original.match(/[a-zA-Z]+/g) ?? [];
  const copiedSentence = text.trim().replace(/\s+/gu, ' ') === original
    && /^[A-Za-z][A-Za-z\s,.'’"!?-]*[.!?]$/u.test(original)
    && words.length >= 3
    && words.filter((word) => /^[a-z]+$/u.test(word) && !/^(?:a|an|the|of|and|in|on|at|for|to|by)$/u.test(word)).length >= 2;
  return ((source.match(/[a-zA-Z]+/g)?.length ?? 0) < 8 || /[\u4e00-\u9fff]/.test(text))
    && !copiedSentence && (!wrapper.test(text) || wrapper.test(source));
}
