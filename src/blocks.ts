export const OWN = 'data-cloudys-gloss';
const excluded = `script,style,noscript,pre,code,textarea,input,select,button,svg,canvas,iframe,[contenteditable]:not([contenteditable="false"]),[translate="no"],[hidden],[aria-hidden="true"],[${OWN}]`;
const navigation = 'nav,summary,label,search,[role="search"],[role="navigation"],[role="menu"],[role="menubar"],[role="toolbar"],[role="tablist"],[role="tab"],[role="button"],[role="switch"],[role="slider"],[aria-haspopup],[aria-controls],a.button,a.btn,a.cta';
const semantic = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,td,th,dt,dd,div,section,article,main';
export function excludedElement(element: Element) { return !!element.closest(excluded); }
function hiddenStyle(style: CSSStyleDeclaration) {
  return style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.opacity === '0' || style.contentVisibility === 'hidden';
}
function excludedTranslationElement(element: Element) {
  if (excludedElement(element) || element.closest(`${navigation},[inert]`)) return true;
  // Inline declarations are cheap to inspect during scanning: no layout or
  // computed-style reads for the rest of a long page.
  for (let styled = element.closest('[style]'); styled; styled = styled.parentElement?.closest('[style]') ?? null) {
    if (styled instanceof HTMLElement && hiddenStyle(styled.style)) return true;
  }
  return false;
}
export function blockText(element: Element, includeNested = true, visible?: (element: Element) => boolean) {
  // Whole-block extraction also supplies selection context. Only automatic
  // translation (includeNested=false) skips navigation and menu labels.
  const shouldExclude = includeNested ? excludedElement : excludedTranslationElement;
  if (shouldExclude(element) || visible && !visible(element)) return '';
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, { acceptNode(node) {
    if (node instanceof Element) {
      if (shouldExclude(node) || (!includeNested && node.matches(semantic)) || visible && !visible(node)) return NodeFilter.FILTER_REJECT;
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
  if (!element.matches('div,section,td,th')) return false;
  let links = 0;
  let directLinksOnly = element.matches('div,section');
  for (const node of element.childNodes) {
    if (node instanceof Element) {
      if (node.hasAttribute(OWN)) continue;
      if (!node.matches('a[href]')) { directLinksOnly = false; break; }
      links++;
    } else if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) { directLinksOnly = false; break; }
  }
  if (directLinksOnly && links >= 2) return true;
  // Older table layouts express navigation as short links wrapped in spans or
  // bold labels, separated by pipes. Prose and long reading links do not match.
  links = 0;
  const nodes = [...element.childNodes];
  while (nodes.length) {
    const node = nodes.pop()!;
    if (node instanceof Element) {
      if (node.hasAttribute(OWN)) continue;
      if (node.matches('a[href]')) {
        const text = node.textContent?.trim() ?? '';
        if (!text || text.length > 40) return false;
        links++;
      } else {
        if (!node.matches('span,b,strong,i,em,small')) return false;
        nodes.push(...node.childNodes);
      }
    } else if (node.nodeType === Node.TEXT_NODE && !/^[\s|·•/]*$/u.test(node.textContent ?? '')) return false;
  }
  return links >= 3;
}
function toolbarCompanion(element: Element) {
  if (!element.matches('td,th') || !element.parentElement?.matches('tr')) return false;
  let links = 0;
  const nodes = [...element.childNodes];
  while (nodes.length) {
    const node = nodes.pop()!;
    if (node instanceof Element) {
      if (node.hasAttribute(OWN)) continue;
      if (node.matches('a[href]')) {
        const text = node.textContent?.trim() ?? '';
        if (!text || text.length > 40 || ++links > 1) return false;
      } else {
        if (!node.matches('span,b,strong,i,em,small')) return false;
        nodes.push(...node.childNodes);
      }
    } else if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) return false;
  }
  // A lone link is usually reading content. Treat it as a control only when
  // another cell in this exact row already establishes a navigation toolbar.
  return links === 1 && [...element.parentElement.children].some((sibling) => sibling !== element && linkGroup(sibling));
}
export function semanticText(element: Element) {
  if (!element.matches(semantic) || linkGroup(element) || toolbarCompanion(element)) return '';
  const text = blockText(element, false);
  return text.length >= 2 && /[a-zA-Z\u00c0-\u024f]/.test(text) ? text : '';
}
/** Resolve stylesheet-only hiding for one nearby block, never a full DOM scan. */
export function renderedSemanticText(element: Element) {
  if (!element.matches(semantic) || linkGroup(element) || toolbarCompanion(element)) return '';
  const styles = new Map<Element, CSSStyleDeclaration>();
  const visible = (node: Element) => {
    let style = styles.get(node);
    if (!style) { style = getComputedStyle(node); styles.set(node, style); }
    if (hiddenStyle(style)) return false;
    const clipped = /rect\(0(?:px)?[, ]+0(?:px)?[, ]+0(?:px)?[, ]+0(?:px)?\)/.test(style.clip)
      || /^inset\(50%\)$/.test(style.clipPath);
    const tinyClipped = ['absolute', 'fixed'].includes(style.position) && parseFloat(style.width) <= 1 && parseFloat(style.height) <= 1 && style.overflow === 'hidden';
    return !clipped && !tinyClipped;
  };
  for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) if (!visible(ancestor)) return '';
  const text = blockText(element, false, visible);
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
