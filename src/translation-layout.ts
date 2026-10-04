type Region = { element: HTMLElement; overflow: number; overflowX: number; gridOverlap: boolean; minimum?: number; users: Set<Element>; changed: Map<string, { value: string; priority: string; applied: string }>; originalStyle: string | null; lastStyle: string | null; hostChanged: boolean };

/** Grow normal-flow reading regions only when inserted text would overflow them.
 * Absolutely positioned overlays are left untouched: growing them cannot move
 * neighbouring overlays safely. Selection translation remains available there.
 */
export class TranslationLayout {
  private regions = new Map<HTMLElement, Region>();
  private sources = new Map<Element, Region[]>();
  private pending = new Set<Region>();
  private targets = new Map<Element, Element>();
  private observer?: ResizeObserver;
  private frame?: number;
  prepare(element: Element) {
    const ancestors: HTMLElement[] = [];
    for (let current: Element | null = element; current && current !== document.body; current = current.parentElement) {
      const style = getComputedStyle(current);
      // Keep the app's scroll viewport intact, including fixed dialogs and
      // absolutely positioned reading panes. Their children can still grow.
      if (['auto', 'scroll'].includes(style.overflowY)) break;
      if (['absolute', 'fixed'].includes(style.position)) return false;
      if (current instanceof HTMLElement) ancestors.push(current);
    }
    const regions = ancestors.map((ancestor) => {
      let region = this.regions.get(ancestor);
      if (!region) {
        const originalStyle = ancestor.getAttribute('style');
        region = { element: ancestor, overflow: Math.max(0, ancestor.scrollHeight - ancestor.clientHeight), overflowX: Math.max(0, ancestor.scrollWidth - ancestor.clientWidth), gridOverlap: getComputedStyle(ancestor).display === 'grid' && this.gridOverlaps(ancestor), users: new Set(), changed: new Map(), originalStyle, lastStyle: originalStyle, hostChanged: false };
        this.regions.set(ancestor, region);
      }
      region.users.add(element);
      return region;
    });
    this.sources.set(element, regions);
    return true;
  }
  watch(source: Element, node: HTMLElement) {
    this.observer ??= new ResizeObserver((entries) => {
      for (const entry of entries) {
        const source = this.targets.get(entry.target);
        if (source) this.update(source);
        else {
          // A host may resize a card without changing its paragraph's box.
          // Observe only the already tracked ancestor chain, not the page.
          for (let element: Element | null = entry.target; element; element = element.parentElement) {
            const region = this.regions.get(element as HTMLElement);
            if (region) this.pending.add(region);
          }
          this.schedule();
        }
      }
    });
    this.targets.set(node, source); this.targets.set(source, source);
    this.observer.observe(node);
    this.observer.observe(source);
    for (const region of this.sources.get(source) ?? []) this.observer.observe(region.element);
    this.update(source);
  }
  update(source: Element) {
    for (const region of this.sources.get(source) ?? []) this.pending.add(region);
    this.schedule();
  }
  private schedule() {
    if (this.frame !== undefined) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      // Separate the read phase from the write phase. ResizeObserver catches
      // wrapping after a resize and subsequent streamed translation updates.
      const changes = [...this.pending].filter(({ element }) => element.isConnected)
        .map((region) => {
          const style = getComputedStyle(region.element);
          const vertical = region.element.scrollHeight - region.element.clientHeight > region.overflow + 2;
          const horizontal = region.element.scrollWidth - region.element.clientWidth > region.overflowX + 2;
          const gridOverlap = !region.gridOverlap && style.display === 'grid' && style.gridTemplateAreas === 'none' && style.gridAutoFlow.startsWith('row') && this.gridOverlaps(region.element);
          const gridItem = vertical && region.element.parentElement && getComputedStyle(region.element.parentElement).display === 'grid';
          return { region, vertical, horizontal, gridOverlap, gridItem, scrollable: ['auto', 'scroll'].includes(style.overflowY), height: vertical ? region.element.getBoundingClientRect().height : 0, display: style.display, position: style.position, minHeight: parseFloat(style.minHeight) || 0 };
        });
      this.pending.clear();
      for (const { region, vertical, horizontal, gridOverlap, gridItem, scrollable, height, display, position, minHeight } of changes) {
        if (scrollable) continue;
        if (gridOverlap) {
          this.set(region, 'grid-template-rows', 'none');
          this.set(region, 'grid-auto-rows', 'minmax(min-content, auto)');
        }
        if (display === 'inline' || ['absolute', 'fixed', 'sticky'].includes(position)) continue;
        if ((vertical || horizontal) && (display === 'flex' || display === 'inline-flex')) this.set(region, 'flex-wrap', 'wrap');
        if (!vertical) continue;
        region.minimum ??= Math.max(height, minHeight);
        this.set(region, 'box-sizing', 'border-box');
        this.set(region, 'min-height', `${region.minimum}px`);
        this.set(region, 'height', 'auto');
        this.set(region, 'max-height', 'none');
        this.set(region, '-webkit-line-clamp', 'unset');
        if (gridItem) this.set(region, 'align-self', 'start');
      }
    });
  }
  private gridOverlaps(element: HTMLElement) {
    // Only implicit, automatically placed rows: named areas and explicit row
    // placements belong to the host's layout and cannot be safely rewritten.
    const children = [...element.children].map((child) => ({ child, style: getComputedStyle(child) }));
    if (children.some(({ style }) => [style.gridRowStart, style.gridRowEnd, style.gridColumnStart, style.gridColumnEnd].some(value => value !== 'auto'))) return false;
    const columns = new Map<number, number>();
    const boxes = children.filter(({ style }) => !['absolute', 'fixed'].includes(style.position)).map(({ child }) => child.getBoundingClientRect()).sort((a, b) => a.top - b.top);
    for (const box of boxes) {
      const column = Math.round(box.left);
      if ((columns.get(column) ?? -Infinity) > box.top + 1) return true;
      columns.set(column, box.bottom);
    }
    return false;
  }
  private set(region: Region, property: string, value: string) {
    const style = region.element.style;
    if (region.element.getAttribute('style') !== region.lastStyle) region.hostChanged = true;
    if (!region.changed.has(property)) region.changed.set(property, { value: style.getPropertyValue(property), priority: style.getPropertyPriority(property), applied: value });
    else {
      const previous = region.changed.get(property)!;
      if (style.getPropertyValue(property) !== previous.applied || style.getPropertyPriority(property) !== 'important') {
        previous.value = style.getPropertyValue(property);
        previous.priority = style.getPropertyPriority(property);
      }
      previous.applied = value;
    }
    style.setProperty(property, value, 'important');
    region.changed.get(property)!.applied = style.getPropertyValue(property);
    region.lastStyle = region.element.getAttribute('style');
  }
  release(source: Element, node?: HTMLElement) {
    this.targets.delete(source);
    if (node) { this.observer?.unobserve(node); this.targets.delete(node); }
    for (const region of this.sources.get(source) ?? []) {
      region.users.delete(source);
      if (!region.users.size) { this.observer?.unobserve(region.element); this.restore(region); this.regions.delete(region.element); this.pending.delete(region); }
    }
    if (!this.regions.has(source as HTMLElement)) this.observer?.unobserve(source);
    this.sources.delete(source);
  }
  private restore(region: Region) {
    if (!region.changed.size) return;
    if (!region.hostChanged && region.element.getAttribute('style') === region.lastStyle) {
      if (region.originalStyle === null) region.element.removeAttribute('style');
      else region.element.setAttribute('style', region.originalStyle);
      return;
    }
    for (const [property, original] of region.changed) {
      // Do not overwrite a newer change made by the host application.
      if (region.element.style.getPropertyValue(property) !== original.applied || region.element.style.getPropertyPriority(property) !== 'important') continue;
      if (original.value) region.element.style.setProperty(property, original.value, original.priority);
      else region.element.style.removeProperty(property);
    }
    if (region.originalStyle === null && !region.element.style.cssText) region.element.removeAttribute('style');
  }
  stop() {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined; this.observer?.disconnect(); this.observer = undefined;
    for (const region of this.regions.values()) this.restore(region);
    this.regions.clear(); this.sources.clear(); this.pending.clear(); this.targets.clear();
  }
}
