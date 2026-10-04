import { describe, expect, it, vi } from 'vitest';
import { placePopover, SelectionPopover } from '../../src/popover';
import type { WordCard } from '../../src/schema';
it('主题配置晚于划词返回时更新现有词卡，不关闭浮层或取消词义请求', async () => {
  document.body.innerHTML = '<p>cloudy</p>';
  const range = document.createRange(); range.selectNodeContents(document.querySelector('p')!);
  range.getBoundingClientRect = () => ({ left: 20, top: 20, bottom: 40 } as DOMRect);
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
  it('选区位于右下角时浮层向左上避让且保持屏幕内边距', () => {
    expect(placePopover({ left: 990, top: 700, bottom: 720 }, 360, 400, 1024, 768)).toEqual({ left: 652, top: 290 });
  });
  it('选区下方空间充足时浮层紧跟选区显示', () => {
    expect(placePopover({ left: 100, top: 100, bottom: 120 }, 360, 400, 1024, 768)).toEqual({ left: 100, top: 130 });
  });
});
