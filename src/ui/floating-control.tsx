import { render, type ComponentChildren } from 'preact';
import { OWN } from '../page/blocks';
import type { Settings } from '../core/schema';
import type { TranslationStatus } from '../page/translator';

const css = `
:host{all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483646!important;color-scheme:light dark!important;overflow:clip!important}
*{box-sizing:border-box}
button{font:inherit;color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}
button:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
svg{display:block;width:20px;height:20px;flex-shrink:0}
.dock{--bg:#fff;--fg:#302b40;--muted:#7b748b;--line:#ece8f3;--accent:#7257d6;--orb:#7257d6;--orb-active:#6045c3;--tint:#f2eefc;--hover:#f7f4fd;--error:#be644d;--shadow:0 5px 20px #3a23691a,0 1px 4px #3a23690d;position:fixed;width:35px;height:46px;pointer-events:auto;font:13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:var(--fg);isolation:isolate}
.dock.dark{--bg:#26222f;--fg:#f1edf9;--muted:#aea4bf;--line:#42394f;--accent:#b59af5;--orb:#9274df;--orb-active:#8263d0;--tint:#383046;--hover:#332c40;--error:#efa88e;--shadow:0 5px 20px #0004,0 1px 4px #0003}
@media(prefers-color-scheme:dark){.dock.system{--bg:#26222f;--fg:#f1edf9;--muted:#aea4bf;--line:#42394f;--accent:#b59af5;--orb:#9274df;--orb-active:#8263d0;--tint:#383046;--hover:#332c40;--error:#efa88e;--shadow:0 5px 20px #0004,0 1px 4px #0003}}
.capsule{position:absolute;top:0;display:flex;align-items:center;width:70px;height:46px;padding:3px;border:1px solid var(--line);border-radius:25px;background:var(--bg);box-shadow:var(--shadow);transition:transform .32s cubic-bezier(.22,1,.36,1)}
.dock.right .capsule{right:0;transform:translateX(50%)}
.dock.left .capsule{left:0;flex-direction:row-reverse;transform:translateX(-50%)}
.dock.left .more{margin-left:0;margin-right:2px}
.dock.right:is(:hover,:has(:focus-visible),.expanded) .capsule{transform:translateX(-10px)}
.dock.left:is(:hover,:has(:focus-visible),.expanded) .capsule{transform:translateX(10px)}
.dock.dragging .capsule{transition:none}
@media(hover:none){.dock.right .capsule{transform:translateX(-10px)}.dock.left .capsule{transform:translateX(10px)}}
.orb{--mark-cutout:var(--orb);position:relative;display:grid;place-items:center;width:38px;height:38px;padding:0;flex-shrink:0;border:0;border-radius:50%;background:var(--orb);color:#fff;touch-action:none;user-select:none;transition:background .18s,transform .18s cubic-bezier(.2,.8,.2,1)}
.orb>.cloud-mark{width:26px;height:26px;transition:transform .22s cubic-bezier(.2,.8,.2,1)}
.orb:hover>.cloud-mark{transform:translateY(-1px)}
.orb:active{transform:scale(.94)}
.dock.dragging .orb{transform:none;cursor:grabbing}
.orb.active{--mark-cutout:var(--orb-active);background:var(--orb-active)}
.orb.active>.cloud-mark{animation:cloud-awake .38s ease-out}
.busy-ring{position:absolute;inset:-3px;border:2px solid transparent;border-top-color:var(--accent);border-right-color:var(--accent);border-radius:50%;pointer-events:none;animation:orbit 1.2s linear infinite}
.orb.busy .cloud-line{animation:reading-ink 1.5s ease-in-out infinite}
.orb.busy .cloud-line:last-child{animation-delay:.2s}
.indicator{position:absolute;right:-1px;bottom:0;display:grid;place-items:center;width:13px;height:13px;border:2px solid var(--bg);border-radius:50%;background:var(--orb-active);color:#fff}
.indicator svg{width:8px;height:8px}
.indicator.error{background:var(--error)}
.more{display:grid;place-items:center;align-self:stretch;width:22px;margin-left:2px;padding:0;border:0;border-radius:14px;background:transparent;color:var(--muted);transition:background .18s,color .18s}
.more:hover,.more[aria-expanded=true]{background:var(--tint);color:var(--accent)}
.more svg{width:13px;height:13px;transition:transform .22s cubic-bezier(.2,.8,.2,1)}
.more[aria-expanded=true] svg{transform:rotate(180deg)}
.menu{position:fixed;overflow:auto;overscroll-behavior:contain;width:276px;max-width:calc(100vw - 24px);padding:18px;border:1px solid var(--line);border-radius:22px;background:var(--bg);box-shadow:0 16px 48px #30204720,0 2px 8px #3020470a;transform-origin:var(--menu-origin);animation:menu-arrive .2s cubic-bezier(.2,.8,.2,1)}
.header{display:flex;align-items:center;gap:11px}
.brand{--mark-cutout:var(--orb);display:grid;place-items:center;width:36px;height:36px;flex-shrink:0;border-radius:12px;background:var(--orb);color:white}
.brand svg{width:26px;height:26px}
.title{font-size:14px;font-weight:650;letter-spacing:-.3px}
.subtitle{font-size:11px;color:var(--muted);line-height:1.8}
.state{display:flex;gap:7px;align-items:center;margin:21px 0 6px;font-size:12px;font-weight:550}
.state-dot{width:6px;height:6px;flex-shrink:0;border-radius:50%;background:var(--muted)}
.state-dot.active{background:var(--accent)}.state-dot.error{background:var(--error)}
.status{font-size:12px;line-height:1.7;color:var(--muted);margin:0 0 17px;overflow-wrap:anywhere}
.status.error{color:var(--error)}
.primary{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;padding:11px 12px;border:1px solid transparent;border-radius:13px;background:#7257d6;color:#fff;font-size:12px;font-weight:550;transition:background .18s,transform .15s}
.primary:hover{background:#6045c3}.primary:active{transform:scale(.98)}
.primary svg{width:17px;height:17px}.primary-label{display:flex;align-items:center;gap:8px}
.toggle-track{width:25px;height:14px;border-radius:8px;background:#ffffff35;padding:3px;flex-shrink:0}
.toggle-track span{display:block;width:8px;height:8px;border-radius:50%;background:currentColor;transition:transform .2s}
.toggle-track.on span{transform:translateX(11px)}
.rows{margin-top:13px;padding-top:7px;border-top:1px solid var(--line)}
.row{display:flex;align-items:center;gap:9px;width:100%;padding:10px 8px;border:0;border-radius:10px;background:transparent;text-align:left;font-size:12px;transition:background .16s}
.row:hover{background:var(--hover)}.row>svg{width:16px;height:16px;color:var(--muted)}.row .end{margin-left:auto;width:13px;height:13px}.retry{color:var(--error)}
.hint{display:flex;align-items:center;justify-content:center;gap:5px;font-size:10px;color:var(--muted);margin-top:12px}.hint svg{width:12px;height:12px}
@keyframes orbit{to{transform:rotate(360deg)}}
@keyframes reading-ink{0%,100%{opacity:1}50%{opacity:.45}}
@keyframes cloud-awake{0%{transform:scale(.88)}60%{transform:scale(1.05)}100%{transform:scale(1)}}
@keyframes menu-arrive{from{opacity:0;transform:translateY(var(--menu-shift)) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
.dock.motion-paused *{animation-play-state:paused!important}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}.orb:hover>.cloud-mark,.orb:active,.primary:active{transform:none}}
`;

/** Pixel-independent version of the cloud + two reading lines brand mark. */
function CloudMark() {
  return <svg class="cloud-mark" viewBox="0 0 32 32" aria-hidden="true">
    <path fill="currentColor" d="M9 25C4.6 25 2 22.2 2 18.7c0-3.3 2.5-6.1 5.9-6.5C8.8 7.7 12 5 16 5s7.2 2.7 8.1 7.2c3.4.4 5.9 3.2 5.9 6.5 0 3.5-2.6 6.3-7 6.3h-3c-1.7 0-2.9.7-4 2-1.1-1.3-2.3-2-4-2Z" />
    <g fill="var(--mark-cutout)"><rect class="cloud-line" x="9.5" y="15" width="13" height="2.5" rx="1.25" /><rect class="cloud-line" x="9.5" y="19.5" width="9" height="2.5" rx="1.25" /></g>
  </svg>;
}


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

const REPLACE_CONTROL = 'cloudys-gloss:replace-control';

/** One control per document, including reinjection after an extension update. */
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

  constructor(private toggle: () => void, private settings: () => void, onReplaced?: () => void) {
    // Firefox can discard an old extension realm while leaving its DOM behind.
    // Live instances dispose their listeners; orphaned hosts are removed too.
    // Our hosts are direct children: no whole-page scan or ongoing observer.
    for (const previous of Array.from(document.documentElement.children)) {
      if (previous.getAttribute(OWN) !== 'floating-control') continue;
      previous.dispatchEvent(new Event(REPLACE_CONTROL));
      previous.remove();
    }
    this.host.setAttribute(OWN, 'floating-control');
    this.host.addEventListener(REPLACE_CONTROL, () => { this.destroy(); onReplaced?.(); }, { once: true, signal: this.controller.signal });
    const shadow = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style'); style.textContent = css;
    shadow.append(style, this.mount); document.documentElement.append(this.host);
    document.addEventListener('visibilitychange', () => this.draw(), { signal: this.controller.signal });
    window.addEventListener('resize', () => this.draw(), { signal: this.controller.signal });
    document.addEventListener('pointerdown', (event) => {
      if (this.open && !event.composedPath().includes(this.host)) { this.open = false; this.draw(); }
    }, { signal: this.controller.signal, capture: true });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.open) {
        const restoreFocus = this.mount.querySelector('.menu')?.contains(shadow.activeElement);
        this.open = false; this.draw();
        if (restoreFocus) this.mount.querySelector<HTMLButtonElement>('.more')?.focus({ preventScroll: true });
      }
    }, { signal: this.controller.signal, capture: true });
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
    render(<><div class={`dock ${this.theme} ${this.side} ${this.open || this.drag?.moved ? 'expanded' : ''} ${this.drag?.moved ? 'dragging' : ''} ${document.hidden ? 'motion-paused' : ''}`} style={{ top: `${this.y}px`, [this.side]: '0px' }}>
      <div class="capsule">
      <button class={`orb ${enabled ? 'active' : ''} ${pending ? 'busy' : ''}`} aria-busy={pending > 0} aria-label={label} aria-pressed={enabled} title={`${label} · 拖动调整位置`}
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
        <CloudMark />
        {pending > 0 && <span class="busy-ring" aria-hidden="true" />}
        {!pending && (enabled || error) && <span class={`indicator ${error ? 'error' : ''}`} aria-hidden="true"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">{error ? <path d="M6 2v4m0 3v.1" /> : <path d="m2.5 6 2.2 2.2 4.8-5" />}</svg></span>}
      </button>
      <button class="more" aria-label="翻译快捷菜单" aria-expanded={this.open} title="翻译快捷菜单" onClick={() => { this.open = !this.open; this.draw(); }}><Icon name="chevron" /></button>
      </div>
      {this.open && <div class="menu" role="region" aria-label="翻译快捷操作" style={{ '--menu-origin': `${this.side} ${menuBelow ? 'top' : 'bottom'}`, '--menu-shift': menuBelow ? '-5px' : '5px', [this.side]: '12px', ...(menuBelow ? { top: `${this.y + 54}px` } : { bottom: `${window.innerHeight - this.y + 10}px` }), maxHeight: `${Math.max(80, menuSpace)}px` }}>
        <div class="header"><span class="brand"><CloudMark /></span><div><div class="title">Cloudy’s Gloss</div><div class="subtitle">让阅读，自然发生</div></div></div>
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
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true; this.controller.abort(); cancelAnimationFrame(this.frame); render(null, this.mount); this.host.remove();
  }
}
