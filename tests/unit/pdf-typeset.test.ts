import { describe, expect, it } from 'vitest';
import { fitPdfText, retainsPdfNumbers } from '../../src/pdf/typeset';
const measure = (text: string, size: number) => [...text].length * size;
const box = { x: 20, y: 30, width: 100, height: 28 };

describe('PDF 译文在原文区域内排版', () => {
  it('正常中文保留原字号并换行，排版只使用页面坐标而不依赖浏览器尺寸', () => {
    const result = fitPdfText('原文与译文按页面位置对应，保持阅读顺序。', box, 10, measure);
    expect(result.overflow).toBe(false); expect(result.fontSize).toBe(10);
    expect(result.lines.join('')).toBe('原文与译文按页面位置对应，保持阅读顺序。');
    expect(result.lines.length * result.lineHeight).toBeLessThanOrEqual(box.height);
    expect(result.lines.every(line => measure(line, result.fontSize) <= box.width)).toBe(true);
  });
  it('三倍长译文不能挤入相邻段落，字号最低保留80%并明确需要展开全文', () => {
    const text = '这段较长的译文需要在详情中完整阅读。'.repeat(3);
    const result = fitPdfText(text, box, 10, measure);
    expect(result.overflow).toBe(true); expect(result.fontSize).toBe(8);
    expect(result.lines.length * result.lineHeight).toBeLessThanOrEqual(box.height);
    expect(text.startsWith(result.lines.join(''))).toBe(true);
  });
  it('极窄单元格装不下一个中文字时保留原稿，不返回越界的替换文字', () => {
    expect(fitPdfText('标题', { ...box, width: 3 }, 10, measure)).toMatchObject({ lines: [], overflow: true });
  });
  it('中文句号与前一个字一起换行，不在下一行孤立出现', () => {
    const result = fitPdfText('你好。', { ...box, width: 20, height: 60 }, 10, measure);
    expect(result.lines).toEqual(['你', '好。']); expect(result.overflow).toBe(false);
  });
  it('英文长词按需拆行且组合字符不被拆开', () => {
    const text = 'aaaaaaaaaaaaaaaaaa';
    const result = fitPdfText(text, { ...box, height: 80 }, 10, measure);
    expect(result.lines.join('')).toBe(text); expect(result.overflow).toBe(false);
    expect(result.lines.every(line => line.length <= 10)).toBe(true);
    const accents = fitPdfText('e\u0301e\u0301e\u0301', { ...box, width: 20, height: 80 }, 10, measure);
    expect(accents.lines).toEqual(['e\u0301', 'e\u0301', 'e\u0301']);
  });
});
describe('PDF 译文中的数值核对', () => {
  it('金额、负号、百分比丢失或改变时不允许覆盖原文', () => {
    expect(retainsPdfNumbers('Budget 1,250.75, change -12.5%, items 3', '预算 1250.75，变化 -12.5%，共 3 项')).toBe(true);
    expect(retainsPdfNumbers('Budget 1,250.75', '预算 125.75')).toBe(false);
    expect(retainsPdfNumbers('Change -12.5%', '变化 12.5%')).toBe(false);
    expect(retainsPdfNumbers('3 plus 3', '共 3')).toBe(false);
  });
  it('日期顺序调整和英文月份改为数字，不误判已有数值丢失', () => {
    expect(retainsPdfNumbers('12 September 2026', '2026 年 9 月 12 日')).toBe(true);
  });
});
