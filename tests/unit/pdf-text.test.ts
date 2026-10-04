import { describe, expect, it } from 'vitest';
import { MAX_PAGE_PARAGRAPHS, pdfBatches, pdfParagraphs, type PdfTextItem } from '../../src/pdf/text';
const item = (str: string, x: number, y: number, width = str.length * 6, size = 12, end = false): PdfTextItem => ({ str, width, height: size, transform: [size, 0, 0, size, x, y], hasEOL: end });

describe('PDF 逐段提取', () => {
  it('同一段的多个字形片段和换行合并为一条，段间留白产生独立段落', () => {
    const result = pdfParagraphs([item('Reading', 40, 700, 42), item('across languages', 86, 700, 90, 12, true), item('should feel natural.', 40, 684, 120, 12, true), item('Another idea starts here.', 40, 650, 144, 12, true)]);
    expect(result).toEqual({ paragraphs: ['Reading across languages should feel natural.', 'Another idea starts here.'], truncated: false });
  });
  it('同一基线上的分栏文字与独立标题不拼成一个翻译请求', () => {
    const result = pdfParagraphs([item('First column', 40, 700, 70, 12, true), item('Second column', 310, 700, 75, 12, true), item('A heading', 40, 650, 100, 22, true), item('Body begins below.', 40, 630, 110, 12, true)]);
    expect(result.paragraphs).toEqual(['First column', 'Second column', 'A heading', 'Body begins below.']);
  });
  it('纯图像页返回空文本，损坏的坐标项被跳过而不会显示乱码', () => {
    expect(pdfParagraphs([{ type: 'beginMarkedContent' }, item('broken', NaN, 20), { str: 'broken', transform: [] }])).toEqual({ paragraphs: [], truncated: false });
  });
  it('极长单段按请求上限切分而不丢字，病态页面最多显示 200 段并给出截断标志', () => {
    const long = pdfParagraphs([item('a'.repeat(6500), 40, 700)]);
    expect(long.paragraphs.join('')).toHaveLength(6500);
    expect(long.paragraphs.every((text) => text.length <= 3000)).toBe(true);
    const many = pdfParagraphs(Array.from({ length: 250 }, (_, index) => item(`Line ${index}`, 40, 10000 - index * 50, 60, 12, true)));
    expect(many.paragraphs).toHaveLength(MAX_PAGE_PARAGRAPHS); expect(many.truncated).toBe(true);
  });
  it('页面段落分批发送时每批最多 8 段且总文字不超过 5,000 字符', () => {
    const texts = [...Array<string>(10).fill('Short paragraph.'), ...Array<string>(6).fill('x'.repeat(3000))];
    const batches = pdfBatches(texts);
    expect(batches.flat()).toEqual(texts.map((_, index) => index));
    expect(batches.every((batch) => batch.length <= 8 && batch.reduce((length, index) => length + texts[index]!.length, 0) <= 5000)).toBe(true);
  });
});
