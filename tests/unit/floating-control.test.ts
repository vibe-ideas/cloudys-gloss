import { describe, expect, it, vi } from 'vitest';
import { FloatingControl } from '../../src/ui/floating-control';

const selector = '[data-cloudys-gloss="floating-control"]';
describe('悬浮球实例交接', () => {
  it('旧脚本已退出但节点残留时，新实例移除所有旧悬浮球并保留网页内容', () => {
    const article = document.createElement('main'); document.body.append(article);
    for (let index = 0; index < 2; index++) {
      const stale = document.createElement('div'); stale.setAttribute('data-cloudys-gloss', 'floating-control');
      stale.attachShadow({ mode: 'open' }).innerHTML = '<button>旧悬浮球</button>';
      document.documentElement.append(stale);
    }
    const control = new FloatingControl(vi.fn(), vi.fn());
    try {
      expect(document.querySelectorAll(selector)).toHaveLength(1);
      expect(document.querySelector(selector)!.shadowRoot!.querySelectorAll('.orb')).toHaveLength(1);
      expect(article.isConnected).toBe(true);
    } finally { control.destroy(); article.remove(); }
  });
  it('旧脚本仍在运行时，新实例通知旧脚本退出，迟到状态更新不会复活旧悬浮球', () => {
    const replaced = vi.fn(); const toggle = vi.fn();
    const first = new FloatingControl(vi.fn(), vi.fn(), replaced);
    const oldHost = document.querySelector(selector)!;
    const second = new FloatingControl(toggle, vi.fn());
    try {
      expect(replaced).toHaveBeenCalledOnce(); expect(oldHost.isConnected).toBe(false);
      first.update({ enabled: true, translated: 1, pending: 0, error: '' });
      first.destroy(); window.dispatchEvent(new Event('resize'));
      expect(oldHost.shadowRoot!.querySelector('.orb')).toBeNull();
      expect(document.querySelectorAll(selector)).toHaveLength(1);
      document.querySelector(selector)!.shadowRoot!.querySelector<HTMLButtonElement>('.orb')!.click();
      expect(toggle).toHaveBeenCalledOnce();
    } finally { first.destroy(); second.destroy(); }
  });
});
