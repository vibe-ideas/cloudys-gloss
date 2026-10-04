import { OWN, blockText, excludedElement, semanticCandidates, semanticText, splitText } from './blocks';
import { mountTranslationMotion, translationLoader } from './translation-motion';
import { translationStyle } from './translation-style';
type Block = { element: Element; text: string; chunks: string[]; translated: string[]; confirmed: boolean[]; next: number; near: boolean; visible: boolean; node?: HTMLElement; rendered?: string; failed: boolean; active: number };
export type TranslationStatus = { enabled: boolean; translated: number; pending: number; error: string };
type Work = { block: Block; index: number; text: string };
export interface TranslationTransport { translate(id: string, texts: string[], onItem: (index: number, text: string, confirmed: boolean) => void): Promise<string[]>; cancel(id: string): void }
export class PageTranslator {
  private blocks = new Map<Element, Block>();
  private nearby = new Set<Block>();
  private complete = new Set<Block>();
  private dirty = new Set<Block>();
  private requests = new Map<string, Work[]>();
  private roots = new Set<Element>();
  private scans: Generator<Element>[] = [];
  private scanTimer?: ReturnType<typeof setTimeout>;
  private intersections?: IntersectionObserver;
  private viewport?: IntersectionObserver;
  private mutations?: MutationObserver;
  private timer?: ReturnType<typeof setTimeout>;
  private running = false;
  private generation = 0;
  private lastError = '';
  private removed = false;
  private motion?: HTMLStyleElement;
  constructor(private transport: TranslationTransport, private changed: () => void = () => {}) {}
  get status() { return { enabled: this.running, translated: this.complete.size, pending: this.requests.size, error: this.lastError }; }
  start() {
    if (this.running) return;
    this.running = true; this.generation++; this.lastError = '';
    this.motion = mountTranslationMotion();
    this.intersections = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const block = this.blocks.get(entry.target); if (!block) continue;
        block.near = entry.isIntersecting;
        if (block.near) { this.nearby.add(block); this.dirty.add(block); } else this.nearby.delete(block);
      }
      this.schedule();
    }, { rootMargin: '500px 0px' });
    this.viewport = new IntersectionObserver((entries) => {
      for (const entry of entries) { const block = this.blocks.get(entry.target); if (block) block.visible = entry.isIntersecting; }
      this.schedule();
    });
    this.scan(document.body);
    this.mutations = new MutationObserver((records) => {
      for (const record of records) {
        const target = record.target instanceof Element ? record.target : record.target.parentElement;
        if (!target || excludedElement(target)) continue;
        if (record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].every((node) => node instanceof Element && node.hasAttribute(OWN))) continue;
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
    this.mutations.observe(document.body, { childList: true, subtree: true, characterData: true });
    this.changed();
  }
  private closestTracked(element: Element) {
    for (let current: Element | null = element; current; current = current.parentElement) if (this.blocks.has(current)) return current;
  }
  private invalidate(element: Element) {
    const block = this.blocks.get(element);
    if (block) { block.node?.remove(); this.nearby.delete(block); this.dirty.delete(block); this.complete.delete(block); }
    this.intersections?.unobserve(element); this.viewport?.unobserve(element); this.blocks.delete(element);
  }
  private scan(root: Element) { this.scans.push(semanticCandidates(root)); this.scanSlice(); }
  private scanSlice = () => {
    if (!this.running || this.scanTimer) return;
    const started = performance.now(); let visited = 0;
    while (this.scans.length && visited++ < 200 && performance.now() - started < 6) {
      const next = this.scans[0]!.next();
      if (next.done) { this.scans.shift(); continue; }
      const element = next.value;
      if (!element.isConnected || this.blocks.has(element)) continue;
      const text = semanticText(element); if (!text) continue;
      this.blocks.set(element, { element, text, chunks: splitText(text, 900), translated: [], confirmed: [], next: 0, near: false, visible: false, failed: false, active: 0 });
      this.intersections?.observe(element); this.viewport?.observe(element);
    }
    if (this.scans.length) this.scanTimer = setTimeout(() => { this.scanTimer = undefined; this.scanSlice(); }, 0);
  };
  private schedule() {
    if (!this.running || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const roots = [...this.roots].filter((root) => root.isConnected); this.roots.clear();
      for (const root of roots) if (!roots.some((other) => other !== root && other.contains(root))) this.scan(root);
      if (this.removed) { for (const [element] of this.blocks) if (!element.isConnected) this.invalidate(element); this.removed = false; }
      this.pump();
      // One coalesced write pass, no layout measurement on streamed updates.
      for (const block of this.dirty) if (this.blocks.get(block.element) === block && block.element.isConnected) this.paint(block);
      this.dirty.clear(); this.changed();
    }, 24);
  }
  private paint(block: Block) {
    if (!block.node) {
      block.node = document.createElement('span'); block.node.setAttribute(OWN, 'pending'); block.node.lang = 'zh-CN';
      block.node.style.cssText = translationStyle(block.element);
      const content = document.createElement('span'); content.dataset.glossPart = 'text';
      block.node.append(content);
      block.element.append(block.node);
    }
    let prefix = 0;
    while (prefix < block.chunks.length && block.translated[prefix]) prefix++;
    const text = block.translated.slice(0, prefix).join(' ');
    const done = block.chunks.every((_, index) => block.confirmed[index]);
    const unchanged = done && text.normalize('NFKC').replace(/\s+/gu, ' ').trim() === block.text.normalize('NFKC').replace(/\s+/gu, ' ').trim();
    block.node.style.setProperty('display', unchanged ? 'none' : 'block', 'important');
    const stateName = done ? 'done' : block.failed ? 'error' : text ? 'partial' : block.active ? 'translating' : 'queued';
    const rendered = JSON.stringify([stateName, text, block.failed && block.active > 0]);
    if (block.rendered === rendered) return;
    block.rendered = rendered;
    block.node.setAttribute(OWN, text ? 'translation' : 'pending');
    block.node.dataset.state = stateName;
    block.node.setAttribute('aria-busy', String(!done && !block.failed));
    const content = block.node.firstElementChild as HTMLElement;
    content.textContent = text;
    if (text) content.dataset.glossReveal = 'true';
    // Keep the text element mounted: streamed chunks must not restart its fade-in.
    while (content.nextSibling) content.nextSibling.remove();
    if (!done) {
      if (!block.failed) block.node.append(translationLoader(Boolean(text), Boolean(block.active)));
      if (block.failed) {
        block.node.append(document.createTextNode(' 翻译失败 · '));
        const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = '重试'; retry.title = this.lastError;
        retry.style.cssText = 'font:inherit!important;font-size:0.8em!important;color:inherit!important;border:0!important;background:transparent!important;text-decoration:underline!important;cursor:pointer!important;padding:0!important;';
        retry.disabled = block.active > 0;
        retry.onclick = () => { this.lastError = ''; block.failed = false; block.next = 0; this.dirty.add(block); this.schedule(); };
        block.node.append(retry);
      }
    }
    if (done) this.complete.add(block); else this.complete.delete(block);
  }
  private pump() {
    if (!this.running) return;
    // Fast scrolling releases obsolete batches so the newly visible area is next.
    for (const [id, work] of this.requests) if (work.every(({ block }) => !block.near || this.blocks.get(block.element) !== block)) {
      this.requests.delete(id); this.transport.cancel(id);
      for (const { block, index } of work) { block.active--; if (!block.confirmed[index]) { block.next = Math.min(block.next, index); block.translated[index] = ''; } this.dirty.add(block); }
    }
    while (this.requests.size < 2) {
      const work: Work[] = []; let chars = 0;
      const candidates = [...this.nearby].sort((a, b) => Number(b.visible) - Number(a.visible));
      for (const block of candidates) {
        if (block.failed || !block.element.isConnected) continue;
        while (block.next < block.chunks.length && work.length < 2) {
          if (block.confirmed[block.next]) { block.next++; continue; }
          const text = block.chunks[block.next]!;
          if (chars + text.length > 1800) break;
          work.push({ block, index: block.next++, text }); chars += text.length; block.active++;
        }
        if (work.length >= 2) break;
      }
      if (!work.length) break;
      const id = crypto.randomUUID(); const generation = this.generation;
      this.requests.set(id, work);
      for (const { block } of work) this.dirty.add(block);
      const receive = (item: number, text: string, confirmed: boolean) => {
        if (!this.running || generation !== this.generation || !this.requests.has(id)) return;
        const value = work[item]; if (!value) return;
        const { block, index } = value;
        if (this.blocks.get(block.element) !== block || !block.element.isConnected || blockText(block.element, false) !== block.text) return;
        block.translated[index] = text; block.confirmed[index] = confirmed;
        this.dirty.add(block); this.schedule();
      };
      void this.transport.translate(id, work.map((item) => item.text), receive).then((translations) => {
        translations.forEach((text, index) => receive(index, text, true));
      }).catch((error: unknown) => {
        if (generation !== this.generation || !this.requests.has(id)) return;
        this.lastError = error instanceof Error ? error.message : '翻译失败';
        for (const { block, index } of work) if (!block.confirmed[index]) { block.failed = true; block.translated[index] = ''; this.dirty.add(block); }
      }).finally(() => {
        if (this.requests.delete(id)) for (const { block } of work) { block.active--; this.dirty.add(block); }
        this.schedule();
      });
    }
  }
  stop() {
    this.running = false; this.generation++;
    if (this.timer) clearTimeout(this.timer); this.timer = undefined;
    if (this.scanTimer) clearTimeout(this.scanTimer); this.scanTimer = undefined; this.scans = [];
    this.mutations?.disconnect(); this.intersections?.disconnect(); this.viewport?.disconnect();
    for (const id of this.requests.keys()) this.transport.cancel(id);
    this.requests.clear(); this.roots.clear(); this.nearby.clear(); this.dirty.clear(); this.complete.clear();
    for (const block of this.blocks.values()) block.node?.remove();
    this.motion?.remove(); this.motion = undefined;
    this.blocks.clear(); this.lastError = ''; this.removed = false; this.changed();
  }
}
