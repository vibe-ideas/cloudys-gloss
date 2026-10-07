import { OWN, blockText, excludedElement, renderedSemanticText, resetSemanticContext, semanticCandidates, semanticContext, semanticText, semanticTextSteps, splitText, translationKind, type SemanticContext } from './blocks';
import { mountTranslationMotion, translationLoader } from './translation-motion';
import { translationStyle } from './translation-style';
import { TranslationLayout } from './translation-layout';
import { ComponentHints } from './component-hints';
import { createId } from './id';
import type { RequestPriority } from './queue';
type Block = { element: Element; text: string; sourceText: string; chunks: string[]; translated: string[]; confirmed: boolean[]; next: number; near: boolean; visible: boolean; visibilityAt?: number; compact: boolean; node?: HTMLElement; rendered?: string; failed: boolean; error?: string; retry?: { id?: string; translations?: string[] }; active: number; layout?: string | false; description?: { target: Element; original: string | null; applied: string }; scroll?: ScrollRegion; scrollChecked?: boolean; localNear?: boolean };
type ScrollRegion = { element: Element; observer: IntersectionObserver; near: boolean; blocks: Set<Block> };
export type TranslationStatus = { enabled: boolean; translated: number; pending: number; error: string };
type Work = { block: Block; index: number; text: string };
type Reading = { element: Element; iterator: Generator<void, string>; context: SemanticContext; revision: number };
const inlineHiding = /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse)|opacity\s*:\s*0(?:[;\s!]|$)|content-visibility\s*:\s*hidden)/i;
const semanticClasses = /(?:^|\s)(?:badge|chip|button|btn|cta)(?:\s|$)/;
export interface TranslationTransport { translate(id: string, texts: string[], onItem: (index: number, text: string, confirmed: boolean) => void, options?: { bypassCache?: boolean; priority?: RequestPriority }): Promise<string[]>; cancel(id: string): void }
export class PageTranslator {
  private blocks = new Map<Element, Block>();
  private nearby = new Set<Block>();
  private complete = new Set<Block>();
  private dirty = new Set<Block>();
  private visibilityDirty = new Set<Block>();
  private retries = new Set<Block>();
  private requests = new Map<string, Work[]>();
  private roots = new Set<Element>();
  private scans: { iterator: Generator<Element>; context: SemanticContext }[] = [];
  private readings = new Map<Element, Reading>();
  private scanTimer?: ReturnType<typeof setTimeout>;
  private intersections?: IntersectionObserver;
  private viewport?: IntersectionObserver;
  private scrollVisibility?: IntersectionObserver;
  private scrollRegions = new Map<Element, ScrollRegion>();
  private mutations?: MutationObserver;
  private timer?: ReturnType<typeof setTimeout>;
  private running = false;
  private generation = 0;
  private lastError = '';
  private removed = false;
  private motion?: HTMLStyleElement;
  private layout = new TranslationLayout();
  private hints = new ComponentHints();
  private preferComponents = false;
  private extraction = semanticContext();
  constructor(private transport: TranslationTransport, private changed: () => void = () => {}) {}
  get status() { return { enabled: this.running, translated: this.complete.size, pending: this.requests.size + this.retries.size, error: this.lastError }; }
  start() {
    if (this.running) return;
    this.running = true; this.generation++; this.lastError = '';
    this.motion = mountTranslationMotion();
    document.addEventListener('visibilitychange', this.visibilityChanged);
    this.intersections = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const block = this.blocks.get(entry.target); if (!block) continue;
        this.recordVisibility(block, entry, true);
        if (entry.isIntersecting && !block.scrollChecked) this.discoverScrollRegion(block);
        // A viewport-root observer clips at inner scrollports even with a large
        // rootMargin. Let their local observer supply the prefetch distance.
        if (!block.scroll) this.setNear(block, entry.isIntersecting);
      }
      this.schedule();
    }, { rootMargin: '500px 0px' });
    this.viewport = new IntersectionObserver((entries) => {
      for (const entry of entries) { const block = this.blocks.get(entry.target); if (block) this.recordVisibility(block, entry); }
      this.schedule();
    });
    this.scan(document.body);
    this.mutations = new MutationObserver((records) => {
      let reset = false;
      const resetClassification = () => {
        if (reset) return;
        resetSemanticContext(this.extraction);
        const contexts = new Set(this.scans.map(scan => scan.context));
        for (const reading of this.readings.values()) contexts.add(reading.context);
        for (const context of contexts) resetSemanticContext(context);
        reset = true;
      };
      for (const record of records) {
        const target = record.target instanceof Element ? record.target : record.target.parentElement;
        if (!target || target.closest(`[${OWN}]`)) continue;
        if (record.type === 'attributes') {
          if (record.attributeName === 'style' && this.layout.ownsStyle(target)) continue;
          const value = target.getAttribute(record.attributeName!) ?? '';
          // Theme/animation attributes affect rendered visibility, but do not
          // change the cheap semantic scan or restart a paused large container.
          if (record.attributeName === 'class' ? semanticClasses.test(record.oldValue ?? '') || semanticClasses.test(value)
            : record.attributeName === 'style' ? inlineHiding.test(record.oldValue ?? '') || inlineHiding.test(value) : true) resetClassification();
          // A dropdown/accordion can reveal existing DOM without adding nodes.
          // Revisit only that component, while body theme changes reuse nearby
          // blocks rather than rescanning a long document.
          const tracked = this.closestTracked(target);
          if (tracked) this.visibilityDirty.add(this.blocks.get(tracked)!);
          const revealed = (record.attributeName === 'hidden' || record.attributeName === 'inert') && !target.hasAttribute(record.attributeName)
            || record.attributeName === 'aria-hidden' && record.oldValue === 'true'
            || record.attributeName === 'style' && inlineHiding.test(record.oldValue ?? '');
          if (revealed && !excludedElement(target)) this.roots.add(target);
          // Stylesheet-hidden blocks were already registered during the cheap
          // scan. Their observer handles display changes; opacity/visibility
          // need only retry blocked nearby members, including app theme roots.
          for (const block of this.nearby) if (target.contains(block.element)) {
            if (block.layout === false) { block.layout = undefined; this.dirty.add(block); }
            else this.visibilityDirty.add(block);
          }
          continue;
        }
        if (excludedElement(target)) continue;
        if (record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].every((node) => node instanceof Element && node.hasAttribute(OWN))) continue;
        // Classification is cached only within an incremental scan. A host DOM
        // change invalidates in-progress caches before their next time slice.
        resetClassification();
        if (record.removedNodes.length) this.removed = true;
        const tracked = this.closestTracked(target);
        if (tracked) { this.invalidate(tracked); this.roots.add(tracked); }
        if (record.type === 'characterData') this.roots.add(target);
        for (const node of record.addedNodes) if (node instanceof Element && !excludedElement(node)) this.roots.add(node);
        if (record.type === 'childList' && !tracked && target !== document.body && target !== document.documentElement
          && [...record.addedNodes, ...record.removedNodes].some((node) => node.nodeType === Node.TEXT_NODE)) this.roots.add(target);
      }
      this.schedule();
    });
    this.mutations.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeOldValue: true, attributeFilter: ['hidden', 'aria-hidden', 'inert', 'open', 'class', 'style'] });
    this.changed();
  }
  private visibilityChanged = () => {
    if (!this.running || document.visibilityState === 'hidden') return;
    // Resume saved incremental scans and pending work; never rescan the page.
    this.scanSlice(); this.schedule();
  };
  private closestTracked(element: Element) {
    for (let current: Element | null = element; current; current = current.parentElement) if (this.blocks.has(current)) return current;
  }
  private setNear(block: Block, near: boolean) {
    if (near && !block.near && block.layout !== undefined) this.visibilityDirty.add(block);
    block.near = near;
    if (near) { this.nearby.add(block); this.dirty.add(block); } else this.nearby.delete(block);
  }
  private recordVisibility(block: Block, entry: IntersectionObserverEntry, expanded = false) {
    // Observer callbacks need not arrive together. Reuse the nearby observer's
    // already-clipped geometry so visible copy does not look offscreen while
    // waiting for its second observer. No extra layout reads or DOM scan.
    const rect = entry.intersectionRect;
    if (expanded && !rect) return;
    const time = entry.time ?? performance.now();
    if (time < (block.visibilityAt ?? -Infinity)) return;
    block.visibilityAt = time;
    block.visible = entry.isIntersecting && (!expanded || rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth);
  }
  private knownScrollRegion(element: Element) {
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const region = this.scrollRegions.get(ancestor); if (region) return region;
    }
  }
  private discoverScrollRegion(block: Block) {
    block.scrollChecked = true;
    for (let ancestor = block.element.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
      if (!['auto', 'scroll'].includes(getComputedStyle(ancestor).overflowY)) continue;
      let region = this.scrollRegions.get(ancestor);
      if (!region) {
        this.scrollVisibility ??= new IntersectionObserver((entries) => {
          for (const entry of entries) {
            const region = this.scrollRegions.get(entry.target); if (!region) continue;
            region.near = entry.isIntersecting;
            for (const member of region.blocks) this.setNear(member, region.near && !!member.localNear);
          }
          this.schedule();
        }, { rootMargin: '500px 0px' });
        const observer = new IntersectionObserver((entries) => {
          for (const entry of entries) {
            const member = this.blocks.get(entry.target); if (!member || member.scroll !== region) continue;
            member.localNear = entry.isIntersecting;
            this.setNear(member, region!.near && entry.isIntersecting);
          }
          this.schedule();
        }, { root: ancestor, rootMargin: '500px 0px' });
        region = { element: ancestor, observer, near: true, blocks: new Set() };
        this.scrollRegions.set(ancestor, region);
        this.scrollVisibility.observe(ancestor);
        // Reuse tracked blocks, not a new DOM scan. Late scan slices and SPA
        // additions join an existing pool through ancestor map lookups below.
        for (const member of this.blocks.values()) if (this.knownScrollRegion(member.element) === region) this.attachScrollRegion(member, region);
      }
      this.attachScrollRegion(block, region);
      return;
    }
  }
  private attachScrollRegion(block: Block, region: ScrollRegion) {
    if (block.scroll === region) return;
    this.detachScrollRegion(block);
    block.scroll = region; block.localNear = false;
    region.blocks.add(block); region.observer.observe(block.element);
    this.setNear(block, false);
  }
  private detachScrollRegion(block: Block) {
    const region = block.scroll; if (!region) return;
    region.observer.unobserve(block.element); region.blocks.delete(block); block.scroll = undefined;
    if (!region.blocks.size) {
      region.observer.disconnect(); this.scrollVisibility?.unobserve(region.element); this.scrollRegions.delete(region.element);
    }
  }
  private invalidate(element: Element) {
    const block = this.blocks.get(element);
    if (block) { this.cancelRetry(block); if (block.node) this.hints.release(block.node); this.clearDescription(block); block.node?.remove(); this.layout.release(element, block.node); this.hints.release(element); this.detachScrollRegion(block); this.nearby.delete(block); this.dirty.delete(block); this.visibilityDirty.delete(block); this.complete.delete(block); }
    this.intersections?.unobserve(element); this.viewport?.unobserve(element); this.blocks.delete(element);
  }
  private scan(root: Element) { this.scans.push({ iterator: semanticCandidates(root), context: semanticContext() }); this.scanSlice(); }
  private scanSlice = () => {
    if (!this.running || this.scanTimer || document.visibilityState === 'hidden') return;
    const started = performance.now(); let visited = 0; let readNext = false;
    while ((this.scans.length || this.readings.size) && visited < 200 && performance.now() - started < 6) {
      // Give a large container a small quantum, then continue discovering its
      // children. First-screen paragraphs must not wait for every main sibling.
      if ((readNext || !this.scans.length) && this.readings.size) {
        readNext = false;
        const reading = this.readings.values().next().value!;
        this.readings.delete(reading.element);
        if (!reading.element.isConnected || this.blocks.has(reading.element)) continue;
        if (reading.revision !== reading.context.revision) {
          reading.iterator = semanticTextSteps(reading.element, reading.context);
          reading.revision = reading.context.revision;
        }
        let next: IteratorResult<void, string> | undefined;
        for (let step = 0; step < 16 && visited++ < 200 && performance.now() - started < 6; step++) {
          next = reading.iterator.next();
          if (next.done) break;
        }
        if (next?.done) this.track(reading.element, next.value, reading.context);
        else this.readings.set(reading.element, reading);
        continue;
      }
      readNext = true; visited++;
      const scan = this.scans[0]!;
      const next = scan.iterator.next();
      if (next.done) { this.scans.shift(); continue; }
      const element = next.value;
      if (!element.isConnected) continue;
      const existing = this.blocks.get(element);
      if (existing) { if (existing.layout === false) { existing.layout = undefined; this.dirty.add(existing); this.schedule(); } continue; }
      if (!this.readings.has(element)) this.readings.set(element, { element, iterator: semanticTextSteps(element, scan.context), context: scan.context, revision: scan.context.revision });
    }
    if (this.scans.length || this.readings.size) this.scanTimer = setTimeout(() => { this.scanTimer = undefined; this.scanSlice(); }, 0);
  };
  private track(element: Element, text: string, context: SemanticContext) {
    if (!text) return;
    const block: Block = { element, text, sourceText: text, chunks: splitText(text, 900), translated: [], confirmed: [], next: 0, near: false, visible: false, compact: translationKind(element, context) === 'component', failed: false, active: 0 };
    this.blocks.set(element, block);
    const region = this.knownScrollRegion(element); if (region) this.attachScrollRegion(block, region);
    this.intersections?.observe(element); this.viewport?.observe(element);
  }
  private schedule() {
    if (!this.running || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const roots = [...this.roots].filter((root) => root.isConnected); this.roots.clear();
      for (const root of roots) if (!roots.some((other) => other !== root && other.contains(root))) this.scan(root);
      if (this.removed) { for (const [element] of this.blocks) if (!element.isConnected) this.invalidate(element); this.removed = false; }
      // Read nearby typography/layout before the coalesced DOM write pass.
      const stale: Block[] = [];
      for (const block of this.visibilityDirty) {
        if (!block.near) continue;
        this.visibilityDirty.delete(block);
        if (block.layout === false) { block.layout = undefined; this.dirty.add(block); }
        else if (block.layout !== undefined && (semanticText(block.element, this.extraction) !== block.sourceText || renderedSemanticText(block.element, this.extraction) !== block.text)) stale.push(block);
      }
      for (const block of this.nearby) if (block.layout === undefined) {
        const text = renderedSemanticText(block.element, this.extraction);
        if (!text) { block.layout = false; continue; }
        block.text = text; block.chunks = splitText(text, 900);
        block.layout = this.layout.prepare(block.element, block.compact) ? translationStyle(block.element, block.compact) : false;
      }
      // Attribute animations only mark local blocks. Compare once per read
      // phase, then remove stale output after all measurements are finished.
      for (const block of stale) { this.invalidate(block.element); this.roots.add(block.element); }
      if (stale.length) this.schedule();
      this.pump();
      // One coalesced write pass, no layout measurement on streamed updates.
      for (const block of this.dirty) if (this.blocks.get(block.element) === block && block.element.isConnected) this.paint(block);
      this.dirty.clear(); this.changed();
    }, 24);
  }
  private paint(block: Block) {
    if (!block.layout) return;
    if (!block.node) {
      block.node = document.createElement('span'); block.node.setAttribute(OWN, 'pending'); block.node.lang = 'zh-CN';
      if (block.compact || this.layout.isHint(block.element)) { block.node.id = `cloudys-gloss-text-${createId()}`; block.node.setAttribute('aria-hidden', 'true'); block.node.dataset.glossMode = this.layout.isHint(block.element) ? 'hint' : 'component'; }
      block.node.style.cssText = block.layout;
      const content = document.createElement('span'); content.dataset.glossPart = 'text';
      block.node.append(content);
      block.element.append(block.node);
      this.layout.watch(block.element, block.node);
    }
    let prefix = 0;
    while (prefix < block.chunks.length && block.translated[prefix]) prefix++;
    const text = block.translated.slice(0, prefix).join(' ');
    const done = block.chunks.every((_, index) => block.confirmed[index]);
    const unchanged = done && text.normalize('NFKC').replace(/\s+/gu, ' ').trim() === block.text.normalize('NFKC').replace(/\s+/gu, ' ').trim();
    const hint = this.layout.isHint(block.element);
    block.node.style.setProperty('display', unchanged || hint ? 'none' : 'block', 'important');
    const stateName = block.retry ? 'retrying' : block.failed ? 'error' : done ? 'done' : text ? 'partial' : block.active ? 'translating' : 'queued';
    const rendered = JSON.stringify([stateName, text, block.error, block.active > 0]);
    if (block.rendered === rendered) return;
    block.rendered = rendered;
    block.node.setAttribute(OWN, text ? 'translation' : 'pending');
    block.node.dataset.state = stateName;
    block.node.setAttribute('aria-busy', String(!!block.retry || !done && !block.failed));
    const content = block.node.firstElementChild as HTMLElement;
    content.textContent = text || (block.compact && block.failed ? '翻译失败' : '');
    if (text) content.dataset.glossReveal = 'true';
    // Keep the text element mounted: streamed chunks must not restart its fade-in.
    while (content.nextSibling) content.nextSibling.remove();
    if (!done && !block.retry && !block.failed) block.node.append(translationLoader(Boolean(text), Boolean(block.active)));
    if (block.failed && !text && !block.compact) {
      const failure = document.createElement('span'); failure.dataset.glossPart = 'failure'; failure.textContent = '翻译失败 · 查看原因与重试'; block.node.append(failure);
    }
    // One shared Shadow DOM panel: no per-paragraph toolbar or nested buttons
    // inside native links, labels, or buttons.
    const action = {
      error: block.error, busy: !!block.retry || block.active > 0,
      label: block.retry ? '正在重试…' : block.failed ? '重试这一段' : '重新翻译这一段',
      retry: () => this.retryBlock(block),
    };
    const actionable = done && !unchanged || block.failed || !!block.retry;
    const source = hint || block.compact || unchanged ? block.element : block.node;
    const other = source === block.element ? block.node : block.element;
    this.hints.release(other);
    if (!block.compact && !unchanged) {
      block.node.tabIndex = 0; block.node.setAttribute('role', 'button');
      block.node.setAttribute('aria-label', block.failed ? '翻译失败：查看原因与重试' : '译文操作：重新翻译这一段');
      block.node.title = '点击查看操作 · Enter / Alt+Enter';
    }
    if (actionable || hint && text && !unchanged) this.hints.update(source, text || '本段尚未完成翻译', actionable ? action : undefined);
    else this.hints.release(source);
    if (done) this.complete.add(block); else this.complete.delete(block);
    if (hint) {
      const ready = actionable || !!text && !unchanged;
      this.layout.hintReady(block.element, ready);
    } else if (block.compact && done && !unchanged) {
      const target = block.element instanceof HTMLLabelElement ? block.element.control ?? block.element : block.element;
      if (block.description && block.description.target !== target) this.clearDescription(block);
      const current = target.getAttribute('aria-describedby');
      const original = current === block.description?.applied ? block.description.original : current;
      const applied = [original, block.node.id].filter(Boolean).join(' ');
      block.description = { target, original, applied }; target.setAttribute('aria-describedby', applied);
    } else if (unchanged || block.failed) this.clearDescription(block);
    this.layout.update(block.element);
  }
  private retryBlock(block: Block) {
    if (!this.running || block.retry || block.active || this.blocks.get(block.element) !== block || !block.element.isConnected) return;
    block.retry = {}; this.retries.add(block); this.dirty.add(block); this.schedule();
  }
  private cancelRetry(block: Block) {
    const id = block.retry?.id;
    block.retry = undefined; this.retries.delete(block);
    if (id) this.transport.cancel(id);
  }
  private async runRetry(block: Block) {
    const attempt = block.retry!;
    const current = () => this.running && block.retry === attempt && this.blocks.get(block.element) === block && block.element.isConnected;
    const translations = attempt.translations ??= [];
    let paused = false;
    try {
      // Reserve one page queue slot for this paragraph, keeping request limits
      // even for long paragraphs. Preserve its last result until all chunks pass.
      for (let index = translations.length; index < block.chunks.length; index += 2) {
        if (document.visibilityState === 'hidden') { paused = true; return; }
        attempt.id = createId();
        const result = await this.transport.translate(attempt.id, block.chunks.slice(index, index + 2), () => {}, { bypassCache: true, priority: 'interactive' });
        if (!current()) return;
        translations.push(...result);
      }
      if (blockText(block.element, false, undefined, this.extraction) !== block.sourceText) return;
      block.translated = translations; block.confirmed = translations.map(() => true); block.next = block.chunks.length;
      block.failed = false; block.error = undefined;
    } catch (error) {
      if (current()) { block.failed = true; block.error = this.errorMessage(error); }
    } finally {
      if (current() && paused) { attempt.id = undefined; this.dirty.add(block); this.schedule(); }
      else if (current()) {
        block.retry = undefined; this.retries.delete(block);
        this.lastError = [...this.blocks.values()].find(value => value.error)?.error ?? '';
        this.dirty.add(block); this.schedule();
      }
    }
  }
  private errorMessage(error: unknown) {
    return error instanceof Error && error.message.trim() ? error.message.slice(0, 500) : '翻译失败，服务未返回可用的错误信息，请重试。';
  }
  private clearDescription(block: Block) {
    const target = block.description?.target;
    if (target && block.description && target.getAttribute('aria-describedby') === block.description.applied) {
      if (block.description.original === null) target.removeAttribute('aria-describedby');
      else target.setAttribute('aria-describedby', block.description.original);
    } else if (block.description && block.node) {
      const current = target!.getAttribute('aria-describedby');
      if (current?.split(/\s+/).includes(block.node.id)) {
        const remaining = current.split(/\s+/).filter(token => token && token !== block.node!.id).join(' ');
        if (remaining) target!.setAttribute('aria-describedby', remaining); else target!.removeAttribute('aria-describedby');
      }
    }
    block.description = undefined;
  }
  private pump() {
    if (!this.running) return;
    // Fast scrolling releases obsolete batches so the newly visible area is next.
    for (const [id, work] of this.requests) if (work.every(({ block }) => !block.near || this.blocks.get(block.element) !== block)) {
      this.requests.delete(id); this.transport.cancel(id);
      for (const { block, index } of work) { block.active--; if (!block.confirmed[index]) { block.next = Math.min(block.next, index); block.translated[index] = ''; } this.dirty.add(block); }
    }
    for (const block of this.retries) if (!block.near || !block.element.isConnected || this.blocks.get(block.element) !== block) {
      this.cancelRetry(block); this.dirty.add(block);
    }
    if (document.visibilityState === 'hidden') return;
    const slots = () => this.requests.size + [...this.retries].filter(block => block.retry?.id).length;
    for (const block of this.retries) {
      if (slots() >= 2) break;
      if (!block.retry?.id) void this.runRetry(block);
    }
    while (slots() < 2) {
      const work: Work[] = []; let chars = 0;
      const candidates = [...this.nearby].sort((a, b) => Number(b.visible) - Number(a.visible) || (this.preferComponents ? Number(b.compact) - Number(a.compact) : Number(a.compact) - Number(b.compact)));
      let compactBatch: boolean | undefined;
      for (const block of candidates) {
        if (block.retry || block.failed || block.layout === false || !block.element.isConnected) continue;
        if (block.next >= block.chunks.length) continue;
        compactBatch ??= block.compact;
        if (block.compact !== compactBatch) continue;
        const limit = compactBatch ? 8 : 2;
        while (block.next < block.chunks.length && work.length < limit) {
          if (block.confirmed[block.next]) { block.next++; continue; }
          const text = block.chunks[block.next]!;
          if (chars + text.length > 1800) break;
          work.push({ block, index: block.next++, text }); chars += text.length; block.active++;
        }
        if (work.length >= limit) break;
      }
      if (!work.length) break;
      this.preferComponents = !compactBatch;
      const id = createId(); const generation = this.generation;
      this.requests.set(id, work);
      for (const { block } of work) this.dirty.add(block);
      const receive = (item: number, text: string, confirmed: boolean) => {
        if (!this.running || generation !== this.generation || !this.requests.has(id)) return;
        const value = work[item]; if (!value) return;
        const { block, index } = value;
        if (this.blocks.get(block.element) !== block || !block.element.isConnected || blockText(block.element, false, undefined, this.extraction) !== block.sourceText) return;
        block.translated[index] = text; block.confirmed[index] = confirmed;
        this.dirty.add(block); this.schedule();
      };
      void this.transport.translate(id, work.map((item) => item.text), receive, { priority: work.some(({ block }) => block.visible) ? 'visible' : 'prefetch' }).then((translations) => {
        translations.forEach((text, index) => receive(index, text, true));
      }).catch((error: unknown) => {
        if (generation !== this.generation || !this.requests.has(id)) return;
        this.lastError = this.errorMessage(error);
        for (const { block, index } of work) if (!block.confirmed[index]) { block.failed = true; block.error = this.lastError; block.translated[index] = ''; this.dirty.add(block); }
      }).finally(() => {
        if (this.requests.delete(id)) for (const { block } of work) { block.active--; this.dirty.add(block); }
        this.schedule();
      });
    }
  }
  stop() {
    this.running = false; this.generation++;
    document.removeEventListener('visibilitychange', this.visibilityChanged);
    if (this.timer) clearTimeout(this.timer); this.timer = undefined;
    if (this.scanTimer) clearTimeout(this.scanTimer); this.scanTimer = undefined; this.scans = []; this.readings.clear();
    this.mutations?.disconnect(); this.intersections?.disconnect(); this.viewport?.disconnect(); this.scrollVisibility?.disconnect();
    for (const region of this.scrollRegions.values()) region.observer.disconnect();
    this.scrollRegions.clear(); this.scrollVisibility = undefined;
    for (const block of this.retries) this.cancelRetry(block);
    for (const id of this.requests.keys()) this.transport.cancel(id);
    this.requests.clear(); this.roots.clear(); this.nearby.clear(); this.dirty.clear(); this.visibilityDirty.clear(); this.complete.clear();
    for (const block of this.blocks.values()) { this.clearDescription(block); block.node?.remove(); }
    this.layout.stop(); this.hints.stop(); this.preferComponents = false;
    this.motion?.remove(); this.motion = undefined;
    this.blocks.clear(); resetSemanticContext(this.extraction); this.lastError = ''; this.removed = false; this.changed();
  }
}
