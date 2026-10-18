import { needsChineseTranslation } from '../core/source-language';

export const OWN = 'data-cloudys-gloss';
const excluded = `script,style,noscript,pre,code,textarea,input,select,option,svg,canvas,iframe,[contenteditable]:not([contenteditable="false"]),[translate="no"],[${OWN}],.ytp-caption-window-container`;
const hidden = '[hidden],[aria-hidden="true"],[inert]';
const controls = 'button,summary,label,legend,[role="button"],[role="tab"],[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],[role="switch"],[role="checkbox"],[role="radio"],[aria-haspopup],a[aria-controls],a.button,a.btn,a.cta';
const navigation = 'nav,header,footer,search,[role="navigation"],[role="menu"],[role="menubar"],[role="toolbar"],[role="tablist"],[role="search"],[role="breadcrumb"]';
const semantic = `p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,td,th,dt,dd,div,section,article,main,${navigation},${controls},.badge,.chip,[role="status"],[role="alert"]`;
export type TranslationKind = 'prose' | 'component';
export type SemanticContext = { groups: WeakMap<Element, boolean>; revision: number };
export function semanticContext(): SemanticContext { return { groups: new WeakMap(), revision: 0 }; }
export function resetSemanticContext(context: SemanticContext) { context.groups = new WeakMap(); context.revision++; }
export function excludedElement(element: Element) { return !!element.closest(`${excluded},${hidden}`); }
function hiddenStyle(style: CSSStyleDeclaration) {
  return style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.opacity === '0' || style.contentVisibility === 'hidden';
}
function excludedTranslationElement(element: Element) {
  if (excludedElement(element)) return true;
  // Inline declarations are cheap to inspect during scanning: no layout or
  // computed-style reads for the rest of a long page.
  for (let styled = element.closest('[style]'); styled; styled = styled.parentElement?.closest('[style]') ?? null) {
    if (styled instanceof HTMLElement && hiddenStyle(styled.style)) return true;
  }
  return false;
}
function linkGroup(element: Element, context?: SemanticContext) {
  const cached = context?.groups.get(element); if (cached !== undefined) return cached;
  const result = rawLinkGroup(element); context?.groups.set(element, result); return result;
}
function rawLinkGroup(element: Element) {
  if (!element.matches('div,section,td,th')) return false;
  let links = 0;
  const nodes = [...element.childNodes];
  while (nodes.length) {
    const node = nodes.pop()!;
    if (node instanceof Element) {
      if (node.hasAttribute(OWN)) continue;
      if (node.matches('a[href]')) {
        const text = blockText(node);
        if (!text || text.length > 40) return false;
        links++;
      } else {
        if (!node.matches('span,b,strong,i,em,small')) return false;
        nodes.push(...node.childNodes);
      }
    } else if (node.nodeType === Node.TEXT_NODE && !/^[\s|·•/]*$/u.test(node.textContent ?? '')) return false;
  }
  return links >= (element.matches('td,th') ? 3 : 2);
}
function componentLink(element: Element, context?: SemanticContext) {
  if (!element.matches('a')) return false;
  // A header/footer can contain article copy as well as navigation. Ordinary
  // links inside a reading block belong to that sentence; explicit CTA/role
  // controls are already handled by componentOwner before this check.
  if (element.closest('p,h1,h2,h3,h4,h5,h6,blockquote,figcaption,dt,dd')) return false;
  if (element.closest(navigation)) return true;
  for (let parent = element.parentElement; parent && parent.matches('span,b,strong,i,em,small,div,section,td,th'); parent = parent.parentElement) {
    if (linkGroup(parent, context)) return true;
    if (parent.matches('td,th') && parent.parentElement?.matches('tr') && [...parent.parentElement.children].some(sibling => linkGroup(sibling, context))) return true;
  }
  return false;
}
function componentOwner(element: Element, context?: SemanticContext) {
  const direct = element.closest(controls);
  if (direct) return direct;
  const link = element.closest('a');
  return link && componentLink(link, context) ? link : null;
}
export function translationKind(element: Element, context?: SemanticContext): TranslationKind | undefined {
  const owner = componentOwner(element, context);
  if (owner && owner !== element) return;
  if (owner === element || componentLink(element, context)) return 'component';
  if (element.matches('span,small,b,strong') && element.closest(navigation) && !element.parentElement?.closest('p,h1,h2,h3,h4,h5,h6,span,small,b,strong')) return 'component';
  if (!element.matches(semantic)) return;
  return element.matches('th,.badge,.chip,[role="status"]') || !!element.closest(navigation) && !element.matches('p,h1,h2,h3,h4,h5,h6,blockquote,figcaption') ? 'component' : 'prose';
}
function* blockTextSteps(element: Element, includeNested = true, visible?: (element: Element) => boolean, context?: SemanticContext): Generator<void, string> {
  const shouldExclude = includeNested ? excludedElement : excludedTranslationElement;
  if (shouldExclude(element) || visible && !visible(element)) return '';
  const label = !includeNested && componentOwner(element, context) === element;
  // An acceptNode filter can skip thousands of rejected sibling blocks inside
  // one nextNode() call. Walk/prune explicitly so even those boundaries yield.
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  const text: string[] = [];
  let node = walker.firstChild();
  while (node) {
    let descend = true;
    if (node instanceof Element) {
      const boundary = !includeNested && (label ? componentOwner(node, context) === node : !!translationKind(node, context));
      descend = !(shouldExclude(node) || boundary || visible && !visible(node));
    } else text.push(node.textContent ?? '');
    yield;
    if (descend && walker.firstChild()) { node = walker.currentNode; continue; }
    while (!walker.nextSibling()) {
      if (!walker.parentNode() || walker.currentNode === element) return text.join('').replace(/\s+/g, ' ').trim();
    }
    node = walker.currentNode;
  }
  return text.join('').replace(/\s+/g, ' ').trim();
}
export function blockText(element: Element, includeNested = true, visible?: (element: Element) => boolean, context?: SemanticContext) {
  const steps = blockTextSteps(element, includeNested, visible, context);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}
export function semanticBlocks(root: Element): Element[] {
  const result: Element[] = [];
  const context = semanticContext();
  for (const element of semanticCandidates(root)) if (semanticText(element, context)) result.push(element);
  return result;
}
export function semanticText(element: Element, context: SemanticContext = semanticContext()) {
  if (!translationKind(element, context)) return '';
  const text = blockText(element, false, undefined, context);
  return needsChineseTranslation(text) ? text : '';
}
/** Incremental equivalent of semanticText, including rejected child boundaries. */
export function* semanticTextSteps(element: Element, context: SemanticContext): Generator<void, string> {
  if (!translationKind(element, context)) return '';
  const text = yield* blockTextSteps(element, false, undefined, context);
  return needsChineseTranslation(text) ? text : '';
}
/** Resolve stylesheet-only hiding for one nearby block, never a full DOM scan. */
export function renderedSemanticText(element: Element, context = semanticContext()) {
  if (!translationKind(element, context)) return '';
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
  const text = blockText(element, false, visible, context);
  return needsChineseTranslation(text) ? text : '';
}
/** Yield every visited node so the caller can time-slice even text-sparse pages. */
export function* semanticCandidates(root: Element): Generator<Element> {
  if (excludedTranslationElement(root)) return;
  type Cursor = { parent: Element; next: Element | null; seen: WeakSet<Element> };
  const cursors: Cursor[] = [{ parent: root, next: root.firstElementChild, seen: new WeakSet() }];
  yield root;
  while (cursors.length) {
    const cursor = cursors[cursors.length - 1]!;
    if (!root.contains(cursor.parent)) { cursors.pop(); continue; }
    let next = cursor.next;
    // A host can remove the current node while this generator is paused. Its
    // saved sibling survives; if that sibling was removed too, revisit only
    // this parent's child list and never descend an already visited subtree.
    if (next && next.parentElement !== cursor.parent) next = cursor.parent.firstElementChild;
    if (!next) { cursors.pop(); continue; }
    cursor.next = next.nextElementSibling;
    if (cursor.seen.has(next)) { yield next; continue; }
    cursor.seen.add(next);
    if (!excludedTranslationElement(next)) cursors.push({ parent: next, next: next.firstElementChild, seen: new WeakSet() });
    yield next;
  }
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
