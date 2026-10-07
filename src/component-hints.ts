import { OWN } from './blocks';
import { createId } from './id';

type TranslationAction = { error?: string; busy: boolean; label: string; retry: () => void };

/** One shared translation/action surface for paragraphs and rigid components.
 * Normal clicks keep their native action. Touch users can hold a marked label;
 * hover/focus exposes a compact action; explicit activation opens paragraph tools.
 */
export class ComponentHints {
  private actions = new Map<Element, TranslationAction>();
  private texts = new Map<Element, string>();
  private host?: HTMLElement;
  private panel?: HTMLElement;
  private source?: Element;
  private interactive = false;
  private dismissed?: Element;
  private description?: string | null;
  private descriptionTarget?: Element;
  private applied?: string;
  private hold?: ReturnType<typeof setTimeout>;
  private leaveTimer?: ReturnType<typeof setTimeout>;
  private resizeFrame?: number;
  private held?: { source: Element; until: number };
  private pressed?: { x: number; y: number };
  private listening = false;
  update(source: Element, text: string, action?: TranslationAction) {
    if (action) this.actions.set(source, action); else this.actions.delete(source);
    this.texts.set(source, text);
    if (!this.listening) {
      this.listening = true;
      document.addEventListener('pointerover', this.enter);
      document.addEventListener('pointerout', this.leave);
      document.addEventListener('focusin', this.enter);
      document.addEventListener('focusout', this.leave);
      document.addEventListener('keydown', this.key, true);
      document.addEventListener('pointerdown', this.down, { passive: true, capture: true });
      document.addEventListener('pointermove', this.move, { passive: true });
      document.addEventListener('pointerup', this.up, { passive: true });
      document.addEventListener('pointercancel', this.cancel, { passive: true });
      document.addEventListener('click', this.click, true);
      document.addEventListener('contextmenu', this.context);
      window.addEventListener('scroll', this.scroll, true);
      window.addEventListener('resize', this.resize);
    }
    if (this.host === document.activeElement && this.source !== source) return;
    if (this.dismissed !== source && (this.source === source || this.focused(source) || source.matches(':hover'))) this.show(source, this.source === source ? this.interactive : false);
  }
  private focused(source: Element) {
    return this.source === source && this.host === document.activeElement || source === document.activeElement || source.contains(document.activeElement) || source instanceof HTMLLabelElement && source.control === document.activeElement;
  }
  private find(target: EventTarget | null) {
    for (let element = target instanceof Element ? target : null; element; element = element.parentElement) if (this.texts.has(element)) return element;
    if (target instanceof HTMLElement) for (const label of (target as HTMLInputElement).labels ?? []) if (this.texts.has(label)) return label;
  }
  private enter = (event: Event) => {
    const source = this.find(event.target);
    if (!source && (!this.host || !event.composedPath().includes(this.host))) return;
    if (this.leaveTimer) clearTimeout(this.leaveTimer); this.leaveTimer = undefined;
    if (event instanceof PointerEvent && event.pointerType === 'touch') return;
    if (source && source !== this.source && this.host === document.activeElement && event.type === 'pointerover') return;
    if (source) { this.dismissed = undefined; this.show(source, this.source === source && this.interactive); }
  };
  private leave = (event: Event) => {
    if (!this.source || !(event.target instanceof Node) || !this.source.contains(event.target) && !this.descriptionTarget?.contains(event.target) && !this.host?.contains(event.target)) return;
    const next = (event as FocusEvent).relatedTarget;
    if (this.source && !(next instanceof Node && (this.source.contains(next) || this.descriptionTarget?.contains(next) || this.host?.contains(next)))) {
      if (event.type === 'pointerout') {
        if (this.focused(this.source)) return;
        if (this.leaveTimer) clearTimeout(this.leaveTimer);
        this.leaveTimer = setTimeout(() => {
          this.leaveTimer = undefined;
          if (!this.source || !this.focused(this.source)) this.hide();
        }, 120);
      }
      else this.hide();
    }
  };
  private key = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      const source = this.source;
      if (this.host && event.composedPath().includes(this.host) && source instanceof HTMLElement) source.focus({ preventScroll: true });
      this.hide(); return;
    }
    const source = this.find(event.target);
    if (source && this.actions.has(source) && (event.altKey && event.key === 'Enter' || source.hasAttribute(OWN) && (event.key === 'Enter' || event.key === ' '))) {
      event.preventDefault(); event.stopPropagation(); this.show(source, true); this.panel?.querySelector<HTMLButtonElement>('.actions button')?.focus({ preventScroll: true });
    }
  };
  private scroll = (event: Event) => { if (!this.host || !event.composedPath().includes(this.host)) this.hide(); };
  private resize = () => {
    const source = this.source;
    if (!source || !this.focused(source)) { this.hide(); return; }
    if (this.resizeFrame !== undefined) return;
    this.resizeFrame = requestAnimationFrame(() => {
      this.resizeFrame = undefined;
      if (this.source !== source) return;
      if (!source.isConnected || !this.focused(source)) { this.hide(); return; }
      this.position(source);
    });
  };
  private down = (event: PointerEvent) => {
    this.clearHold(); this.held = undefined;
    if (this.source && event.target instanceof Node && !this.source.contains(event.target) && !this.descriptionTarget?.contains(event.target) && !this.host?.contains(event.target)) this.hide();
    if (event.pointerType !== 'touch') return;
    if (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable]')) return;
    const source = this.find(event.target); if (!source) return;
    this.pressed = { x: event.clientX, y: event.clientY };
    this.hold = setTimeout(() => { this.held = { source, until: Infinity }; this.show(source, true); }, 500);
  };
  private move = (event: PointerEvent) => {
    if (this.pressed && Math.hypot(event.clientX - this.pressed.x, event.clientY - this.pressed.y) > 10) this.clearHold();
  };
  private clearHold = () => { if (this.hold) clearTimeout(this.hold); this.hold = undefined; this.pressed = undefined; };
  private up = () => { this.clearHold(); if (this.held) this.held.until = performance.now() + 750; };
  private cancel = () => { this.hide(); this.held = undefined; };
  private click = (event: MouseEvent) => {
    const source = this.find(event.target);
    if (source?.hasAttribute(OWN) && this.actions.has(source) && !window.getSelection()?.toString()) {
      event.preventDefault(); event.stopPropagation(); this.show(source, true); this.panel?.querySelector<HTMLButtonElement>('.actions button')?.focus({ preventScroll: true }); return;
    }
    if (this.held && performance.now() < this.held.until && this.held.source === this.find(event.target)) {
      event.preventDefault(); event.stopImmediatePropagation(); this.held = undefined;
    }
  };
  private context = (event: Event) => { if (this.held && performance.now() < this.held.until && this.held.source === this.find(event.target)) event.preventDefault(); };
  private show(source: Element, interactive = this.interactive) {
    const text = this.texts.get(source); if (!text || !source.isConnected) return;
    if (this.source !== source) this.hide();
    this.dismissed = undefined; this.interactive = interactive;
    if (!this.host) {
      this.host = document.createElement('span'); this.host.setAttribute(OWN, 'component-hint');
      this.host.id = `cloudys-gloss-label-${createId()}`; this.host.setAttribute('role', 'tooltip');
      this.host.setAttribute('popover', 'manual');
      this.host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483646!important;';
      const shadow = this.host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      // A fixed auto-width box can widen after left changes. Intrinsic width
      // keeps the measured width stable while the viewport cap still wraps it.
      style.textContent = ':host{color-scheme:light dark}:host::backdrop{background:transparent;pointer-events:none}.tip{position:fixed;box-sizing:border-box;width:max-content;max-width:min(320px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;overscroll-behavior:contain;padding:9px 12px;border:1px solid light-dark(#d5d9df,#505860);border-radius:9px;background:light-dark(#fff,#20252b);color:light-dark(#202832,#f3f6fa);box-shadow:0 4px 18px #0003;font:13px/1.6 system-ui,sans-serif;overflow-wrap:anywhere;pointer-events:none}.tip small{display:block;font-size:10px;opacity:.72;margin-top:3px}.error{color:light-dark(#a32e3b,#ffb4b9);margin-top:8px;white-space:pre-wrap}.actions{pointer-events:auto;display:flex;align-items:center;gap:12px;border-top:1px solid light-dark(#e4e5ec,#444a56);padding-top:8px;margin-top:10px}.actions[hidden]{display:none}.actions button{font:inherit;font-size:12px;border:1px solid light-dark(#d6d1e9,#655c80);border-radius:6px;padding:5px 9px;background:light-dark(#f6f3ff,#322b43);color:inherit;cursor:pointer}.actions button:disabled{opacity:.6;cursor:wait}.actions button:focus-visible{outline:2px solid #8570ce;outline-offset:2px}.tip.compact{width:30px;height:30px;min-height:30px;padding:0;border:0;overflow:visible;border-radius:9px}.launch{pointer-events:auto;display:grid;place-items:center;width:30px;height:30px;padding:0;border:1px solid light-dark(#e0daef,#595065);border-radius:9px;background:light-dark(#fff,#292533);color:light-dark(#7257d6,#c0acff);font:22px/1 system-ui;cursor:pointer}.launch:hover{background:light-dark(#f2edff,#3c3251)}.launch:focus-visible{outline:2px solid #8570ce;outline-offset:2px}[hidden]{display:none!important}';
      this.panel = document.createElement('span'); this.panel.className = 'tip'; this.panel.tabIndex = -1;
      this.panel.addEventListener('click', event => event.stopPropagation());
      this.panel.addEventListener('pointerdown', event => event.stopPropagation());
      shadow.append(style, this.panel); document.documentElement.append(this.host);
    }
    // A modal makes everything outside its DOM subtree inert, including a
    // separately opened top-layer popover. Keep ownership inside that dialog.
    const parent = source.closest('dialog[open]') ?? document.documentElement;
    if (this.host.parentElement !== parent) {
      if (typeof this.host.hidePopover === 'function' && this.host.matches(':popover-open')) this.host.hidePopover();
      parent.append(this.host);
    }
    this.host.style.setProperty('display', 'block', 'important');
    // Dialogs and popovers live above every document z-index. A manual popover
    // shares that layer without stealing focus or closing the host's popover.
    if (typeof this.host.showPopover === 'function') {
      if (!this.host.matches(':popover-open')) this.host.showPopover();
    }
    const action = this.actions.get(source);
    this.host.setAttribute('role', action && this.interactive ? 'dialog' : 'tooltip');
    this.host.setAttribute('aria-label', '段落翻译操作');
    // Update in place so streaming/retry status never removes keyboard focus.
    if (!this.panel!.firstChild) {
      const launch = document.createElement('button'); launch.className = 'launch'; launch.type = 'button';
      launch.setAttribute('aria-label', '打开段落翻译操作'); launch.title = '重翻 / 查看错误';
      launch.textContent = '↻';
      launch.onclick = () => { if (this.source) { this.panel?.focus({ preventScroll: true }); this.show(this.source, true); this.panel?.querySelector<HTMLButtonElement>('.actions button')?.focus({ preventScroll: true }); } };
      const copy = document.createElement('div'); copy.className = 'copy';
      const error = document.createElement('div'); error.className = 'error'; error.setAttribute('role', 'status');
      const actions = document.createElement('div'); actions.className = 'actions';
      const retry = document.createElement('button'); retry.type = 'button';
      retry.onclick = () => { const value = this.source && this.actions.get(this.source); if (value && !value.busy) value.retry(); };
      actions.append(retry);
      const note = document.createElement('small'); note.className = 'note';
      this.panel!.append(launch, copy, error, actions, note);
    }
    const compact = !!action && source.hasAttribute(OWN) && !this.interactive;
    this.panel!.classList.toggle('compact', compact);
    this.panel!.querySelector<HTMLElement>('.launch')!.hidden = !action || this.interactive;
    const copy = this.panel!.querySelector<HTMLElement>('.copy')!;
    copy.textContent = source.hasAttribute(OWN) && action ? '段落翻译' : text;
    copy.hidden = compact;
    const error = this.panel!.querySelector<HTMLElement>('.error')!;
    error.hidden = compact || !action?.error; error.textContent = action?.error ? `翻译失败原因：${action.error}` : '';
    this.panel!.querySelector<HTMLElement>('.actions')!.hidden = !action || !this.interactive;
    const retry = this.panel!.querySelector<HTMLButtonElement>('.actions button')!;
    retry.textContent = action?.label ?? '重新翻译这一段';
    if (action?.busy && this.host.shadowRoot?.activeElement === retry) this.panel!.focus({ preventScroll: true });
    retry.disabled = !!action?.busy;
    this.panel!.querySelector<HTMLElement>('.note')!.hidden = compact;
    this.panel!.querySelector('.note')!.textContent = action ? '仅重新请求本段 · Esc 关闭' : '译文 · Esc 关闭';
    this.position(source);
    if (this.source !== source) {
      this.source = source;
    }
    if (action) this.clearDescription();
    else if (!this.descriptionTarget) {
      this.descriptionTarget = source instanceof HTMLLabelElement ? source.control ?? source : source;
      this.description = this.descriptionTarget.getAttribute('aria-describedby');
      this.applied = [this.description, this.host.id].filter(Boolean).join(' ');
      this.descriptionTarget.setAttribute('aria-describedby', this.applied);
    }
  }
  private position(source: Element) {
    const bounds = source.getBoundingClientRect();
    if (this.panel!.classList.contains('compact')) {
      // Prefer the paragraph gutter so the entry never sits on the next line.
      const beside = bounds.left >= 48 || bounds.right + 48 <= innerWidth;
      const left = bounds.left >= 48 ? bounds.left - 36 : bounds.right + 48 <= innerWidth ? bounds.right + 6 : bounds.right - 30;
      this.panel!.style.maxHeight = '30px'; this.panel!.style.pointerEvents = 'auto';
      this.panel!.style.left = `${Math.max(12, Math.min(left, innerWidth - 42))}px`;
      this.panel!.style.top = `${Math.max(12, Math.min(beside ? bounds.top : bounds.bottom + 6, innerHeight - 42))}px`;
      return;
    }
    const above = Math.max(0, bounds.top - 18); const below = Math.max(0, innerHeight - bounds.bottom - 18);
    const natural = this.panel!.scrollHeight + 2;
    const before = source.closest('dialog[open]') && above >= natural || below < natural && above > below;
    const available = Math.max(above, below);
    const full = available < 64;
    this.panel!.style.maxHeight = `${Math.max(24, full ? innerHeight - 24 : before ? above : below)}px`;
    const panel = this.panel!.getBoundingClientRect();
    // Interactive panels must catch their whole surface: otherwise hovering
    // through transparent copy can switch to a different underlying paragraph.
    // Passive, short hints still let original controls receive pointer events.
    this.panel!.style.pointerEvents = this.panel!.classList.contains('compact') || this.interactive && this.actions.has(source) || this.panel!.scrollHeight > this.panel!.clientHeight + 2 ? 'auto' : 'none';
    this.panel!.style.left = `${Math.min(Math.max(12, bounds.left), Math.max(12, innerWidth - panel.width - 12))}px`;
    this.panel!.style.top = `${full ? 12 : before ? Math.max(12, bounds.top - panel.height - 6) : bounds.bottom + 6}px`;
  }
  private hide = () => {
    this.clearHold();
    if (this.resizeFrame !== undefined) cancelAnimationFrame(this.resizeFrame); this.resizeFrame = undefined;
    if (this.leaveTimer) clearTimeout(this.leaveTimer); this.leaveTimer = undefined;
    if (this.host) { if (typeof this.host.hidePopover === 'function' && this.host.matches(':popover-open')) this.host.hidePopover(); this.host.style.setProperty('display', 'none', 'important'); }
    this.clearDescription();
    if (this.source) this.dismissed = this.source;
    this.source = undefined; this.descriptionTarget = undefined; this.description = undefined; this.applied = undefined;
  };
  private clearDescription() {
    if (this.descriptionTarget && this.descriptionTarget.getAttribute('aria-describedby') === this.applied) {
      if (this.description === null) this.descriptionTarget.removeAttribute('aria-describedby');
      else if (this.description !== undefined) this.descriptionTarget.setAttribute('aria-describedby', this.description);
    } else if (this.descriptionTarget && this.host) {
      const current = this.descriptionTarget.getAttribute('aria-describedby');
      if (current?.split(/\s+/).includes(this.host.id)) {
        const remaining = current.split(/\s+/).filter(token => token && token !== this.host!.id).join(' ');
        if (remaining) this.descriptionTarget.setAttribute('aria-describedby', remaining); else this.descriptionTarget.removeAttribute('aria-describedby');
      }
    }
    this.descriptionTarget = undefined; this.description = undefined; this.applied = undefined;
  }
  release(source: Element) { this.texts.delete(source); this.actions.delete(source); if (this.source === source) this.hide(); }
  stop() {
    this.hide(); this.held = undefined; this.dismissed = undefined; this.host?.remove(); this.host = undefined; this.panel = undefined; this.texts.clear(); this.actions.clear();
    document.removeEventListener('pointerover', this.enter); document.removeEventListener('pointerout', this.leave);
    document.removeEventListener('focusin', this.enter); document.removeEventListener('focusout', this.leave);
    document.removeEventListener('keydown', this.key, true); document.removeEventListener('pointerdown', this.down, true);
    document.removeEventListener('pointermove', this.move); document.removeEventListener('pointerup', this.up);
    document.removeEventListener('pointercancel', this.cancel); document.removeEventListener('click', this.click, true);
    document.removeEventListener('contextmenu', this.context); window.removeEventListener('scroll', this.scroll, true);
    window.removeEventListener('resize', this.resize); this.listening = false;
  }
}
