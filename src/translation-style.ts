/** Keep translated prose in the page's own color context, including mixed light/dark sections. */
export function translationStyle(element: Element) {
  const source = getComputedStyle(element);
  let size = parseFloat(source.fontSize);
  let color = 'inherit';
  // Some display headlines are a paragraph containing one large styled span.
  // Read typography once at insertion, never on each streamed token.
  const textLength = element.textContent?.trim().length ?? 0;
  for (const child of element.children) {
    if (!child.matches('span,strong,b,em') || (child.textContent?.trim().length ?? 0) < textLength * .6) continue;
    const style = getComputedStyle(child);
    if (parseFloat(style.fontSize) > size * 1.3) { size = parseFloat(style.fontSize); color = style.color; }
  }
  const heading = element.matches('h1,h2,h3,h4,h5,h6') || size >= 32;
  const fontSize = heading && size >= 32 ? `${Math.min(28, Math.max(16, size * .62))}px` : heading ? 'clamp(12px,0.85em,24px)' : 'clamp(12px,0.95em,24px)';
  return `all:initial!important;display:block!important;position:static!important;float:none!important;box-sizing:border-box!important;min-inline-size:0!important;max-inline-size:100%!important;flex:0 0 100%!important;grid-column:1 / -1!important;margin:0.4em 0 0.65em!important;padding:0!important;border:0!important;background:transparent!important;color:${color}!important;opacity:1!important;font-family:inherit!important;font-size:${fontSize}!important;font-weight:${heading ? '500' : '400'}!important;font-style:normal!important;line-height:1.65!important;letter-spacing:normal!important;text-transform:none!important;text-indent:0!important;text-align:inherit!important;white-space:normal!important;overflow-wrap:anywhere!important;word-break:normal!important;direction:inherit!important;`;
}
