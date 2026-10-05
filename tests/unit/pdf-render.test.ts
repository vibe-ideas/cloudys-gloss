import { beforeEach, describe, expect, it, vi } from 'vitest';
// These tests exercise scheduling/inspection, not the browser canvas renderer.
// PDF.js only constructs this matrix during module initialization in happy-dom.
vi.hoisted(() => { vi.stubGlobal('DOMMatrix', class {}); });
import { OPS, type PDFPageProxy, type RenderTask } from 'pdfjs-dist';
import { MAX_PDF_CANVAS_PIXELS, PdfOperationGuard, PdfPagePainter } from '../../src/pdf/render';

type OperatorList = Awaited<ReturnType<PDFPageProxy['getOperatorList']>>;
type RenderParameters = Parameters<PDFPageProxy['render']>[0];
type Operation = [number, unknown[] | null];
const glyph = { unicode: 'A', fontChar: 'A', width: 600 };
const list = (operations: Operation[]): OperatorList => ({ fnArray: operations.map(op => op[0]), argsArray: operations.map(op => op[1]) });
const inspect = (operations: Operation[]) => { const guard = new PdfOperationGuard(), items = list(operations); items.fnArray.forEach((_, index) => guard.inspect(index, items)); return guard; };
const text: Operation = [OPS.showText, [[glyph]]];

describe('PDF 原版式回填的页面检查', () => {
  it('彩底表格使用普通字体、路径和图片时允许去字，并保留所有非文字绘制', () => {
    const operations: Operation[] = [
      [OPS.save, null], [OPS.setFillRGBColor, ['#147799']],
      [OPS.constructPath, [OPS.fill, [new Float32Array([0, 0, 0, 1, 100, 0, 1, 100, 100, 4])], new Float32Array([0, 0, 100, 100])]],
      [OPS.paintImageXObject, ['image_1', 100, 100]], [OPS.beginText, null], [OPS.dependency, ['font_1']], [OPS.setFont, ['font_1', 18]],
      [OPS.setTextMatrix, [new Float32Array([1, 0, 0, 1, 20, 80])]], [OPS.setTextRenderingMode, [0]], text, [OPS.endText, null], [OPS.restore, null],
    ];
    const guard = inspect(operations); expect(guard.safe).toBe(true);
    const items = list(operations);
    expect(items.fnArray.map((_, index) => guard.filter(index, items))).toEqual(operations.map(op => op[0] !== OPS.showText));
  });

  it.each([
    ['文字用作裁剪轮廓', [OPS.setTextRenderingMode, [7]], '文字裁剪'],
    ['扫描页含不可见 OCR 文字', [OPS.setTextRenderingMode, [3]], '隐藏文字'],
    ['Type3 字形包含自定义图案', [OPS.showText, [[{ ...glyph, operatorListId: 'A' }]]], 'Type3'],
    ['图片透明度依赖软蒙版', [OPS.setGState, [[['SMask', true]]]], '软蒙版'],
    ['透明分组可能受去字影响', [OPS.beginGroup, [{}]], '分组'],
    ['文字藏在图案填充内部', [OPS.setFillColorN, [['TilingPattern']]], '图案'],
    ['页面使用非标准混合模式', [OPS.setGState, [[['BM', 'multiply']]]], '混合'],
    ['原文处于可隐藏图层', [OPS.beginMarkedContentProps, ['OC', {}]], '隐藏图层'],
    ['裁剪路径遮住一部分原文字形', [OPS.clip, null], '裁剪'],
    ['操作编码超出已验证范围', [999_999, []], '尚未验证'],
    ['普通文字指令的字形结构损坏', [OPS.showText, [[{ unicode: 'A' }]]], '尚未验证'],
  ] as const)('%s时保留原稿而不尝试原位盖字', (_, operation, reason) => {
    const guard = inspect([operation as unknown as Operation]);
    expect(guard.safe).toBe(false); expect(guard.reasons.join(' ')).toContain(reason);
  });

  it('网格在文字之后绘制时收集绘制顺序，交给局部遮挡判定而不拒绝整页', () => {
    const guard = inspect([text, [OPS.constructPath, [OPS.stroke, [new Float32Array([0, 0, 20, 1, 100, 20])], [0, 20, 100, 20]]]]);
    expect(guard.safe).toBe(true); expect([...guard.textIndices]).toEqual([0]); expect([...guard.paintIndices]).toEqual([1]);
  });
});

function makeCanvas(color = [255, 255, 255, 255]) {
  const canvas = document.createElement('canvas');
  const context = {
    clearRect: vi.fn(), drawImage: vi.fn(), lineWidth: 1,
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    getImageData: vi.fn((_x: number, _y: number, width: number, height: number) => {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let index = 0; index < data.length; index += 4) data.set(color, index);
      return { data };
    }),
  };
  vi.spyOn(canvas, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  return { canvas, context };
}

function fakePage(options: { operations?: Operation[]; bounds?: Record<number, [number, number, number, number]>; width?: number; height?: number; holdFirst?: boolean } = {}) {
  const operations = options.operations ?? [], width = options.width ?? 600, height = options.height ?? 400;
  const items = list(operations); let active = 0, maxActive = 0;
  const tasks: { finish(): void; cancel: ReturnType<typeof vi.fn> }[] = [];
  const page = {
    recordedBBoxes: null as unknown,
    isPureXfa: false,
    getViewport: ({ scale }: { scale: number }) => ({ width: width * scale, height: height * scale }),
    render: vi.fn((params: RenderParameters) => {
      active++; maxActive = Math.max(maxActive, active);
      let resolve!: () => void, reject!: (error: Error) => void, done = false;
      const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
      const finish = () => {
        if (done) return; done = true; active--;
        items.fnArray.forEach((_, index) => params.operationsFilter?.(index, items));
        if (params.recordOperations) page.recordedBBoxes = {
          length: items.fnArray.length,
          isEmpty: (index: number) => !options.bounds?.[index],
          minX: (index: number) => options.bounds![index]![0] / width,
          minY: (index: number) => options.bounds![index]![1] / height,
          maxX: (index: number) => options.bounds![index]![2] / width,
          maxY: (index: number) => options.bounds![index]![3] / height,
        };
        resolve();
      };
      const cancel = vi.fn(() => { if (!done) { done = true; active--; reject(new Error('Rendering cancelled')); } });
      tasks.push({ finish, cancel });
      if (!(options.holdFirst && tasks.length === 1)) queueMicrotask(finish);
      return { promise, cancel } as unknown as RenderTask;
    }),
  };
  const original = makeCanvas([18, 32, 48, 255]), translated = makeCanvas(), background = makeCanvas();
  const painter = new PdfPagePainter(page as unknown as PDFPageProxy, original.canvas, translated.canvas, background.canvas);
  return { painter, page, original, translated, background, tasks, maxActive: () => maxActive };
}

describe('PDF 对照画布的资源和局部覆盖', () => {
  beforeEach(() => vi.stubGlobal('devicePixelRatio', 1));

  it('高分辨率大页的三个画布合计不超过六百万像素', async () => {
    const f = fakePage({ width: 5000, height: 5000 });
    const result = await f.painter.render(2);
    expect(result?.safe).toBe(true); expect(result?.pixels).toBeLessThanOrEqual(MAX_PDF_CANVAS_PIXELS);
    expect(result?.pixels).toBe(f.original.canvas.width * f.original.canvas.height * 3);
    await f.painter.dispose();
  });

  it('调用方未预建画布上下文时两个 PDF 渲染都使用白纸背景，避免黑底吞掉黑字', async () => {
    const f = fakePage();
    expect(f.original.canvas.getContext).not.toHaveBeenCalled();
    await f.painter.render(1);
    expect(f.page.render.mock.calls.map(([params]) => params.background)).toEqual(['#ffffff', '#ffffff']);
    await f.painter.dispose();
  });

  it('连续缩放会取消旧页渲染，等待它退出后再复用同一个画布', async () => {
    const f = fakePage({ holdFirst: true });
    const first = f.painter.render(1); await Promise.resolve();
    expect(f.tasks).toHaveLength(1);
    const next = f.painter.render(0.8);
    await expect(first).resolves.toBeUndefined(); await expect(next).resolves.toMatchObject({ safe: true });
    expect(f.tasks[0]!.cancel).toHaveBeenCalledOnce(); expect(f.maxActive()).toBe(1);
    expect(f.original.canvas.width).toBe(480);
    await f.painter.dispose();
  });

  it('关闭正在渲染的页会取消任务并清空三个画布，迟到完成不会重新显示', async () => {
    const f = fakePage({ holdFirst: true });
    const render = f.painter.render(1); await Promise.resolve();
    const close = f.painter.dispose(); f.tasks[0]!.finish(); await close;
    await expect(render).resolves.toBeUndefined();
    expect([f.original, f.translated, f.background].map(value => value.canvas.width * value.canvas.height)).toEqual([0, 0, 0]);
    await expect(f.painter.render(1)).resolves.toBeUndefined(); expect(f.tasks).toHaveLength(1);
  });

  it('渲染尚未完成时颜色识别、恢复和覆盖都不会使用半成品图像', async () => {
    const f = fakePage({ holdFirst: true }); const render = f.painter.render(1); await Promise.resolve();
    const box = [{ x: 10, y: 10, width: 20, height: 20 }];
    f.painter.reset(); f.painter.cover(box); expect(f.painter.textColor(box)).toBeNull(); expect(f.painter.canRead(box)).toBe(false);
    expect(f.translated.context.drawImage).not.toHaveBeenCalled(); expect(f.original.context.getImageData).not.toHaveBeenCalled();
    await f.painter.dispose(); await render;
  });

  it('带软蒙版的页面只显示完整原稿，不渲染不可靠的无文字背景', async () => {
    const f = fakePage({ operations: [[OPS.setGState, [[['SMask', true]]]]] });
    expect(await f.painter.render(1)).toMatchObject({ safe: false, textSafe: false }); expect(f.page.render).toHaveBeenCalledTimes(1);
    expect(f.painter.canRead([{ x: 10, y: 10, width: 20, height: 20 }])).toBe(false);
    f.painter.cover([{ x: 10, y: 10, width: 20, height: 20 }]);
    expect(f.translated.context.drawImage).toHaveBeenCalledOnce();
    await f.painter.dispose();
  });

  it('透明页局部回填先擦除原字再复制背景，越界和损坏的矩形不会越界绘制', async () => {
    const f = fakePage(); await f.painter.render(1);
    f.translated.context.clearRect.mockClear(); f.translated.context.drawImage.mockClear();
    f.painter.cover([{ x: -5, y: -6, width: 20, height: 20 }, { x: 599, y: 399, width: 20, height: 20 }, { x: NaN, y: 0, width: 20, height: 20 }]);
    expect(f.translated.context.clearRect.mock.calls).toEqual([[0, 0, 15, 14], [599, 399, 1, 1]]);
    expect(f.translated.context.clearRect.mock.invocationCallOrder[0]).toBeLessThan(f.translated.context.drawImage.mock.invocationCallOrder[0]!);
    await f.painter.dispose();
  });

  it('同一译文多次更新复用局部颜色缓存，没有可见字形差异时保留原稿', async () => {
    const f = fakePage(); await f.painter.render(1);
    const box = [{ x: 20, y: 20, width: 30, height: 15 }];
    expect(f.painter.textColor(box)).toBe('rgb(18, 32, 48)'); expect(f.painter.textColor(box)).toBe('rgb(18, 32, 48)');
    expect(f.original.context.getImageData).toHaveBeenCalledOnce(); expect(f.background.context.getImageData).toHaveBeenCalledOnce();
    f.original.context.getImageData.mockImplementation((_x, _y, width, height) => ({ data: new Uint8ClampedArray(width * height * 4).fill(255) }));
    expect(f.painter.textColor([{ x: 60, y: 20, width: 30, height: 15 }])).toBeNull();
    expect(f.painter.canRead([{ x: 60, y: 20, width: 30, height: 15 }])).toBe(false);
    await f.painter.dispose();
  });

  it('浏览器拒绝读取页面像素时不展示或发送尚未确认可见的原文', async () => {
    const f = fakePage(); await f.painter.render(1);
    f.original.context.getImageData.mockImplementation(() => { throw new Error('Pixel read unavailable'); });
    expect(f.painter.canRead([{ x: 10, y: 10, width: 30, height: 15 }])).toBe(false);
    await f.painter.dispose();
  });

  it('一条绘图指令在文字之后画完整网格时，只要线不碰字就允许翻译单元格', async () => {
    const path = new Float32Array([0, 20, 20, 1, 580, 20, 0, 20, 380, 1, 580, 380, 0, 300, 20, 1, 300, 380]);
    const f = fakePage({ operations: [text, [OPS.constructPath, [OPS.stroke, [path], [20, 20, 580, 380]]]], bounds: { 0: [40, 40, 140, 60], 1: [20, 20, 580, 380] } });
    expect(await f.painter.render(1)).toMatchObject({ safe: true, textSafe: true });
    expect(f.painter.textColor([{ x: 40, y: 40, width: 100, height: 20 }])).toBe('rgb(18, 32, 48)');
    expect(f.painter.canRead([{ x: 40, y: 40, width: 100, height: 20 }])).toBe(true);
    await f.painter.dispose();
  });

  it('后绘色块遮住某段原文时只阻止该段盖字，其他单元格仍可原位翻译', async () => {
    const f = fakePage({ operations: [text, [OPS.constructPath, [OPS.fill, [new Float32Array([0, 45, 45, 1, 75, 45, 1, 75, 50, 4])], [45, 45, 75, 50]]], text], bounds: { 0: [40, 40, 140, 60], 1: [45, 45, 75, 50], 2: [330, 40, 430, 60] } });
    expect(await f.painter.render(1)).toMatchObject({ safe: true });
    const blocked = [{ x: 40, y: 40, width: 100, height: 20 }];
    expect(f.painter.canRead(blocked)).toBe(false);
    expect(f.painter.canRead([{ x: 330, y: 40, width: 100, height: 20 }])).toBe(true);
    expect(f.painter.textColor(blocked)).toBeNull(); expect(f.painter.textColor([{ x: 330, y: 40, width: 100, height: 20 }])).toBe('rgb(18, 32, 48)');
    f.translated.context.clearRect.mockClear(); f.painter.cover(blocked); expect(f.translated.context.clearRect).not.toHaveBeenCalled();
    await f.painter.dispose();
  });

  it('第二张卡片先画背景再画自身文字时，不受第一张卡片更早文字的影响', async () => {
    const f = fakePage({ operations: [text, [OPS.constructPath, [OPS.fill, [new Float32Array([0, 300, 20, 1, 580, 20, 1, 580, 90, 4])], [300, 20, 580, 90]]], text], bounds: { 0: [40, 40, 140, 60], 1: [300, 20, 580, 90], 2: [330, 40, 430, 60] } });
    expect(await f.painter.render(1)).toMatchObject({ safe: true });
    expect(f.painter.textColor([{ x: 330, y: 40, width: 100, height: 20 }])).toBe('rgb(18, 32, 48)');
    await f.painter.dispose();
  });
});
