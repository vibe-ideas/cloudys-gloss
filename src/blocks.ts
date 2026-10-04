export const OWN = 'data-cloudys-gloss';
const excluded = `script,style,noscript,pre,code,textarea,input,select,button,svg,canvas,iframe,[contenteditable]:not([contenteditable="false"]),[translate="no"],[hidden],[aria-hidden="true"],[${OWN}]`;
const navigation = 'nav,[role="navigation"],[role="menu"],[role="menubar"],[role="toolbar"]';
const semantic = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,td,th,dt,dd,div,section,article,main';
export function excludedElement(element: Element) { return !!element.closest(excluded); }
function excludedTranslationElement(element: Element) { return excludedElement(element) || !!element.closest(navigation); }
export function blockText(element: Element, includeNested = true) {
  // Whole-block extraction also supplies selection context. Only automatic
  // translation (includeNested=false) skips navigation and menu labels.
  const shouldExclude = includeNested ? excludedElement : excludedTranslationElement;
  if (shouldExclude(element)) return '';
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, { acceptNode(node) {
    if (node instanceof Element) {
      if (shouldExclude(node) || (!includeNested && node.matches(semantic))) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_SKIP;
    }
    return NodeFilter.FILTER_ACCEPT;
  } });
  let text = '';
  while (walker.nextNode()) text += walker.currentNode.textContent;
  return text.replace(/\s+/g, ' ').trim();
}
export function semanticBlocks(root: Element): Element[] {
  const result: Element[] = [];
  for (const element of semanticCandidates(root)) if (semanticText(element)) result.push(element);
  return result;
}
function linkGroup(element: Element) {
  if (!element.matches('div,section')) return false;
  let links = 0;
  for (const node of element.childNodes) {
    if (node instanceof Element) {
      if (node.hasAttribute(OWN)) continue;
      if (!node.matches('a[href]')) return false;
      links++;
    } else if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) return false;
  }
  return links >= 2;
}
export function semanticText(element: Element) {
  if (!element.matches(semantic) || linkGroup(element)) return '';
  const text = blockText(element, false);
  return text.length >= 2 && /[a-zA-Z\u00c0-\u024f]/.test(text) ? text : '';
}
/** Yield every visited node so the caller can time-slice even text-sparse pages. */
export function* semanticCandidates(root: Element): Generator<Element> {
  if (excludedTranslationElement(root)) return;
  yield root;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, { acceptNode(node) {
    return excludedTranslationElement(node as Element) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
  } });
  while (walker.nextNode()) yield walker.currentNode as Element;
}
export function splitText(text: string, max = 6000) {
  if (text.length <= max) return text ? [text] : [];
  // Walk sentence boundaries once, keeping a condition or clause together when
  // the full sentence fits the request budget. Short blocks avoid this work.
  const sentences = new Intl.Segmenter('en', { granularity: 'sentence' }).segment(text)[Symbol.iterator]();
  let next = sentences.next();
  let start = 0;
  const parts: string[] = [];
  while (text.length - start > max) {
    const limit = start + max;
    let sentenceEnd = start;
    while (!next.done) {
      const end = next.value.index + next.value.segment.trimEnd().length;
      if (end > limit) break;
      if (end > start) sentenceEnd = end;
      next = sentences.next();
    }
    const space = text.lastIndexOf(' ', limit);
    const cut = sentenceEnd > start ? sentenceEnd : space > start + max / 2 ? space : limit;
    parts.push(text.slice(start, cut));
    start = cut;
    while (start < text.length && /\s/u.test(text[start]!)) start++;
  }
  if (start < text.length) parts.push(text.slice(start));
  return parts;
}
