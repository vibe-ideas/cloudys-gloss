import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComponentHints } from '../../src/page/component-hints';

let hints: ComponentHints;
const surface = () => document.querySelector<HTMLElement>('[data-cloudys-gloss="component-hint"]')!;
const pointer = (source: Element, type: string) => source.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: 'mouse', relatedTarget: document.body }));

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<button id="source" aria-describedby="help">Help</button><button id="other">Another action</button>';
  hints = new ComponentHints();
});
afterEach(() => { hints.stop(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('固定控件译文提示的键盘与窗口事件', () => {
  it('键盘焦点留在来源按钮时，迟到的窗口缩放重新定位译文并保留焦点和说明', async () => {
    const source = document.querySelector<HTMLButtonElement>('#source')!;
    let rect = new DOMRect(20, 40, 100, 24);
    vi.spyOn(source, 'getBoundingClientRect').mockImplementation(() => rect);
    hints.update(source, '完整帮助译文'); source.focus();
    const host = surface(); const tip = host.shadowRoot!.querySelector<HTMLElement>('.tip')!;
    expect(tip.style.top).toBe('70px');
    const description = source.getAttribute('aria-describedby');
    rect = new DOMRect(30, 120, 100, 24);
    window.dispatchEvent(new Event('resize'));
    await vi.advanceTimersByTimeAsync(32);
    expect(host.style.display).toBe('block');
    expect(tip.style.top).toBe('150px');
    expect(document.activeElement).toBe(source);
    expect(source.getAttribute('aria-describedby')).toBe(description);
  });

  it.each(['按钮', '外置表单标签'])('键盘聚焦%s后，鼠标离开与旧离开计时不会关闭译文，焦点离开后正常关闭', async kind => {
    if (kind === '外置表单标签') document.body.innerHTML = '<label id="source" for="input">Email</label><input id="input"><button id="other">Another action</button>';
    const source = document.querySelector<HTMLElement>('#source')!;
    const control = source instanceof HTMLLabelElement ? source.control! : source;
    hints.update(source, '完整帮助译文');
    pointer(source, 'pointerover'); pointer(source, 'pointerout');
    control.focus(); pointer(source, 'pointerout');
    await vi.advanceTimersByTimeAsync(160);
    expect(surface().style.display).toBe('block');
    expect(document.activeElement).toBe(control);
    document.querySelector<HTMLButtonElement>('#other')!.focus();
    expect(surface().style.display).toBe('none');
  });

  it('Esc、页面滚动或关闭翻译后，迟到的窗口事件不会重新打开提示', async () => {
    const source = document.querySelector<HTMLButtonElement>('#source')!;
    hints.update(source, '完整帮助译文'); source.focus();
    window.dispatchEvent(new Event('resize'));
    source.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    window.dispatchEvent(new Event('resize'));
    await vi.advanceTimersByTimeAsync(32);
    expect(surface().style.display).toBe('none');
    expect(source.getAttribute('aria-describedby')).toBe('help');
    source.blur(); source.focus();
    window.dispatchEvent(new Event('resize')); window.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(32);
    expect(surface().style.display).toBe('none');
    source.blur(); source.focus(); window.dispatchEvent(new Event('resize')); hints.stop();
    await vi.advanceTimersByTimeAsync(32);
    expect(document.querySelector('[data-cloudys-gloss="component-hint"]')).toBeNull();
    expect(source.getAttribute('aria-describedby')).toBe('help');
  });

  it('只有鼠标悬停且没有键盘焦点时，移出或缩放仍关闭提示', async () => {
    const source = document.querySelector<HTMLElement>('#source')!;
    hints.update(source, '完整帮助译文'); pointer(source, 'pointerover');
    window.dispatchEvent(new Event('resize'));
    expect(surface().style.display).toBe('none');
    pointer(source, 'pointerover'); pointer(source, 'pointerout');
    await vi.advanceTimersByTimeAsync(160);
    expect(surface().style.display).toBe('none');
  });
});
