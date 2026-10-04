import { beforeEach, describe, expect, it } from 'vitest';
import { blockText, semanticBlocks, splitText } from '../../src/blocks';
describe('全文翻译语义块提取', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  it('段落含强调与链接时合并成一个请求单元并保留完整语义', () => {
    document.body.innerHTML = '<article><p>Hello <strong>beautiful</strong> <a>world</a>.</p></article>';
    const blocks = semanticBlocks(document.body);
    expect(blocks).toHaveLength(1); expect(blockText(blocks[0]!)).toBe('Hello beautiful world.');
  });
  it('代码、输入框、可编辑区域和已有译文不会再次送给模型', () => {
    document.body.innerHTML = '<pre><p>secret code</p></pre><div contenteditable>private input</div><p>Hello<span data-cloudys-gloss>你好</span></p>';
    const blocks = semanticBlocks(document.body);
    expect(blocks.map((element) => blockText(element))).toEqual(['Hello']);
  });
  it('超长段落按长度分段且不会丢失文本', () => {
    const text = 'a'.repeat(13000); const chunks = splitText(text);
    expect(chunks.map((part) => part.length)).toEqual([6000, 6000, 1000]);
    expect(chunks.join('')).toBe(text);
  });
  it('多句段落超过请求长度时在句末分段，不拆开下一句的操作条件', () => {
    const first = 'The door is closed.';
    const condition = 'Keep it closed until the alarm stops.';
    expect(splitText(`${first} ${condition}`, 42)).toEqual([first, condition]);
  });
  it('多句段落含小数和带引号的问句时保留完整句子与标点', () => {
    const first = 'The price is 8.75 dollars.';
    const second = 'She asked, "Is it ready?"';
    const third = 'We waited outside.';
    const chunks = splitText(`${first} ${second} ${third}`, 40);
    expect(chunks).toEqual([first, second, third]);
    expect(chunks.every((part) => part.length <= 40)).toBe(true);
  });
  it('单句本身超过请求长度时按空格继续分段，完整保留条件和正文', () => {
    const text = 'Keep the painted wooden door closed until the maintenance engineer confirms the alarm has stopped.';
    const chunks = splitText(text, 35);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((part) => part.length <= 35)).toBe(true);
    expect(chunks.join(' ')).toBe(text);
  });
  it('相邻短句能放入同一请求时合并发送，避免每句话各自请求', () => {
    expect(splitText('One sentence. Next sentence. Last sentence.', 29)).toEqual(['One sentence. Next sentence.', 'Last sentence.']);
  });
  it('嵌套列表和混合容器中父级文字不会遗漏，也不重复包含子段落', () => {
    document.body.innerHTML = '<div>Opening text<p>Nested paragraph</p></div><ul><li>Parent item<ul><li>Child item</li></ul></li></ul>';
    expect(semanticBlocks(document.body).map((element) => blockText(element, false))).toEqual(['Opening text', 'Nested paragraph', 'Parent item', 'Child item']);
  });
});
