import { test, expect } from '../support/fixtures';

const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
*{box-sizing:border-box}body{margin:24px;font:16px/1.5 system-ui}a{color:#246}header{border-bottom:1px solid #aaa}nav{display:flex;flex-flow:row nowrap;gap:20px;height:40px;align-items:center}nav a{display:inline-flex;align-items:center;gap:4px}.commit{display:flex;flex-flow:row nowrap;align-items:center;gap:12px;border:1px solid #aaa;padding:8px;font:14px/21px system-ui;margin-top:16px;min-width:0}.authors{display:flex;flex-flow:row nowrap;align-items:center;gap:8px}.author{display:flex;align-items:center;gap:4px}.message{display:flex;flex-flow:row nowrap;align-items:center;gap:8px;min-width:0;flex:1}.truncate{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.details{display:flex;flex-flow:row nowrap;align-items:center;gap:6px;font-size:12px;flex-shrink:0}.message button{width:24px;height:24px}.reading{max-width:720px}p{margin:18px 0}.reading .row{display:flex;white-space:nowrap}
</style></head><body><header id="chrome"><nav><a id="code" href="#code"><svg width="16" height="16"></svg><span>Code</span></a><a id="issues" href="#issues"><span>Issues</span><span>762</span></a><a href="#actions">Actions</a></nav></header>
<div class="commit" id="commit"><div class="authors"><div class="author" id="author"><a href="#author">Sample Author</a></div><div id="joiner">and</div><div class="author"><a href="#coauthor">Other Reader</a></div></div><div class="message" id="message"><span class="truncate"><a href="#commit">Improve background translation performance</a></span><button aria-label="Open commit details">…</button></div><div class="details"><a href="#hash">0757bee</a><span>yesterday</span></div></div>
<main class="reading"><h1>Read without changing the page.</h1><p id="prose">The article keeps every original paragraph and shows a Chinese translation below it.</p><p class="row" id="reading-row">Text in a horizontal container.</p></main></body></html>`;

test('翻译不换行的导航和提交信息时保持原高度及排列，译文可悬停或键盘查看，正文仍显示双语', async ({ extension }, testInfo) => {
  const { page, server, toggle } = extension;
  for (const width of [1200, 700]) {
    await page.setViewportSize({ width, height: 900 });
    await page.route(`${server.url}/compact-rows`, route => route.fulfill({ contentType: 'text/html', body: html }));
    await page.goto(`${server.url}/compact-rows`);
    const original = await page.locator('header,.commit,main').evaluateAll(nodes => nodes.map(node => node.outerHTML));
    const before = await page.locator('#chrome,#commit,#author,#joiner,#message').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().toJSON()));
    await toggle();
    await expect(page.locator('#joiner > [data-state="done"]')).toHaveText('中文译文：and');
    await expect(page.locator('#message > [data-state="done"]')).toHaveCount(1);
    await expect(page.locator('#prose > [data-state="done"]')).toBeVisible();
    await expect(page.locator('#reading-row > [data-state="done"]')).toBeVisible();
    const after = await page.locator('#chrome,#commit,#author,#joiner,#message').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().toJSON()));
    after.forEach((box, index) => { expect(box.height).toBeCloseTo(before[index]!.height, 0); expect(box.x).toBeCloseTo(before[index]!.x, 0); });
    await expect(page.locator('#joiner > [data-gloss-mode="hint"]')).toBeHidden();
    await page.mouse.move(10, 10);
    await page.locator('#joiner').focus();
    const hint = page.locator('[data-cloudys-gloss="component-hint"]');
    await expect(hint.locator('.tip')).toContainText('中文译文：and');
    await page.keyboard.press('Escape');
    await page.locator('#author a').hover();
    await expect(hint.locator('.tip')).toContainText('Sample Author');
    await expect(page.locator('#author')).not.toHaveAttribute('tabindex');
    await page.screenshot({ path: testInfo.outputPath(`compact-rows-${width}.png`), fullPage: true });
    await toggle();
    expect(await page.locator('header,.commit,main').evaluateAll(nodes => nodes.map(node => node.outerHTML))).toEqual(original);
  }
});
