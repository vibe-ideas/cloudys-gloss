import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageTranslator } from '../../src/translator';
let observers: IntersectionObserverCallback[];
type ObserverRecord = { callback: IntersectionObserverCallback; options?: IntersectionObserverInit; targets: Set<Element>; disconnected: boolean };
let observerRecords: ObserverRecord[];
const observed = new Set<Element>();
beforeEach(() => {
  observed.clear(); observers = []; observerRecords = [];
  vi.stubGlobal('IntersectionObserver', class {
    record: ObserverRecord;
    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      observers.push(callback); this.record = { callback, options, targets: new Set(), disconnected: false }; observerRecords.push(this.record);
    }
    observe(element: Element) { observed.add(element); this.record.targets.add(element); }
    unobserve(element: Element) { observed.delete(element); this.record.targets.delete(element); }
    disconnect() { observed.clear(); this.record.targets.clear(); this.record.disconnected = true; }
  });
  document.body.innerHTML = '<p>Hello <strong>world</strong>.</p><p>Another paragraph.</p>';
});
afterEach(() => vi.unstubAllGlobals());
const visible = () => observers.forEach((enter) => enter([...observed].map((target) => ({ target, isIntersecting: true } as IntersectionObserverEntry)), {} as IntersectionObserver));
const intersect = (observer: ObserverRecord, elements: Element[], isIntersecting: boolean) => observer.callback(elements.map((target) => ({ target, isIntersecting } as IntersectionObserverEntry)), {} as IntersectionObserver);
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
  it('正文进入附近后剔除样式表隐藏的辅助文字，流式结果仍能完成且修改原文会重新提取', async () => {
    document.body.innerHTML = '<style>.concealed{display:none}</style><p>Visible text. <span class="concealed">More ways to donate</span></p><div><a class="concealed" href="/hidden">Hidden standalone link</a></div>';
    const original = document.body.innerHTML;
    const translate = vi.fn(async (_id: string, texts: string[], receive: (index: number, text: string, confirmed: boolean) => void) => {
      texts.forEach((text, index) => receive(index, `译文：${text}`, false));
      return texts.map((text) => `译文：${text}`);
    });
    const translator = new PageTranslator({ translate, cancel: vi.fn() }); translator.start(); visible();
    await vi.waitFor(() => expect(document.querySelector('p [data-state="done"]')?.textContent).toBe('译文：Visible text.'));
    expect(translate.mock.calls.flatMap(([, texts]) => texts)).toEqual(['Visible text.']);
    expect(document.querySelector('div [data-cloudys-gloss]')).toBeNull();
    document.querySelector('p')!.firstChild!.textContent = 'Updated visible text. ';
    await vi.waitFor(() => expect(translator.status.translated).toBe(0));
    await new Promise((resolve) => setTimeout(resolve, 60)); visible();
    await vi.waitFor(() => expect(document.querySelector('p [data-state="done"]')?.textContent).toBe('译文：Updated visible text.'));
    expect(translate.mock.calls[1]![1]).toEqual(['Updated visible text.']);
    translator.stop();
    document.querySelector('p')!.firstChild!.textContent = 'Visible text. ';
    expect(document.body.innerHTML).toBe(original);
  });
  it('内部滚动面板的末段被前文译文推出可见区后，仍在附近范围内便继续完成，无需用户再次滚动', async () => {
    document.body.innerHTML = `<section id="reader" style="height:380px;overflow-y:auto">${Array.from({ length: 8 }, (_, index) => `<p>Panel paragraph ${index + 1}.</p>`).join('')}</section>`;
    const panel = document.querySelector('#reader')!;
    const paragraphs = [...panel.querySelectorAll('p')];
    const pending: (() => void)[] = [];
    const translate = vi.fn((_id: string, texts: string[]) => new Promise<string[]>((resolve) => pending.push(() => resolve(texts.map((text) => `译文：${text}`)))));
    const translator = new PageTranslator({ translate, cancel: vi.fn() }); translator.start();
    intersect(observerRecords[0]!, [paragraphs[0]!], true);
    const local = observerRecords.find((record) => record.options?.root === panel)!;
    expect(local.options?.rootMargin).toBe('500px 0px');
    expect(local.targets.size).toBe(8);
    intersect(local, paragraphs, true);
    intersect(observerRecords[1]!, paragraphs.slice(0, 4), true);
    await vi.waitFor(() => expect(translate).toHaveBeenCalledTimes(2));
    // Translation expands earlier paragraphs, so the outer observer clips the
    // last paragraph; the panel observer still sees it in its prefetch margin.
    intersect(observerRecords[0]!, paragraphs.slice(4), false);
    intersect(observerRecords[1]!, paragraphs.slice(4), false);
    pending[0]!(); pending[1]!();
    await vi.waitFor(() => expect(translate).toHaveBeenCalledTimes(4));
    pending[2]!(); pending[3]!();
    await vi.waitFor(() => expect(paragraphs[7]!.querySelector('[data-state="done"]')?.textContent).toBe('译文：Panel paragraph 8.'));
    expect(translate.mock.calls.flatMap(([, texts]) => texts)).toHaveLength(8);
    translator.stop();
  });
  it('内部滚动面板离开页面附近时取消请求，即使段落仍在壳内附近也不继续请求，返回后仍优先实际可见段落', async () => {
    document.body.innerHTML = `<section id="reader" style="height:380px;overflow-y:auto">${Array.from({ length: 8 }, (_, index) => `<p>Panel paragraph ${index + 1}.</p>`).join('')}</section>`;
    const panel = document.querySelector('#reader')!;
    const paragraphs = [...panel.querySelectorAll('p')];
    const translate = vi.fn<(id: string, texts: string[]) => Promise<string[]>>(() => new Promise<string[]>(() => {}));
    const cancel = vi.fn();
    const translator = new PageTranslator({ translate, cancel }); translator.start();
    intersect(observerRecords[0]!, [paragraphs[0]!], true);
    const local = observerRecords.find((record) => record.options?.root === panel)!;
    const gate = observerRecords.find((record) => record.targets.has(panel))!;
    intersect(local, paragraphs, true);
    await vi.waitFor(() => expect(translate).toHaveBeenCalledTimes(2));
    intersect(gate, [panel], false);
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(2));
    intersect(local, paragraphs, true);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(translate).toHaveBeenCalledTimes(2);
    intersect(local, paragraphs, false);
    intersect(gate, [panel], true);
    intersect(local, paragraphs.slice(6), true);
    intersect(observerRecords[1]!, [paragraphs[7]!], true);
    await vi.waitFor(() => expect(translate).toHaveBeenCalledTimes(3));
    expect(translate.mock.calls[2]![1]).toEqual(['Panel paragraph 8.', 'Panel paragraph 7.']);
    translator.stop();
    expect(observerRecords.every((record) => record.disconnected && !record.targets.size)).toBe(true);
    expect(document.querySelector('[data-cloudys-gloss]')).toBeNull();
  });
  it('SPA 向已发现的滚动面板追加段落时复用现有观察器，移除面板后释放其观察器', async () => {
    document.body.innerHTML = '<section id="reader" style="height:380px;overflow-y:auto"><p>Existing panel paragraph.</p></section>';
    const panel = document.querySelector('#reader')!;
    const translate = vi.fn(async (_id: string, texts: string[]) => texts.map((text) => `译文：${text}`));
    const translator = new PageTranslator({ translate, cancel: vi.fn() }); translator.start();
    intersect(observerRecords[0]!, [panel.querySelector('p')!], true);
    const local = observerRecords.find((record) => record.options?.root === panel)!;
    const count = observerRecords.length;
    const paragraph = document.createElement('p'); paragraph.textContent = 'New panel paragraph.'; panel.append(paragraph);
    await vi.waitFor(() => expect(local.targets.has(paragraph)).toBe(true));
    expect(observerRecords).toHaveLength(count);
    intersect(local, [paragraph], true);
    await vi.waitFor(() => expect(paragraph.querySelector('[data-state="done"]')?.textContent).toBe('译文：New panel paragraph.'));
    panel.remove();
    await vi.waitFor(() => expect(local.disconnected).toBe(true));
    expect(local.targets.size).toBe(0);
    translator.stop();
  });
});
