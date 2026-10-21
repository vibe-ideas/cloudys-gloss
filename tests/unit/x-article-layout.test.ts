import { afterEach, describe, expect, it, vi } from 'vitest';
import { TranslationLayout } from '../../src/page/translation-layout';

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

describe('X 文章的双语阅读布局', () => {
  it('文章位于自动高度的绝对定位列表单元时，标题和正文直接展示译文', () => {
    vi.stubGlobal('location', new URL('https://x.com/poteto/status/2097732320606507506'));
    document.body.innerHTML = '<div data-testid="cellInnerDiv" style="position:absolute;top:0"><span data-testid="twitter-article-title">Article title</span><div data-testid="twitterArticleReadView"><p>Article paragraph.</p></div></div>';
    const layout = new TranslationLayout();
    for (const source of document.querySelectorAll('span,p')) {
      layout.prepare(source);
      expect(layout.isHint(source)).toBe(false);
    }
    layout.stop();
  });
  it.each([
    ['普通网站的同名容器', 'https://example.com', '', ''],
    ['固定高度的列表单元', 'https://x.com', 'height:80px', ''],
    ['上下边缘固定的列表单元', 'https://x.com', 'bottom:0', ''],
    ['文章内部的绝对定位浮层', 'https://x.com', '', 'position:absolute'],
    ['文章外部的固定定位浮层', 'https://x.com', '', '', 'position:fixed'],
  ])('%s 仍使用悬浮译文，避免插入文字撑破原有布局', (_name, url, cellStyle, paragraphStyle, outerStyle = '') => {
    vi.stubGlobal('location', new URL(url));
    document.body.innerHTML = `<section style="${outerStyle}"><div data-testid="cellInnerDiv" style="position:absolute;${cellStyle}"><div data-testid="twitterArticleReadView"><p style="${paragraphStyle}">Overlay copy.</p></div></div></section>`;
    const source = document.querySelector('p')!;
    const layout = new TranslationLayout(); layout.prepare(source);
    expect(layout.isHint(source)).toBe(true);
    layout.stop();
  });
});
