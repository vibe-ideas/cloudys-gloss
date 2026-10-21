import { test, expect } from '../support/fixtures';
import { xArticleFixture } from './x-article-fixture';

test('X 长文章直接显示标题、正文和引用帖译文，滚动续译，后续评论不重叠且关闭后恢复', async ({ extension }, testInfo) => {
  const { page, context, options, server } = extension;
  const url = 'https://x.com/poteto/status/2097732320606507506';
  await context.route('https://x.com/**', route => route.fulfill({ contentType: 'text/html', body: xArticleFixture }));
  await page.goto(url);
  await expect(page.locator('[data-cloudys-gloss="floating-control"]')).toHaveCount(1);
  const original = await page.locator('#article-cell').innerHTML();
  const cellStyle = await page.locator('#article-cell').getAttribute('style');
  for (const [selector, translation] of [
    ['#title', 'pstack 完整指南：第二部分'],
    ['#intro', '上一篇文章介绍了验证为什么是使用智能体的基础，以及如何创建自己的验证技能。'],
    ['#lesson', '关键在于：智能体必须能验证自己的工作。阅读下一章了解更多。'],
    ['#quote', '我正在编写 pstack 指南！这是第一部分。'],
  ]) server.setTranslation((await page.locator(selector!).textContent())!, translation!);
  await options.toggle(url);
  for (const selector of ['#title', '#intro', '#lesson', '#quote']) {
    const translated = page.locator(`${selector} > [data-state="done"]`);
    await expect(translated).toBeVisible();
    await expect(translated).toContainText(/[\u4e00-\u9fff]/);
    await expect(translated).not.toHaveAttribute('data-gloss-mode', 'hint');
  }
  await expect(page.locator('#overlay-one > [data-state=done]')).toBeHidden();
  await expect(page.locator('#overlay-one > [data-state=done]')).toHaveAttribute('data-gloss-mode', 'hint');
  for (const width of [1100, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect.poll(() => page.evaluate(() => {
      const cell = document.querySelector('#article-cell')!.getBoundingClientRect();
      const next = document.querySelector('#next')!.getBoundingClientRect();
      const blocks = [...document.querySelectorAll('#title,#intro,#lesson,#quote')];
      return blocks.every(block => {
        const translation = block.querySelector('[data-state=done]')!.getBoundingClientRect();
        const range = document.createRange(); range.selectNode(block.firstChild!);
        return translation.top >= range.getBoundingClientRect().bottom - 1 && translation.bottom <= block.getBoundingClientRect().bottom + 1;
      }) && cell.bottom <= next.top + 1 && document.documentElement.scrollWidth <= document.documentElement.clientWidth;
    })).toBe(true);
    // Playwright's default caret hiding writes style="" to contenteditable=false
    // too; preserve the DOM so the exact restoration assertion tests our code.
    await page.screenshot({ caret: 'initial', path: testInfo.outputPath(`x-article-${width}.png`) });
  }
  // New blocks arrive after the first paint, as in client-side article loading.
  await page.locator('#late').evaluate(node => { node.innerHTML = '<div data-block="true"><div id="continuation">The rest of the article arrives after navigation.</div></div>'; });
  await page.locator('#continuation').scrollIntoViewIfNeeded();
  await expect(page.locator('#continuation > [data-state=done]')).toBeVisible();
  expect(server.calls.flatMap(call => call.texts ?? []).filter(text => text.startsWith('In my last post'))).toHaveLength(1);
  await page.locator('#late').evaluate(node => node.replaceChildren());
  await options.toggle(url);
  await expect(page.locator('#article-cell')).toHaveJSProperty('innerHTML', original);
  expect(await page.locator('#article-cell').getAttribute('style')).toBe(cellStyle);
});
