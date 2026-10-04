import { describe, expect, it, vi } from 'vitest';
import { placePopover, SelectionPopover } from '../../src/popover';
import { FloatingControl } from '../../src/floating-control';
import type { WordCard } from '../../src/schema';
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
