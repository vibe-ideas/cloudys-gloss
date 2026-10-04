import { describe, expect, it } from 'vitest';
import { pdfReaderHash, pdfTabSource } from '../../src/pdf-link';

describe('PDF 阅读入口', () => {
  it('当前页是在线 PDF 或带 PDF 格式参数的下载时预填原始地址，本地文件要求用户选择', () => {
    for (const url of ['https://example.com/report.PDF#page=3', 'https://example.com/export?format=pdf', 'https://example.com/download?filename=paper.pdf&token=signed']) {
      expect(pdfTabSource(url)).toEqual({ local: false, url });
    }
    expect(pdfTabSource('file:///Users/example/report.pdf')).toEqual({ local: true });
  });
  it('普通网页、内置页面、无效地址和含用户名密码的地址不触发 PDF 自动载入', () => {
    for (const url of [undefined, 'invalid', 'https://example.com/article', 'about:blank', 'javascript:alert(1)', 'https://user:secret@example.com/report.pdf']) {
      expect(pdfTabSource(url)).toBeUndefined();
    }
  });
  it('PDF 地址完整放入扩展页片段，签名参数与页码不会变成扩展页请求参数', () => {
    const url = 'https://example.com/report.pdf?token=a&part=2#page=3';
    const hash = pdfReaderHash(url);
    expect(hash.startsWith('#url=')).toBe(true);
    expect(new URLSearchParams(hash.slice(1)).get('url')).toBe(url);
    expect(pdfReaderHash()).toBe('');
  });
});
