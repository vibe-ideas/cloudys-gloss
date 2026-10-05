import { AnnotationMode, OPS, version, type PDFPageProxy, type RenderTask } from 'pdfjs-dist';
import type { PdfRect } from './layout';
type PDFOperatorList = Awaited<ReturnType<PDFPageProxy['getOperatorList']>>;

export const MAX_PDF_CANVAS_PIXELS = 6_000_000;
const MAX_CANVAS_EDGE = 8192;
const MAX_COLOR_READ_PIXELS = 250_000;
const MAX_COLOR_SAMPLES = 2048;
const MAX_COLOR_CACHE = 256;
const textOps = new Set<number>([OPS.showText, OPS.showSpacedText, OPS.nextLineShowText, OPS.nextLineSetSpacingShowText]);
const pathPaintOps = new Set<number>([OPS.stroke, OPS.closeStroke, OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke, OPS.endPath, OPS.rawFillPath]);
const noArgs = new Set<number>([OPS.save, OPS.restore, OPS.beginText, OPS.endText, OPS.nextLine, OPS.endMarkedContent, OPS.beginCompat, OPS.endCompat]);
const numberArgs = new Map<number, number>([
  [OPS.setLineWidth, 1], [OPS.setLineCap, 1], [OPS.setLineJoin, 1], [OPS.setMiterLimit, 1], [OPS.setFlatness, 1],
  [OPS.transform, 6], [OPS.setCharSpacing, 1], [OPS.setWordSpacing, 1], [OPS.setHScale, 1], [OPS.setLeading, 1],
  [OPS.setTextRise, 1], [OPS.moveText, 2], [OPS.setLeadingMoveText, 2],
]);
const unsafeOps = new Map<number, string>([
  [OPS.clip, '页面含裁剪路径'], [OPS.eoClip, '页面含裁剪路径'],
  [OPS.beginGroup, '页面含透明或蒙版分组'], [OPS.endGroup, '页面含透明或蒙版分组'],
  [OPS.setFillColorN, '页面含图案填充'], [OPS.setStrokeColorN, '页面含图案描边'], [OPS.shadingFill, '页面含复杂渐变'],
  [OPS.paintFormXObjectBegin, '页面含独立裁剪的图形对象'], [OPS.paintFormXObjectEnd, '页面含独立裁剪的图形对象'],
  [OPS.beginAnnotation, '页面含独立批注绘制'], [OPS.endAnnotation, '页面含独立批注绘制'],
  [OPS.setCharWidth, '页面含 Type3 字体'], [OPS.setCharWidthAndBounds, '页面含 Type3 字体'],
  [OPS.setFillTransparent, '页面含不可见填充'], [OPS.setStrokeTransparent, '页面含不可见描边'],
]);

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function numbers(value: unknown, length?: number): boolean {
  if (!Array.isArray(value) && !(ArrayBuffer.isView(value) && 'length' in value)) return false;
  const list = value as ArrayLike<unknown>;
  if (length !== undefined && list.length !== length) return false;
  if (list.length > 256) return false;
  for (let index = 0; index < list.length; index++) if (!finite(list[index])) return false;
  return true;
}

/** PDF.js exposes the render list, but glyph/path argument shapes are versioned
 * implementation IR. Fail closed on upgrades or unrecognized shapes. Never read
 * commonObjs, rewrite the list, or monkeypatch CanvasGraphics. */
export class PdfOperationGuard {
  private readonly failures = new Set<string>();
  private operations = 0;
  private glyphs = 0;
  readonly textIndices = new Set<number>();
  readonly paintIndices = new Set<number>();

  constructor() { if (version !== '6.4.299') this.reject('PDF.js 版本尚未验证原位回填'); }
  get safe() { return this.failures.size === 0; }
  get reasons() { return [...this.failures]; }
  reject(reason: string) { this.failures.add(reason); }

  inspect(index: number, list: Pick<PDFOperatorList, 'fnArray' | 'argsArray'>): void {
    if (!this.safe) return;
    if (++this.operations > 100_000) { this.reject('页面绘图指令过多'); return; }
    const op: unknown = list.fnArray[index];
    const raw: unknown = list.argsArray[index];
    const args: unknown[] = raw == null ? [] : Array.isArray(raw) ? raw : [];
    if (!finite(op) || (raw != null && !Array.isArray(raw))) { this.reject('页面绘图指令格式未识别'); return; }
    const reason = unsafeOps.get(op);
    if (reason) { this.reject(reason); return; }
    let valid = false;
    if (noArgs.has(op)) valid = args.length === 0;
    else if (numberArgs.has(op)) valid = numbers(args, numberArgs.get(op));
    else if (op === OPS.dependency) valid = args.length > 0 && args.every(value => typeof value === 'string');
    else if (op === OPS.setFont) valid = args.length === 2 && typeof args[0] === 'string' && finite(args[1]) && args[1] !== 0;
    else if (op === OPS.setTextMatrix) valid = args.length === 1 && numbers(args[0], 6);
    else if (op === OPS.setTextRenderingMode) {
      valid = args.length === 1 && Number.isInteger(args[0]) && Number(args[0]) >= 0 && Number(args[0]) <= 2;
      if (!valid) { this.reject('页面含隐藏文字或文字裁剪'); return; }
    } else if (op === OPS.setDash) valid = args.length === 2 && numbers(args[0]) && finite(args[1]);
    else if (op === OPS.setStrokeRGBColor || op === OPS.setFillRGBColor) valid = args.length === 1 && typeof args[0] === 'string' && /^#[\da-f]{6}$/i.test(args[0]);
    else if (op === OPS.setRenderingIntent) valid = args.length === 1 && typeof args[0] === 'string';
    else if (op === OPS.beginMarkedContent) valid = args.length === 1 && typeof args[0] === 'string';
    else if (op === OPS.beginMarkedContentProps) {
      if (args[0] === 'OC') { this.reject('页面含可切换的隐藏图层'); return; }
      valid = args.length === 2 && typeof args[0] === 'string';
    } else if (op === OPS.setGState) valid = this.graphicsState(args);
    else if (op === OPS.showText) {
      if (args.length !== 1 || !Array.isArray(args[0])) valid = false;
      else {
        valid = true;
        for (const glyph of args[0] as unknown[]) {
          if (++this.glyphs > 200_000) { this.reject('页面字形过多'); return; }
          if (finite(glyph)) continue;
          if (record(glyph) && glyph.operatorListId != null) { this.reject('页面含 Type3 字体'); return; }
          if (!record(glyph) || typeof glyph.unicode !== 'string' || typeof glyph.fontChar !== 'string' || !glyph.fontChar || !finite(glyph.width)) { valid = false; break; }
        }
        this.textIndices.add(index);
      }
    } else if (op === OPS.constructPath) {
      const data = args[1];
      const path = Array.isArray(data) ? data[0] : undefined;
      valid = args.length === 3 && finite(args[0]) && pathPaintOps.has(args[0]) && Array.isArray(data) && data.length === 1
        && (path === null || path instanceof Float32Array || (typeof Path2D !== 'undefined' && path instanceof Path2D))
        && (args[2] === null || numbers(args[2], 4));
      if (valid && args[0] !== OPS.endPath) this.paintIndices.add(index);
    } else if (op === OPS.paintImageXObject) {
      valid = args.length >= 1 && args.length <= 3 && typeof args[0] === 'string' && args.slice(1).every(finite);
      if (valid) this.paintIndices.add(index);
    } else if (op === OPS.paintInlineImageXObject || op === OPS.paintImageMaskXObject) {
      valid = args.length === 1 && record(args[0]) && finite(args[0].width) && finite(args[0].height);
      if (valid) this.paintIndices.add(index);
    } else if (op === OPS.paintSolidColorImageMask) { valid = args.length === 0; if (valid) this.paintIndices.add(index); }
    // Unnormalized text operators and optimized image groups intentionally fall
    // back until their complete IR/visibility semantics have fixtures.
    if (!valid) this.reject('页面含尚未验证的绘图指令');
  }

  filter = (index: number, list: PDFOperatorList): boolean => {
    this.inspect(index, list);
    return !textOps.has(list.fnArray[index]!);
  };

  private graphicsState(args: unknown[]): boolean {
    if (args.length !== 1 || !Array.isArray(args[0])) return false;
    for (const state of args[0] as unknown[]) {
      if (!Array.isArray(state) || state.length !== 2) return false;
      const [key, value] = state;
      if (key === 'SMask') { if (value) this.reject('页面含文字相关的软蒙版'); else if (value !== false && value !== null) return false; }
      else if (key === 'BM') { if (value !== 'source-over') this.reject('页面含混合绘图模式'); }
      else if (key === 'ca' || key === 'CA') { if (value !== 1) this.reject('页面含半透明文字或图形'); }
      else if (key === 'TR') { if (value !== null) this.reject('页面含颜色转换滤镜'); }
      else if (['LW', 'LC', 'LJ', 'ML', 'FL'].includes(String(key))) { if (!finite(value)) return false; }
      else if (key === 'RI') { if (typeof value !== 'string') return false; }
      else if (key === 'D') { if (!Array.isArray(value) || value.length !== 2 || !numbers(value[0]) || !finite(value[1])) return false; }
      else if (key === 'Font') { if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'string' || !finite(value[1]) || value[1] === 0) return false; }
      else return false;
    }
    return true;
  }
}

export type PdfPaintResult = { safe: boolean; textSafe: boolean; reasons: string[]; pixels: number };

type BBoxReader = { length: number; isEmpty(index: number): boolean; minX(index: number): number; minY(index: number): number; maxX(index: number): number; maxY(index: number): number };
const intersection = (a: PdfRect, b: PdfRect): PdfRect | null => {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x, height = Math.min(a.y + a.height, b.y + b.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
};

/** Small bounded spatial index. A full-table stroke may span a page; storing
 * its individual straight lines avoids treating every cell as overpainted. */
class RectGrid {
  private readonly cells = new Map<number, PdfRect[]>();
  private entries = 0;
  constructor(private readonly width: number, private readonly height: number) {}
  private keys(rect: PdfRect): number[] {
    const keys = [];
    const left = Math.max(0, Math.min(31, Math.floor(rect.x / this.width * 32)));
    const right = Math.max(0, Math.min(31, Math.floor((rect.x + rect.width) / this.width * 32)));
    const top = Math.max(0, Math.min(31, Math.floor(rect.y / this.height * 32)));
    const bottom = Math.max(0, Math.min(31, Math.floor((rect.y + rect.height) / this.height * 32)));
    for (let row = top; row <= bottom; row++) for (let col = left; col <= right; col++) keys.push(row * 32 + col);
    return keys;
  }
  add(rect: PdfRect): boolean {
    const keys = this.keys(rect);
    if ((this.entries += keys.length) > 100_000) return false;
    for (const key of keys) { const items = this.cells.get(key) ?? []; items.push(rect); this.cells.set(key, items); }
    return true;
  }
  query(rect: PdfRect): Set<PdfRect> {
    const found = new Set<PdfRect>();
    for (const key of this.keys(rect)) for (const item of this.cells.get(key) ?? []) found.add(item);
    return found;
  }
}

function occludedText(raw: unknown, guard: PdfOperationGuard, width: number, height: number, strokes: ReadonlyMap<number, readonly PdfRect[]>): RectGrid | null {
  if (!record(raw) || !finite(raw.length) || !['isEmpty', 'minX', 'minY', 'maxX', 'maxY'].every(key => typeof raw[key] === 'function')) return null;
  const reader = raw as unknown as BBoxReader;
  const texts = new RectGrid(width, height), blocked = new RectGrid(width, height);
  let checks = 0;
  const bounds = (index: number): PdfRect | null => {
    if (reader.isEmpty(index)) return null;
    const x = reader.minX(index) * width, y = reader.minY(index) * height;
    const right = reader.maxX(index) * width, bottom = reader.maxY(index) * height;
    if (![x, y, right, bottom].every(finite) || right < x || bottom < y) throw new Error('Invalid recorded PDF bounds');
    return intersection({ x, y, width: right - x, height: bottom - y }, { x: 0, y: 0, width, height });
  };
  try {
    for (const index of [...guard.textIndices, ...guard.paintIndices].sort((a, b) => a - b)) {
      if (index >= reader.length) return null;
      const box = bounds(index);
      if (guard.textIndices.has(index)) { if (box && !texts.add(box)) return null; continue; }
      for (const paint of strokes.get(index) ?? (box ? [box] : [])) {
        for (const text of texts.query(paint)) {
          if (++checks > 100_000) return null;
          const overlap = intersection(paint, text);
          if (overlap && !blocked.add(overlap)) return null;
        }
      }
    }
  } catch { return null; }
  return blocked;
}

type Line = readonly [number, number, number, number];
/** DrawOPS values are PDF.js 6.4.299's versioned public operator-list payload.
 * Only axis-aligned straight paths get narrow bounds; curves use recordedBBox. */
function straightLines(value: unknown): readonly Line[] | null {
  if (!(value instanceof Float32Array) || value.length > 20_000) return null;
  const lines: Line[] = []; let x = 0, y = 0, startX = 0, startY = 0, started = false;
  const add = (nextX: number, nextY: number) => {
    if (![nextX, nextY].every(finite) || (Math.abs(x - nextX) > 0.0001 && Math.abs(y - nextY) > 0.0001)) return false;
    if (x !== nextX || y !== nextY) lines.push([x, y, nextX, nextY]);
    x = nextX; y = nextY; return lines.length <= 2048;
  };
  for (let offset = 0; offset < value.length;) {
    const op = value[offset++];
    if (op === 0) { x = startX = value[offset++]!; y = startY = value[offset++]!; started = true; if (![x, y].every(finite)) return null; }
    else if (op === 1 && started) { if (!add(value[offset++]!, value[offset++]!)) return null; }
    else if (op === 4 && started) { if (!add(startX, startY)) return null; }
    else return null;
  }
  return lines;
}

/** Owns three rasters for one page. CSS geometry stays at viewport scale 1;
 * displayScale changes raster sharpness only. The caller owns page.cleanup(). */
export class PdfPagePainter {
  private generation = 0;
  private disposed = false;
  private safe = false;
  private originalReady = false;
  private rasterScale = 1;
  private active?: RenderTask;
  private settled: Promise<void> = Promise.resolve();
  private readonly colors = new Map<string, string | null>();
  private occlusion?: RectGrid;
  private readonly lineCache = new WeakMap<object, readonly Line[] | null>();

  constructor(private readonly page: PDFPageProxy, private readonly original: HTMLCanvasElement, private readonly translated: HTMLCanvasElement, private readonly background: HTMLCanvasElement) {
    if (new Set([original, translated, background]).size !== 3) throw new Error('PDF 对照需要三个独立画布');
  }

  render(displayScale: number): Promise<PdfPaintResult | undefined> {
    if (this.disposed) return Promise.resolve(undefined);
    const generation = ++this.generation;
    this.safe = false; this.originalReady = false; this.occlusion = undefined; this.colors.clear(); this.active?.cancel();
    const work = this.settled.then(() => this.renderCurrent(generation, displayScale));
    this.settled = work.then(() => undefined, () => undefined);
    return work;
  }

  reset(): void {
    if (this.disposed || !this.originalReady) return;
    const ctx = this.context(this.translated);
    ctx.clearRect(0, 0, this.translated.width, this.translated.height);
    ctx.drawImage(this.original, 0, 0);
  }

  canRead(rects: readonly PdfRect[]): boolean {
    if (!this.safe || this.disposed || !rects.length || rects.length > 256) return false;
    const boxes = rects.map(rect => this.pixelRect(rect));
    // Matching page text can still be white-on-white or fully absent from the
    // visible raster. Require actual glyph contrast before exposing its string.
    return boxes.every(box => box !== null && !this.covered(box)) && this.textColor(rects) !== null;
  }

  cover(rects: readonly PdfRect[]): void {
    if (!this.safe || this.disposed) return;
    const boxes = rects.map(rect => this.pixelRect(rect)).filter((rect): rect is PdfRect => rect !== null);
    if (boxes.some(box => this.covered(box))) return;
    const ctx = this.context(this.translated);
    for (const box of boxes) {
      // Transparent background pixels must replace the original glyphs too.
      ctx.clearRect(box.x, box.y, box.width, box.height);
      ctx.drawImage(this.background, box.x, box.y, box.width, box.height, box.x, box.y, box.width, box.height);
    }
  }

  textColor(rects: readonly PdfRect[]): string | null {
    if (!this.safe || this.disposed || rects.length > 256) return null;
    const boxes = rects.map(rect => this.pixelRect(rect)).filter((rect): rect is PdfRect => rect !== null);
    if (!boxes.length) return null;
    const key = boxes.map(box => `${box.x},${box.y},${box.width},${box.height}`).join(';');
    if (this.colors.has(key)) return this.colors.get(key)!;
    if (boxes.some(box => this.covered(box))) { this.cacheColor(key, null); return null; }
    const x = Math.min(...boxes.map(box => box.x)), y = Math.min(...boxes.map(box => box.y));
    const width = Math.max(...boxes.map(box => box.x + box.width)) - x;
    const height = Math.max(...boxes.map(box => box.y + box.height)) - y;
    let color: string | null = null;
    if (width * height <= MAX_COLOR_READ_PIXELS) {
      let original: Uint8ClampedArray, background: Uint8ClampedArray;
      try {
        original = this.context(this.original).getImageData(x, y, width, height).data;
        background = this.context(this.background).getImageData(x, y, width, height).data;
      } catch { this.cacheColor(key, null); return null; }
      const step = Math.max(1, Math.ceil(width * height / MAX_COLOR_SAMPLES));
      const buckets = new Map<number, { weight: number; red: number; green: number; blue: number; count: number }>();
      let changed = 0;
      for (let pixel = 0; pixel < width * height; pixel += step) {
        const px = x + pixel % width, py = y + Math.floor(pixel / width);
        if (!boxes.some(box => px >= box.x && py >= box.y && px < box.x + box.width && py < box.y + box.height)) continue;
        const offset = pixel * 4;
        const red = original[offset]!, green = original[offset + 1]!, blue = original[offset + 2]!;
        const delta = Math.abs(red - background[offset]!) + Math.abs(green - background[offset + 1]!) + Math.abs(blue - background[offset + 2]!) + Math.abs(original[offset + 3]! - background[offset + 3]!);
        if (delta < 72 || original[offset + 3]! < 96) continue;
        changed++;
        const bucketKey = (red >> 4) * 256 + (green >> 4) * 16 + (blue >> 4);
        const bucket = buckets.get(bucketKey) ?? { weight: 0, red: 0, green: 0, blue: 0, count: 0 };
        const weight = delta * delta;
        bucket.weight += weight; bucket.red += red * weight; bucket.green += green * weight; bucket.blue += blue * weight; bucket.count++;
        buckets.set(bucketKey, bucket);
      }
      const best = [...buckets.values()].sort((a, b) => b.weight - a.weight)[0];
      if (best && changed >= 3) color = `rgb(${Math.round(best.red / best.weight)}, ${Math.round(best.green / best.weight)}, ${Math.round(best.blue / best.weight)})`;
    }
    this.cacheColor(key, color);
    return color;
  }

  async dispose(): Promise<void> {
    this.disposed = true; this.safe = false; this.originalReady = false; this.generation++;
    this.active?.cancel(); await this.settled; this.colors.clear();
    for (const canvas of [this.original, this.translated, this.background]) { canvas.width = 0; canvas.height = 0; }
  }

  private async renderCurrent(generation: number, displayScale: number): Promise<PdfPaintResult | undefined> {
    if (!this.current(generation)) return undefined;
    const base = this.page.getViewport({ scale: 1 });
    if (!finite(base.width) || !finite(base.height) || base.width <= 0 || base.height <= 0) throw new Error('PDF 页面尺寸无效');
    const desired = Math.max(0.01, Math.min(2, (finite(displayScale) && displayScale > 0 ? displayScale : 1) * Math.min(2, globalThis.devicePixelRatio || 1)));
    this.rasterScale = Math.min(desired, Math.sqrt(MAX_PDF_CANVAS_PIXELS / (3 * base.width * base.height)), MAX_CANVAS_EDGE / base.width, MAX_CANVAS_EDGE / base.height);
    const viewport = this.page.getViewport({ scale: this.rasterScale });
    const width = Math.max(1, Math.floor(viewport.width)), height = Math.max(1, Math.floor(viewport.height));
    for (const canvas of [this.original, this.translated, this.background]) { canvas.width = width; canvas.height = height; }
    const pixels = width * height * 3;
    const guard = new PdfOperationGuard();
    if (this.page.isPureXfa) guard.reject('动态表单使用原稿阅读');
    const strokes = new Map<number, readonly PdfRect[]>();
    // Keep annotation appearances in the original. Disabling them could reveal
    // text covered by a draft redaction or another opaque annotation.
    // The viewer presents a white sheet. Use the same opaque matte for both
    // passes: PDF.js may create alpha:false contexts, where a transparent fill
    // produces black paper; transparent white glyphs would also look invisible
    // against the sheet yet appear different in an alpha-only comparison.
    const options = { viewport, annotationMode: AnnotationMode.ENABLE, background: '#ffffff' };
    try {
      // The public cache can contain partial bounds from a cancelled render;
      // this painter owns the page's canvases and records fresh metadata.
      this.page.recordedBBoxes = null;
      await this.run(this.page.render({ ...options, canvas: this.original, recordOperations: true, operationsFilter: (index, list) => {
        guard.inspect(index, list);
        if (guard.safe) this.captureStrokes(index, list, strokes);
        return true;
      } }));
      if (!this.current(generation)) return undefined;
      this.originalReady = true; this.reset();
      if (!guard.safe) return { safe: false, textSafe: false, reasons: guard.reasons, pixels };
      this.occlusion = occludedText(this.page.recordedBBoxes, guard, width, height, strokes) ?? undefined;
      if (!this.occlusion) return { safe: false, textSafe: false, reasons: ['页面绘制边界未能验证，已保留原稿'], pixels };
      const backgroundGuard = new PdfOperationGuard();
      try { await this.run(this.page.render({ ...options, canvas: this.background, operationsFilter: backgroundGuard.filter })); }
      catch (error) { if (!this.current(generation)) return undefined; backgroundGuard.reject(error instanceof Error ? '原位背景未能完成，已保留原稿' : '原位背景渲染失败'); }
      if (!this.current(generation)) return undefined;
      this.safe = backgroundGuard.safe;
      return { safe: this.safe, textSafe: this.safe, reasons: backgroundGuard.reasons, pixels };
    } catch (error) {
      if (!this.current(generation)) return undefined;
      throw error;
    }
  }

  private async run(task: RenderTask): Promise<void> {
    this.active = task;
    try { await task.promise; } finally { if (this.active === task) this.active = undefined; }
  }
  private current(generation: number) { return !this.disposed && this.generation === generation; }
  private cacheColor(key: string, color: string | null) {
    if (this.colors.size >= MAX_COLOR_CACHE) this.colors.delete(this.colors.keys().next().value!);
    this.colors.set(key, color);
  }
  private covered(box: PdfRect) { return !!this.occlusion && [...this.occlusion.query(box)].some(region => intersection(region, box)); }
  private captureStrokes(index: number, list: PDFOperatorList, output: Map<number, readonly PdfRect[]>): void {
    if (list.fnArray[index] !== OPS.constructPath) return;
    const args: unknown = list.argsArray[index];
    if (!Array.isArray(args) || (args[0] !== OPS.stroke && args[0] !== OPS.closeStroke) || !Array.isArray(args[1])) return;
    const data = args[1];
    if (!this.lineCache.has(data)) this.lineCache.set(data, straightLines(data[0]));
    const lines = this.lineCache.get(data); if (!lines) return;
    const ctx = this.context(this.original), transform = ctx.getTransform();
    const { a, b, c, d, e, f } = transform;
    if (![a, b, c, d, e, f, ctx.lineWidth].every(finite)) return;
    // Orthogonal joins need at most sqrt(2) times half the stroke width.
    // Frobenius norm also bounds skewed/scaled viewport transforms.
    const padding = Math.max(1, Math.hypot(a, b, c, d) * Math.abs(ctx.lineWidth) * Math.SQRT2 / 2) + 1;
    const boxes: PdfRect[] = [];
    for (const [x1, y1, x2, y2] of lines) {
      const ax = a * x1 + c * y1 + e, ay = b * x1 + d * y1 + f;
      const bx = a * x2 + c * y2 + e, by = b * x2 + d * y2 + f;
      const box = intersection({ x: Math.min(ax, bx) - padding, y: Math.min(ay, by) - padding, width: Math.abs(ax - bx) + padding * 2, height: Math.abs(ay - by) + padding * 2 }, { x: 0, y: 0, width: this.original.width, height: this.original.height });
      if (box) boxes.push(box);
    }
    output.set(index, boxes);
  }
  private context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
    const context = canvas.getContext('2d'); if (!context) throw new Error('浏览器无法创建 PDF 画布'); return context;
  }
  private pixelRect(rect: PdfRect): PdfRect | null {
    if (![rect.x, rect.y, rect.width, rect.height].every(finite) || rect.width <= 0 || rect.height <= 0) return null;
    const x = Math.max(0, Math.floor(rect.x * this.rasterScale)), y = Math.max(0, Math.floor(rect.y * this.rasterScale));
    const right = Math.min(this.original.width, Math.ceil((rect.x + rect.width) * this.rasterScale));
    const bottom = Math.min(this.original.height, Math.ceil((rect.y + rect.height) * this.rasterScale));
    return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
  }
}
