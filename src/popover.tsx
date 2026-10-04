import { render } from 'preact';
import { useState } from 'preact/hooks';
import { OWN, blockText, excludedElement } from './blocks';
import type { Settings, WordCard } from './schema';

type Anchor = { left: number; top: number; bottom: number };
export function placePopover(anchor: Anchor, width: number, height: number, viewportWidth: number, viewportHeight: number) {
  return {
    left: Math.max(12, Math.min(anchor.left, viewportWidth - width - 12)),
    top: Math.max(12, Math.min(anchor.bottom + height + 20 <= viewportHeight ? anchor.bottom + 10 : anchor.top - height - 10, viewportHeight - height - 12)),
  };
}
export interface DictionaryTransport { lookup(id: string, word: string, context: string): Promise<WordCard>; cancel(id: string): void }
const css = `
:host{all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;color-scheme:light dark!important}
*{box-sizing:border-box} .panel{--bg:#fff;--fg:#242238;--muted:#747186;--line:#eeecf5;--soft:#f5f4fb;--accent:#6f58d9;position:fixed;pointer-events:auto;width:360px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 24px);overflow:auto;overscroll-behavior:contain;background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:18px;padding:20px;box-shadow:0 14px 54px #19142f25;font:14px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;text-align:left;}
.panel.dark{--bg:#22212b;--fg:#f1eff9;--muted:#aaa5be;--line:#3b384a;--soft:#2c2939;--accent:#b4a3ff}
@media(prefers-color-scheme:dark){.panel.system{--bg:#22212b;--fg:#f1eff9;--muted:#aaa5be;--line:#3b384a;--soft:#2c2939;--accent:#b4a3ff}}
header{display:flex;align-items:center;justify-content:space-between;color:var(--muted);font-size:11px;letter-spacing:1.6px}button{font:inherit;cursor:pointer;background:var(--soft);color:var(--fg);border:0;border-radius:8px;padding:5px 9px}button:hover{color:var(--accent)}button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}h2{font-size:26px;line-height:1.2;margin:15px 0 12px;overflow-wrap:anywhere;letter-spacing:-.7px}p{margin:8px 0} .ipa{display:flex;flex-wrap:wrap;gap:7px}.ipa button{font-size:12px;color:var(--muted)}.sense{margin:15px 0;display:flex;align-items:baseline;gap:10px}.pos{font-size:11px;color:var(--accent);border-radius:5px;background:var(--soft);padding:2px 7px;flex-shrink:0}.context{padding:13px;border-radius:10px;background:var(--soft);margin-top:17px}.label{font-size:10px;font-weight:600;letter-spacing:1.4px;color:var(--accent)}.examples{border-top:1px solid var(--line);margin-top:17px;padding-top:14px}.zh,footer{color:var(--muted);font-size:12px}footer{margin-top:16px;font-size:10px}.skeleton{height:12px;background:var(--soft);border-radius:6px;margin:14px 0;animation:pulse 1.2s ease-in-out infinite}.error{color:#cf6475;overflow-wrap:anywhere}@keyframes pulse{50%{opacity:.45}}@media(prefers-reduced-motion:reduce){.skeleton{animation:none}}
`;

export function DictionaryCard({ card }: { card: WordCard }) {
  const [audioError, setAudioError] = useState('');
  const speak = (locale: string) => {
    if (!('speechSynthesis' in window)) { setAudioError('此浏览器暂不支持发音'); return; }
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(card.word);
    utterance.lang = locale;
    const voices = speechSynthesis.getVoices();
    utterance.voice = voices.find((voice) => voice.lang === locale && voice.localService) ?? voices.find((voice) => voice.lang === locale) ?? null;
    utterance.rate = 0.85;
    utterance.onerror = () => setAudioError('发音不可用，请安装系统英语语音');
    setAudioError(''); speechSynthesis.speak(utterance);
  };
  return <>
    <h2>{card.word}</h2>
    <div class="ipa"><button aria-label="美式发音" onClick={() => speak('en-US')}>US {card.ipa.us || '音标暂无'} ♫</button><button aria-label="英式发音" onClick={() => speak('en-GB')}>UK {card.ipa.uk || '音标暂无'} ♫</button></div>
    {audioError && <p class="error" role="status">{audioError}</p>}
    {card.senses.map((sense, i) => <div class="sense" key={i}><span class="pos">{sense.partOfSpeech}</span><span>{sense.meaning}</span></div>)}
    <div class="context"><div class="label">IN THIS CONTEXT · 此处含义</div><p>{card.contextMeaning}</p></div>
    <div class="examples"><div class="label">EXAMPLES · 例句</div>{card.examples.map((example, i) => <div key={i}><p>{example.en}</p><p class="zh">{example.zh}</p></div>)}</div>
    <footer>AI 释义 · 离线词典音标 · 系统语音发音</footer>
  </>;
}
export class SelectionPopover {
  private host?: HTMLElement;
  private shadow?: ShadowRoot;
  private mount?: HTMLElement;
  private id?: string;
  private anchor?: Anchor;
  private resize?: ResizeObserver;
  private timer?: ReturnType<typeof setTimeout>;
  private controller = new AbortController();
  constructor(private transport: DictionaryTransport, private theme: Settings['theme'] = 'system') {
    // Sites often stop bubbling pointer/key events in their own UI handlers.
    // Observe selection gestures first without preventing the site's default action.
    const options = { signal: this.controller.signal, capture: true };
    document.addEventListener('pointerup', this.onSelection, options);
    document.addEventListener('keyup', this.onKey, options);
    document.addEventListener('pointerdown', (event) => {
      if (!event.composedPath().includes(this.host!)) this.close();
    }, options);
    window.addEventListener('resize', () => this.position(), options);
    window.addEventListener('scroll', (event) => { if (!event.composedPath().includes(this.host!)) this.close(); }, { ...options, capture: true, passive: true });
  }
  setTheme(theme: Settings['theme']) {
    this.theme = theme;
    const panel = this.mount?.firstElementChild;
    if (panel) panel.className = `panel ${theme}`;
  }
  private onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { this.close(); return; }
    if (event.shiftKey || event.key.startsWith('Arrow')) this.onSelection(event);
  };
  private onSelection = (event: Event) => {
    if (event.composedPath().some((node) => node instanceof Element && node.hasAttribute(OWN))) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.readSelection(), 0);
  };
  private readSelection() {
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return;
    const word = selection.toString().trim();
    if (!word || word.length > 200) return;
    const range = selection.getRangeAt(0);
    const parent = range.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    if (!parent || excludedElement(parent)) return;
    const bounds = range.getBoundingClientRect();
    const context = blockText(parent.closest('p,li,td,blockquote,article') ?? parent).slice(0, 3000);
    this.open(word, context, { left: bounds.left, top: bounds.top, bottom: bounds.bottom });
  }
  private open(word: string, context: string, anchor: Anchor) {
    this.close();
    this.anchor = anchor;
    this.host = document.createElement('div'); this.host.setAttribute(OWN, 'popover');
    this.shadow = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style'); style.textContent = css;
    this.mount = document.createElement('div'); this.shadow.append(style, this.mount);
    document.documentElement.append(this.host);
    const id = crypto.randomUUID(); this.id = id;
    const show = (card?: WordCard, error?: string) => {
      if (this.id !== id) return;
      render(<section class={`panel ${this.theme}`} role="dialog" aria-label="AI 单词卡" aria-busy={!card && !error}>
        <header><span>☁ CLOUDY’S GLOSS</span><button aria-label="关闭词卡" onClick={() => this.close()}>×</button></header>
        <div aria-live="polite">{card ? <DictionaryCard card={card} /> : <><h2>{word}</h2>{error ? <><p class="error" role="alert">{error}</p><button onClick={() => this.open(word, context, anchor)}>重试</button></> : <><p class="zh">正在理解上下文…</p><div class="skeleton" /><div class="skeleton" style={{ width: '72%' }} /><div class="skeleton" /></>}</>}</div>
      </section>, this.mount!);
      this.position();
    };
    show();
    this.resize = new ResizeObserver(() => this.position()); this.resize.observe(this.mount.firstElementChild!);
    void this.transport.lookup(id, word, context).then((card) => show(card)).catch((error: unknown) => show(undefined, error instanceof Error ? error.message : '词卡生成失败'));
  }
  private position() {
    const panel = this.mount?.firstElementChild as HTMLElement | null;
    if (!panel || !this.anchor) return;
    const { width, height } = panel.getBoundingClientRect();
    const position = placePopover(this.anchor, width, height, window.innerWidth, window.innerHeight);
    panel.style.left = `${position.left}px`; panel.style.top = `${position.top}px`;
  }
  close() {
    if (this.timer) clearTimeout(this.timer); this.timer = undefined;
    if (this.id) this.transport.cancel(this.id); this.id = undefined;
    this.resize?.disconnect();
    if (this.mount) render(null, this.mount);
    this.host?.remove(); this.host = undefined; this.mount = undefined;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }
  destroy() { this.close(); this.controller.abort(); }
}
