import { browser } from 'wxt/browser';
import { OWN } from '../page/blocks';
import { createId } from '../core/id';
import { imageDisplay } from './display';
import { InlineImageEvent } from './inline-protocol';
import { lineGeometry, type ImageOcr, type ReadingLine } from './regions';

type Result = { source: string; host: HTMLDivElement; layer: HTMLDivElement; status: HTMLParagraphElement; image?: ImageOcr['image']; items: ReadingLine[]; hidden: boolean; busy: boolean; error?: string; ms?: number };
type Port = ReturnType<typeof browser.runtime.connect>;

/** Article overlays live outside the article tree: no wrapping/replacing the site's images. */
export class ArticleImageTranslator {
  private results = new Map<HTMLImageElement, Result>();
  private active?: { image: HTMLImageElement; id: string };
  private port?: Port;
  private controller = new AbortController();
  private resize?: ResizeObserver;
  private mutations: MutationObserver;
  private frame = 0;
  constructor(private changed: () => void) {
    document.querySelectorAll(`[${OWN}="image-overlay"]`).forEach(node => node.remove());
    const signal = this.controller.signal;
    window.addEventListener('scroll', this.schedule, { signal, capture: true, passive: true });
    window.addEventListener('resize', this.schedule, { signal, passive: true });
    document.addEventListener('load', this.schedule, { signal, capture: true });
    if (typeof ResizeObserver !== 'undefined') this.resize = new ResizeObserver(this.schedule);
    this.mutations = new MutationObserver(records => {
      if (records.some(record => !(record.target instanceof Element ? record.target : record.target.parentElement)?.closest(`[${OWN}]`))) this.schedule();
    });
    this.mutations.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset', 'class', 'style', 'width', 'height', 'hidden', 'open'] });
  }
  state(image: HTMLImageElement) {
    const result = this.results.get(image);
    const visible = result?.items.some(line => line.translation && line.translation !== line.text);
    return { label: result?.busy ? '停止图片翻译' : visible ? result?.hidden ? '查看图片译文' : '查看原图' : result?.error ? '重试图片翻译' : '翻译这张图片',
      status: result?.status.textContent ?? '', busy: !!result?.busy, translated: !!visible };
  }
  toggle(image: HTMLImageElement) {
    const result = this.results.get(image);
    if (result?.busy) { this.stop(); return; }
    if (this.state(image).translated && result) { result.hidden = !result.hidden; this.schedule(); this.changed(); return; }
    this.start(image);
  }
  private start(image: HTMLImageElement) {
    this.stop();
    const source = image.currentSrc || image.src;
    let result = this.results.get(image);
    if (!result) {
      // Bound DOM and retained OCR text on image-heavy articles.
      if (this.results.size >= 8) this.remove(this.results.keys().next().value!);
      const host = document.createElement('div'); host.setAttribute(OWN, 'image-overlay'); host.hidden = true;
      host.style.cssText = 'all:initial!important;position:fixed!important;pointer-events:none!important;overflow:hidden!important;z-index:2147483643!important;';
      const shadow = host.attachShadow({ mode: 'open' }); const style = document.createElement('style');
      style.textContent = ':host([hidden]){display:none!important}.layer{position:absolute;transform-origin:0 0}.translated-region{position:absolute;box-sizing:border-box;display:flex;align-items:center;justify-content:center;overflow:hidden;text-align:center;white-space:normal;overflow-wrap:anywhere;color:#111;background:#fffffff5;font-family:system-ui,sans-serif;font-weight:500;line-height:1.05;transform-origin:0 0}.status{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}';
      const layer = document.createElement('div'); layer.className = 'layer'; const status = document.createElement('p'); status.className = 'status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
      shadow.append(style, layer, status); document.documentElement.append(host);
      result = { source, host, layer, status, items: [], hidden: false, busy: true }; this.results.set(image, result); this.resize?.observe(image);
    }
    Object.assign(result, { source, items: [], hidden: false, busy: true, error: undefined, image: undefined }); result.layer.replaceChildren(); result.host.dataset.imageState = 'processing'; result.host.hidden = true; result.status.textContent = '正在准备本机图片翻译…';
    const id = createId(); this.active = { image, id };
    try {
      this.port ??= this.connect();
      this.port.postMessage({ type: 'start', id, url: source });
    } catch { this.fail('图片翻译连接失效，请刷新页面重试'); }
    this.changed();
  }
  private connect() {
    const port = browser.runtime.connect({ name: 'image-inline-owner' });
    port.onMessage.addListener((raw: unknown) => {
      const parsed = InlineImageEvent.safeParse(raw); if (!parsed.success || parsed.data.id !== this.active?.id) return;
      const event = parsed.data; const image = this.active.image; const result = this.results.get(image); if (!result) return;
      if ((image.currentSrc || image.src) !== result.source) { this.remove(image); this.stop(); return; }
      if (event.type === 'error') this.fail(event.error);
      else if (event.type === 'progress') { result.status.textContent = event.status; this.changed(); }
      else {
        result.image = event.image; result.items = event.items; result.ms = event.ms;
        result.host.dataset.totalMs = String(event.ms);
        result.host.dataset.imageState = event.done ? 'done' : 'processing';
        const uncertain = result.items.filter(line => line.score < .85).length; const failed = result.items.filter(line => line.error).length;
        result.status.textContent = event.done ? `图片翻译完成 · ${(event.ms / 1000).toFixed(2)} 秒${uncertain ? ` · ${uncertain} 处识别需核对` : ''}${failed ? ` · ${failed} 处翻译未完成：${result.items.find(line => line.error)!.text.slice(0, 70)}` : ''} · 点击“打开图片阅读页”可校对` : '正在本机翻译图片文字…';
        if (event.done) { result.busy = false; result.error = failed ? result.items.find(line => line.error)?.error : undefined; this.active = undefined; }
        this.draw(result); this.schedule(); this.changed();
      }
    });
    port.onDisconnect.addListener(() => { if (this.port === port) { this.port = undefined; if (this.active) this.fail('本机图片处理已停止，请重试或打开图片阅读页'); } });
    return port;
  }
  private draw(result: Result) {
    result.layer.replaceChildren(); if (!result.image) return;
    for (const line of result.items) {
      const box = lineGeometry(line, result.image); if (!box || line.score < .85 || !line.translation || line.translation === line.text) continue;
      const label = document.createElement('div'); label.className = 'translated-region'; label.textContent = line.translation; label.title = `${line.text}\n${line.translation}`;
      label.style.cssText = `left:${box.x}px;top:${box.y}px;width:${box.width}px;height:${box.height}px;transform:rotate(${box.angle}deg);font-size:${Math.min(box.height * .78, box.width / line.translation.length * .95)}px;`;
      result.layer.append(label);
    }
  }
  private schedule = () => { if (!this.frame && this.results.size) this.frame = requestAnimationFrame(() => { this.frame = 0; this.position(); }); };
  private position() {
    for (const [image, result] of this.results) {
      if (!image.isConnected || (image.currentSrc || image.src) !== result.source) { this.remove(image); if (this.active?.image === image) this.stop(); continue; }
      result.host.hidden = true;
      if (result.hidden || !result.image || !result.layer.childElementCount) continue;
      const rect = image.getBoundingClientRect(); const style = getComputedStyle(image);
      if (!rect.width || !rect.height || style.visibility !== 'visible' || style.display === 'none' || Number(style.opacity) === 0) continue;
      const sx = rect.width / image.offsetWidth; const sy = rect.height / image.offsetHeight;
      // Rotated/skewed elements need a different coordinate map; leave their original pixels visible.
      if (!this.axisAligned(style.transform)) continue;
      const left = rect.left + (parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft)) * sx;
      const top = rect.top + (parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop)) * sy;
      const width = (image.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)) * sx;
      const height = (image.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)) * sy;
      const display = imageDisplay(width, height, result.image.width, result.image.height, style.objectFit || 'fill', style.objectPosition || '50% 50%'); if (!display) continue;
      let l = Math.max(0, left); let t = Math.max(0, top); let r = Math.min(innerWidth, left + width); let b = Math.min(innerHeight, top + height);
      for (let parent = image.parentElement; parent && parent !== document.documentElement; parent = parent.parentElement) {
        const css = getComputedStyle(parent); const box = parent.getBoundingClientRect();
        if (!this.axisAligned(css.transform)) { r = l; break; }
        if (/(hidden|clip|auto|scroll)/.test(css.overflowX)) { l = Math.max(l, box.left); r = Math.min(r, box.right); }
        if (/(hidden|clip|auto|scroll)/.test(css.overflowY)) { t = Math.max(t, box.top); b = Math.min(b, box.bottom); }
      }
      if (r <= l || b <= t) continue;
      result.host.style.setProperty('left', `${l}px`, 'important'); result.host.style.setProperty('top', `${t}px`, 'important'); result.host.style.setProperty('width', `${r - l}px`, 'important'); result.host.style.setProperty('height', `${b - t}px`, 'important');
      result.layer.style.cssText = `left:${left - l + display.left}px;top:${top - t + display.top}px;width:${result.image.width}px;height:${result.image.height}px;transform:scale(${display.scaleX},${display.scaleY});`;
      result.host.hidden = false;
      // Fixed overlays must not paint through sticky headers or site dialogs.
      for (const label of result.layer.children) {
        const box = label.getBoundingClientRect();
        const hit = document.elementFromPoint(Math.min(r - 1, Math.max(l + 1, box.left + box.width / 2)), Math.min(b - 1, Math.max(t + 1, box.top + box.height / 2)));
        (label as HTMLElement).style.visibility = hit === image || hit === image.parentElement ? 'visible' : 'hidden';
      }
    }
  }
  private axisAligned(transform: string) {
    if (!transform || transform === 'none') return true;
    try { const matrix = new DOMMatrixReadOnly(transform); return matrix.is2D && matrix.b === 0 && matrix.c === 0 && matrix.a > 0 && matrix.d > 0; } catch { return false; }
  }
  private fail(error: string) { if (this.active) { const result = this.results.get(this.active.image); if (result) { result.busy = false; result.error = error; result.host.dataset.imageState = 'error'; result.status.textContent = `${error}；可打开图片阅读页处理。`; } } this.active = undefined; this.changed(); }
  stop() {
    if (!this.active) return;
    try { this.port?.postMessage({ type: 'stop' }); } catch { /* A closed processor has already stopped. */ }
    const result = this.results.get(this.active.image); if (result) { result.busy = false; result.host.dataset.imageState = 'stopped'; result.status.textContent = '已停止，保留已完成的图片译文。'; }
    this.active = undefined; this.changed();
  }
  private remove(image: HTMLImageElement) { this.results.get(image)?.host.remove(); this.results.delete(image); this.resize?.unobserve(image); }
  reset() { this.stop(); const port = this.port; this.port = undefined; port?.disconnect(); for (const image of this.results.keys()) this.remove(image); }
  destroy() { this.reset(); this.controller.abort(); this.resize?.disconnect(); this.mutations.disconnect(); cancelAnimationFrame(this.frame); }
}
