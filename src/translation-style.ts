/** Keep translated prose in the page's own color context, including mixed light/dark sections. */
export function translationStyle(element: Element) {
  const heading = element.matches('h1,h2,h3,h4,h5,h6');
  return `all:initial!important;display:block!important;box-sizing:border-box!important;max-inline-size:100%!important;margin:0.4em 0 0.65em!important;padding:0!important;border:0!important;background:transparent!important;color:inherit!important;opacity:1!important;font-family:inherit!important;font-size:${heading ? 'clamp(16px,0.62em,28px)' : '0.95em'}!important;font-weight:${heading ? '500' : '400'}!important;font-style:normal!important;line-height:1.75!important;letter-spacing:normal!important;text-transform:none!important;text-indent:0!important;text-align:inherit!important;white-space:normal!important;overflow-wrap:anywhere!important;word-break:normal!important;direction:inherit!important;`;
}
