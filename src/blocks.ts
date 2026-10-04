export const OWN = 'data-cloudys-gloss';
const excluded = `script,style,noscript,pre,code,textarea,input,select,button,svg,canvas,iframe,[contenteditable]:not([contenteditable="false"]),[translate="no"],[hidden],[aria-hidden="true"],[${OWN}]`;
const semantic = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,td,th,dt,dd,div,section,article,main';
export function excludedElement(element: Element) { return !!element.closest(excluded); }
export function blockText(element: Element, includeNested = true) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, { acceptNode(node) {
    if (node instanceof Element) {
      if (excludedElement(node) || (!includeNested && node.matches(semantic))) return NodeFilter.FILTER_REJECT;
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
export function semanticText(element: Element) {
  if (!element.matches(semantic)) return '';
  const text = blockText(element, false);
  return text.length >= 2 && /[a-zA-Z\u00c0-\u024f]/.test(text) ? text : '';
}
/** Yield every visited node so the caller can time-slice even text-sparse pages. */
export function* semanticCandidates(root: Element): Generator<Element> {
  if (excludedElement(root)) return;
  yield root;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, { acceptNode(node) {
    return excludedElement(node as Element) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
  } });
  while (walker.nextNode()) yield walker.currentNode as Element;
}
export function splitText(text: string, max = 6000) {
  const parts: string[] = [];
  while (text.length > max) {
    const space = text.lastIndexOf(' ', max);
    const cut = space > max / 2 ? space : max;
    parts.push(text.slice(0, cut)); text = text.slice(cut).trimStart();
  }
  if (text) parts.push(text);
  return parts;
}
