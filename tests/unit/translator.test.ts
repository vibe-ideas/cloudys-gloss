import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageTranslator } from '../../src/page/translator';
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
  it('中文含技术名词的段落不注册翻译观察器或请求，SPA 改成英文后增量翻译，改回中文时移除旧译文', async () => {
    document.body.innerHTML = '<p id="chinese">使用 Kubernetes 与 PostgreSQL 部署服务。</p><p id="english">Read this English paragraph.</p>';
    const chinese = document.querySelector('#chinese')!; const english = document.querySelector('#english')!;
    const translate = vi.fn<import('../../src/page/translator').TranslationTransport['translate']>(async (_id, texts) => texts.map(() => '新的中文译文'));
    const translator = new PageTranslator({ translate, cancel: vi.fn() });
    try {
      translator.start();
      await vi.waitFor(() => expect(observed.has(english)).toBe(true));
      expect(observed.has(chinese)).toBe(false);
      visible(); await vi.waitFor(() => expect(translator.status.translated).toBe(1));
      expect(translate.mock.calls.flatMap(([, texts]) => texts)).toEqual(['Read this English paragraph.']);
      chinese.textContent = 'This paragraph has changed to English.';
      await vi.waitFor(() => expect(observed.has(chinese)).toBe(true));
      visible(); await vi.waitFor(() => expect(chinese.querySelector('[data-state="done"]')).not.toBeNull());
      english.textContent = '这段改为中文，API 名称不需要再翻译。';
      await vi.waitFor(() => expect(observed.has(english)).toBe(false));
      expect(english.querySelector('[data-cloudys-gloss]')).toBeNull();
      expect(translate.mock.calls.flatMap(([, texts]) => texts)).toEqual(['Read this English paragraph.', 'This paragraph has changed to English.']);
    } finally { translator.stop(); }
  });
  it('视口内正文发可见优先级，附近预取发低优先级，仍最多同时请求两批', async () => {
    document.body.innerHTML = '<p>Visible first.</p><p>Visible second.</p><p>Nearby third.</p><p>Nearby fourth.</p>';
    const translate = vi.fn<import('../../src/page/translator').TranslationTransport['translate']>(() => new Promise(() => {}));
    const translator = new PageTranslator({ translate, cancel: vi.fn() }); translator.start();
    const paragraphs = [...document.querySelectorAll('p')];
    intersect(observerRecords[0]!, paragraphs, true); intersect(observerRecords[1]!, paragraphs.slice(0, 2), true);
    await vi.waitFor(() => expect(translate).toHaveBeenCalledTimes(2));
    expect(translate.mock.calls.map(([, texts, , options]) => ({ texts, priority: options?.priority }))).toEqual([
      { texts: ['Visible first.', 'Visible second.'], priority: 'visible' },
      { texts: ['Nearby third.', 'Nearby fourth.'], priority: 'prefetch' },
    ]);
    translator.stop();
  });
  it('切到隐藏标签页后已有批次完成但不继续请求，切回后续译且不重复翻译成功段落', async () => {
    document.body.innerHTML = Array.from({ length: 8 }, (_, i) => `<p>Paragraph ${i}.</p>`).join('');
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const finish: (() => void)[] = [];
    const translate = vi.fn<import('../../src/page/translator').TranslationTransport['translate']>((_id, texts) => new Promise(resolve => finish.push(() => resolve(texts.map(text => `译文：${text}`)))));
    const cancel = vi.fn(); const translator = new PageTranslator({ translate, cancel });
    try {
      translator.start(); visible(); await vi.waitFor(() => expect(translate).toHaveBeenCalledTimes(2));
      visibility.mockReturnValue('hidden'); document.dispatchEvent(new Event('visibilitychange'));
      finish[0]!(); finish[1]!(); await vi.waitFor(() => expect(translator.status.pending).toBe(0));
      expect(translate).toHaveBeenCalledTimes(2); expect(cancel).not.toHaveBeenCalled();
      visibility.mockReturnValue('visible'); document.dispatchEvent(new Event('visibilitychange'));
      await vi.waitFor(() => expect(translate).toHaveBeenCalledTimes(4)); finish[2]!(); finish[3]!();
      await vi.waitFor(() => expect(translator.status.translated).toBe(8));
      expect(translate.mock.calls.flatMap(([, texts]) => texts)).toEqual(Array.from({ length: 8 }, (_, i) => `Paragraph ${i}.`));
    } finally { translator.stop(); visibility.mockRestore(); }
  });
  it('页面隐藏时新增段落不扫描也不请求，切回只扫描新增区域并保留原有译文', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const translate = vi.fn<import('../../src/page/translator').TranslationTransport['translate']>(async (_id, texts) => texts.map(text => `译文：${text}`));
    const translator = new PageTranslator({ translate, cancel: vi.fn() });
    const scan = vi.spyOn(document, 'createTreeWalker');
    try {
      translator.start(); visible(); await vi.waitFor(() => expect(translator.status.translated).toBe(2));
      const fullScans = scan.mock.calls.filter(([root]) => root === document.body).length;
      visibility.mockReturnValue('hidden'); document.dispatchEvent(new Event('visibilitychange'));
      const added = document.createElement('p'); added.textContent = 'New hidden-page paragraph.'; document.body.append(added);
      await new Promise(resolve => setTimeout(resolve, 80)); expect(observed.has(added)).toBe(false); expect(translate).toHaveBeenCalledOnce();
      visibility.mockReturnValue('visible'); document.dispatchEvent(new Event('visibilitychange'));
      await vi.waitFor(() => expect(observed.has(added)).toBe(true)); visible();
      await vi.waitFor(() => expect(translator.status.translated).toBe(3));
      expect(translate.mock.calls[1]![1]).toEqual(['New hidden-page paragraph.']);
      expect(scan.mock.calls.filter(([root]) => root === document.body)).toHaveLength(fullScans);
    } finally { translator.stop(); visibility.mockRestore(); scan.mockRestore(); }
  });
  it('首次扫描暂停在即将被删除的正文上时，后续存活段落仍被发现并完成翻译', async () => {
    document.body.innerHTML = '<main><p id="first">Removed paragraph.</p><p id="middle">Middle paragraph.</p><p id="last">Last paragraph.</p></main>';
    const first = document.querySelector('#first')!;
    let now = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    const add = observed.add;
    const record = vi.spyOn(observed, 'add').mockImplementation(function (this: Set<Element>, value: Element) {
      const result = add.call(this, value);
      // Pause after the paragraph is registered, before visiting its sibling.
      // This is independent of real machine timing.
      if (value === first) now = 10;
      return result;
    });
    const translate = vi.fn(async (_id: string, texts: string[]) => texts.map(text => `译文：${text}`));
    const translator = new PageTranslator({ translate, cancel: vi.fn() }); translator.start();
    record.mockRestore(); clock.mockRestore(); first.remove();
    const last = document.querySelector('#last')!;
    await vi.waitFor(() => expect(observed.has(last)).toBe(true)); visible();
    await vi.waitFor(() => expect(last.querySelector('[data-state="done"]')?.textContent).toBe('译文：Last paragraph.'));
    expect(translate.mock.calls.flatMap(([, texts]) => texts)).toEqual(['Middle paragraph.', 'Last paragraph.']);
    translator.stop();
  });
  it('包含两千个子块的大容器不会突破首次扫描节点预算，首屏正文先被发现，暂停期间修改的直接文本仍完整翻译', async () => {
    document.body.innerHTML = `<main>Original introduction. ${Array.from({ length: 2000 }, (_, i) => `<article><p id="reading-${i}">Reading ${i}.</p></article>`).join('')} Closing context.</main>`;
    const main = document.querySelector('main')!;
    const matches = Element.prototype.matches;
    let boundaries = 0;
    const match = vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
      if (this.tagName === 'ARTICLE' && selector.startsWith('p,h1,h2,h3,h4,h5,h6,li,blockquote')) boundaries++;
      return matches.call(this, selector);
    });
    // Hold the clock still to exercise the independent node budget exactly,
    // without depending on how fast this test machine executes DOM selectors.
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
    const translate = vi.fn(async (_id: string, texts: string[]) => texts.map(text => `译文：${text}`));
    const translator = new PageTranslator({ translate, cancel: vi.fn() }); translator.start();
    clock.mockRestore(); match.mockRestore();
    expect(boundaries).toBeLessThan(200);
    expect(observed.has(document.querySelector('#reading-0')!)).toBe(true);
    expect(observed.has(main)).toBe(false);
    main.firstChild!.textContent = 'Updated introduction. ';
    await vi.waitFor(() => expect(observed.has(main)).toBe(true), { timeout: 3000 });
    intersect(observerRecords[0]!, [main], true); intersect(observerRecords[1]!, [main], true);
    await vi.waitFor(() => expect(main.querySelector(':scope > [data-state="done"]')?.textContent).toBe('译文：Updated introduction. Closing context.'));
    expect(translate.mock.calls.flatMap(([, texts]) => texts)).toEqual(['Updated introduction. Closing context.']);
    translator.stop();
  });
  it('正文附近回调先到、可见回调迟到时，首批仍先发送可见正文而不会被两批导航标签抢占', async () => {
    document.body.innerHTML = `<nav>${Array.from({ length: 24 }, (_, i) => `<a href="#${i}">Section ${i}</a>`).join('')}</nav><h2>Article 0: Practical reading</h2><p>Reading 0. The first visible paragraph.</p>`;
    const translate = vi.fn<(id: string, texts: string[]) => Promise<string[]>>(() => new Promise(() => {}));
    const translator = new PageTranslator({ translate, cancel: vi.fn() }); translator.start();
    await vi.waitFor(() => expect(observed.size).toBe(26));
    const labels = [...document.querySelectorAll('a')];
    // Firefox may deliver the labels' viewport records before the copy's.
    intersect(observerRecords[1]!, labels, true);
    observerRecords[0]!.callback([...observed].map(target => {
      const rect = new DOMRect(20, target.matches('a') ? 20 : 240, 200, 30);
      return { target, isIntersecting: true, intersectionRect: rect, time: performance.now() } as IntersectionObserverEntry;
    }), {} as IntersectionObserver);
    await vi.waitFor(() => expect(translate).toHaveBeenCalledTimes(2));
    expect(translate.mock.calls[0]![1]).toEqual(['Article 0: Practical reading', 'Reading 0. The first visible paragraph.']);
    expect(translate.mock.calls[1]![1]).toHaveLength(8);
    translator.stop();
  });
  it('一千个操作标签与正文共存时先发送首屏正文，随后只合并附近标签且最多保留两个请求', async () => {
    document.body.innerHTML = `<div>${Array.from({ length: 1000 }, (_, i) => `<a href="#${i}">Section ${i}</a>`).join('')}</div><p>The first visible paragraph.</p><p>The second visible paragraph.</p>`;
    const walker = vi.spyOn(document, 'createTreeWalker');
    const translate = vi.fn<(id: string, texts: string[]) => Promise<string[]>>(() => new Promise(() => {}));
    const translator = new PageTranslator({ translate, cancel: vi.fn() }); translator.start();
    await vi.waitFor(() => expect(observed.size).toBe(1002), { timeout: 3000 });
    const nearby = [...[...document.querySelectorAll('a')].slice(0, 8), ...document.querySelectorAll('p')];
    intersect(observerRecords[0]!, nearby, true); intersect(observerRecords[1]!, nearby, true);
    await vi.waitFor(() => expect(translate).toHaveBeenCalledTimes(2));
    expect(translate.mock.calls[0]![1]).toEqual(['The first visible paragraph.', 'The second visible paragraph.']);
    expect(translate.mock.calls[1]![1]).toHaveLength(8);
    expect(translate.mock.calls[1]![1].every(text => text.startsWith('Section'))).toBe(true);
    expect(translate.mock.calls[1]![1].join('').length).toBeLessThanOrEqual(1800);
    expect(walker.mock.calls.length).toBeLessThanOrEqual(4000);
    translator.stop(); walker.mockRestore();
  });
  it('按钮静态标签翻译后保留无障碍名称与原描述，不读输入值，停止后精确恢复', async () => {
    document.body.innerHTML = '<button aria-describedby="help">Save changes</button><span id="help">Save your document.</span><label>Email address<input value="private@example.test"></label>';
    const original = document.body.innerHTML;
    const translate = vi.fn(async (_id: string, texts: string[]) => texts.map(text => `译文：${text}`));
    const translator = new PageTranslator({ translate, cancel: vi.fn() }); translator.start(); visible();
    await vi.waitFor(() => expect(translator.status.translated).toBe(2));
    const button = document.querySelector('button')!;
    const translation = button.querySelector('[data-state="done"]')!;
    expect(translation.getAttribute('aria-hidden')).toBe('true');
    expect(button.getAttribute('aria-describedby')).toBe(`help ${translation.id}`);
    expect(button.querySelectorAll('button')).toHaveLength(0);
    expect(document.querySelector('input')!.getAttribute('aria-describedby')).toBe(document.querySelector('label [data-state=done]')!.id);
    expect(translate.mock.calls.flatMap(([, texts]) => texts)).toEqual(['Save changes', 'Email address']);
    translator.stop(); expect(document.body.innerHTML).toBe(original);
  });
  it('菜单仅移除 hidden 或行内隐藏样式时重新提取局部标签，关闭翻译保留展开状态', async () => {
    document.body.innerHTML = '<nav hidden><a href="#one">Hidden navigation</a></nav><section style="display:none"><button>Hidden action</button></section>';
    const translate = vi.fn(async (_id: string, texts: string[]) => texts.map(text => `译文：${text}`));
    const translator = new PageTranslator({ translate, cancel: vi.fn() }); translator.start(); visible();
    expect(translate).not.toHaveBeenCalled();
    document.querySelector('nav')!.removeAttribute('hidden');
    document.querySelector('section')!.style.display = 'block';
    await vi.waitFor(() => expect([...observed].map(node => node.textContent).sort()).toEqual(['Hidden action', 'Hidden navigation'])); visible();
    await vi.waitFor(() => expect(translator.status.translated).toBe(2));
    expect(translate.mock.calls.flatMap(([, texts]) => texts).sort()).toEqual(['Hidden action', 'Hidden navigation']);
    translator.stop(); expect(document.querySelector('nav')!.hidden).toBe(false);
    expect(document.querySelector('section')!.style.display).toBe('block');
  });
  it('网页在双语开启后追加无障碍说明，关闭时只删除插件引用并保留新增说明', async () => {
    document.body.innerHTML = '<button aria-describedby="original-help">Save changes</button>';
    const translator = new PageTranslator({ translate: async () => ['保存更改'], cancel: vi.fn() }); translator.start(); visible();
    await vi.waitFor(() => expect(translator.status.translated).toBe(1));
    const source = document.querySelector('button')!;
    source.setAttribute('aria-describedby', `${source.getAttribute('aria-describedby')} new-help`);
    translator.stop(); expect(source.getAttribute('aria-describedby')).toBe('original-help new-help');
  });
  it('输入框已聚焦且关联标签位于固定栏时，新译文自动显示，关闭提示保留网页新增说明', async () => {
    document.body.innerHTML = '<nav style="position:fixed"><label for="setting">Save changes</label></nav><input id="setting" aria-describedby="original-help">';
    let finish!: (values: string[]) => void;
    const translator = new PageTranslator({ translate: () => new Promise(resolve => { finish = resolve; }), cancel: vi.fn() }); translator.start(); visible();
    await vi.waitFor(() => expect(translator.status.pending).toBe(1));
    const source = document.querySelector('input')!; source.focus(); finish(['保存更改']);
    await vi.waitFor(() => expect(document.querySelector<HTMLElement>('[data-cloudys-gloss="component-hint"]')?.style.display).toBe('block'));
    source.setAttribute('aria-describedby', `${source.getAttribute('aria-describedby')} new-help`);
    source.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(source.getAttribute('aria-describedby')).toBe('original-help new-help');
    translator.stop(); expect(source.getAttribute('aria-describedby')).toBe('original-help new-help');
  });
  it('应用根节点反复切换主题类和颜色样式时不会再次遍历已有的两千段文档', async () => {
    document.body.innerHTML = `<main id="app">${Array.from({ length: 2000 }, (_, i) => `<p>Document paragraph ${i}.</p>`).join('')}</main>`;
    const walker = vi.spyOn(document, 'createTreeWalker');
    const translator = new PageTranslator({ translate: vi.fn(), cancel: vi.fn() }); translator.start();
    await vi.waitFor(() => expect(observed.size).toBe(2000), { timeout: 3000 });
    const scans = walker.mock.calls.length;
    for (let i = 0; i < 10; i++) {
      document.querySelector('main')!.className = `theme-${i}`;
      document.querySelector('main')!.style.color = i % 2 ? 'black' : 'blue';
    }
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(walker).toHaveBeenCalledTimes(scans);
    translator.stop(); walker.mockRestore();
  });
  it('固定导航用一个悬浮提示显示译文，离开、Esc、滚动和关闭后不会留下提示', async () => {
    document.body.innerHTML = '<nav style="position:fixed;height:40px"><a href="#one">Support</a><a href="#two">Account</a></nav>';
    const original = document.body.innerHTML;
    const translator = new PageTranslator({ translate: async (_id, texts) => texts.map(text => `译文：${text}`), cancel: vi.fn() }); translator.start(); visible();
    await vi.waitFor(() => expect(translator.status.translated).toBe(2));
    const links = document.querySelectorAll('a');
    for (const event of ['pointerout', 'Escape', 'scroll']) {
      links[0]!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      const hint = document.querySelector<HTMLElement>('[data-cloudys-gloss="component-hint"]')!;
      expect(hint.style.display).toBe('block'); expect(hint.shadowRoot!.textContent).toContain('译文：Support');
      if (event === 'Escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      else if (event === 'scroll') window.dispatchEvent(new Event('scroll'));
      else links[0]!.dispatchEvent(new FocusEvent(event, { bubbles: true }));
      await vi.waitFor(() => expect(hint.style.display).toBe('none'));
    }
    links[1]!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(document.querySelectorAll('[data-cloudys-gloss="component-hint"]')).toHaveLength(1);
    const hostEscape = vi.fn((event: Event) => event.stopPropagation());
    links[1]!.addEventListener('keydown', hostEscape);
    links[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(hostEscape).toHaveBeenCalledTimes(1);
    expect(document.querySelector<HTMLElement>('[data-cloudys-gloss="component-hint"]')!.style.display).toBe('none');
    translator.stop(); expect(document.querySelector('[data-cloudys-gloss="component-hint"]')).toBeNull();
    expect(document.body.innerHTML).toBe(original);
  });
  it('固定控件的中间译文最终与原文相同时清除提示及可用标记', async () => {
    document.body.innerHTML = '<nav style="position:fixed"><a href="#pro">Example Pro</a></nav>';
    let receive!: (index: number, text: string, confirmed: boolean) => void;
    let finish!: (values: string[]) => void;
    const translator = new PageTranslator({ translate: (_id, _texts, callback) => { receive = callback; return new Promise(resolve => { finish = resolve; }); }, cancel: vi.fn() });
    translator.start(); visible(); await vi.waitFor(() => expect(translator.status.pending).toBe(1));
    receive(0, '临时结果', false);
    const link = document.querySelector('a')!;
    await vi.waitFor(() => expect(link.style.textDecorationStyle).toBe('dotted'));
    link.focus();
    link.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    receive(0, '更新中的临时译文', false);
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(document.querySelector<HTMLElement>('[data-cloudys-gloss="component-hint"]')!.style.display).toBe('none');
    finish(['Example Pro']);
    await vi.waitFor(() => expect(translator.status.translated).toBe(1));
    expect(link.style.textDecorationStyle).toBe('');
    expect(document.querySelector<HTMLElement>('[data-cloudys-gloss="component-hint"]')!.style.display).toBe('none');
    translator.stop();
  });
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
  it('段内辅助文字只切换 CSS 类显隐时重译附近完整语句，关闭翻译保留宿主最新显示状态', async () => {
    document.body.innerHTML = '<style>.concealed{display:none}</style><p>Primary text. <span class="concealed">Additional details.</span></p>';
    const paragraph = document.querySelector('p')!;
    const extra = paragraph.querySelector('span')!;
    const translate = vi.fn(async (_id: string, texts: string[]) => texts.map(text => `译文：${text}`));
    const translator = new PageTranslator({ translate, cancel: vi.fn() }); translator.start(); visible();
    await vi.waitFor(() => expect(paragraph.querySelector('[data-state="done"]')?.textContent).toBe('译文：Primary text.'));
    for (let i = 0; i < 10; i++) extra.className = i % 2 ? '' : 'concealed';
    await vi.waitFor(() => expect(translator.status.translated).toBe(0));
    await new Promise(resolve => setTimeout(resolve, 60)); visible();
    await vi.waitFor(() => expect(paragraph.querySelector('[data-state="done"]')?.textContent).toBe('译文：Primary text. Additional details.'));
    extra.className = 'concealed';
    await vi.waitFor(() => expect(translator.status.translated).toBe(0));
    await new Promise(resolve => setTimeout(resolve, 60)); visible();
    await vi.waitFor(() => expect(paragraph.querySelector('[data-state="done"]')?.textContent).toBe('译文：Primary text.'));
    expect(translate.mock.calls.flatMap(([, texts]) => texts)).toEqual(['Primary text.', 'Primary text. Additional details.', 'Primary text.']);
    translator.stop();
    expect(extra.className).toBe('concealed');
    expect(paragraph.textContent).toBe('Primary text. Additional details.');
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
  it('网页各段保留各自错误，单段重试绕过缓存且再次失败保留成功译文，不重新扫描全文', async () => {
    const translate = vi.fn<import('../../src/page/translator').TranslationTransport['translate']>()
      .mockRejectedValueOnce(new Error('HTTP 503 服务不可用'))
      .mockResolvedValueOnce(['新的第一段译文'])
      .mockRejectedValueOnce(new Error('HTTP 429 请求过多'));
    const translator = new PageTranslator({ translate, cancel: vi.fn() });
    const scan = vi.spyOn(document, 'createTreeWalker'); translator.start(); visible();
    await vi.waitFor(() => expect(document.querySelectorAll('[data-state="error"]')).toHaveLength(2));
    const count = scan.mock.calls.filter(([root]) => root === document.body).length;
    const first = document.querySelector<HTMLElement>('p [data-cloudys-gloss]')!;
    first.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    const host = document.querySelector('[data-cloudys-gloss="component-hint"]')!;
    expect(host.shadowRoot!.querySelector('.error')!.textContent).toContain('HTTP 503');
    host.shadowRoot!.querySelector<HTMLButtonElement>('.actions button')!.click();
    await vi.waitFor(() => expect(first.textContent).toBe('新的第一段译文'));
    expect(translate.mock.calls[1]![1]).toEqual(['Hello world.']);
    expect(translate.mock.calls[1]![3]).toEqual({ bypassCache: true, priority: 'interactive' });
    host.shadowRoot!.querySelector<HTMLButtonElement>('.actions button')!.click();
    await vi.waitFor(() => expect(host.shadowRoot!.querySelector('.error')!.textContent).toContain('HTTP 429'));
    expect(first.textContent).toBe('新的第一段译文');
    document.querySelectorAll('p')[1]!.querySelector('[data-cloudys-gloss]')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(host.shadowRoot!.querySelector('.error')!.textContent).toContain('HTTP 503');
    expect(scan.mock.calls.filter(([root]) => root === document.body)).toHaveLength(count);
    translator.stop(); scan.mockRestore();
  });
  it('长段落重新翻译按两块以内分批，全部成功才替换旧译文，不重复请求其他段落', async () => {
    document.body.innerHTML = `<p>${'A long sentence for careful reading. '.repeat(70)}</p><p>Other paragraph.</p>`;
    const translate = vi.fn<import('../../src/page/translator').TranslationTransport['translate']>(async (_id, texts) => texts.map(text => `旧译文：${text}`));
    const translator = new PageTranslator({ translate, cancel: vi.fn() }); translator.start(); await vi.waitFor(() => expect(observed.size).toBe(2)); visible();
    await vi.waitFor(() => expect(translator.status.translated).toBe(2));
    const first = document.querySelector<HTMLElement>('p [data-cloudys-gloss]')!; const previous = first.textContent;
    const count = translate.mock.calls.length;
    const finish: (() => void)[] = [];
    translate.mockImplementation((_id, texts) => new Promise(resolve => finish.push(() => resolve(texts.map(() => '新译文')))));
    first.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    const button = document.querySelector('[data-cloudys-gloss="component-hint"]')!.shadowRoot!.querySelector<HTMLButtonElement>('.actions button')!;
    button.click(); button.click();
    await vi.waitFor(() => expect(finish).toHaveLength(1));
    expect(first.textContent).toBe(previous); finish[0]!();
    await vi.waitFor(() => expect(finish).toHaveLength(2));
    expect(first.textContent).toBe(previous); finish[1]!();
    await vi.waitFor(() => expect(first.textContent).not.toBe(previous));
    const calls = translate.mock.calls.slice(count);
    expect(calls).toHaveLength(2);
    expect(calls.every(([, texts, , options]) => texts.length <= 2 && texts.join('').length <= 1800 && options?.bypassCache)).toBe(true);
    expect(calls.flatMap(([, texts]) => texts)).not.toContain('Other paragraph.');
    translator.stop();
  });
  it('长段重翻在切出标签页后暂停下一批，切回续接已完成片段并一次替换旧译文', async () => {
    document.body.innerHTML = `<p>${'A long sentence for careful reading. '.repeat(70)}</p>`;
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const translate = vi.fn<import('../../src/page/translator').TranslationTransport['translate']>(async (_id, texts) => texts.map(() => '旧译文'));
    const translator = new PageTranslator({ translate, cancel: vi.fn() });
    try {
      translator.start(); await vi.waitFor(() => expect(observed.size).toBe(1)); visible();
      await vi.waitFor(() => expect(translator.status.translated).toBe(1));
      const first = document.querySelector<HTMLElement>('p [data-cloudys-gloss]')!; const previous = first.textContent;
      const finish: (() => void)[] = [];
      translate.mockImplementation((_id, texts) => new Promise(resolve => finish.push(() => resolve(texts.map(() => '新译文')))));
      first.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      document.querySelector('[data-cloudys-gloss="component-hint"]')!.shadowRoot!.querySelector<HTMLButtonElement>('.actions button')!.click();
      await vi.waitFor(() => expect(finish).toHaveLength(1));
      visibility.mockReturnValue('hidden'); document.dispatchEvent(new Event('visibilitychange')); finish[0]!();
      await new Promise(resolve => setTimeout(resolve, 80));
      expect(finish).toHaveLength(1); expect(first.textContent).toBe(previous);
      visibility.mockReturnValue('visible'); document.dispatchEvent(new Event('visibilitychange'));
      await vi.waitFor(() => expect(finish).toHaveLength(2)); finish[1]!();
      await vi.waitFor(() => expect(first.textContent).toBe('新译文 新译文 新译文'));
      expect(finish).toHaveLength(2);
    } finally { translator.stop(); visibility.mockRestore(); }
  });
  it('网页同时重试三段仍最多占用两个请求，关闭翻译取消运行请求且迟到结果不恢复译文', async () => {
    document.body.innerHTML = '<p>First paragraph.</p><p>Second paragraph.</p><p>Third paragraph.</p>';
    const original = document.body.innerHTML;
    const translate = vi.fn<import('../../src/page/translator').TranslationTransport['translate']>(async (_id, texts) => texts.map(text => `译文：${text}`));
    const cancel = vi.fn(); const translator = new PageTranslator({ translate, cancel }); translator.start(); visible();
    await vi.waitFor(() => expect(translator.status.translated).toBe(3));
    const finish: (() => void)[] = [];
    translate.mockImplementation((_id, texts) => new Promise(resolve => finish.push(() => resolve(texts.map(() => '迟到的译文')))));
    for (const node of document.querySelectorAll('p [data-cloudys-gloss]')) {
      node.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      document.querySelector('[data-cloudys-gloss="component-hint"]')!.shadowRoot!.querySelector<HTMLButtonElement>('.actions button')!.click();
    }
    await vi.waitFor(() => expect(finish).toHaveLength(2));
    expect(translator.status.pending).toBe(3);
    translator.stop(); expect(cancel).toHaveBeenCalledTimes(2);
    finish.forEach(resolve => resolve()); await Promise.resolve();
    expect(document.body.innerHTML).toBe(original);
    expect(document.querySelector('[data-cloudys-gloss="component-hint"]')).toBeNull();
  });

});
