/** Protect code and names with checked, reversible markers, never guessed replacements. */
export function protectTranslationLiterals(source: string) {
  let prefix = 'ZXQCG';
  while (source.toLowerCase().includes(prefix.toLowerCase())) prefix += 'Z';
  const values: string[] = [];
  const counts: number[] = [];
  const mask = (value: string) => {
    let index = values.indexOf(value);
    if (index < 0) { index = values.push(value) - 1; counts.push(0); }
    counts[index]!++;
    return `${prefix}${index}QXZ`;
  };
  const literals = /`[^`\n]+`|https?:\/\/[^\s<>]+|\b(?=[a-f\d]{7,40}\b)(?=[a-f\d]*\d)[a-f\d]+\b|\b[\w.-]+(?:\/[\w.-]+)*\/[\w.-]*[\w-]|(?:[A-Za-z]:\\|\.{1,2}\/|~\/|\/)[\w./\\-]*[\w/-]|\b[A-Za-z_$][\w$-]*(?:\.[\w$-]+)+(?:\([^()\n]*\))?|\b[A-Z][a-z\d]+(?:[A-Z][A-Za-z\d]*)+\b|\b[A-Z]{2,}(?:[-_]\w+)*\b|\b(?:Firefox|Chromium|Chrome|Electron|macOS|Windows|Linux)\b/gu;
  const text = source.replace(literals, mask).replace(/\b[A-Z][A-Za-z\d]+(?: [A-Z][A-Za-z\d]+)+\b/gu, value => {
    if (value.includes(prefix)) return value;
    // A title made entirely of ordinary capitalized words still needs translating.
    if (value === source.trim() && value.includes(' ') && !/[A-Z]{2}|[a-z][A-Z]/u.test(value)) return value;
    if (value.includes(' ') && /\b(?:A|An|The|Can|Could|Your|You|Without|And|Or|What|How|Why|We|Our|To|In|At|On|For|With|By|Of|Is|Are)\b/u.test(value)) return value;
    return mask(value);
  });
  const literalOnly = values.length > 0 && text.replace(new RegExp(`${prefix}\\d+QXZ`, 'g'), '').trim() === '';
  return { text, literalOnly, restore(translated: string) {
    for (const [index] of values.entries()) {
      const marker = `${prefix}${index}QXZ`;
      if ((translated.match(new RegExp(marker, 'gi'))?.length ?? 0) !== counts[index]) throw new Error('离线翻译未完整保留代码或专名');
    }
    const result = translated.replace(new RegExp(`${prefix}(\\d+)QXZ`, 'gi'), (marker, index: string) => values[Number(index)] ?? marker);
    if (result.toLowerCase().includes(prefix.toLowerCase())) throw new Error('离线翻译返回了未知标记');
    return result;
  } };
}
