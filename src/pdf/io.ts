export const MAX_PDF_BYTES = 40 * 1024 * 1024;
export function pdfUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('请输入完整的 HTTP 或 HTTPS PDF 地址'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('PDF 地址须使用 HTTP 或 HTTPS，且不能包含用户名或密码');
  return url;
}
export function validatePdf(data: Uint8Array): Uint8Array {
  if (!data.byteLength) throw new Error('PDF 文件为空，请重新选择');
  if (data.byteLength > MAX_PDF_BYTES) throw new Error('PDF 超过 40 MB，请选择较小的文件');
  const header = new TextDecoder().decode(data.subarray(0, 1024));
  if (!header.includes('%PDF-')) throw new Error('该地址或文件不是有效的 PDF；需要登录的网站请先下载文件，再从本地打开');
  return data;
}
export async function readPdfUrl(value: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<Uint8Array> {
  const url = pdfUrl(value);
  const response = await fetcher(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!response.ok) throw new Error(`PDF 下载失败（HTTP ${response.status}），可先下载文件再从本地打开`);
  const declared = Number(response.headers.get('content-length'));
  if (declared > MAX_PDF_BYTES) { await response.body?.cancel(); throw new Error('PDF 超过 40 MB，请选择较小的文件'); }
  if (!response.body) throw new Error('PDF 下载没有返回内容，请重新打开');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PDF_BYTES) throw new Error('PDF 超过 40 MB，请选择较小的文件');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  signal.throwIfAborted();
  const data = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  return validatePdf(data);
}
