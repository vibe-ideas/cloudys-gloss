import { render } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { OWN } from '../page/blocks';
import { SubtitleHistory, subtitleTime } from './history';
import { needsChineseTranslation } from '../core/source-language';

const PAGE_SIZE = 40;
const css = `
:host{all:initial;display:block;color-scheme:light dark;font:14px/1.5 system-ui,-apple-system,sans-serif;color:#ececf0;--panel:#18191d;--border:#ffffff14;--muted:#a4a5af;--active:#c7b9ff;--hover:#ffffff08}
*{box-sizing:border-box}button{font:inherit;cursor:pointer}button:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--active);outline-offset:-2px}
.panel{height:100%;display:flex;flex-direction:column;background:var(--panel);border:1px solid var(--border);border-radius:14px;overflow:hidden}
.header{padding:15px 16px 12px;display:flex;gap:12px;align-items:flex-start;border-bottom:1px solid var(--border);flex:none}.heading{flex:1}h2{font-size:15px;line-height:1.5;margin:0;font-weight:650;letter-spacing:.02em}.subtitle{font-size:11px;color:var(--muted);margin:3px 0 0}
.close{border:0;background:transparent;color:var(--muted);width:28px;height:28px;border-radius:7px;font-size:22px;line-height:1}.close:hover{background:var(--hover);color:var(--active)}
.scroll{min-height:0;flex:1;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#7775 transparent;padding:6px 8px 12px;overflow-anchor:none}
ol{list-style:none;padding:0;margin:0}.row{padding:12px 11px;border-radius:9px;border:1px solid transparent;margin:3px 0;overflow-wrap:anywhere}.row[aria-current=true]{background:#a78bfa12;border-color:#a78bfa36}
.meta{display:flex;align-items:center;gap:8px;margin-bottom:7px}.time{border:0;background:transparent;padding:0;color:var(--muted);font:11px/1.5 ui-monospace,monospace;font-variant-numeric:tabular-nums}.time:hover{color:var(--active);text-decoration:underline}.playing{font-size:10px;color:var(--active)}
.zh{font-size:14px;line-height:1.7;margin:0 0 5px;white-space:pre-line}.en{font-size:12px;line-height:1.6;color:var(--muted);margin:0;white-space:pre-line}.empty{margin:24px 14px;color:var(--muted);font-size:13px;line-height:1.8}.status{font-size:11px;color:var(--muted);margin:6px 0 0}
.repair,.page{border:0;color:var(--active);background:transparent;font-size:11px;padding:6px 0}.repair:hover,.page:hover{text-decoration:underline}.page{display:block;width:100%;padding:10px}.error{font-size:11px;color:#f2acb8;margin-top:6px}summary{cursor:pointer}
.footer{border-top:1px solid var(--border);padding:10px 16px;display:flex;justify-content:space-between;align-items:center;gap:8px;min-height:46px;flex:none;color:var(--muted);font-size:11px}.follow{font:12px system-ui;border:1px solid #a78bfa44;background:#a78bfa14;color:var(--active);border-radius:6px;padding:5px 9px}.follow:hover{background:#a78bfa24}
:host([data-mode=docked]) .panel{border-radius:0;border-width:0 0 0 1px}
.resize{position:absolute;left:-6px;top:0;bottom:0;width:12px;z-index:2;cursor:ew-resize;touch-action:none;user-select:none}
.resize:after{content:"";position:absolute;left:5px;top:calc(50% - 22px);height:44px;width:2px;border-radius:2px;background:var(--muted);opacity:.5;transition:background-color 120ms,opacity 120ms}
.resize:hover:after,.resize:focus-visible:after,.resize[data-dragging]:after{background:var(--active);opacity:1}
:host([data-mode=below]) .resize{display:none}
@media(prefers-reduced-motion:reduce){.resize:after{transition:none}}
:host([data-theme=light]){color-scheme:light;--panel:#fff;--border:#19192216;--muted:#6c6d79;--active:#7050b5;--hover:#19192208;color:#22232b}:host([data-theme=light]) .error{color:#a73653}
`;

const dockCss = `
[data-cloudys-history-column]{--ytd-watch-flexy-sidebar-width:var(--cloudys-history-column-width)!important}
[data-cloudys-history-column] #columns{grid-template-columns:minmax(0,1fr) var(--cloudys-history-column-width)!important}
[data-cloudys-history-column] #secondary{box-sizing:border-box!important;width:var(--cloudys-history-column-width)!important;min-width:var(--cloudys-history-column-width)!important;max-width:var(--cloudys-history-column-width)!important;flex:0 0 var(--cloudys-history-column-width)!important}
[data-cloudys-history-column] #primary{min-width:0!important;flex:1 1 0%!important}
[data-cloudys-history=docked] .html5-video-container{width:100%!important;height:100%!important}
[data-cloudys-history=docked] video{width:calc(100% - var(--cloudys-history-width))!important;height:100%!important;left:0!important;top:0!important;transform:none!important;object-fit:contain!important;max-width:none!important}
[data-cloudys-history=docked] .ytp-chrome-bottom{width:calc(100% - var(--cloudys-history-width) - 24px)!important}
[data-cloudys-history=docked] .ytp-chrome-top{right:var(--cloudys-history-width)!important}
[data-cloudys-history=docked]>.ytp-right-controls{right:calc(var(--cloudys-history-width) + 10px)!important}
[data-cloudys-history=docked] .ytp-caption-window-container,[data-cloudys-history=docked] .ytp-cued-thumbnail-overlay{width:calc(100% - var(--cloudys-history-width))!important}
`;

type Props = { history: SubtitleHistory; revision: number; close: () => void; seek: (time: number, retry?: boolean) => void; status: string; recover?: () => void };
function HistoryPanel({ history, revision, close, seek, status, recover }: Props) {
  const [following, setFollowing] = useState(true);
  const [anchor, setAnchor] = useState<number>();
  const scroll = useRef<HTMLDivElement>(null);
  const entries = history.entries;
  const current = history.currentStart;
  const end = Math.max(1, Math.min(entries.length, (following ? history.indexAt(current ?? Infinity) : history.indexAt(anchor ?? Infinity)) + 1));
  const start = Math.max(0, end - PAGE_SIZE);
  const rows = entries.slice(start, end);
  const stopFollowing = () => { if (following) { setAnchor(entries[end - 1]?.start); setFollowing(false); } };
  const page = (nextEnd: number) => { setAnchor(entries[Math.max(0, Math.min(entries.length, nextEnd) - 1)]?.start); setFollowing(false); if (scroll.current) scroll.current.scrollTop = 0; };
  useLayoutEffect(() => {
    if (following && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [following, revision]);
  return <section class="panel" aria-label="字幕记录" onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); close(); } }} onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onDblClick={event => event.stopPropagation()}>
    <header class="header"><div class="heading"><h2>字幕记录</h2><p class="subtitle">回看刚才的内容 · 点击时间跳转</p>{status && <p class="subtitle" aria-label="字幕准备状态">{status}</p>}{recover && <button class="repair" onClick={recover}>重新读取完整字幕</button>}</div><button class="close" aria-label="关闭字幕记录" onClick={close}>×</button></header>
    <div class="scroll" ref={scroll} tabIndex={0} aria-label="历史双语字幕" onWheel={stopFollowing} onTouchStart={stopFollowing}
      onPointerDown={event => { if (event.target === event.currentTarget) stopFollowing(); }}
      onKeyDown={event => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) stopFollowing(); }}>
      {start > 0 && <button class="page" onClick={() => page(start)}>查看更早的字幕</button>}
      {!entries.length && <p class="empty">播放视频后，原文和译文会留在这里。你可以随时回看，视频会继续播放。</p>}
      <ol>{rows.map(row => <li class="row" key={row.start} aria-current={row.start === current ? 'true' : undefined}>
        <div class="meta"><button class="time" aria-label={`跳转到 ${subtitleTime(row.start)}`} onClick={() => { setFollowing(true); seek(row.start); }}>{subtitleTime(row.start)}</button>{row.start === current && <span class="playing">当前句</span>}</div>
        {row.translated && <p class="zh" lang="zh-CN">{row.translated}</p>}<p class="en">{row.original}</p>
        {!row.translated && needsChineseTranslation(row.original) && <>
          {row.start === current && row.pending ? <p class="status">正在翻译…</p> : <button class="repair" onClick={() => { setFollowing(true); seek(row.start, true); }}>跳转并{row.error ? '重试' : '补译'}</button>}
          {row.error && <details class="error"><summary>错误原因</summary>{row.error}</details>}
        </>}
      </li>)}</ol>
      {end < entries.length && <button class="page" onClick={() => page(end + PAGE_SIZE)}>查看较新的字幕</button>}
    </div>
    <footer class="footer"><span>{entries.length ? `${start + 1}–${end} / ${entries.length} 条` : '本次观看记录'}</span>{following ? <span>跟随当前句</span> : <button class="follow" onClick={() => setFollowing(true)}>回到当前句</button>}</footer>
  </section>;
}

/** Dock in YouTube's existing right column; only split the player in theater/fullscreen. */
export class SubtitleSidebar {
  private host = document.createElement('div');
  private mount = document.createElement('div');
  private style = document.createElement('style');
  private observer: ResizeObserver;
  private themeObserver: MutationObserver;
  private lifetime = new AbortController();
  private frame?: number;
  private revision = -1;
  private status = '';
  private recoverable = false;
  private visible = false;
  private secondary?: HTMLElement;
  private columnWatch?: Element;
  private grip = document.createElement('div');
  private preferredWidth?: number;
  private bounds = { min: 260, max: 560 };
  private dragEvents?: AbortController;
  private drag?: { id: number; x: number; width: number; preferred?: number; moved: boolean };
  constructor(private player: HTMLElement, private history: SubtitleHistory, private close: () => void, private seek: Props['seek'], private recover?: () => void) {
    // Reloading the extension may discard its old realm before destroy runs.
    const oldColumn = player.closest<HTMLElement>('ytd-watch-flexy[data-cloudys-history-column]');
    oldColumn?.removeAttribute('data-cloudys-history-column'); oldColumn?.style.removeProperty('--cloudys-history-column-width');
    this.host.setAttribute(OWN, 'video-history'); this.host.hidden = true; this.mount.style.height = '100%';
    const shadow = this.host.attachShadow({ mode: 'open' }); const sheet = document.createElement('style'); sheet.textContent = css;
    this.grip.className = 'resize'; this.grip.tabIndex = 0; this.grip.setAttribute('role', 'separator');
    this.grip.setAttribute('aria-label', '调整字幕记录宽度'); this.grip.setAttribute('aria-orientation', 'vertical');
    this.grip.title = '拖动调整宽度 · 左右方向键微调 · 双击 / Enter 恢复默认';
    shadow.append(sheet, this.mount, this.grip);
    const signal = this.lifetime.signal;
    const move = (event: PointerEvent) => {
      const drag = this.drag;
      if (!drag || event.pointerId !== drag.id) return;
      if (!drag.moved && Math.abs(drag.x - event.clientX) < 3) return;
      event.preventDefault(); event.stopPropagation();
      if (!drag.moved) {
        drag.moved = true;
        this.grip.setPointerCapture(event.pointerId); this.grip.setAttribute('data-dragging', '');
      }
      this.setWidth(drag.width + drag.x - event.clientX);
    };
    const finish = (event: PointerEvent) => {
      const drag = this.drag;
      if (!drag || event.pointerId !== drag.id) return;
      event.stopPropagation();
      if (drag.moved) this.setWidth(drag.width + drag.x - event.clientX);
      this.endDrag();
    };
    this.grip.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !this.visible || this.host.dataset.mode === 'below') return;
      event.stopPropagation(); this.grip.focus(); this.endDrag();
      this.drag = { id: event.pointerId, x: event.clientX, width: this.host.getBoundingClientRect().width, preferred: this.preferredWidth, moved: false };
      // Keep ordinary clicks separate from dragging; capture only after movement.
      this.dragEvents = new AbortController();
      window.addEventListener('pointermove', move, { signal: this.dragEvents.signal });
      window.addEventListener('pointerup', finish, { signal: this.dragEvents.signal });
      window.addEventListener('pointercancel', () => this.endDrag(true), { signal: this.dragEvents.signal });
    }, { signal });
    this.grip.addEventListener('lostpointercapture', () => this.endDrag(), { signal });
    this.grip.addEventListener('dblclick', event => { event.stopPropagation(); this.preferredWidth = undefined; this.scheduleLayout(); }, { signal });
    this.grip.addEventListener('click', event => event.stopPropagation(), { signal });
    this.grip.addEventListener('mousedown', event => event.stopPropagation(), { signal });
    this.grip.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Enter') { event.preventDefault(); this.endDrag(); this.preferredWidth = undefined; this.scheduleLayout(); return; }
      if (event.key === 'Escape' && this.drag) { event.preventDefault(); this.endDrag(true); return; }
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const current = Number(this.grip.getAttribute('aria-valuenow'));
      this.setWidth(event.key === 'Home' ? this.bounds.min : event.key === 'End' ? this.bounds.max : current + (event.key === 'ArrowLeft' ? 20 : -20));
    }, { signal });
    this.grip.addEventListener('keyup', event => event.stopPropagation(), { signal });
    this.style.setAttribute(OWN, 'video-history-style'); this.style.textContent = dockCss; player.append(this.style);
    this.themeObserver = new MutationObserver(() => this.scheduleLayout()); this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['dark'] });
    this.observer = new ResizeObserver(() => this.scheduleLayout()); this.observer.observe(player);
    document.addEventListener('fullscreenchange', () => this.scheduleLayout(), { signal: this.lifetime.signal });
    window.addEventListener('resize', () => this.scheduleLayout(), { signal: this.lifetime.signal });
  }
  update(visible: boolean, status = '', recoverable = false) {
    if (visible !== this.visible) {
      this.visible = visible; this.host.hidden = !visible; this.revision = -1;
      if (visible) this.scheduleLayout(); else { this.endDrag(); this.restore(); render(null, this.mount); }
    }
    if (!visible || (this.revision === this.history.revision && this.status === status && this.recoverable === recoverable)) return;
    this.revision = this.history.revision;
    this.status = status; this.recoverable = recoverable;
    render(<HistoryPanel history={this.history} revision={this.revision} close={this.close} seek={this.seek} status={status} recover={recoverable ? this.recover : undefined} />, this.mount);
  }
  private scheduleLayout() {
    if (!this.visible || this.frame !== undefined) return;
    this.frame = requestAnimationFrame(() => { this.frame = undefined; if (this.visible) this.layout(); });
  }
  private setWidth(width: number) {
    this.preferredWidth = Math.round(Math.max(this.bounds.min, Math.min(this.bounds.max, width)));
    this.scheduleLayout();
  }
  private endDrag(cancel = false) {
    const drag = this.drag; this.drag = undefined;
    this.dragEvents?.abort(); this.dragEvents = undefined;
    if (!drag) return;
    if (cancel) { this.preferredWidth = drag.preferred; this.scheduleLayout(); }
    this.grip.removeAttribute('data-dragging');
    if (this.grip.hasPointerCapture(drag.id)) this.grip.releasePointerCapture(drag.id);
  }
  private width(defaultWidth: number, available: number, docked: boolean) {
    const max = Math.max(120, Math.floor(Math.min(560, available * .45, available - 360)));
    this.bounds = { min: Math.min(docked ? 220 : 260, max), max };
    const width = Math.round(Math.max(this.bounds.min, Math.min(max, this.preferredWidth ?? defaultWidth)));
    this.grip.setAttribute('aria-valuemin', String(this.bounds.min)); this.grip.setAttribute('aria-valuemax', String(max));
    this.grip.setAttribute('aria-valuenow', String(width)); this.grip.setAttribute('aria-valuetext', `${width} 像素`);
    return width;
  }
  private layout() {
    this.host.dataset.theme = document.documentElement.hasAttribute('dark') ? 'dark' : 'light';
    const player = this.player.getBoundingClientRect();
    const watch = this.player.closest('ytd-watch-flexy');
    const secondary = watch?.querySelector<HTMLElement>('#secondary');
    const right = secondary?.getBoundingClientRect();
    const fullscreen = !!document.fullscreenElement;
    const column = !fullscreen && !watch?.hasAttribute('theater') && secondary && right && right.width >= 260 && right.left >= player.right - 8;
    if (secondary && secondary !== this.secondary) { if (this.secondary) this.observer.unobserve(this.secondary); this.secondary = secondary; this.observer.observe(secondary); }
    this.restore();
    if (column && watch) {
      const width = this.width(right.width, player.width + right.width, false);
      if (this.preferredWidth !== undefined) {
        this.columnWatch = watch;
        watch.setAttribute('data-cloudys-history-column', '');
        (watch as HTMLElement).style.setProperty('--cloudys-history-column-width', `${width}px`);
      }
      if (this.host.parentElement !== secondary) secondary.prepend(this.host);
      this.host.dataset.mode = 'column'; this.host.style.cssText = `display:block;position:sticky;top:76px;height:${Math.max(240, Math.min(player.height, innerHeight - 112))}px;margin-bottom:16px;`;
    } else if (player.width >= 760 || fullscreen) {
      const width = this.width(Math.min(320, Math.floor(player.width * .28)), player.width, true);
      if (this.host.parentElement !== this.player) this.player.append(this.host);
      this.host.dataset.mode = 'docked'; this.host.style.cssText = `display:block;position:absolute;right:0;top:0;bottom:0;width:${width}px;z-index:80;`;
      this.player.style.setProperty('--cloudys-history-width', `${width}px`); this.player.setAttribute('data-cloudys-history', 'docked');
      this.player.querySelector(`[${OWN}="video-subtitles"]`)?.setAttribute('data-history-docked', '');
    } else {
      this.endDrag();
      if (this.host.previousElementSibling !== this.player) this.player.after(this.host);
      this.host.dataset.mode = 'below'; this.host.style.cssText = 'display:block;position:relative;width:100%;height:320px;margin-top:12px;';
    }
  }
  private restore() {
    if (this.columnWatch) {
      this.columnWatch.removeAttribute('data-cloudys-history-column');
      (this.columnWatch as HTMLElement).style.removeProperty('--cloudys-history-column-width'); this.columnWatch = undefined;
    }
    this.player.removeAttribute('data-cloudys-history'); this.player.style.removeProperty('--cloudys-history-width');
    this.player.querySelector(`[${OWN}="video-subtitles"]`)?.removeAttribute('data-history-docked');
    if (!this.visible) this.host.style.display = 'none';
  }
  destroy() {
    this.visible = false; this.endDrag(); if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.lifetime.abort(); this.observer.disconnect(); this.themeObserver.disconnect(); this.restore(); render(null, this.mount); this.host.remove(); this.style.remove();
  }
}
