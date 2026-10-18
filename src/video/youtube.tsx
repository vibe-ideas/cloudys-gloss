import { render } from 'preact';
import { injectScript } from 'wxt/utils/inject-script';
import { OWN } from '../page/blocks';
import { captionText, captionPhrases, parseCaptions } from './captions';
import { MAX_CAPTION_BYTES, videoId } from './protocol';
import { SubtitleScheduler, type SubtitleClient, type SubtitleLine } from './scheduler';

const css = `
:host{all:initial!important;position:absolute!important;inset:0!important;z-index:60!important;pointer-events:none!important;color-scheme:dark!important}
*{box-sizing:border-box}.captions{position:absolute;bottom:12%;left:8%;width:84%;text-align:center;font-family:system-ui,-apple-system,sans-serif;line-height:1.45;color:#fff;text-shadow:0 1px 3px #000;overflow-wrap:anywhere;max-height:55%;overflow:hidden}
.line{display:table;margin:3px auto;padding:3px 10px;border-radius:5px;background:#101310d9;white-space:pre-line}
.original{font-size:clamp(13px,1.5vw,21px);color:#eee}.translation{font-size:clamp(16px,1.9vw,27px);font-weight:550}
.waiting{display:block;width:30px;height:3px;margin:8px auto;background:#dfff7280;border-radius:3px;animation:breathe 1.3s ease-in-out infinite}
.notice{position:absolute;top:12px;left:12px;max-width:min(420px,85%);padding:10px 14px;border-radius:8px;background:#141713e8;color:#eee;font:13px/1.5 system-ui;pointer-events:auto}
.notice p{margin:0}.notice button,.retry{font:12px/1.5 system-ui;color:#dfff72;border:1px solid #dfff7250;background:#141713ed;padding:4px 9px;border-radius:5px;cursor:pointer;pointer-events:auto}.notice button{margin-top:7px}
.retry{display:table;margin:5px auto}.error{display:table;margin:5px auto;background:#141713ed;font-size:12px;max-width:100%;padding:4px 8px;pointer-events:auto}
button:focus-visible{outline:2px solid #dfff72;outline-offset:3px}
@keyframes breathe{50%{opacity:.3;transform:scaleX(.55)}}@media(prefers-reduced-motion:reduce){.waiting{animation:none}}
`;
const nativeStyle = `[data-cloudys-subtitles="active"] .ytp-caption-window-container{visibility:hidden!important}`;
const emptyLine: SubtitleLine = { original: '', translated: '', pending: false, error: '' };

/** Scoped to the YouTube player. No document-wide mutation observer or animation loop. */
export class YouTubeSubtitles {
  private player?: HTMLElement;
  private video?: HTMLVideoElement;
  private button?: HTMLButtonElement;
  private host?: HTMLElement;
  private mount?: HTMLElement;
  private style?: HTMLStyleElement;
  private observer?: MutationObserver;
  private binding?: AbortController;
  private lifetime = new AbortController();
  private id = '';
  private channel = '';
  private enabled = false;
  private track = false;
  private trackBody = '';
  private ccEnabledByUs = false;
  private line: SubtitleLine = emptyLine;
  private note = '';
  private showError = false;
  private lastDraw = '';
  private debounce?: ReturnType<typeof setTimeout>;
  private deadline?: ReturnType<typeof setTimeout>;
  private bindTimer?: ReturnType<typeof setTimeout>;
  private waitingTimer?: ReturnType<typeof setTimeout>;
  private bridge?: Promise<unknown>;
  private scheduler: SubtitleScheduler;
  constructor(client: SubtitleClient, private loadBridge: () => Promise<unknown> = () => injectScript('/youtube-bridge.js')) {
    this.scheduler = new SubtitleScheduler(client, line => { this.line = line; this.draw(); });
    window.addEventListener('message', this.message, { signal: this.lifetime.signal });
    document.addEventListener('yt-navigate-start', () => this.unbind(), { signal: this.lifetime.signal });
    document.addEventListener('yt-navigate-finish', () => this.navigate(), { signal: this.lifetime.signal });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.scheduler.reset(); this.track = false; this.stopBridge(); }
      else if (this.enabled && this.player) this.start();
    }, { signal: this.lifetime.signal });
    this.navigate();
  }
  navigate(attempt = 0) {
    clearTimeout(this.bindTimer);
    if (this.lifetime.signal.aborted) return;
    const id = videoId(location.href);
    const player = document.getElementById('movie_player');
    const video = player?.querySelector('video');
    const controls = player?.querySelector('.ytp-right-controls');
    if (id && player === this.player && video === this.video && this.button?.isConnected && id === this.id) return;
    this.unbind();
    if (!id) return;
    if (!player || !video || !controls) {
      if (attempt < 30) this.bindTimer = setTimeout(() => this.navigate(attempt + 1), 500);
      return;
    }
    // Discard orphaned DOM left by a discarded extension realm after reload.
    for (const node of player.querySelectorAll(`[${OWN}="video-toggle"],[${OWN}="video-subtitles"],[${OWN}="video-style"]`)) node.remove();
    player.removeAttribute('data-cloudys-subtitles');
    this.id = id; this.player = player; this.video = video; this.binding = new AbortController();
    const signal = this.binding.signal;
    this.button = document.createElement('button'); this.button.setAttribute(OWN, 'video-toggle'); this.button.className = 'ytp-button';
    this.button.textContent = '双语'; this.button.style.cssText = 'width:48px;font:600 13px system-ui;vertical-align:top;color:inherit';
    this.button.addEventListener('click', () => { this.enabled = !this.enabled; if (this.enabled) this.start(); else this.stop(); }, { signal });
    controls.prepend(this.button);
    this.host = document.createElement('div'); this.host.setAttribute(OWN, 'video-subtitles');
    const shadow = this.host.attachShadow({ mode: 'open' }); const style = document.createElement('style'); style.textContent = css;
    this.mount = document.createElement('div'); shadow.append(style, this.mount); player.append(this.host);
    this.style = document.createElement('style'); this.style.setAttribute(OWN, 'video-style'); this.style.textContent = nativeStyle; player.append(this.style);
    for (const event of ['timeupdate', 'play', 'pause', 'seeked', 'ratechange', 'loadedmetadata']) video.addEventListener(event, () => this.tick(), { signal });
    video.addEventListener('seeking', () => { if (this.enabled) { if (!this.track) this.scheduler.setLive(''); this.scheduler.tick(video.currentTime, true); } }, { signal });
    this.draw(); if (this.enabled) this.start();
  }
  settingsChanged() { this.scheduler.destroy(); if (this.enabled && this.player) this.start(); }
  private start() {
    if (!this.player || !this.video || document.hidden) return;
    this.stopBridge(); this.observer?.disconnect();
    this.track = false; this.trackBody = ''; this.showError = false; this.scheduler.setTrack([]);
    this.note = '正在读取字幕。若没有字幕，请在 YouTube 的 CC 菜单中选择英文字幕。';
    this.channel = crypto.randomUUID(); const channel = this.channel;
    this.observer = new MutationObserver(records => {
      if (records.some(record => record.type === 'attributes' && record.target === this.player)) this.tick();
      if (!this.track && records.some(record => record.target instanceof Element && (record.target.closest('.ytp-caption-window-container') || [...record.addedNodes].some(node => node instanceof Element && (node.matches('.ytp-caption-window-container') || node.querySelector('.ytp-caption-window-container')))) || record.target.parentElement?.closest('.ytp-caption-window-container'))) this.scheduleLive();
    });
    this.observer.observe(this.player, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
    this.bridge ??= this.loadBridge().catch(() => { this.bridge = undefined; });
    void this.bridge.then(() => {
      if (!this.enabled || channel !== this.channel) return;
      window.postMessage({ source: 'cloudys-gloss:captions:request', channel, id: this.id, action: 'start' }, location.origin);
      // Enable the normal player captions so live fallback and authorized caption
      // requests both work. Restore only if we changed the original CC state.
      const cc = this.player?.querySelector<HTMLButtonElement>('.ytp-subtitles-button');
      if (cc?.getAttribute('aria-pressed') === 'false') { this.ccEnabledByUs = true; cc.click(); }
    });
    clearTimeout(this.waitingTimer);
    this.waitingTimer = setTimeout(() => {
      if (this.enabled && !this.track && !this.line.original) { this.note = '还没有读到字幕。请开启 CC 并选择英文；无字幕的视频暂不支持。'; this.draw(); }
    }, 10000);
    this.readLive(); this.tick();
  }
  private stopBridge() {
    if (this.channel) window.postMessage({ source: 'cloudys-gloss:captions:request', channel: this.channel, id: this.id, action: 'stop' }, location.origin);
    this.channel = '';
  }
  private stop() {
    this.stopBridge(); this.observer?.disconnect(); this.observer = undefined;
    clearTimeout(this.debounce); clearTimeout(this.deadline); clearTimeout(this.waitingTimer);
    this.debounce = undefined; this.deadline = undefined;
    this.scheduler.reset(); this.track = false; this.note = ''; this.player?.removeAttribute('data-cloudys-subtitles');
    if (this.ccEnabledByUs && this.id === videoId(location.href)) {
      const cc = this.player?.querySelector<HTMLButtonElement>('.ytp-subtitles-button');
      if (cc?.getAttribute('aria-pressed') === 'true') cc.click();
    }
    this.ccEnabledByUs = false; this.draw();
  }
  private unbind() {
    this.stop(); this.binding?.abort(); this.button?.remove(); this.style?.remove();
    if (this.mount) render(null, this.mount); this.host?.remove();
    this.player = undefined; this.video = undefined; this.mount = undefined; this.button = undefined; this.id = ''; this.lastDraw = '';
  }
  private message = (event: MessageEvent) => {
    const data = event.data;
    if (event.source !== window || event.origin !== location.origin || !this.enabled || !this.channel || data?.source !== 'cloudys-gloss:captions:response' || data.channel !== this.channel || data.id !== this.id || this.id !== videoId(location.href)) return;
    if (data.type === 'track' && typeof data.body === 'string' && data.body.length <= MAX_CAPTION_BYTES) {
      if (this.track && data.body === this.trackBody) return;
      const captions = captionPhrases(parseCaptions(data.body));
      if (captions.length) { this.track = true; this.trackBody = data.body; this.note = ''; this.scheduler.setTrack(captions); this.tick(); }
      else this.readLive();
    }
    if (data.type === 'unavailable') this.readLive();
  };
  private scheduleLive() {
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.readLive(), 180);
    // Rolling ASR updates must not postpone a translation forever.
    this.deadline ??= setTimeout(() => this.readLive(), 650);
  }
  private readLive() {
    clearTimeout(this.debounce); clearTimeout(this.deadline); this.deadline = undefined;
    if (!this.enabled || this.track || !this.player || document.hidden || this.player.classList.contains('ad-showing')) return;
    const text = captionText(Array.from(this.player.querySelectorAll('.ytp-caption-segment')).map(node => node.textContent ?? '').join(' ')).slice(0, 2400);
    if (text) this.note = '';
    this.scheduler.setLive(text); this.tick();
  }
  private tick(seek = false) {
    if (!this.enabled || !this.video || document.hidden) return;
    if (!this.player?.classList.contains('ad-showing')) this.scheduler.tick(this.video.currentTime, seek, this.video.playbackRate);
    this.draw();
  }
  private draw() {
    if (this.button) {
      this.button.setAttribute('aria-label', this.enabled ? '关闭双语字幕' : '开启双语字幕');
      this.button.setAttribute('aria-pressed', String(this.enabled)); this.button.title = this.enabled ? `关闭 Cloudy’s Gloss 双语字幕 · ${this.track ? '字幕轨道 · 提前翻译' : '当前 CC · 实时翻译'}` : 'Cloudy’s Gloss 双语字幕 · 使用当前翻译模型';
      this.button.style.color = this.enabled ? '#dfff72' : 'inherit';
    }
    if (!this.mount) return;
    const visible = this.enabled && !document.hidden && !this.player?.classList.contains('ad-showing');
    const line = visible ? this.line : emptyLine;
    if (line.original) this.player?.setAttribute('data-cloudys-subtitles', 'active'); else this.player?.removeAttribute('data-cloudys-subtitles');
    const key = JSON.stringify([visible, line, this.note, this.showError]); if (key === this.lastDraw) return; this.lastDraw = key;
    render(<>
      {visible && !line.original && this.note && <div class="notice" role="status"><p>{this.note}</p><button onClick={() => this.start()}>重新读取字幕</button></div>}
      {line.original && <div class="captions" aria-label="双语字幕">
        <div class="line original">{line.original}</div>
        {line.translated && <div class="line translation" lang="zh-CN">{line.translated}</div>}
        {line.pending && !line.translated && <span class="waiting" aria-label="正在翻译字幕" />}
        {line.error && <><button class="retry" onClick={() => this.scheduler.retry()}>重试这句</button><button class="retry" onClick={() => { this.showError = !this.showError; this.draw(); }}>错误原因</button>{this.showError && <span class="error">{line.error}</span>}</>}
      </div>}
    </>, this.mount);
  }
  destroy() { this.enabled = false; clearTimeout(this.bindTimer); this.lifetime.abort(); this.unbind(); this.scheduler.destroy(); }
}
