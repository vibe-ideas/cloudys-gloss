import { OWN } from './blocks';
import { createId } from './id';

/** One shared, non-interactive translation surface for labels in rigid overlays.
 * Normal clicks keep their native action. Touch users can hold a marked label;
 * keyboard users receive the same translation when its existing control focuses.
 */
export class ComponentHints {
  private texts = new Map<Element, string>();
  private host?: HTMLElement;
  private panel?: HTMLElement;
  private source?: Element;
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
  update(source: Element, text: string) {
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
    if (this.dismissed !== source && (this.source === source || this.focused(source) || source.matches(':hover'))) this.show(source);
  }
  private focused(source: Element) {
    return source === document.activeElement || source.contains(document.activeElement) || source instanceof HTMLLabelElement && source.control === document.activeElement;
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
    if (source) { this.dismissed = undefined; this.show(source); }
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
  private key = (event: KeyboardEvent) => { if (event.key === 'Escape') this.hide(); };
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
    this.hold = setTimeout(() => { this.held = { source, until: Infinity }; this.show(source); }, 500);
  };
  private move = (event: PointerEvent) => {
    if (this.pressed && Math.hypot(event.clientX - this.pressed.x, event.clientY - this.pressed.y) > 10) this.clearHold();
  };
  private clearHold = () => { if (this.hold) clearTimeout(this.hold); this.hold = undefined; this.pressed = undefined; };
  private up = () => { this.clearHold(); if (this.held) this.held.until = performance.now() + 750; };
  private cancel = () => { this.hide(); this.held = undefined; };
  private click = (event: MouseEvent) => {
    if (this.held && performance.now() < this.held.until && this.held.source === this.find(event.target)) {
      event.preventDefault(); event.stopImmediatePropagation(); this.held = undefined;
    }
  };
  private context = (event: Event) => { if (this.held && performance.now() < this.held.until && this.held.source === this.find(event.target)) event.preventDefault(); };
  private show(source: Element) {
    const text = this.texts.get(source); if (!text || !source.isConnected) return;
    if (this.source !== source) this.hide();
    this.dismissed = undefined;
    if (!this.host) {
      this.host = document.createElement('span'); this.host.setAttribute(OWN, 'component-hint');
      this.host.id = `cloudys-gloss-label-${createId()}`; this.host.setAttribute('role', 'tooltip');
      this.host.setAttribute('popover', 'manual');
      this.host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483646!important;';
      const shadow = this.host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      // A fixed auto-width box can widen after left changes. Intrinsic width
      // keeps the measured width stable while the viewport cap still wraps it.
      style.textContent = ':host{color-scheme:light dark}:host::backdrop{background:transparent;pointer-events:none}.tip{position:fixed;box-sizing:border-box;width:max-content;max-width:min(320px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;overscroll-behavior:contain;padding:9px 12px;border:1px solid light-dark(#d5d9df,#505860);border-radius:9px;background:light-dark(#fff,#20252b);color:light-dark(#202832,#f3f6fa);box-shadow:0 4px 18px #0003;font:13px/1.6 system-ui,sans-serif;overflow-wrap:anywhere;pointer-events:none}.tip small{display:block;font-size:10px;opacity:.72;margin-top:3px}';
      this.panel = document.createElement('span'); this.panel.className = 'tip';
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
    this.panel!.replaceChildren(document.createTextNode(text));
    const note = document.createElement('small'); note.textContent = '译文 · Esc 关闭'; this.panel!.append(note);
    this.position(source);
    if (this.source !== source) {
      this.source = source; this.descriptionTarget = source instanceof HTMLLabelElement ? source.control ?? source : source;
      this.description = this.descriptionTarget.getAttribute('aria-describedby');
      this.applied = [this.description, this.host.id].filter(Boolean).join(' ');
      this.descriptionTarget.setAttribute('aria-describedby', this.applied);
    }
  }
  private position(source: Element) {
    const bounds = source.getBoundingClientRect();
    const above = Math.max(0, bounds.top - 18); const below = Math.max(0, innerHeight - bounds.bottom - 18);
    const natural = this.panel!.scrollHeight + 2;
    const before = source.closest('dialog[open]') && above >= natural || below < natural && above > below;
    const available = Math.max(above, below);
    const full = available < 64;
    this.panel!.style.maxHeight = `${Math.max(24, full ? innerHeight - 24 : before ? above : below)}px`;
    const panel = this.panel!.getBoundingClientRect();
    // Short hints never intercept the original control or adjacent buttons.
    // Only overflowing long help needs a pointer surface for native scrolling.
    this.panel!.style.pointerEvents = this.panel!.scrollHeight > this.panel!.clientHeight + 2 ? 'auto' : 'none';
    this.panel!.style.left = `${Math.min(Math.max(12, bounds.left), Math.max(12, innerWidth - panel.width - 12))}px`;
    this.panel!.style.top = `${full ? 12 : before ? Math.max(12, bounds.top - panel.height - 6) : bounds.bottom + 6}px`;
  }
  private hide = () => {
    this.clearHold();
    if (this.resizeFrame !== undefined) cancelAnimationFrame(this.resizeFrame); this.resizeFrame = undefined;
    if (this.leaveTimer) clearTimeout(this.leaveTimer); this.leaveTimer = undefined;
    if (this.host) { if (typeof this.host.hidePopover === 'function' && this.host.matches(':popover-open')) this.host.hidePopover(); this.host.style.setProperty('display', 'none', 'important'); }
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
    if (this.source) this.dismissed = this.source;
    this.source = undefined; this.descriptionTarget = undefined; this.description = undefined; this.applied = undefined;
  };
  release(source: Element) { this.texts.delete(source); if (this.source === source) this.hide(); }
  stop() {
    this.hide(); this.held = undefined; this.dismissed = undefined; this.host?.remove(); this.host = undefined; this.panel = undefined; this.texts.clear();
    document.removeEventListener('pointerover', this.enter); document.removeEventListener('pointerout', this.leave);
    document.removeEventListener('focusin', this.enter); document.removeEventListener('focusout', this.leave);
    document.removeEventListener('keydown', this.key, true); document.removeEventListener('pointerdown', this.down, true);
    document.removeEventListener('pointermove', this.move); document.removeEventListener('pointerup', this.up);
    document.removeEventListener('pointercancel', this.cancel); document.removeEventListener('click', this.click, true);
    document.removeEventListener('contextmenu', this.context); window.removeEventListener('scroll', this.scroll, true);
    window.removeEventListener('resize', this.resize); this.listening = false;
  }
}
