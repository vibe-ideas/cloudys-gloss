import { OWN } from '../page/blocks';
import { ArticleImageTranslator } from './article';
import { imageIcon } from './icons';

/** One delegated image action. Original images, anchors and page geometry stay intact. */
export class ImageTranslationLauncher {
  private host = document.createElement('div');
  private button = document.createElement('button');
  private reader = document.createElement('button');
  private status = document.createElement('span');
  private statusIcon = document.createElement('span');
  private statusText = document.createElement('span');
  private details = document.createElement('button');
  private translator = new ArticleImageTranslator(() => this.refresh());
  private controller = new AbortController();
  private image?: HTMLImageElement;
  private contextImage?: HTMLImageElement;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private open: (url: string) => Promise<unknown>) {
    document.querySelectorAll(`[${OWN}="image-launcher"]`).forEach(node => node.remove());
    this.host.setAttribute(OWN, 'image-launcher'); this.host.hidden = true;
    const shadow = this.host.attachShadow({ mode: 'open' }); const style = document.createElement('style');
    style.textContent = `
      :host{all:initial;position:fixed!important;z-index:2147483645!important;pointer-events:auto!important;
        display:flex!important;align-items:center;gap:3px;box-sizing:border-box;width:max-content!important;
        padding:3px;border:1px solid #ffffff26;border-radius:9px;background:#222622f5;
        color:#edf0e9;box-shadow:0 2px 10px #0003;color-scheme:dark}
      :host([hidden]){display:none!important}
      button{all:unset;box-sizing:border-box;position:relative;display:flex;align-items:center;justify-content:center;
        flex:none;width:28px;height:28px;border-radius:5px;font:500 12px/1 system-ui;
        color:inherit;cursor:pointer;white-space:nowrap}
      button:hover{background:#ffffff18}button:active{background:#ffffff25}
      button:focus-visible{outline:2px solid #c2de99;outline-offset:-2px}
      button:disabled{opacity:.5;cursor:wait}
      .action{color:#c5e5a1;background:#c5e5a112}
      :host([data-busy="true"]) .action{color:#b9bfb5;background:transparent}
      :host([data-busy="true"]) .action:hover{color:#fff;background:#ffffff18}
      .reader{color:#b9bfb5;margin-left:3px}
      .reader::before{content:"";position:absolute;left:-4px;top:6px;height:16px;width:1px;background:#ffffff20}
      svg{display:block;width:16px;height:16px;pointer-events:none;flex:none}
      .status{display:flex;align-items:center;gap:6px;min-width:0;padding:0 5px;
        color:#edf0e9;font:500 12px/28px system-ui;font-variant-numeric:tabular-nums;white-space:nowrap}
      .status-text{overflow:hidden;text-overflow:ellipsis}
      .status-icon svg{width:13px;height:13px;color:#c5e5a1}
      :host([data-busy="true"]) .status-icon svg{animation:spin 1s linear infinite}
      .details{width:auto;min-width:0;flex:0 1 auto;gap:5px;padding:0 5px;color:#efd18e}
      .details span{overflow:hidden;text-overflow:ellipsis}
      .details svg{width:14px;height:14px}
      [hidden]{display:none!important}
      button::after{content:attr(data-tip);position:absolute;right:0;top:calc(100% + 10px);
        padding:6px 8px;border:1px solid #ffffff20;border-radius:6px;background:#222622;
        color:#f2f4ee;font:12px/1.4 system-ui;box-shadow:0 2px 8px #0003;pointer-events:none;
        opacity:0;visibility:hidden;transition:opacity .12s}
      button:hover::after,button:focus-visible::after{opacity:1;visibility:visible;transition-delay:.2s}
      :host([data-tip-side="left"]) button::after{left:0;right:auto}
      @keyframes spin{to{transform:rotate(360deg)}}
      @media(prefers-reduced-motion:reduce){.status-icon svg{animation:none!important}button::after{transition:none}}
    `;
    this.button.type = 'button'; this.button.className = 'action'; this.button.innerHTML = imageIcon('translate');
    this.button.setAttribute('aria-label', '翻译这张图片');
    this.button.onclick = event => { if (!event.isTrusted) return; event.preventDefault(); event.stopPropagation(); if (this.image) this.translator.toggle(this.image); };
    this.reader.type = 'button'; this.reader.className = 'reader';
    this.reader.setAttribute('aria-label', '打开图片阅读页'); this.reader.dataset.tip = '放大 / 校对';
    this.reader.innerHTML = imageIcon('zoom');
    const openReader = (event: MouseEvent) => {
      if (!event.isTrusted) return;
      event.preventDefault(); event.stopPropagation();
      const url = this.image?.currentSrc || this.image?.src; if (!url) return;
      this.reader.disabled = this.details.disabled = true;
      void this.open(url).then(() => this.hide()).catch(() => {
        this.details.hidden = false; this.details.innerHTML = imageIcon('warning');
        this.details.dataset.tip = '打开失败，点击重试'; this.details.setAttribute('aria-label', '打开图片阅读页失败，点击重试'); this.position();
      }).finally(() => { this.reader.disabled = this.details.disabled = false; });
    };
    this.reader.onclick = openReader; this.details.onclick = openReader;
    this.details.type = 'button'; this.details.className = 'details'; this.details.hidden = true;
    this.status.className = 'status'; this.status.setAttribute('role', 'status');
    this.statusIcon.className = 'status-icon'; this.statusIcon.setAttribute('aria-hidden', 'true'); this.statusText.className = 'status-text';
    this.status.append(this.statusIcon, this.statusText);
    shadow.append(style, this.status, this.details, this.button, this.reader); document.documentElement.append(this.host);
    const signal = this.controller.signal;
    document.addEventListener('contextmenu', event => {
      if (!event.isTrusted) return;
      this.contextImage = event.target instanceof HTMLImageElement ? event.target : undefined;
    }, { signal, capture: true });
    document.addEventListener('pointerover', event => {
      const image = event.target;
      if (!(image instanceof HTMLImageElement) || image.closest(`[${OWN}]`) || image.naturalWidth < 200 || image.naturalHeight < 80) return;
      const url = image.currentSrc || image.src; if (!/^https?:\/\//i.test(url)) return;
      clearTimeout(this.timer); this.image = image; this.refresh(); this.host.hidden = false; this.position();
    }, { signal, passive: true });
    document.addEventListener('pointerout', event => {
      if (event.target !== this.image) return;
      clearTimeout(this.timer); this.timer = setTimeout(() => { if (!this.host.matches(':hover') && !shadow.activeElement) this.hide(); }, 250);
    }, { signal, passive: true });
    this.host.addEventListener('pointerleave', event => { if (event.relatedTarget !== this.image && !shadow.activeElement) this.hide(); }, { signal });
    this.host.addEventListener('focusout', () => {
      clearTimeout(this.timer); this.timer = setTimeout(() => {
        if (!shadow.activeElement && !this.host.matches(':hover') && !this.image?.matches(':hover')) this.hide();
      }, 250);
    }, { signal });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') this.hide(); }, { signal });
    window.addEventListener('scroll', () => this.hide(), { signal, capture: true, passive: true });
    window.addEventListener('resize', () => this.hide(), { signal, passive: true });
  }
  private position() {
    if (!this.image || this.host.hidden) return;
    const box = this.image!.getBoundingClientRect();
    this.host.style.setProperty('max-width', `${Math.min(220, Math.max(96, box.width - 12), innerWidth - 16)}px`, 'important');
    const toolbar = this.host.getBoundingClientRect();
    let top = Math.max(8, Math.min(innerHeight - toolbar.height - 8, box.top + 6));
    let left = Math.max(8, Math.min(innerWidth - toolbar.width - 8, box.right - toolbar.width - 6));
    // Small images need clear pixels more than a permanently overlaid toolbar.
    // Dock outside only when hit-testing finds empty ancestor space, not a
    // neighbouring image, caption, link or another page control.
    this.host.dataset.dock = 'inside';
    if (box.width < 240 || box.height < toolbar.height * 3) {
      const positions = [
        { x: left, y: box.top - toolbar.height - 6 },
        { x: box.right + 6, y: box.top },
        { x: left, y: box.bottom + 6 },
      ];
      const outside = positions.find(({ x, y }) => {
        if (x < 8 || y < 8 || x + toolbar.width > innerWidth - 8 || y + toolbar.height > innerHeight - 8) return false;
        return [0.05, .5, .95].every(dx => [0.05, .5, .95].every(dy => {
          const hit = document.elementsFromPoint(x + toolbar.width * dx, y + toolbar.height * dy).find(node => node !== this.host);
          return !!hit && hit !== this.image && hit.contains(this.image!);
        }));
      });
      if (outside) { left = outside.x; top = outside.y; this.host.dataset.dock = 'outside'; }
    }
    this.host.style.setProperty('top', `${top}px`, 'important');
    this.host.style.setProperty('left', `${left}px`, 'important');
    this.host.dataset.tipSide = left < 160 ? 'left' : 'right';
  }
  private setStatus(full: string, compact: string, busy = false) {
    this.statusText.textContent = compact; this.status.title = full; this.status.setAttribute('aria-label', full);
    this.statusIcon.innerHTML = busy ? imageIcon('spinner') : full.startsWith('图片翻译完成') ? imageIcon('check') : '';
    this.status.hidden = !full;
  }
  private refresh() {
    if (!this.image) return;
    const state = this.translator.state(this.image);
    this.host.dataset.busy = String(state.busy);
    this.button.innerHTML = imageIcon(state.busy ? 'stop' : state.label === '查看原图' ? 'image' : state.label === '重试图片翻译' ? 'retry' : 'translate');
    this.button.setAttribute('aria-label', state.label); this.button.dataset.tip = state.label;
    const progress = /正在本机翻译\s+(\d+)\s*\/\s*(\d+)/.exec(state.status);
    const failed = /(\d+) 处翻译未完成/.exec(state.status);
    const uncertain = /(\d+) 处识别需核对/.exec(state.status);
    const warning = failed ? `${failed[1]} 处未译` : uncertain ? `${uncertain[1]} 处待核对` : !state.busy && state.status && !/^(图片翻译完成|已停止)/.test(state.status) ? '未完成' : '';
    const compact = progress ? `${progress[1]}/${progress[2]}`
        : state.status.startsWith('图片翻译完成') ? ''
          : state.status.startsWith('已停止') ? '已停止'
            : state.busy ? /识别/.test(state.status) ? '识别' : /读取/.test(state.status) ? '读取' : /准备/.test(state.status) ? '准备' : '翻译' : '';
    this.setStatus(state.status, compact, state.busy);
    this.details.hidden = !warning;
    if (warning) {
      this.status.hidden = true; this.details.innerHTML = imageIcon('warning');
      const text = document.createElement('span'); text.textContent = warning; this.details.append(text);
      this.details.dataset.tip = '查看详情 / 校对'; this.details.title = state.status;
      this.details.setAttribute('aria-label', `${state.status}，打开阅读页查看详情`);
    }
    this.position();
  }
  translateFromContext(url: string) {
    const matches = (image: HTMLImageElement | undefined) => image?.isConnected && (image.currentSrc || image.src) === url;
    const image = matches(this.contextImage) ? this.contextImage : [...document.images].find(image => matches(image));
    if (!image) return false;
    this.image = image; this.translator.toggle(image); this.refresh(); return true;
  }
  hide() { clearTimeout(this.timer); this.host.hidden = true; this.image = undefined; }
  reset() { this.translator.reset(); this.contextImage = undefined; this.hide(); }
  destroy() { this.controller.abort(); this.translator.destroy(); this.hide(); this.host.remove(); }
}
