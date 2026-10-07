import { describe, expect, it, vi } from 'vitest';
import { placePopover, SelectionPopover, type DictionaryTransport } from '../../src/popover';
import { FloatingControl } from '../../src/floating-control';
import type { WordCard } from '../../src/schema';
import type { WordSpeech } from '../../src/speech';
import type { LocalDefinition } from '../../src/dictionaries/store';

function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const cloudyCard: WordCard = { word: 'cloudy', ipa: { us: '/complete-us/', uk: '/complete-uk/' }, senses: [{ partOfSpeech: 'adjective', meaning: '多云的' }], contextMeaning: '多云的天气', examples: [{ en: 'A cloudy day.', zh: '多云的一天。' }] };
async function selectAndOpen(word: string) {
  document.body.innerHTML = `<p>${word}</p>`;
  const range = document.createRange(); range.selectNodeContents(document.querySelector('p')!);
  range.getBoundingClientRect = () => ({ left: 20, top: 20, bottom: 40 } as DOMRect); range.cloneRange = () => range;
  const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  document.querySelector('p')!.dispatchEvent(new Event('pointerup', { bubbles: true }));
  await vi.waitFor(() => expect(document.querySelector('[data-cloudys-gloss=popover]')?.shadowRoot?.querySelector('.launcher')).toBeTruthy());
  document.querySelector('[data-cloudys-gloss=popover]')!.shadowRoot!.querySelector<HTMLButtonElement>('.launcher')!.click();
  return document.querySelector('[data-cloudys-gloss=popover]')!.shadowRoot!;
}
describe('词卡离线音标预览', () => {
  it('模型尚未返回时展示导入词库的来源与释义，模型失败后仍能阅读且不执行词条 HTML', async () => {
    const card = deferred<WordCard>();
    const popover = new SelectionPopover({ lookup: () => card.promise, local: async () => [{ dictionary: '科技词库', headword: 'cloudy', matchedAs: 'cloudy', text: '<img src="https://bad">本地多云解释', truncated: false }], cancel: vi.fn() });
    try {
      const shadow = await selectAndOpen('cloudy');
      await vi.waitFor(() => expect(shadow.textContent).toContain('本地多云解释'));
      expect(shadow.textContent).toContain('科技词库'); expect(shadow.textContent).toContain('AI 语境解释准备中'); expect(shadow.querySelector('img')).toBeNull();
      card.reject(new Error('模型离线'));
      await vi.waitFor(() => expect(shadow.textContent).toContain('模型离线'));
      expect(shadow.textContent).toContain('本地多云解释');
    } finally { popover.destroy(); window.getSelection()!.removeAllRanges(); }
  });
  it('关闭词卡后新选一个词，旧词库查询被取消且迟到释义不会串入新词卡', async () => {
    const old = deferred<LocalDefinition[]>(); const cancel = vi.fn();
    const local = vi.fn().mockImplementationOnce(() => old.promise).mockResolvedValueOnce([]);
    const popover = new SelectionPopover({ lookup: async (_id, word) => ({ ...cloudyCard, word }), local, cancel });
    try {
      await selectAndOpen('cloudy'); popover.close(); expect(cancel).toHaveBeenCalledWith(local.mock.calls[0]![0]);
      const shadow = await selectAndOpen('light');
      old.resolve([{ dictionary: '旧词库', headword: 'cloudy', matchedAs: 'cloudy', text: '旧本地词条', truncated: false }]);
      await old.promise; await Promise.resolve(); expect(shadow.textContent).not.toContain('旧本地词条');
    } finally { popover.destroy(); window.getSelection()!.removeAllRanges(); }
  });
  it('词典未标注口音的音标单独展示，AI 释义完成后仍保留该标注', async () => {
    const card = deferred<WordCard>();
    const popover = new SelectionPopover({ lookup: () => card.promise, pronunciation: async () => ({ us: '', uk: '', general: '/ˈjæməl/' }), cancel: vi.fn() });
    try {
      const shadow = await selectAndOpen('YAML');
      await vi.waitFor(() => expect(shadow.querySelector('[aria-label="未标注口音的词典音标"]')?.textContent).toContain('/ˈjæməl/'));
      expect(shadow.querySelector('[aria-label="美式发音"]')?.textContent).not.toContain('/ˈjæməl/');
      card.resolve({ ...cloudyCard, word: 'YAML', ipa: { us: '', uk: '' } });
      await vi.waitFor(() => expect(shadow.textContent).toContain('多云的天气'));
      expect(shadow.textContent).toContain('词典未标注口音');
    } finally { popover.destroy(); window.getSelection()!.removeAllRanges(); }
  });
  it('释义仍在等待时先显示离线音标并可发音，释义失败后保留音标与发音按钮', async () => {
    const card = deferred<WordCard>(); const ipa = deferred<WordCard['ipa']>();
    const transport: DictionaryTransport = { lookup: vi.fn(() => card.promise), pronunciation: vi.fn(() => ipa.promise), cancel: vi.fn() };
    const speech: WordSpeech = { play: vi.fn(async () => {}), stop: vi.fn() };
    const popover = new SelectionPopover(transport, 'system', speech);
    try {
      const shadow = await selectAndOpen('cloudy');
      ipa.resolve({ us: '/preview-us/', uk: '/preview-uk/' });
      await vi.waitFor(() => expect(shadow.textContent).toContain('/preview-us/'));
      expect(shadow.textContent).toContain('释义准备中'); expect(shadow.querySelector('.panel')!.getAttribute('aria-busy')).toBe('true');
      shadow.querySelector<HTMLButtonElement>('[aria-label="美式发音"]')!.click();
      expect(speech.play).toHaveBeenCalledWith('cloudy', 'en-US');
      card.reject(new Error('模型暂不可用'));
      await vi.waitFor(() => expect(shadow.textContent).toContain('模型暂不可用'));
      expect(shadow.textContent).toContain('/preview-us/'); expect(shadow.querySelector('.panel')!.getAttribute('aria-busy')).toBe('false');
      shadow.querySelector<HTMLButtonElement>('[aria-label="英式发音"]')!.click();
      expect(speech.play).toHaveBeenCalledWith('cloudy', 'en-GB');
    } finally { popover.destroy(); window.getSelection()!.removeAllRanges(); }
  });
  it('离线预览播放尚未结束时 AI 补齐词卡，不停止或重启发音，播放状态持续到完成', async () => {
    const card = deferred<WordCard>(); const playing = deferred<void>();
    const speech: WordSpeech = { play: vi.fn(() => playing.promise), stop: vi.fn() };
    const popover = new SelectionPopover({ lookup: () => card.promise, pronunciation: async () => ({ us: '/preview/', uk: '/preview/' }), cancel: vi.fn() }, 'system', speech);
    try {
      const shadow = await selectAndOpen('cloudy');
      await vi.waitFor(() => expect(shadow.textContent).toContain('/preview/'));
      const button = shadow.querySelector<HTMLButtonElement>('[aria-label="美式发音"]')!;
      button.click(); await vi.waitFor(() => expect(button.getAttribute('aria-busy')).toBe('true'));
      const stopsBefore = vi.mocked(speech.stop).mock.calls.length;
      card.resolve(cloudyCard);
      await vi.waitFor(() => expect(shadow.textContent).toContain('多云的天气'));
      expect(shadow.querySelector('[aria-label="美式发音"]')).toBe(button);
      expect(button.getAttribute('aria-busy')).toBe('true'); expect(shadow.textContent).toContain('正在播放美式发音');
      expect(speech.play).toHaveBeenCalledOnce(); expect(speech.stop).toHaveBeenCalledTimes(stopsBefore);
      playing.resolve(); await vi.waitFor(() => expect(button.getAttribute('aria-busy')).toBe('false'));
      expect(shadow.textContent).not.toContain('正在播放美式发音');
    } finally { playing.resolve(); popover.destroy(); window.getSelection()!.removeAllRanges(); }
  });
  it('完整词卡先返回时，迟到的空音标不会覆盖已显示的音标和释义', async () => {
    const ipa = deferred<WordCard['ipa']>();
    const popover = new SelectionPopover({ lookup: async () => cloudyCard, pronunciation: () => ipa.promise, cancel: vi.fn() });
    try {
      const shadow = await selectAndOpen('cloudy');
      await vi.waitFor(() => expect(shadow.textContent).toContain('多云的天气'));
      ipa.resolve({ us: '', uk: '' }); await ipa.promise; await Promise.resolve();
      expect(shadow.textContent).toContain('/complete-us/'); expect(shadow.textContent).not.toContain('释义准备中');
    } finally { popover.destroy(); window.getSelection()!.removeAllRanges(); }
  });
  it('关闭后改选新词会分别取消旧音标和释义请求，旧结果迟到不串入新词卡', async () => {
    const cards = [deferred<WordCard>(), deferred<WordCard>()]; const ipas = [deferred<WordCard['ipa']>(), deferred<WordCard['ipa']>()];
    const lookup = vi.fn().mockImplementationOnce(() => cards[0]!.promise).mockImplementationOnce(() => cards[1]!.promise);
    const pronunciation = vi.fn().mockImplementationOnce(() => ipas[0]!.promise).mockImplementationOnce(() => ipas[1]!.promise);
    const cancel = vi.fn(); const popover = new SelectionPopover({ lookup, pronunciation, cancel });
    try {
      await selectAndOpen('cloudy'); popover.close();
      expect(cancel).toHaveBeenCalledWith(lookup.mock.calls[0]![0]); expect(cancel).toHaveBeenCalledWith(pronunciation.mock.calls[0]![0]);
      expect(lookup.mock.calls[0]![0]).not.toBe(pronunciation.mock.calls[0]![0]);
      const shadow = await selectAndOpen('light');
      ipas[0]!.resolve({ us: '/old/', uk: '/old/' }); cards[0]!.resolve(cloudyCard);
      ipas[1]!.resolve({ us: '/laɪt/', uk: '/laɪt/' });
      await vi.waitFor(() => expect(shadow.textContent).toContain('/laɪt/'));
      expect(shadow.querySelector('h2')!.textContent).toBe('light'); expect(shadow.textContent).not.toContain('/old/'); expect(shadow.textContent).not.toContain('多云的');
      popover.close(); expect(document.querySelector('[data-cloudys-gloss=popover]')).toBeNull();
      cards[1]!.resolve({ ...cloudyCard, word: 'light' }); await cards[1]!.promise; await Promise.resolve();
      expect(document.querySelector('[data-cloudys-gloss=popover]')).toBeNull();
    } finally { popover.destroy(); window.getSelection()!.removeAllRanges(); }
  });
  it('离线词典不可用时仍能显示 AI 词卡，不额外重试模型', async () => {
    const lookup = vi.fn(async () => cloudyCard);
    const popover = new SelectionPopover({ lookup, pronunciation: async () => { throw new Error('词典不可用'); }, cancel: vi.fn() });
    try {
      const shadow = await selectAndOpen('cloudy');
      await vi.waitFor(() => expect(shadow.textContent).toContain('多云的天气'));
      expect(lookup).toHaveBeenCalledTimes(1); expect(shadow.querySelector('[role=alert]')).toBeNull();
    } finally { popover.destroy(); window.getSelection()!.removeAllRanges(); }
  });
});
it('主题配置晚于划词返回时更新现有词卡，不关闭浮层或取消词义请求', async () => {
  document.body.innerHTML = '<p>cloudy</p>';
  const range = document.createRange(); range.selectNodeContents(document.querySelector('p')!);
  range.getBoundingClientRect = () => ({ left: 20, top: 20, bottom: 40 } as DOMRect);
  range.cloneRange = () => range;
  const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  const cancel = vi.fn(); const lookup = vi.fn(() => new Promise<WordCard>(() => {}));
  const popover = new SelectionPopover({ lookup, cancel });
  try {
    document.querySelector('p')!.dispatchEvent(new Event('pointerup', { bubbles: true }));
    await vi.waitFor(() => expect(document.querySelector('[data-cloudys-gloss=popover]')?.shadowRoot?.querySelector('.launcher')).toBeTruthy());
    expect(lookup).not.toHaveBeenCalled();
    document.querySelector('[data-cloudys-gloss=popover]')!.shadowRoot!.querySelector<HTMLButtonElement>('.launcher')!.click();
    await vi.waitFor(() => expect(lookup).toHaveBeenCalledTimes(1));
    const panel = document.querySelector('[data-cloudys-gloss="popover"]')!.shadowRoot!.querySelector('.panel')!;
    popover.setTheme('dark');
    expect(panel.isConnected).toBe(true); expect(panel.classList.contains('dark')).toBe(true);
    expect(cancel).not.toHaveBeenCalled(); expect(lookup).toHaveBeenCalledTimes(1);
  } finally { popover.destroy(); selection.removeAllRanges(); }
});
describe('划词浮层定位', () => {
  it('窄屏中间划词后完整词卡放到空间较大的一侧，并限制高度以保持原词可见', () => {
    expect(placePopover({ left: 200, top: 220, bottom: 244 }, 360, 600, 390, 500)).toEqual({ left: 18, top: 254, maxHeight: 234 });
  });
  it('小窗口下方划词后完整词卡向上展开，并保留选区与屏幕边距', () => {
    expect(placePopover({ left: 20, top: 160, bottom: 184 }, 296, 600, 320, 220)).toEqual({ left: 12, top: 12, maxHeight: 138 });
  });
  it('选区位于右下角时浮层向左上避让且保持屏幕内边距', () => {
    expect(placePopover({ left: 990, top: 700, bottom: 720 }, 360, 400, 1024, 768)).toEqual({ left: 652, top: 290, maxHeight: 678 });
  });
  it('选区下方空间充足时浮层紧跟选区显示', () => {
    expect(placePopover({ left: 100, top: 100, bottom: 120 }, 360, 400, 1024, 768)).toEqual({ left: 100, top: 130, maxHeight: 626 });
  });
  it('加载卡片向下打开后补齐内容仍向下展开，空间不足时在卡片内滚动', () => {
    expect(placePopover({ left: 100, top: 400, bottom: 420 }, 360, 600, 1024, 768, true)).toEqual({ left: 100, top: 430, maxHeight: 326 });
  });
});


it('原文因窗口大小变化移动时，词卡重新测量保留的选区并跟随定位', async () => {
  document.body.innerHTML = '<p>cloudy</p>';
  const range = document.createRange(); range.selectNodeContents(document.querySelector('p')!);
  let anchor = { left: 20, top: 20, bottom: 40 };
  range.getBoundingClientRect = () => anchor as DOMRect; range.cloneRange = () => range;
  const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  const popover = new SelectionPopover({ lookup: () => new Promise<WordCard>(() => {}), cancel: vi.fn() });
  try {
    document.querySelector('p')!.dispatchEvent(new Event('pointerup', { bubbles: true }));
    await vi.waitFor(() => expect(document.querySelector('[data-cloudys-gloss="popover"]')).not.toBeNull());
    const panel = document.querySelector('[data-cloudys-gloss="popover"]')!.shadowRoot!.querySelector<HTMLElement>('.panel')!;
    expect(panel.style.top).toBe('50px');
    anchor = { left: 70, top: 150, bottom: 170 };
    window.dispatchEvent(new Event('resize'));
    expect(panel.style.top).toBe('180px'); expect(panel.style.left).toBe('70px');
  } finally { popover.destroy(); selection.removeAllRanges(); }
});

it('完整词卡在小窗口被限高后放大窗口，重新放宽滚动区域且仍显示同一张词卡', async () => {
  const height = vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(300);
  const popover = new SelectionPopover({ lookup: async () => cloudyCard, cancel: vi.fn() });
  try {
    const shadow = await selectAndOpen('cloudy');
    await vi.waitFor(() => expect(shadow.textContent).toContain('多云的天气'));
    const panel = shadow.querySelector<HTMLElement>('.panel')!;
    panel.getBoundingClientRect = () => ({ width: 360, height: 238 } as DOMRect);
    Object.defineProperty(panel, 'scrollHeight', { configurable: true, value: 598 });
    window.dispatchEvent(new Event('resize'));
    expect(panel.style.maxHeight).toBe('238px'); expect(panel.style.top).toBe('50px');
    height.mockReturnValue(900); window.dispatchEvent(new Event('resize'));
    expect(panel.style.maxHeight).toBe('838px'); expect(panel.style.top).toBe('50px');
    expect(shadow.querySelector('.panel')).toBe(panel); expect(shadow.textContent).toContain('多云的天气');
  } finally { popover.destroy(); height.mockRestore(); window.getSelection()!.removeAllRanges(); }
});

it('网页拦截事件时悬浮菜单仍能点外关闭，菜单内按Esc后焦点回到展开按钮', () => {
  document.body.innerHTML = '<main><button>网页按钮</button></main>';
  const main = document.querySelector('main')!;
  main.addEventListener('pointerdown', (event) => event.stopPropagation());
  const control = new FloatingControl(vi.fn(), vi.fn());
  try {
    const shadow = document.querySelector('[data-cloudys-gloss="floating-control"]')!.shadowRoot!;
    const more = shadow.querySelector<HTMLButtonElement>('.more')!;
    more.click(); expect(shadow.querySelector('.menu')).not.toBeNull();
    main.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(shadow.querySelector('.menu')).toBeNull();
    more.click(); const row = shadow.querySelector<HTMLButtonElement>('.row')!; row.focus();
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
    expect(shadow.querySelector('.menu')).toBeNull(); expect(shadow.activeElement).toBe(more);
  } finally { control.destroy(); }
});


it('悬浮菜单打开后用户已返回网页输入，按Esc关闭菜单时保留网页输入焦点', () => {
  document.body.innerHTML = '<input aria-label="网页搜索" />';
  const input = document.querySelector('input')!;
  const control = new FloatingControl(vi.fn(), vi.fn());
  try {
    const shadow = document.querySelector('[data-cloudys-gloss="floating-control"]')!.shadowRoot!;
    shadow.querySelector<HTMLButtonElement>('.more')!.click(); input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(shadow.querySelector('.menu')).toBeNull(); expect(document.activeElement).toBe(input);
  } finally { control.destroy(); }
});
