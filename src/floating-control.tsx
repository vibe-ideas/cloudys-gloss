import { render, type ComponentChildren } from 'preact';
import { OWN } from './blocks';
import type { Settings } from './schema';
import type { TranslationStatus } from './translator';

const css = `
:host{all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483646!important;color-scheme:light dark!important;overflow:clip!important}
*{box-sizing:border-box}button{font:inherit;color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}button:focus-visible{outline:2px solid var(--accent);outline-offset:3px}svg{display:block;width:20px;height:20px;flex-shrink:0}
.dock{--bg:#fff;--fg:#243a37;--muted:#7a8784;--line:#e7eeeb;--accent:#218675;--tint:#edf7f2;--hover:#f4f7f5;--error:#b9634c;--shadow:0 8px 28px #193c3212,0 2px 6px #193c320a;position:fixed;width:35px;height:46px;pointer-events:auto;font:13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:var(--fg);isolation:isolate}
.dock.dark{--bg:#1e2726;--fg:#e3eeea;--muted:#99aba5;--line:#374540;--accent:#88d6bc;--tint:#293f36;--hover:#2a3530;--error:#edac93;--shadow:0 8px 28px #0003,0 2px 6px #0002}@media(prefers-color-scheme:dark){.dock.system{--bg:#1e2726;--fg:#e3eeea;--muted:#99aba5;--line:#374540;--accent:#88d6bc;--tint:#293f36;--hover:#2a3530;--error:#edac93;--shadow:0 8px 28px #0003,0 2px 6px #0002}}
.capsule{position:absolute;top:0;display:flex;align-items:center;width:70px;height:46px;padding:3px;border:1px solid var(--line);border-radius:17px;background:var(--bg);box-shadow:var(--shadow);transition:transform .24s cubic-bezier(.2,.8,.2,1),opacity .2s;opacity:.72}
.dock.right .capsule{right:0;transform:translateX(50%)}.dock.left .capsule{left:0;flex-direction:row-reverse;transform:translateX(-50%)}
.dock.left .more{margin-left:0;margin-right:2px}
.dock:is(:hover,:has(:focus-visible),.expanded) .capsule{opacity:1}
.dock.right:is(:hover,:has(:focus-visible),.expanded) .capsule{transform:translateX(-10px)}
.dock.left:is(:hover,:has(:focus-visible),.expanded) .capsule{transform:translateX(10px)}
.dock.dragging .capsule{transition:none}
@media(hover:none){.dock .capsule{opacity:1}.dock.right .capsule{transform:translateX(-10px)}.dock.left .capsule{transform:translateX(10px)}}
.orb{position:relative;display:grid;place-items:center;width:38px;height:38px;border:0;border-radius:12px;background:transparent;touch-action:none;user-select:none;transition:background .16s,color .16s}.orb>svg{width:23px;height:23px}.orb:hover,.more:hover{background:var(--hover);color:var(--accent)}.orb.active{background:var(--tint);color:var(--accent)}.orb.active:hover{filter:brightness(.97)}.indicator{position:absolute;right:3px;bottom:3px;width:8px;height:8px;border:2px solid var(--bg);border-radius:50%;background:var(--accent)}.indicator.busy{width:10px;height:10px;right:2px;bottom:2px;border:2px solid var(--line);border-top-color:var(--accent);background:var(--bg);animation:spin .9s linear infinite}.indicator.error{background:var(--error)}.more{display:grid;place-items:center;align-self:stretch;width:22px;margin-left:2px;padding:0;border:0;border-radius:10px;background:transparent;color:var(--muted)}.more svg{width:13px;height:13px;transition:transform .16s}.more[aria-expanded=true]{background:var(--hover);color:var(--accent)}.more[aria-expanded=true] svg{transform:rotate(180deg)}
.menu{position:fixed;overflow:auto;overscroll-behavior:contain;width:276px;max-width:calc(100vw - 24px);padding:16px;border:1px solid var(--line);border-radius:20px;background:var(--bg);box-shadow:0 18px 60px #193c321c,0 3px 10px #193c3210;animation:appear .15s ease-out}.header{display:flex;align-items:center;gap:10px}.brand{display:grid;place-items:center;width:32px;height:32px;border-radius:10px;background:var(--tint);color:var(--accent)}.brand svg{width:19px;height:19px}.title{font-size:13px;font-weight:650;letter-spacing:-.2px}.subtitle{font-size:10px;color:var(--muted);letter-spacing:1.1px;line-height:1.8}.state{display:flex;gap:7px;align-items:center;margin:19px 0 5px;font-size:12px;font-weight:550}.state-dot{width:6px;height:6px;flex-shrink:0;border-radius:50%;background:var(--muted)}.state-dot.active{background:var(--accent)}.state-dot.error{background:var(--error)}.status{font-size:12px;line-height:1.65;color:var(--muted);margin:0 0 15px;overflow-wrap:anywhere}.status.error{color:var(--error)}.primary{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;padding:11px 12px;border:1px solid transparent;border-radius:11px;background:var(--accent);color:#fff;font-size:12px;font-weight:550}.dark .primary{color:#16392d}@media(prefers-color-scheme:dark){.system .primary{color:#16392d}}.primary:hover{filter:brightness(.95)}.primary svg{width:17px;height:17px}.primary-label{display:flex;align-items:center;gap:8px}.toggle-track{width:25px;height:14px;border-radius:8px;background:#ffffff35;padding:3px;flex-shrink:0}.toggle-track span{display:block;width:8px;height:8px;border-radius:50%;background:currentColor;transition:transform .15s}.toggle-track.on span{transform:translateX(11px)}.rows{margin-top:11px;padding-top:7px;border-top:1px solid var(--line)}.row{display:flex;align-items:center;gap:9px;width:100%;padding:9px 8px;border:0;border-radius:9px;background:transparent;text-align:left;font-size:12px}.row:hover{background:var(--hover)}.row>svg{width:16px;height:16px;color:var(--muted)}.row .end{margin-left:auto;width:13px;height:13px;color:var(--muted)}.retry{color:var(--error)}.hint{display:flex;align-items:center;justify-content:center;gap:5px;font-size:10px;color:var(--muted);margin-top:13px}.hint svg{width:12px;height:12px}@keyframes spin{to{transform:rotate(360deg)}}@keyframes appear{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
`;

type IconName = 'translate' | 'chevron' | 'settings' | 'hide' | 'retry' | 'original' | 'drag';
function Icon({ name, className }: { name: IconName; className?: string }) {
  const paths: Record<IconName, ComponentChildren> = {
    translate: <><path d="M3 5h12M9 3v2M6 5c1 5 4 8 8 10M12 5c-1 5-4 8-8 10M13 21l4-10 4 10M14.5 17h5" /></>,
    chevron: <path d="m8 10 4 4 4-4" />,
    settings: <><path d="M4 7h8m4 0h4M4 17h3m4 0h9" /><circle cx="14" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></>,
    hide: <><path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.5 5.3A10 10 0 0 1 12 5c6 0 9 7 9 7a16 16 0 0 1-2.6 3.8M6.1 6.1A17 17 0 0 0 3 12s3 7 9 7a10 10 0 0 0 4.2-1" /></>,
    retry: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 17.9 17" /></>,
    original: <><path d="m8 4-4 4 4 4M4 8h10a6 6 0 0 1 0 12h-3" /></>,
    drag: <><circle cx="9" cy="5" r=".8" /><circle cx="15" cy="5" r=".8" /><circle cx="9" cy="12" r=".8" /><circle cx="15" cy="12" r=".8" /><circle cx="9" cy="19" r=".8" /><circle cx="15" cy="19" r=".8" /></>,
  };
  return <svg class={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

/** One isolated control per content-script lifetime. Pointer movement never reads layout. */
export class FloatingControl {
  private host = document.createElement('div');
  private mount = document.createElement('div');
  private controller = new AbortController();
  private status: TranslationStatus = { enabled: false, translated: 0, pending: 0, error: '' };
  private theme: Settings['theme'] = 'system';
  private open = false;
  private side: 'left' | 'right' = 'right';
  private y = Math.round(window.innerHeight * .6);
  private drag?: { id: number; x: number; y: number; origin: number; moved: boolean };
  private suppressClick = false;
  private frame = 0;
  private destroyed = false;

  constructor(private toggle: () => void, private settings: () => void) {
    this.host.setAttribute(OWN, 'floating-control');
    const shadow = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style'); style.textContent = css;
    shadow.append(style, this.mount); document.documentElement.append(this.host);
    window.addEventListener('resize', () => this.draw(), { signal: this.controller.signal });
    document.addEventListener('pointerdown', (event) => {
      if (this.open && !event.composedPath().includes(this.host)) { this.open = false; this.draw(); }
    }, { signal: this.controller.signal });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.open) { this.open = false; this.draw(); }
    }, { signal: this.controller.signal });
    this.draw();
  }
  update(status: TranslationStatus) { this.status = status; this.draw(); }
  setTheme(theme: Settings['theme']) { this.theme = theme; this.draw(); }
  private draw = () => {
    if (this.destroyed) return;
    this.y = Math.max(12, Math.min(this.y, window.innerHeight - 58));
    const { enabled, translated, pending, error } = this.status;
    const label = enabled ? '恢复原文' : '翻译当前网页';
    const menuBelow = this.y < window.innerHeight / 2;
    const menuSpace = menuBelow ? window.innerHeight - this.y - 66 : this.y - 22;
    render(<><div class={`dock ${this.theme} ${this.side} ${this.open || this.drag?.moved ? 'expanded' : ''} ${this.drag?.moved ? 'dragging' : ''}`} style={{ top: `${this.y}px`, [this.side]: '0px' }}>
      <div class="capsule">
      <button class={`orb ${enabled ? 'active' : ''}`} aria-label={label} aria-pressed={enabled} title={`${label} · 拖动调整位置`}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          this.suppressClick = false;
          this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, origin: this.y, moved: false };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!this.drag || event.pointerId !== this.drag.id) return;
          if (Math.hypot(event.clientX - this.drag.x, event.clientY - this.drag.y) > 6) this.drag.moved = true;
          if (!this.drag.moved) return;
          this.y = this.drag.origin + event.clientY - this.drag.y;
          this.side = event.clientX < window.innerWidth / 2 ? 'left' : 'right';
          this.open = false;
          if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); });
        }}
        onPointerUp={(event) => {
          if (event.pointerId !== this.drag?.id) return;
          this.suppressClick = this.drag.moved; this.drag = undefined;
          event.currentTarget.releasePointerCapture(event.pointerId); this.draw();
        }}
        onPointerCancel={() => { this.suppressClick = true; this.drag = undefined; this.draw(); }}
        onClick={(event) => {
          if (this.suppressClick && event.detail !== 0) { this.suppressClick = false; return; }
          this.toggle();
        }}>
        <Icon name="translate" />
        {(enabled || error) && <span class={`indicator ${pending ? 'busy' : error ? 'error' : ''}`} />}
      </button>
      <button class="more" aria-label="翻译快捷菜单" aria-expanded={this.open} title="翻译快捷菜单" onClick={() => { this.open = !this.open; this.draw(); }}><Icon name="chevron" /></button>
      </div>
      {this.open && <div class="menu" role="region" aria-label="翻译快捷操作" style={{ [this.side]: '12px', ...(menuBelow ? { top: `${this.y + 54}px` } : { bottom: `${window.innerHeight - this.y + 10}px` }), maxHeight: `${Math.max(80, menuSpace)}px` }}>
        <div class="header"><span class="brand"><Icon name="translate" /></span><div><div class="title">Cloudy’s Gloss</div><div class="subtitle">让阅读，自然发生</div></div></div>
        <div class="state"><span class={`state-dot ${error ? 'error' : enabled ? 'active' : ''}`} />{error ? '翻译遇到了一点问题' : pending ? '正在为你翻译' : enabled ? '双语阅读已开启' : '专注阅读，随时翻译'}</div>
        <div class={`status ${error ? 'error' : ''}`} role="status">{error || (pending ? `已完成 ${translated} 段，译文即将呈现` : enabled ? `已翻译 ${translated} 段 · 滚动时继续翻译` : '保留原文，让中文译文伴你阅读。')}</div>
        <button class="primary" aria-label={label} onClick={() => this.toggle()}><span class="primary-label"><Icon name={enabled ? 'original' : 'translate'} />{label}</span><span class={`toggle-track ${enabled ? 'on' : ''}`} aria-hidden="true"><span /></span></button>
        <div class="rows">
          {error && <button class="row retry" aria-label="重试翻译" onClick={() => { if (this.status.enabled) this.toggle(); this.toggle(); }}><Icon name="retry" />重试翻译</button>}
          <button class="row" aria-label="模型设置" onClick={() => { this.settings(); this.open = false; this.draw(); }}><Icon name="settings" />模型设置<svg class="end" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg></button>
          <button class="row" aria-label="本页隐藏悬浮球" onClick={() => this.destroy()}><Icon name="hide" />本页隐藏悬浮球</button>
        </div>
        <div class="hint"><Icon name="drag" />移近展开 · 拖动换边</div>
      </div>}
    </div></>, this.mount);
  };
  destroy() { this.destroyed = true; this.controller.abort(); cancelAnimationFrame(this.frame); render(null, this.mount); this.host.remove(); }
}
