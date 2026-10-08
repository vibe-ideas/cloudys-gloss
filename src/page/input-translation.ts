type Editor = HTMLInputElement | HTMLTextAreaElement | HTMLElement;
type Snapshot = { text: string; raw: string; caret: number };
type Sequence = { editor: Editor; count: number; at: number; expected: string; caret: number };
type Job = { id: string; editor: Editor; snapshot: Snapshot; observer?: MutationObserver; timer?: ReturnType<typeof setTimeout> };
type Transport = { translate(id: string, text: string): Promise<string>; cancel(id: string): void };
const LIMIT = 12000;
const nativeField = (editor: Editor): editor is HTMLInputElement | HTMLTextAreaElement => editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement;
const rawValue = (editor: Editor) => nativeField(editor) ? editor.value : editor.innerHTML;
const block = /^(DIV|P|LI|BLOCKQUOTE|H[1-6])$/;

function editorFor(event: Event): Editor | undefined {
  const path = event.composedPath();
  const first = path.find(node => node instanceof HTMLElement) as HTMLElement | undefined;
  if (!first || path.some(node => node instanceof HTMLElement && node.hasAttribute('data-cloudys-gloss'))) return;
  if (first.closest('.monaco-editor,.cm-editor,.CodeMirror,pre,code,[inert],[aria-readonly="true"],[aria-disabled="true"]')) return;
  if (first instanceof HTMLInputElement || first instanceof HTMLTextAreaElement) {
    if (first.disabled || first.readOnly || first.matches(':disabled')) return;
    if (first instanceof HTMLInputElement && !['text', 'search'].includes(first.type)) return;
    if (/(?:password|one-time-code|cc-)/i.test(first.autocomplete)) return;
    return first;
  }
  let editor: HTMLElement | undefined;
  for (const node of path) {
    if (!(node instanceof HTMLElement)) continue;
    const attribute = node.getAttribute('contenteditable');
    if (attribute === 'false') break;
    if (attribute === '' || attribute === 'true' || attribute === 'plaintext-only') editor = node;
  }
  return editor;
}

function snapshot(editor: Editor): Snapshot {
  if (nativeField(editor)) return { text: editor.value, raw: editor.value,
    caret: editor.selectionStart === editor.selectionEnd ? editor.selectionStart ?? -1 : -1 };
  const selection = editor.ownerDocument.getSelection();
  const anchor = selection?.isCollapsed ? selection.anchorNode : null;
  let text = ''; let caret = -1; let visited = 0;
  const newline = () => { if (text && !text.endsWith('\n')) text += '\n'; };
  const walk = (node: Node, depth: number) => {
    if (++visited > 20000 || depth > 64 || text.length > LIMIT + 4) throw new Error('输入内容过长，请分段翻译（最多 12,000 字符）');
    if (node.nodeType === Node.TEXT_NODE) {
      if (node === anchor) caret = text.length + selection!.anchorOffset;
      text += (node.textContent ?? '').replace(/\u00a0/g, ' ');
      return;
    }
    if (node instanceof HTMLElement && node.tagName === 'BR') { text += '\n'; return; }
    const isBlock = node !== editor && node instanceof HTMLElement && block.test(node.tagName);
    if (isBlock) newline();
    node.childNodes.forEach((child, i) => {
      if (node === anchor && selection!.anchorOffset === i) caret = text.length;
      walk(child, depth + 1);
    });
    if (node === anchor && selection!.anchorOffset === node.childNodes.length) caret = text.length;
    if (isBlock) newline();
  };
  walk(editor, 0);
  return { text: text.replace(/\n$/, ''), raw: editor.innerHTML, caret };
}

function focused(editor: Editor) {
  let active = editor.ownerDocument.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active === editor || (!!active && editor.contains(active));
}

/** Four separate space presses; all work is scoped to the active editor. */
export class InputTranslation {
  private sequence?: Sequence;
  private job?: Job;
  private composing = false;
  private writing = false;
  private enabled = true;
  private host?: HTMLElement;
  private dismissTimer?: ReturnType<typeof setTimeout>;
  private undo?: () => void;
  private events = new AbortController();

  constructor(private transport: Transport, private doc: Document = document) {
    const options = { capture: true, signal: this.events.signal };
    doc.addEventListener('keydown', this.keydown, options);
    doc.addEventListener('input', this.input, options);
    doc.addEventListener('compositionstart', () => { this.composing = true; this.reset(); this.cancel(); }, options);
    doc.addEventListener('compositionend', () => { this.composing = false; this.reset(); }, options);
    doc.addEventListener('pointerdown', event => {
      if (event.composedPath().includes(this.host!)) return;
      this.reset(); this.undo = undefined;
      if (!this.job) this.hide();
    }, options);
    doc.addEventListener('focusout', event => {
      if (this.writing || event.composedPath().includes(this.host!)) return;
      this.reset(); this.cancel(); this.undo = undefined; this.hide();
    }, options);
    doc.defaultView?.addEventListener('blur', () => this.resetPage(), { signal: this.events.signal });
  }
  setEnabled(enabled: boolean) { this.enabled = enabled; if (!enabled) this.resetPage(); }
  resetPage() { this.reset(); this.cancel(); this.undo = undefined; this.hide(); }
  destroy() { this.resetPage(); this.events.abort(); }
  private reset() { this.sequence = undefined; }
  private hide() { clearTimeout(this.dismissTimer); this.host?.remove(); this.host = undefined; }
  private cancel() {
    const job = this.job;
    if (!job) return;
    this.job = undefined; clearTimeout(job.timer); job.observer?.disconnect();
    this.transport.cancel(job.id); this.hide();
  }
  private input = (event: Event) => {
    if (this.writing) return;
    this.cancel(); this.undo = undefined;
    const input = event as InputEvent;
    if (input.isComposing || input.inputType !== 'insertText' || !/^[ \u00a0]$/.test(input.data ?? '')) this.reset();
  };
  private keydown = (event: KeyboardEvent) => {
    if (!event.isTrusted) return;
    if (event.key === 'Escape' && this.job) {
      event.preventDefault(); event.stopPropagation(); this.cancel(); this.reset(); return;
    }
    if (this.writing || !this.enabled) return;
    if (this.job && !['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) this.cancel();
    if (this.undo) { this.undo = undefined; this.hide(); }
    if (this.composing || event.isComposing || event.keyCode === 229 || event.repeat || event.defaultPrevented
      || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.key !== ' ') { this.reset(); return; }
    const editor = editorFor(event);
    if (!editor) { this.reset(); return; }
    let current: Snapshot;
    try { current = snapshot(editor); } catch { this.reset(); return; }
    if (current.caret < 0 || current.text.length > LIMIT + 3) { this.reset(); return; }
    const previous = this.sequence;
    const consecutive = previous?.editor === editor && performance.now() - previous.at <= 650
      && previous.expected === current.text && previous.caret === current.caret;
    const count = consecutive ? previous.count + 1 : 1;
    if (count < 4) {
      this.sequence = { editor, count, at: performance.now(),
        expected: current.text.slice(0, current.caret) + ' ' + current.text.slice(current.caret), caret: current.caret + 1 };
      return;
    }
    this.reset();
    const source = current.text.slice(0, current.caret - 3) + current.text.slice(current.caret);
    if (!source.trim() || source.trim().length > LIMIT) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!nativeField(editor) && editor.querySelector('img,video,audio,iframe,svg,[contenteditable="false"],input,button')) {
      this.show('此输入框含图片或不可编辑内容，暂不支持整框替换'); return;
    }
    // Consume only the three spaces already inserted by the browser. The fourth
    // is prevented. Failed/aborted requests leave the complete original draft.
    this.writing = true;
    try {
      if (nativeField(editor)) editor.setSelectionRange(current.caret - 3, current.caret);
      else {
        const selection = this.doc.getSelection();
        if (selection?.anchorNode?.nodeType !== Node.TEXT_NODE || selection.anchorOffset < 3) throw new Error('请在文本末尾连续按四下空格');
        const range = this.doc.createRange();
        range.setStart(selection.anchorNode, selection.anchorOffset - 3); range.setEnd(selection.anchorNode, selection.anchorOffset);
        selection.removeAllRanges(); selection.addRange(range);
      }
      let cleaned = this.doc.execCommand?.('delete', false) ?? false;
      if (!cleaned && nativeField(editor)) {
        editor.setRangeText('', current.caret - 3, current.caret, 'end');
        editor.setSelectionRange(current.caret - 3, current.caret - 3);
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'deleteContentBackward' }));
        cleaned = true;
      }
      if (!cleaned || snapshot(editor).text !== source) throw new Error('当前编辑器未接受快捷操作，请使用普通文本输入框');
    } catch (error) { this.show(error instanceof Error ? error.message : '无法读取输入框'); return; }
    finally { this.writing = false; }
    void this.translate(editor);
  };
  private async translate(editor: Editor) {
    const state = snapshot(editor);
    const job: Job = { id: crypto.randomUUID(), editor, snapshot: state };
    this.job = job;
    if (!nativeField(editor)) {
      job.observer = new MutationObserver(() => { if (this.job === job) this.cancel(); });
      job.observer.observe(editor, { subtree: true, childList: true, characterData: true });
    }
    job.timer = setTimeout(() => {
      if (this.job === job) { this.cancel(); this.show('翻译等待超时，原文已保留，请重试'); }
    }, 600000);
    this.show('正在翻译为英文…', '取消', () => { this.cancel(); }, true);
    try {
      const translation = await this.transport.translate(job.id, state.text.trim());
      if (this.job !== job) return;
      if (!editor.isConnected || !focused(editor) || rawValue(editor) !== state.raw) { this.cancel(); return; }
      if (typeof translation !== 'string' || !translation.trim() || translation.length > 20000) throw new Error('模型没有返回有效英文译文');
      clearTimeout(job.timer); job.observer?.disconnect();
      const usedNativeUndo = this.replace(editor, translation);
      this.job = undefined;
      const translated = rawValue(editor);
      this.undo = () => {
        if (!editor.isConnected || rawValue(editor) !== translated) { this.hide(); return; }
        this.writing = true;
        try {
          editor.focus({ preventScroll: true });
          if (usedNativeUndo && this.doc.execCommand?.('undo', false)) return;
          if (nativeField(editor)) this.replace(editor, state.text);
        } finally { this.writing = false; this.undo = undefined; this.hide(); }
      };
      this.show('已替换为英文', '撤销', () => this.undo?.());
    } catch (error) {
      if (this.job !== job) return;
      this.job = undefined; clearTimeout(job.timer); job.observer?.disconnect();
      const detail = error instanceof Error ? error.message : '请重试';
      this.show(rawValue(editor) === state.raw ? `翻译失败，原文已保留：${detail}` : detail);
    }
  }
  private replace(editor: Editor, text: string): boolean {
    if (nativeField(editor) && (editor.disabled || editor.readOnly || editor.matches(':disabled') || (editor.maxLength >= 0 && text.length > editor.maxLength))) {
      throw new Error('英文译文超出输入框限制或输入框不可编辑，原文已保留');
    }
    if (!nativeField(editor) && editor.getAttribute('contenteditable') === 'false') throw new Error('输入框已不可编辑，原文已保留');
    this.writing = true;
    try {
      editor.focus({ preventScroll: true });
      if (nativeField(editor)) editor.setSelectionRange(0, editor.value.length);
      else {
        const range = this.doc.createRange(); range.selectNodeContents(editor);
        const selection = this.doc.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
      }
      const before = rawValue(editor);
      const native = this.doc.execCommand?.('insertText', false, text) ?? false;
      if (!native && nativeField(editor) && rawValue(editor) === before) {
        const allowed = editor.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, composed: true, cancelable: true, inputType: 'insertReplacementText', data: text }));
        if (!allowed) throw new Error('编辑器阻止了替换，原文已保留');
        const prototype = editor instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(editor, text);
        editor.setSelectionRange(text.length, text.length);
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertReplacementText', data: text }));
      }
      if (snapshot(editor).text !== text.replace(/\u00a0/g, ' ').replace(/\n$/, '')) throw new Error('当前编辑器未接受完整译文，请使用普通文本输入框');
      return native;
    } finally { this.writing = false; }
  }
  private show(message: string, action?: string, onAction?: () => void, busy = false) {
    this.hide();
    const host = this.doc.createElement('div'); host.dataset.cloudysGloss = 'input-translation';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = this.doc.createElement('style');
    style.textContent = ':host{all:initial;position:fixed;right:20px;bottom:20px;z-index:2147483647;color-scheme:light dark;font:13px/1.5 system-ui,sans-serif}.notice{box-sizing:border-box;display:flex;align-items:center;gap:12px;max-width:min(440px,calc(100vw - 40px));padding:12px 16px;border:1px solid #7257d640;border-radius:14px;background:light-dark(#fff,#25232d);color:light-dark(#35313f,#eeeaf9);box-shadow:0 6px 30px #0002;overflow-wrap:anywhere}button{font:inherit;white-space:nowrap;border:0;border-radius:8px;padding:6px 12px;color:light-dark(#6040c3,#d1bdff);background:light-dark(#f1ecff,#423459);cursor:pointer}button:focus-visible{outline:2px solid #9374ed;outline-offset:2px}.busy::before{content:"";width:12px;height:12px;flex-shrink:0;border:2px solid #7257d640;border-top-color:#9272e8;border-radius:50%;animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.busy::before{animation:none}}';
    const notice = this.doc.createElement('div'); notice.className = `notice${busy ? ' busy' : ''}`;
    const label = this.doc.createElement('span'); label.setAttribute('role', 'status'); label.textContent = message; notice.append(label);
    if (action) {
      const button = this.doc.createElement('button'); button.type = 'button'; button.textContent = action;
      button.addEventListener('mousedown', event => event.preventDefault());
      button.addEventListener('click', () => onAction?.()); notice.append(button);
    }
    shadow.append(style, notice); (this.doc.body ?? this.doc.documentElement).append(host); this.host = host;
    if (!busy) this.dismissTimer = setTimeout(() => { this.undo = undefined; this.hide(); }, 10000);
  }
}
