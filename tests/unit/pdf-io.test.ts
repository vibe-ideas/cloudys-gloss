import { describe, expect, it, vi } from 'vitest';
import { MAX_PDF_BYTES, pdfUrl, readPdfUrl, validatePdf } from '../../src/pdf/io';
const bytes = (value: string) => new TextEncoder().encode(value);
describe('PDF 文件读取边界', () => {
  it('只接受无内嵌凭据的 HTTP(S) URL，本地文件由选择器读取', () => {
    expect(pdfUrl('https://example.com/book.pdf?download=1').hostname).toBe('example.com');
    for (const value of ['file:///book.pdf', 'javascript:alert(1)', 'https://user:secret@example.com/book.pdf', 'book.pdf']) expect(() => pdfUrl(value)).toThrow();
  });
  it('收到登录网页或空文件时报告可恢复错误，不交给 PDF 解析器', () => {
    expect(() => validatePdf(bytes('<html>Sign in</html>'))).toThrow('不是有效的 PDF');
    expect(() => validatePdf(new Uint8Array())).toThrow('文件为空');
    expect(validatePdf(bytes('%PDF-1.7\n'))).toHaveLength(9);
  });
  it('有 Content-Length 的超大 PDF 在读取正文前被拒绝并取消下载', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), { headers: { 'content-length': String(MAX_PDF_BYTES + 1) } });
    await expect(readPdfUrl('https://example.com/book.pdf', new AbortController().signal, vi.fn().mockResolvedValue(response))).rejects.toThrow('超过 40 MB');
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('分块下载隐藏了文件大小时仍执行 40 MB 上限并取消流', async () => {
    const cancel = vi.fn(); let next = 0;
    const response = new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(++next === 1 ? MAX_PDF_BYTES : 1)); }, cancel }));
    await expect(readPdfUrl('https://example.com/book.pdf', new AbortController().signal, vi.fn().mockResolvedValue(response))).rejects.toThrow('超过 40 MB');
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('下载成功后合并分块字节且不携带网站 cookies 或 referrer', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes('%PDF-')); controller.enqueue(bytes('1.7\n')); controller.close(); } })));
    const signal = new AbortController().signal;
    expect(new TextDecoder().decode(await readPdfUrl('https://example.com/book.pdf', signal, fetcher))).toBe('%PDF-1.7\n');
    expect(fetcher).toHaveBeenCalledWith(new URL('https://example.com/book.pdf'), { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
  });
  it('下载被取消时释放尚未读完的响应流，不把部分 PDF 交给解析器', async () => {
    const controller = new AbortController(); const cancel = vi.fn();
    const response = new Response(new ReadableStream({ start(stream) { stream.enqueue(bytes('%PDF-1.7\n')); }, cancel }));
    const fetcher = vi.fn().mockImplementation(async () => { controller.abort(new Error('用户取消下载')); return response; });
    await expect(readPdfUrl('https://example.com/book.pdf', controller.signal, fetcher)).rejects.toThrow('用户取消下载');
    expect(cancel).toHaveBeenCalledOnce();
  });
});
