import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { OWN, blockText, excludedElement } from '../page/blocks';
import type { Settings, WordCard } from '../core/schema';
import type { WordSpeech } from '../speech/speech';
import type { SpeechLocale } from '../speech/native-speech';
import { createId } from '../core/id';
import type { LocalDefinition } from '../dictionaries/store';

type Anchor = { left: number; top: number; bottom: number };
export function placePopover(anchor: Anchor, width: number, height: number, viewportWidth: number, viewportHeight: number, preferredBelow?: boolean) {
  const below = Math.max(0, viewportHeight - anchor.bottom - 22);
  const above = Math.max(0, anchor.top - 22);
  const useBelow = preferredBelow ?? (height <= below || (height > above && below >= above));
  const maxHeight = Math.min(viewportHeight - 24, useBelow ? below : above);
  // A multi-line selection can occupy almost the entire viewport. In that
  // exceptional case retain a usable, scrollable card within the screen.
  if (maxHeight < 64) return {
    left: Math.max(12, Math.min(anchor.left, viewportWidth - width - 12)),
    top: 12,
    maxHeight: Math.max(0, viewportHeight - 24),
  };
  const visibleHeight = Math.min(height, maxHeight);
  return {
    left: Math.max(12, Math.min(anchor.left, viewportWidth - width - 12)),
    top: useBelow ? anchor.bottom + 10 : anchor.top - visibleHeight - 10,
    maxHeight,
  };
}
export interface DictionaryTransport { lookup(id: string, word: string, context: string): Promise<WordCard>; local?(id: string, word: string): Promise<LocalDefinition[]>; pronunciation?(id: string, word: string): Promise<WordCard['ipa']>; cancel(id: string): void }
const css = `
:host{all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;color-scheme:light dark!important}
*{box-sizing:border-box} .panel{--bg:#fff;--fg:#242238;--muted:#747186;--line:#eeecf5;--soft:#f5f4fb;--accent:#6f58d9;position:fixed;pointer-events:auto;width:360px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 24px);overflow:auto;overflow-wrap:anywhere;overscroll-behavior:contain;background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:18px;padding:20px;box-shadow:0 14px 54px #19142f25;font:14px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;text-align:left;}
.panel.dark{--bg:#22212b;--fg:#f1eff9;--muted:#aaa5be;--line:#3b384a;--soft:#2c2939;--accent:#b4a3ff}
@media(prefers-color-scheme:dark){.panel.system{--bg:#22212b;--fg:#f1eff9;--muted:#aaa5be;--line:#3b384a;--soft:#2c2939;--accent:#b4a3ff}}
.panel.launcher{display:grid;place-items:center;width:34px;height:34px;min-height:34px;padding:0;overflow:visible;border:1px solid #ffffff45;border-radius:10px;background:#7257d6;color:#fff;box-shadow:0 3px 10px #35206a30;cursor:pointer;animation:appear .14s ease-out}.panel.launcher:hover{background:#6245c7;color:#fff}.panel.launcher:active{transform:scale(.94)}@keyframes appear{from{opacity:0;transform:translateY(3px) scale(.94)}to{opacity:1;transform:none}}@media(prefers-reduced-motion:reduce){.panel.launcher{animation:none}.panel.launcher:active{transform:none}}
header{display:flex;align-items:center;justify-content:space-between;color:var(--muted);font-size:11px;letter-spacing:1.6px}button{font:inherit;cursor:pointer;background:var(--soft);color:var(--fg);border:0;border-radius:8px;padding:5px 9px}button:hover{color:var(--accent)}button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}h2{font-size:26px;line-height:1.2;margin:15px 0 12px;overflow-wrap:anywhere;letter-spacing:-.7px}p{margin:8px 0} .ipa{display:flex;flex-wrap:wrap;gap:7px}.ipa button{font-size:12px;color:var(--muted)}.sense{margin:15px 0;display:flex;align-items:baseline;gap:10px}.pos{font-size:11px;color:var(--accent);border-radius:5px;background:var(--soft);padding:2px 7px;flex-shrink:0}.context{padding:13px;border-radius:10px;background:var(--soft);margin-top:17px}.label{font-size:10px;font-weight:600;letter-spacing:1.4px;color:var(--accent)}.examples{border-top:1px solid var(--line);margin-top:17px;padding-top:14px}.zh,footer{color:var(--muted);font-size:12px}footer{margin-top:16px;font-size:10px}.skeleton{height:12px;background:var(--soft);border-radius:6px;margin:14px 0;animation:pulse 1.2s ease-in-out infinite}.error{color:#b2485b;overflow-wrap:anywhere}.panel.dark .error{color:#f0a3b1}@media(prefers-color-scheme:dark){.panel.system .error{color:#f0a3b1}}@keyframes pulse{50%{opacity:.45}}@media(prefers-reduced-motion:reduce){.skeleton{animation:none}}
`;

export function DictionaryCard({ card, speech, pending = false, error, onRetry, local = [] }: { card: WordCard; speech?: WordSpeech; pending?: boolean; error?: string; onRetry?: () => void; local?: LocalDefinition[] }) {
  const [audioError, setAudioError] = useState('');
  const [speaking, setSpeaking] = useState<SpeechLocale>();
  const attempt = useRef(0);
  useEffect(() => () => { attempt.current++; speech?.stop(); }, [speech]);
  const speak = (locale: SpeechLocale) => {
    if (!speech) { setAudioError('发音服务未就绪，请刷新页面'); return; }
    const token = ++attempt.current;
    setAudioError(''); setSpeaking(locale);
    void speech.play(card.word, locale).catch((error: unknown) => {
      if (attempt.current === token) setAudioError(error instanceof Error ? error.message : '发音失败');
    }).finally(() => { if (attempt.current === token) setSpeaking(undefined); });
  };
  return <>
    <h2>{card.word}</h2>
    <div class="ipa"><button aria-busy={speaking === 'en-US'} aria-label="美式发音" onClick={() => speak('en-US')}>US {card.ipa.us || '音标暂无'} ♫</button><button aria-busy={speaking === 'en-GB'} aria-label="英式发音" onClick={() => speak('en-GB')}>UK {card.ipa.uk || '音标暂无'} ♫</button></div>
    {card.ipa.general && <p class="zh" aria-label="未标注口音的词典音标">IPA {card.ipa.general} <small>（词典未标注口音）</small></p>}
    {speaking && <p class="zh" role="status">正在播放{speaking === 'en-US' ? '美式' : '英式'}发音…</p>}
    {audioError && <p class="error" role="status">{audioError}</p>}
    {!!local.length && <section aria-label="本地词库释义" style={{ marginTop: 16, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
      <div class="label">LOCAL DICTIONARY · 本地词库</div>
      {local.map((entry, index) => <details key={`${entry.dictionary}:${entry.headword}:${index}`} open={index === 0} style={{ marginTop: 8 }}>
        <summary style={{ cursor: 'pointer', color: 'var(--accent)' }}>{entry.dictionary} · {entry.headword}</summary>
        {entry.matchedAs !== entry.headword && <p class="zh">别名：{entry.matchedAs}</p>}
        {entry.phonetic && <p class="zh">词库读音（未标注口音）：{entry.phonetic}</p>}
        <p style={{ whiteSpace: 'pre-wrap', maxHeight: 180, overflow: 'auto', overscrollBehavior: 'contain' }}>{entry.text}</p>
        {entry.truncated && <p class="zh">长词条仅显示前 12,000 字符。</p>}
      </details>)}
      <p class="zh">词库原有释义，具体含义请结合下方语境解释。</p>
    </section>}
    {error ? <><p class="error" role="alert">{error}</p><button onClick={onRetry}>重试</button></> : pending ? <><p class="zh">{local.length ? 'AI 语境解释准备中' : '释义准备中'}</p><div class="skeleton" /><div class="skeleton" style={{ width: '72%' }} /><div class="skeleton" /></> : <>
    {card.senses.map((sense, i) => <div class="sense" key={i}><span class="pos">{sense.partOfSpeech}</span><span>{sense.meaning}</span></div>)}
    <div class="context"><div class="label">IN THIS CONTEXT · 此处含义</div><p>{card.contextMeaning}</p></div>
    <div class="examples"><div class="label">EXAMPLES · 例句</div>{card.examples.map((example, i) => <div key={i}><p>{example.en}</p><p class="zh">{example.zh}</p></div>)}</div>
    <footer>AI 释义 · 离线词典音标 · 系统语音发音</footer>
    </>}
  </>;
}
export class SelectionPopover {
  private host?: HTMLElement;
  private shadow?: ShadowRoot;
  private mount?: HTMLElement;
  private id?: string;
  private pronunciationId?: string;
  private localId?: string;
  private below?: boolean;
  private pending?: { word: string; context: string; range: Range };
  private sourceRange?: Range;
  private returnFocus?: HTMLElement;
  private resize?: ResizeObserver;
  private timer?: ReturnType<typeof setTimeout>;
  private controller = new AbortController();
  constructor(private transport: DictionaryTransport, private theme: Settings['theme'] = 'system', private speech?: WordSpeech) {
    // Sites often stop bubbling pointer/key events in their own UI handlers.
    // Observe selection gestures first without preventing the site's default action.
    const options = { signal: this.controller.signal, capture: true };
    document.addEventListener('pointerup', this.onSelection, options);
    document.addEventListener('keyup', this.onKey, options);
    document.addEventListener('selectionchange', () => {
      if (this.pending && !this.shadow?.activeElement && window.getSelection()?.toString().trim() !== this.pending.word) this.close();
    }, options);
    document.addEventListener('pointerdown', (event) => {
      if (!event.composedPath().includes(this.host!)) this.close();
    }, options);
    window.addEventListener('resize', () => { this.below = undefined; this.position(); }, options);
    window.addEventListener('scroll', (event) => { if (!event.composedPath().includes(this.host!)) this.close(); }, { ...options, capture: true, passive: true });
  }
  setTheme(theme: Settings['theme']) {
    this.theme = theme;
    const panel = this.mount?.firstElementChild;
    if (panel) { panel.classList.remove('light', 'dark', 'system'); panel.classList.add(theme); }
  }
  private onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { this.close(true); return; }
    if (event.shiftKey || event.key.startsWith('Arrow')) this.onSelection(event);
  };
  private onSelection = (event: Event) => {
    if (event.composedPath().some((node) => node instanceof Element && node.hasAttribute(OWN))) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.readSelection(event instanceof KeyboardEvent), 0);
  };
  private readSelection(keyboard = false) {
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return;
    const word = selection.toString().trim();
    if (!word || word.length > 200) return;
    const range = selection.getRangeAt(0);
    const parent = range.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    if (!parent || excludedElement(parent)) return;
    const context = blockText(parent.closest('p,li,td,blockquote,article') ?? parent).slice(0, 3000);
    this.offer(word, context, range.cloneRange(), keyboard);
  }
  private surface(range: Range) {
    this.close();
    this.sourceRange = range;
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    this.host = document.createElement('div'); this.host.setAttribute(OWN, 'popover');
    this.shadow = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style'); style.textContent = css;
    this.mount = document.createElement('div'); this.shadow.append(style, this.mount);
    (range.startContainer.parentElement?.closest('dialog[open]') ?? document.documentElement).append(this.host);
  }
  private offer(word: string, context: string, range: Range, keyboard: boolean) {
    this.surface(range);
    this.pending = { word, context, range };
    render(<button type="button" class={`panel launcher ${this.theme}`} aria-label="翻译所选内容" title="翻译所选内容" onPointerDown={(event) => event.preventDefault()} onClick={(event) => {
      const focus = this.returnFocus;
      this.open(word, context, range, event.detail === 0);
      this.returnFocus = focus;
    }}>
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true"><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-6l-5 3v-3H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M7 8h10M7 12h6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
    </button>, this.mount!);
    this.position();
    if (keyboard) this.mount?.querySelector<HTMLElement>('.launcher')?.focus({ preventScroll: true });
  }
  private open(word: string, context: string, range: Range, keyboard = false) {
    this.surface(range);
    const id = createId(); this.id = id;
    let card: WordCard | undefined;
    let error: string | undefined;
    let ipa: WordCard['ipa'] = { us: '', uk: '' };
    let local: LocalDefinition[] = [];
    const show = () => {
      if (this.id !== id) return;
      render(<section class={`panel ${this.theme}`} role="dialog" tabIndex={-1} aria-label="AI 单词卡" aria-busy={!card && !error}>
        <header><span>☁ CLOUDY’S GLOSS</span><button aria-label="关闭词卡" onClick={() => this.close(true)}>×</button></header>
        <div aria-live="polite"><DictionaryCard card={card ?? { word, ipa, senses: [], contextMeaning: '', examples: [] }} local={local} speech={this.speech} pending={!card && !error} error={error} onRetry={() => this.open(word, context, range, keyboard)} /></div>
      </section>, this.mount!);
      this.position();
    };
    show();
    if (!this.mount) return;
    if (keyboard) this.mount.querySelector<HTMLElement>('.panel')?.focus({ preventScroll: true });
    this.resize = new ResizeObserver(() => this.position()); this.resize.observe(this.mount.firstElementChild!);
    if (this.transport.local) {
      const localId = createId(); this.localId = localId;
      void this.transport.local(localId, word).then(result => {
        if (this.id !== id || this.localId !== localId) return;
        local = result; show();
      }).catch(() => { /* An unavailable imported dictionary never blocks built-in IPA or AI. */ }).finally(() => {
        if (this.localId === localId) this.localId = undefined;
      });
    }
    if (this.transport.pronunciation) {
      const pronunciationId = createId(); this.pronunciationId = pronunciationId;
      void this.transport.pronunciation(pronunciationId, word).then((result) => {
        if (this.id !== id || this.pronunciationId !== pronunciationId) return;
        ipa = result;
        if (card) card = { ...card, ipa: { ...ipa, ...card.ipa, us: card.ipa.us || ipa.us, uk: card.ipa.uk || ipa.uk } };
        show();
      }).catch(() => { /* Missing offline entries do not block the AI card or speech. */ }).finally(() => {
        if (this.pronunciationId === pronunciationId) this.pronunciationId = undefined;
      });
    }
    void this.transport.lookup(id, word, context).then((result) => {
      card = { ...result, ipa: { ...ipa, ...result.ipa, us: result.ipa.us || ipa.us, uk: result.ipa.uk || ipa.uk } }; error = undefined; show();
    }).catch((cause: unknown) => { error = cause instanceof Error ? cause.message : '词卡生成失败'; show(); });
  }
  private position() {
    const panel = this.mount?.firstElementChild as HTMLElement | null;
    if (!panel || !this.sourceRange) return;
    if (!this.sourceRange.commonAncestorContainer.isConnected) { this.close(); return; }
    const anchor = this.sourceRange.getBoundingClientRect();
    if (anchor.bottom < 0 || anchor.top > window.innerHeight) { this.close(); return; }
    const { width, height } = panel.getBoundingClientRect();
    // Use full content height when deciding which side has room. A previously
    // constrained panel must be able to expand again after viewport changes.
    const position = placePopover(anchor, width, Math.max(height, panel.scrollHeight + 2), window.innerWidth, window.innerHeight, this.below);
    if (this.id && this.below === undefined) this.below = position.top >= anchor.bottom;
    panel.style.maxHeight = `${Math.max(0, position.maxHeight)}px`;
    panel.style.left = `${position.left}px`; panel.style.top = `${position.top}px`;
  }
  close(restoreFocus = false) {
    if (this.timer) clearTimeout(this.timer); this.timer = undefined;
    if (this.id) this.transport.cancel(this.id); this.id = undefined;
    if (this.pronunciationId) this.transport.cancel(this.pronunciationId); this.pronunciationId = undefined;
    if (this.localId) this.transport.cancel(this.localId); this.localId = undefined;
    this.below = undefined;
    this.resize?.disconnect();
    const focusInside = !!this.shadow?.activeElement;
    if (this.mount) render(null, this.mount);
    this.host?.remove(); this.host = undefined; this.mount = undefined; this.sourceRange = undefined; this.pending = undefined; this.shadow = undefined;
    if (restoreFocus && focusInside && this.returnFocus?.isConnected) this.returnFocus.focus({ preventScroll: true });
    this.returnFocus = undefined;
    this.speech?.stop();
  }
  destroy() { this.close(); this.controller.abort(); }
}
