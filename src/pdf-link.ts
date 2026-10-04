/** Only prefill a PDF when the active tab's URL identifies it as one. Other
 * downloads can still be opened by pasting a URL in the PDF reader. */
export function pdfTabSource(value?: string): { local: boolean; url?: string } | undefined {
  if (!value) return;
  try {
    const url = new URL(value);
    if (!['http:', 'https:', 'file:'].includes(url.protocol) || url.username || url.password) return;
    const isPdf = /\.pdf$/i.test(url.pathname)
      || url.searchParams.get('format')?.toLowerCase() === 'pdf'
      || ['filename', 'download'].some(key => /\.pdf$/i.test(url.searchParams.get(key) ?? ''));
    if (!isPdf) return;
    return url.protocol === 'file:' ? { local: true } : { local: false, url: value };
  } catch { return; }
}

export function pdfReaderHash(url?: string) {
  return url ? `#${new URLSearchParams({ url }).toString()}` : '';
}
