import { describe, expect, it } from 'vitest';
import { buildPdfLayout, MAX_LAYOUT_ITEMS, MAX_LAYOUT_TEXT_CHARACTERS, type PdfLayoutViewport, type PdfRect } from '../../src/pdf/layout';
import { MAX_PAGE_CHARACTERS, MAX_PAGE_PARAGRAPHS } from '../../src/pdf/text';

const viewport: PdfLayoutViewport = { transform: [1, 0, 0, -1, 0, 800], width: 600, height: 800 };
const styles = { body: { ascent: 0.8, descent: -0.2, fontFamily: 'sans-serif' } };
const item = (str: string, x = 40, y = 700, width = 160, size = 12, hasEOL = true) => ({
  str, width, height: size, transform: [size, 0, 0, size, x, y], hasEOL, fontName: 'body', dir: 'ltr',
});
const inside = (rect: PdfRect, page = viewport) => rect.x >= 0 && rect.y >= 0 && rect.width >= 0 && rect.height >= 0
  && rect.x + rect.width <= page.width + 0.001 && rect.y + rect.height <= page.height + 0.001;

describe('PDF 原位译文的正文与组件边界', () => {
  it('同段字形片段和相邻换行合成正文，保留原有空格、逐行覆盖区域及真实行距', () => {
    const result = buildPdfLayout([
      item('Reading ', 40, 700, 42, 12, false), item('across languages', 82, 700, 90),
      item('should feel natural.', 40, 684, 120), item('Another idea starts here.', 40, 645, 144),
    ], styles, viewport);
    expect(result.blocks.map(block => block.text)).toEqual(['Reading across languages should feel natural.', 'Another idea starts here.']);
    const first = result.blocks[0]!;
    expect(first.inkRects).toHaveLength(3);
    expect(first.box.x).toBeCloseTo(39.52); expect(first.box.y).toBeCloseTo(89.92);
    expect(first.fontSize).toBe(12); expect(first.lineHeight).toBe(16);
    expect(result.blocks.every(block => block.layoutSafe && block.translatable)).toBe(true);
    expect(result.truncated).toBe(false);
  });

  it('同一行的字形基线有微小误差且输入顺序相反时，仍按可见的从左到右顺序组成一句', () => {
    const result = buildPdfLayout([item('across languages', 85, 700.1, 100), item('Reading', 40, 700, 42, 12, false)], styles, viewport);
    expect(result.blocks.map(block => block.text)).toEqual(['Reading across languages']);
    expect(result.blocks[0]!.layoutSafe).toBe(true);
  });

  it('双栏正文只在自己的列内合段，两个段落的范围不会横穿中间栏距', () => {
    const left = ['A long first sentence in the left column', 'continues with another useful explanation.'];
    const right = ['A different topic starts in the right column', 'and continues without joining the left text.'];
    const result = buildPdfLayout([
      item(left[0]!, 40, 700, 220), item(right[0]!, 330, 700, 220),
      item(left[1]!, 40, 684, 210), item(right[1]!, 330, 684, 210),
    ], styles, viewport);
    expect(result.blocks.map(block => block.text)).toEqual([left.join(' '), right.join(' ')]);
    expect(result.blocks[0]!.box.x + result.blocks[0]!.box.width).toBeLessThan(result.blocks[1]!.box.x);
    expect(result.blocks.every(block => block.layoutSafe)).toBe(true);
  });

  it('字号相同但使用另一种字体的标题不与下面的正文拼接，正文内的换行仍然合段', () => {
    const result = buildPdfLayout([{ ...item('Summary of the report.'), fontName: 'heading' },
      item('This paragraph explains the result', 40, 684), item('and continues on the next line.', 40, 668)],
    { ...styles, heading: { ...styles.body, fontFamily: 'serif' } }, viewport);
    expect(result.blocks.map(block => block.text)).toEqual(['Summary of the report.', 'This paragraph explains the result and continues on the next line.']);
  });

  it('表头、姓名、金额等表格单元格保持独立，跨列的大空白不会成为遮罩或翻译文本', () => {
    const result = buildPdfLayout([
      item('PRODUCT', 40, 700, 80), item('DETAILS', 330, 700, 80),
      item('Ada Lovelace', 40, 684, 80), { ...item(' ', 120, 684, 210, 12, false), height: 0 }, item('USD 1,250.00', 330, 684, 80),
      item('An unusually long product description', 40, 668, 220), item('Another detailed independent table cell', 330, 668, 220),
    ], styles, viewport);
    expect(result.blocks.map(block => block.text)).toEqual(['PRODUCT', 'DETAILS', 'Ada Lovelace', 'USD 1,250.00',
      'An unusually long product description', 'Another detailed independent table cell']);
    expect(result.blocks.flatMap(block => block.inkRects)).toHaveLength(6);
    expect(result.blocks.map(block => block.translatable)).toEqual([true, true, true, false, true, true]);
    expect(result.blocks.every(block => block.layoutSafe && block.box.width < 222)).toBe(true);
  });

  it('正文末行旁出现另一段文字时不扩展整段框覆盖邻文，原文没有被丢弃', () => {
    const texts = ['A long paragraph begins across this area.', 'Its last line.', 'A separate note.'];
    const result = buildPdfLayout([item(texts[0]!, 40, 700, 300), item(texts[1]!, 40, 684, 100), item(texts[2]!, 200, 684, 120)], styles, viewport);
    expect(result.blocks.map(block => block.text)).toEqual(texts);
    expect(result.blocks.every(block => block.layoutSafe)).toBe(true);
  });

  it('数字、金额、网址和邮箱保留原位而不请求模型，姓名和全大写表头仍然翻译', () => {
    const texts = ['Ada Lovelace', 'ANNUAL REVENUE', 'CAD', '2026', '$2,400.00', 'usd 1,250.00', '12.4%', 'https://example.com/report', 'ada@example.test'];
    const result = buildPdfLayout(texts.map((text, index) => item(text, 40, 740 - index * 30)), styles, viewport);
    expect(result.blocks.map(block => block.text)).toEqual(texts);
    expect(result.blocks.map(block => block.translatable)).toEqual([true, true, true, false, false, false, false, false, false]);
    expect(result.blocks.every(block => block.layoutSafe)).toBe(true);
  });
});

describe('PDF 裁剪、旋转与无法安全覆盖的原文', () => {
  it('裁剪框原点不是零时使用 viewport 的坐标变换，不把文本放回未裁剪页的位置', () => {
    const crop = { transform: [1, 0, 0, -1, -50, 750], width: 400, height: 600 };
    const block = buildPdfLayout([item('Text inside the crop.', 100, 700, 120)], styles, crop).blocks[0]!;
    expect(block.box.x).toBeCloseTo(49.52); expect(block.box.y).toBeCloseTo(39.92);
    expect(block.layoutSafe).toBe(true); expect(inside(block.box, crop)).toBe(true);
  });

  it('页面 UserUnit 改变时宽度、字号和定位一起变换，不依赖未包含 UserUnit 的 scale 字段', () => {
    const units = { transform: [2, 0, 0, -2, -100, 1500], width: 800, height: 1200, scale: 1 };
    const block = buildPdfLayout([item('Scaled page text.', 100, 700, 120)], styles, units).blocks[0]!;
    expect(block.fontSize).toBe(24); expect(block.box.width).toBeCloseTo(241.5);
    expect(block.box.x).toBeCloseTo(99.25); expect(block.box.y).toBeCloseTo(80.05);
    expect(block.layoutSafe).toBe(true);
  });

  it('旋转页面保留正确的显示坐标，文本转回水平时可覆盖，竖向文本仍可用阅读模式翻译', () => {
    const rotated = { transform: [0, 1, 1, 0, -150, -50], width: 600, height: 400 };
    const normal = buildPdfLayout([item('Rotated with the page.', 100, 700, 120)], styles, rotated).blocks[0]!;
    expect(normal.box.x).toBeCloseTo(547.12); expect(normal.box.y).toBeCloseTo(49.52);
    expect(normal.box.width).toBeCloseTo(12.96); expect(normal.box.height).toBeCloseTo(120.96);
    expect(normal.layoutSafe).toBe(false); expect(normal.translatable).toBe(true);
    expect(normal.reasons).toContain('rotated-text'); expect(inside(normal.box, rotated)).toBe(true);
    const upright = buildPdfLayout([{ ...item('Upright after rotation.'), transform: [0, 12, -12, 0, 100, 500] }], styles, rotated).blocks[0]!;
    expect(upright.layoutSafe).toBe(true); expect(upright.box.width).toBeCloseTo(160.96);
  });

  it('倾斜、竖排和从右到左文字保留全文与坐标，但明确禁止原位覆盖', () => {
    const source = [
      { ...item('Slanted writing.', 40, 700), transform: [12, 0, 3, 12, 40, 700] },
      { ...item('Vertical writing.', 40, 650), fontName: 'vertical' },
      { ...item('كتابة من اليمين', 40, 600), dir: 'rtl' },
    ];
    const result = buildPdfLayout(source, { ...styles, vertical: { ...styles.body, vertical: true } }, viewport);
    expect(result.blocks.map(block => block.text)).toEqual(source.map(entry => entry.str));
    expect(result.blocks.every(block => !block.layoutSafe && block.translatable && block.inkRects.length === 1)).toBe(true);
    expect(result.blocks[0]!.reasons).toContain('skewed-text');
    expect(result.blocks[1]!.reasons).toContain('unsupported-direction');
  });

  it('重复 OCR 层或彼此重叠的文字均保留，但不能用译文遮住另一块原文', () => {
    const result = buildPdfLayout([item('Visible original sentence.', 40, 700, 160), item('Duplicate OCR sentence.', 45, 700, 160)], styles, viewport);
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks.every(block => !block.layoutSafe && block.translatable && block.reasons.includes('overlapping-text'))).toBe(true);
  });

  it('跨裁剪边缘或完全位于页外的文本不丢字，所有对外坐标均在页面范围内', () => {
    const source = [item('Partly outside the page.', -5, 796, 100), item('Entirely beyond the crop.', 650, 700, 100)];
    const result = buildPdfLayout(source, styles, viewport);
    expect(result.blocks.map(block => block.text)).toEqual(source.map(entry => entry.str));
    expect(result.blocks.every(block => !block.layoutSafe && block.reasons.includes('clipped-text'))).toBe(true);
    expect(result.blocks.every(block => inside(block.box) && block.inkRects.every(rect => inside(rect)))).toBe(true);
    expect(result.blocks[1]!.box.width).toBe(0);
  });

  it('损坏坐标和缺少字体度量时保留可阅读文字，降级原因可供界面解释', () => {
    const result = buildPdfLayout([{ ...item('Broken coordinates.'), transform: [12, 0, 0, 12, NaN, 700] },
      { ...item('Missing font metrics.', 40, 650), fontName: 'unknown' }], styles, viewport);
    expect(result.blocks.map(block => block.text)).toEqual(['Broken coordinates.', 'Missing font metrics.']);
    expect(result.blocks.every(block => !block.layoutSafe && block.translatable)).toBe(true);
    expect(result.reasons).toEqual(expect.arrayContaining(['invalid-geometry', 'missing-font-metrics']));
    expect(result.blocks.every(block => inside(block.box))).toBe(true);
  });
});

describe('PDF 布局提取的资源上限', () => {
  it('初始输入包含大量非文字标记时也只读取有限项，并明确报告未处理的后续内容', () => {
    let reads = 0;
    const entries = new Proxy(Array.from({ length: MAX_LAYOUT_ITEMS + 10 }, () => ({ type: 'beginMarkedContent' })), {
      get(target, key, receiver) { if (typeof key === 'string' && /^\d+$/.test(key)) reads++; return Reflect.get(target, key, receiver); },
    });
    const result = buildPdfLayout(entries, styles, viewport);
    expect(reads).toBe(MAX_LAYOUT_ITEMS); expect(result.blocks).toEqual([]);
    expect(result.truncated).toBe(true); expect(result.reasons).toContain('item-limit');
  });

  it('超过二百段的页面只保留允许的文本块，截断状态不会伪装为完整页面', () => {
    const page = { transform: [1, 0, 0, -1, 0, 12000], width: 600, height: 12000 };
    const result = buildPdfLayout(Array.from({ length: MAX_PAGE_PARAGRAPHS + 1 }, (_, index) => item(`Section ${index}`, 40, 11950 - index * 40)), styles, page);
    expect(result.blocks).toHaveLength(MAX_PAGE_PARAGRAPHS);
    expect(result.blocks.at(-1)!.text).toBe(`Section ${MAX_PAGE_PARAGRAPHS - 1}`);
    expect(result.truncated).toBe(true); expect(result.reasons).toContain('block-limit');
  });

  it('超过十万字的异常页面只保留有界文本，说明截断且不发送异常长段', () => {
    const result = buildPdfLayout([item(`English ${'x'.repeat(MAX_PAGE_CHARACTERS)}`)], styles, viewport);
    expect(result.blocks[0]!.text).toHaveLength(MAX_PAGE_CHARACTERS);
    expect(result.blocks[0]!.layoutSafe).toBe(false); expect(result.blocks[0]!.translatable).toBe(false);
    expect(result.truncated).toBe(true); expect(result.reasons).toContain('character-limit');
  });

  it('合并换行时新增的空格也计入十万字上限，最后被截断的段落不用于原位覆盖或模型请求', () => {
    const page = { transform: [1, 0, 0, -1, 0, 2000], width: 600, height: 2000 };
    const result = buildPdfLayout(Array.from({ length: 100 }, (_, index) => item('x'.repeat(1000), 40, 1950 - index * 16, 300)), styles, page);
    expect(result.blocks.reduce((total, block) => total + block.text.length, 0)).toBe(MAX_PAGE_CHARACTERS);
    expect(result.truncated).toBe(true); expect(result.reasons).toContain('character-limit');
    expect(result.blocks.at(-1)!.layoutSafe).toBe(false); expect(result.blocks.at(-1)!.translatable).toBe(false);
  });

  it('普通长正文在三千字之前分块；单个异常超长字形片段保留全文但不交给模型', () => {
    const source = [item('a'.repeat(1500), 40, 700, 300), item('b'.repeat(1500), 40, 684, 300), item('c'.repeat(3001), 40, 650, 300)];
    const result = buildPdfLayout(source, styles, viewport);
    expect(result.blocks.map(block => block.text)).toEqual(source.map(entry => entry.str));
    expect(result.blocks.filter(block => block.translatable).every(block => block.text.length <= MAX_LAYOUT_TEXT_CHARACTERS)).toBe(true);
    expect(result.blocks.map(block => block.translatable)).toEqual([true, true, false]);
    expect(result.blocks[2]!.reasons).toContain('long-text'); expect(result.truncated).toBe(false);
  });
});
