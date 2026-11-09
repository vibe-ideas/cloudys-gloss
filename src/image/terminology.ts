/** Source-side numeric protection and a glossary for explicit computer evaluation.
 * Checked markers preserve versions, ratios and terms without rewriting model guesses.
 */
export function protectImageTerminology(source: string, context: string) {
  const technical = /\b(?:macOS|Windows|Linux|GUI|CPU|GPU|software|computer)\b/i.test(context)
    && /\b(?:driver|benchmark|harness|foreground|background)\b/i.test(context);
  let prefix = 'ZXIMG'; while (source.toLowerCase().includes(prefix.toLowerCase()) || context.toLowerCase().includes(prefix.toLowerCase())) prefix += 'Z';
  const terms: string[] = [];
  const dictionary: Record<string, string> = { 'full background pass': '后台完整通过', driver: '驱动程序', drivers: '驱动程序', background: '后台', foreground: '前台', harness: '测试框架' };
  const numbers = /[-+−]?\d+(?:[.,]\d+)*(?:[eE][+-]?\d+)?(?:\s*%)?(?:\s*\/\s*\d+(?:[.,]\d+)*(?:\s*%)?)?/g;
  // A nominal software/version/component label has an unambiguous "with"
  // relation. Preserve the component name without relying on a tiny LLM to
  // translate the connective between two identifiers (e.g. Python 3.12 with NumPy).
  const component = technical && /^[A-Z][\w.-]*\s+\d[\d.]*\s+with\s+[A-Z][\w.-]*(?=[,;]|$)/.test(source.trim());
  const pattern = technical ? new RegExp(`${component ? '\\s+with\\s+[A-Z][\\w.-]*(?=[,;]|$)|' : ''}\\b(?:full background pass|drivers?|background|foreground|harness)\\b|${numbers.source}`, 'gi') : numbers;
  const text = source.replace(pattern, value => {
    const clause = component && /^\s+with\s+/i.test(value);
    const index = terms.push(clause ? `（配有 ${value.replace(/^\s+with\s+/i, '')}）` : dictionary[value.toLowerCase()] ?? value) - 1;
    return `${clause ? ' ' : ''}${prefix}${index}QXZ`;
  });
  return { text, restore(value: string) {
    terms.forEach((_, index) => { if ((value.match(new RegExp(`${prefix}${index}QXZ`, 'gi')) ?? []).length !== 1) throw new Error('图片译文未完整保留术语标记'); });
    const result = value.replace(new RegExp(`${prefix}(\\d+)QXZ`, 'gi'), (marker, index: string) => terms[Number(index)] ?? marker);
    if (terms.length && result.toLowerCase().includes(prefix.toLowerCase())) throw new Error('图片译文含未知术语标记');
    return result;
  } };
}
