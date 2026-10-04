import { beforeEach, describe, expect, it, vi } from 'vitest';
import { blockText, excludedElement, renderedSemanticText, semanticBlocks, semanticText, splitText } from '../../src/blocks';
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
  it.each(['nav', 'div role="navigation"', 'div role="menu"', 'div role="menubar"', 'div role="toolbar"'])('全文扫描遇到 %s 导航区域时不为菜单文字创建翻译请求', (tag) => {
    const name = tag.split(' ')[0];
    document.body.innerHTML = `<${tag}><ul><li>Store</li><li>Accessories</li></ul></${name}><p>Read the full story.</p>`;
    expect(semanticBlocks(document.body).map(semanticText)).toEqual(['Read the full story.']);
    const item = document.querySelector('li')!;
    expect(semanticBlocks(item)).toEqual([]);
    expect(semanticText(item)).toBe('');
  });
  it('文章页眉标题、正文链接、普通列表和页脚说明仍参与全文翻译', () => {
    document.body.innerHTML = '<article><header><h1>A brighter future</h1></header><p>Read our <a href="/story">full story</a>.</p><ul><li>First lesson</li><li>Second lesson</li></ul><footer><p>Written by the editorial team.</p></footer></article>';
    expect(semanticBlocks(document.body).map(semanticText)).toEqual(['A brighter future', 'Read our full story.', 'First lesson', 'Second lesson', 'Written by the editorial team.']);
  });
  it('正文容器内嵌导航时只提取正文，不把导航标签串入父级译文', () => {
    document.body.innerHTML = '<div>Article introduction. <nav><a>Store</a><span>Accessories</span></nav><span role="menu"><a>Account</a></span> More context.</div>';
    const container = document.body.firstElementChild!;
    expect(semanticBlocks(document.body).map(semanticText)).toEqual(['Article introduction. More context.']);
    expect(blockText(container, false)).toBe('Article introduction. More context.');
  });
  it('用户主动划选导航单词时仍允许显示词卡并提取选区上下文', () => {
    document.body.innerHTML = '<nav><ul><li><a>Accessories</a></li></ul></nav>';
    const link = document.querySelector('a')!;
    expect(excludedElement(link)).toBe(false);
    expect(blockText(link.closest('li')!)).toBe('Accessories');
  });
  it.each(['div', 'section'])('全文翻译遇到只含多个操作链接的 %s 时不在链接组后追加译文', (tag) => {
    document.body.innerHTML = `<${tag}>\n <a href="/learn">Learn more</a>\n <a href="/buy"><span>Buy</span></a> <!-- rendered controls --> <span data-cloudys-gloss>加载中</span></${tag}><p>Discover the next chapter.</p>`;
    expect(semanticBlocks(document.body).map(semanticText)).toEqual(['Discover the next chapter.']);
    expect(semanticText(document.body.firstElementChild!)).toBe('');
    expect(blockText(document.querySelector('a')!)).toBe('Learn more');
  });
  it('单个正文链接、含多个链接的正文和普通链接列表仍参与全文翻译', () => {
    document.body.innerHTML = '<div><a href="/story">The full story</a></div><section>Compare <a href="/first">first</a> with <a href="/second">second</a>.</section><div><a href="/first">First</a> <span>and</span> <a href="/second">second</a></div><ul><li><a href="/one">First chapter</a></li><li><a href="/two">Second chapter</a></li></ul>';
    expect(semanticBlocks(document.body).map(semanticText)).toEqual(['The full story', 'Compare first with second.', 'First and second', 'First chapter', 'Second chapter']);
  });
  it('链接按钮与嵌套切换标签保持原样，普通正文链接仍可翻译且控件可划词', () => {
    document.body.innerHTML = '<div><a class="cta" href="/buy"><span>Buy</span></a></div><div role="tablist"><div role="tab"><span>Camera</span></div></div><a role="button"><div>Watch the film</div></a><div><a aria-controls="gallery">Colors</a></div><p>Read the <a href="/story">full story</a>.</p>';
    expect(semanticBlocks(document.body).map(semanticText)).toEqual(['Read the full story.']);
    expect(blockText(document.querySelector('.cta')!)).toBe('Buy');
  });
  it('折叠入口标签不被汇总成文章末尾译文，展开正文仍单独翻译', () => {
    document.body.innerHTML = '<article><details open><summary>Read more</summary><p>The full background story.</p></details></article>';
    expect(semanticBlocks(document.body).map(semanticText)).toEqual(['The full background story.']);
    expect(blockText(document.querySelector('summary')!)).toBe('Read more');
  });
  it('搜索控件与表单标签不被抽成父容器译文，正文内的普通链接仍保留', () => {
    document.body.innerHTML = '<div role="search"><a href="/search"><span>Search</span></a><input type="search"></div><div><label for="email"><span>Email address</span></label><input id="email"></div><p>Read the <a href="/guide">search guide</a>.</p>';
    expect(semanticBlocks(document.body).map(semanticText)).toEqual(['Read the search guide.']);
  });
  it.each(['display:none', 'visibility:hidden', 'opacity:0', 'content-visibility:hidden'])('初扫遇到行内 %s 隐藏文本时不混入父级，不读取全页计算样式', (style) => {
    document.body.innerHTML = `<div>Visible introduction. <span style="${style}"><a href="/donate">More ways to donate</a></span> Read on.</div>`;
    const computed = vi.spyOn(window, 'getComputedStyle');
    expect(semanticBlocks(document.body).map(semanticText)).toEqual(['Visible introduction. Read on.']);
    expect(computed).not.toHaveBeenCalled();
    computed.mockRestore();
  });
  it('附近正文经样式表隐藏的辅助文字不会送译，但显示中的链接和强调文字完整保留', () => {
    document.body.innerHTML = '<style>.concealed-copy{display:none}.silent-copy{visibility:hidden}.transparent-copy{opacity:0}.clipped-copy{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0px,0px,0px,0px)}</style><p id="copy">Read <span class="concealed-copy">More ways to donate</span><span class="silent-copy">Hidden label</span><span class="transparent-copy">Invisible label</span><span class="clipped-copy">Screen reader hint</span>the <a href="/guide">complete guide</a> <strong>today</strong>.</p>';
    expect(renderedSemanticText(document.querySelector('#copy')!)).toBe('Read the complete guide today.');
  });
  it('整个语义块位于样式表隐藏的祖先中时不生成附近译文', () => {
    document.body.innerHTML = '<style>.concealed{display:none}</style><section class="concealed"><p>Hidden donor message.</p></section>';
    expect(renderedSemanticText(document.querySelector('p')!)).toBe('');
  });
  it('旧式表格的导航工具条及同一行登录入口保持原样，其他行的单链接和短标题仍翻译', () => {
    document.body.innerHTML = '<table><tbody><tr><td><span><b><a href="/">Community News</a></b> | <a href="/new">new</a> | <a href="/ask">ask</a> | <a href="/jobs">jobs</a></span></td><td id="toolbar-login"><a href="/login">login</a></td></tr><tr><td>Read <a href="/one">the first report</a>, compare <a href="/two">the second report</a>, then see <a href="/three">the discussion</a>.</td></tr><tr><td><a href="/login">login</a></td><td><a href="/story">Short story</a></td></tr></tbody></table>';
    expect(semanticBlocks(document.body).map(semanticText)).toEqual(['Read the first report, compare the second report, then see the discussion.', 'login', 'Short story']);
    expect(renderedSemanticText(document.querySelector('#toolbar-login')!)).toBe('');
    expect(blockText(document.querySelector('#toolbar-login')!)).toBe('login');
  });
  it('表格内较长的文章链接即使用竖线分隔也保留为阅读内容', () => {
    const title = 'Researchers explain how everyday observations improve city planning';
    document.body.innerHTML = `<table><tbody><tr><td><span><a href="/one">${title}</a> | <a href="/two">Another detailed report</a> | <a href="/three">A third report</a></span></td></tr></tbody></table>`;
    expect(semanticBlocks(document.body).map(semanticText)).toEqual([`${title} | Another detailed report | A third report`]);
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
