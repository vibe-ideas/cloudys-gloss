import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageTranslator } from '../../src/translator';
let observers: IntersectionObserverCallback[];
const observed = new Set<Element>();
beforeEach(() => {
  observed.clear(); observers = [];
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { observers.push(callback); }
    observe(element: Element) { observed.add(element); }
    unobserve(element: Element) { observed.delete(element); }
    disconnect() { observed.clear(); }
  });
  document.body.innerHTML = '<p>Hello <strong>world</strong>.</p><p>Another paragraph.</p>';
});
afterEach(() => vi.unstubAllGlobals());
const visible = () => observers.forEach((enter) => enter([...observed].map((target) => ({ target, isIntersecting: true } as IntersectionObserverEntry)), {} as IntersectionObserver));
describe('双语阅读生命周期', () => {
  it('同批第一段已返回、第二段仍在生成时先展示第一段，停止后移除所有进度节点', async () => {
    let receive!: (index: number, text: string, confirmed: boolean) => void;
    let finish!: (values: string[]) => void;
    const translator = new PageTranslator({ translate: (_id, _texts, callback) => { receive = callback; return new Promise((resolve) => { finish = resolve; }); }, cancel: vi.fn() });
    translator.start(); visible();
    await vi.waitFor(() => expect(document.querySelector('[data-state="translating"]')).not.toBeNull());
    receive(0, '第一段已翻译', false);
    await vi.waitFor(() => expect(document.querySelector('p')!.textContent).toContain('第一段已翻译'));
    expect(document.querySelectorAll('p')[1]!.querySelector('[aria-label="翻译中"]')).not.toBeNull();
    expect(document.querySelectorAll('p')[1]!.textContent).toBe('Another paragraph.');
    expect(translator.status.translated).toBe(0);
    translator.stop(); finish(['第一段已翻译', '第二段']);
    await Promise.resolve(); expect(document.querySelector('[data-cloudys-gloss]')).toBeNull();
  });
  it('滚动离开旧段落时取消旧请求，让新视口段落先开始且忽略旧进度', async () => {
    const callbacks: ((index: number, text: string, confirmed: boolean) => void)[] = [];
    const cancel = vi.fn();
    const translate = vi.fn((_id: string, _texts: string[], callback: typeof callbacks[number]) => { callbacks.push(callback); return new Promise<string[]>(() => {}); });
    const translator = new PageTranslator({ translate, cancel }); translator.start(); visible();
    await vi.waitFor(() => expect(translate).toHaveBeenCalledTimes(1));
    observers[0]!([...observed].map((target) => ({ target, isIntersecting: false } as IntersectionObserverEntry)), {} as IntersectionObserver);
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
    callbacks[0]!(0, '不应出现的旧结果', true);
    expect(document.body.textContent).not.toContain('不应出现的旧结果');
    visible(); await vi.waitFor(() => expect(translate).toHaveBeenCalledTimes(2)); translator.stop();
  });
  it('附近有大量段落时先翻译实际可见段落，每批最多两段且不超过 1800 字符', async () => {
    document.body.innerHTML = Array.from({ length: 8 }, (_, i) => `<p id="p${i}">Paragraph ${i} ${'read '.repeat(120)}</p>`).join('');
    const translate = vi.fn(() => new Promise<string[]>(() => {}));
    const translator = new PageTranslator({ translate, cancel: vi.fn() }); translator.start();
    observers[0]!([...observed].map((target) => ({ target, isIntersecting: true } as IntersectionObserverEntry)), {} as IntersectionObserver);
    observers[1]!([{ target: document.querySelector('#p5'), isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    await vi.waitFor(() => expect(translate).toHaveBeenCalledTimes(2));
    const calls = translate.mock.calls as unknown as [string, string[]][];
    expect(calls[0]![1][0]).toContain('Paragraph 5');
    for (const [, texts] of calls) { expect(texts.length).toBeLessThanOrEqual(2); expect(texts.join('').length).toBeLessThanOrEqual(1800); }
    translator.stop();
  });
  it('屏幕外段落不请求，进入附近后合并请求，关闭后原 DOM 完全恢复', async () => {
    const original = document.body.innerHTML;
    const translate = vi.fn(async (_id: string, texts: string[]) => texts.map((text) => `中文：${text}`));
    const translator = new PageTranslator({ translate, cancel: vi.fn() });
    translator.start(); expect(translate).not.toHaveBeenCalled(); visible();
    await vi.waitFor(() => expect(translator.status.translated).toBe(2));
    expect(translate).toHaveBeenCalledTimes(1); expect(translate.mock.calls[0]![1]).toEqual(['Hello world.', 'Another paragraph.']);
    translator.stop(); expect(document.body.innerHTML).toBe(original);
  });
  it('关闭翻译后迟到的模型结果不会重新插入页面', async () => {
    let finish!: (values: string[]) => void;
    const cancel = vi.fn(); const translator = new PageTranslator({ translate: () => new Promise((resolve) => { finish = resolve; }), cancel });
    translator.start(); visible(); await vi.waitFor(() => expect(translator.status.pending).toBe(1));
    translator.stop(); finish(['你好', '另一段']); await Promise.resolve();
    expect(cancel).toHaveBeenCalledTimes(1); expect(document.querySelector('[data-cloudys-gloss]')).toBeNull();
  });
  it('SPA 修改原段落后移除旧译文并只翻译更新后的内容', async () => {
    const translate = vi.fn(async (_id: string, texts: string[]) => texts.map((text) => `中文：${text}`));
    const translator = new PageTranslator({ translate, cancel: vi.fn() }); translator.start(); visible();
    await vi.waitFor(() => expect(translator.status.translated).toBe(2));
    document.querySelector('p')!.firstChild!.textContent = 'Changed ';
    await vi.waitFor(() => expect(translator.status.translated).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 60)); visible();
    await vi.waitFor(() => expect(document.querySelector('p [data-cloudys-gloss]')?.textContent).toBe('中文：Changed world.'));
    expect(translate.mock.calls[1]![1]).toEqual(['Changed world.']); translator.stop();
  });
});
