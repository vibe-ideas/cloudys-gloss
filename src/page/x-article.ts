/** Public X reading-view markers, independent of its generated CSS class names. */
export const X_ARTICLE_CONTENT = '[data-testid="twitterArticleReadView"],[data-testid="longformRichTextComponent"],[data-testid="twitter-article-title"]';

export function isXArticle(element: Element) {
  return /^(?:www\.|mobile\.)?(?:x|twitter)\.com$/.test(location.hostname)
    && !!element.closest(X_ARTICLE_CONTENT);
}

/** X's virtualizer measures these auto-height cells and moves following rows.
 * Leave their size/transform entirely to X. This exception is not applicable to
 * arbitrary absolute overlays, constrained cells, or fixed reading dialogs.
 */
export function isXArticleCell(element: Element, style: CSSStyleDeclaration) {
  return element instanceof HTMLElement && element.dataset.testid === 'cellInnerDiv'
    && style.position === 'absolute'
    && (!element.style.height || element.style.height === 'auto')
    && (!style.maxHeight || style.maxHeight === 'none')
    // Browsers resolve an automatic bottom inset to pixels for absolute boxes.
    && (!element.style.bottom || element.style.bottom === 'auto')
    && (!style.overflowY || style.overflowY === 'visible');
}
