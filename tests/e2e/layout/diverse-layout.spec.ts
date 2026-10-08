import type { Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { test, expect } from '../support/fixtures';

const translation = '[data-cloudys-gloss="translation"][data-state="done"]';

/** Report the actual offending boxes rather than reducing failures to a boolean. */
async function layoutViolations(page: Page, containers: string, following?: string) {
  return page.evaluate(({ containers, following, translation }) => {
    const violations: string[] = [];
    const boxes = [...document.querySelectorAll(containers)].map((element) => ({ element, rect: element.getBoundingClientRect() }));
    for (const { element, rect } of boxes) {
      for (const node of element.querySelectorAll(translation)) {
        const translated = node.getBoundingClientRect();
        if (translated.bottom > rect.bottom + 1 || translated.right > rect.right + 1 || translated.left < rect.left - 1) {
          violations.push(`${element.id || element.tagName}: translation outside container (translation bottom ${translated.bottom.toFixed(1)}, container bottom ${rect.bottom.toFixed(1)})`);
        }
      }
      for (const other of boxes) {
        if (element === other.element) continue;
        const overlapX = Math.min(rect.right, other.rect.right) - Math.max(rect.left, other.rect.left);
        const overlapY = Math.min(rect.bottom, other.rect.bottom) - Math.max(rect.top, other.rect.top);
        if (overlapX > 1 && overlapY > 1) violations.push(`${element.id || element.tagName} overlaps ${other.element.id || other.element.tagName} by ${overlapY.toFixed(1)}px`);
      }
    }
    if (following) {
      const next = document.querySelector(following)!.getBoundingClientRect();
      const bottom = Math.max(...boxes.map(({ rect }) => rect.bottom));
      if (bottom > next.top + 1) violations.push(`last container bottom ${bottom.toFixed(1)} covers following content at ${next.top.toFixed(1)}`);
    }
    return violations;
  }, { containers, following, translation });
}

test('文档阅读：长译文撑开表格行，侧栏、代码和链接保持可用，窄屏与关闭翻译后布局完整', async ({ extension }, testInfo) => {
  const { page, server, toggle } = extension;
  await page.goto(`${server.url}/diverse-layout`);
  const original = await page.locator('#diverse-main').innerHTML();
  const navigation = await page.locator('.docs-nav').innerHTML();
  const command = await page.locator('#docs-command').innerHTML();
  await toggle();
  await expect(page.locator(`#docs-intro > ${translation}`)).toContainText('修改生产环境之前');
  await page.locator('#deployment-table').scrollIntoViewIfNeeded();
  await expect(page.locator(`#deployment-table ${translation}`)).toHaveCount(6);
  await expect.poll(() => layoutViolations(page, '#deployment-table tr')).toEqual([]);
  await expect(page.locator('.docs-nav a > [data-state=done]')).toHaveCount(3);
  await expect(page.locator('#docs-command')).toHaveJSProperty('innerHTML', command);
  await expect(page.locator('#docs-link > a')).toHaveAttribute('href', '#deployment-table');
  expect(server.calls.flatMap((call) => call.texts ?? [])).not.toContain('deploy --check --environment=production');
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('documentation-table-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#deployment-table').scrollIntoViewIfNeeded();
  await expect.poll(() => layoutViolations(page, '#deployment-table tr')).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('documentation-table-mobile.png') });
  await toggle();
  await expect(page.locator('#diverse-main')).toHaveJSProperty('innerHTML', original);
  await expect(page.locator('.docs-nav')).toHaveJSProperty('innerHTML', navigation);
});

test('资讯网格：固定行高卡片接收长中文标题后不裁切或互相覆盖，手机单列与恢复原文正常', async ({ extension }, testInfo) => {
  const { page, server, toggle } = extension;
  await page.goto(`${server.url}/diverse-layout`);
  const original = await page.locator('#news-layout').innerHTML();
  await page.locator('#news-layout').scrollIntoViewIfNeeded();
  await toggle();
  for (let index = 1; index <= 4; index++) {
    await page.locator(`#news-card-${index}`).scrollIntoViewIfNeeded();
    await expect(page.locator(`#news-card-${index} ${translation}`)).toHaveCount(2);
  }
  await page.screenshot({ animations: 'disabled', fullPage: true, path: testInfo.outputPath('news-grid-desktop.png') });
  await expect.poll(() => layoutViolations(page, '.news-card', '#news-after')).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#news-card-2').scrollIntoViewIfNeeded();
  await expect.poll(() => layoutViolations(page, '.news-card', '#news-after')).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ animations: 'disabled', fullPage: true, path: testInfo.outputPath('news-grid-mobile.png') });
  await toggle();
  await expect(page.locator('#news-layout')).toHaveJSProperty('innerHTML', original);
});

test('长文阅读：图注引用与正文链接保持顺序，折叠展开和 SPA 新段落增量翻译且双语操作控件正常', async ({ extension }, testInfo) => {
  const { page, server, toggle } = extension;
  await page.goto(`${server.url}/diverse-layout`);
  const original = await page.locator('#essay-layout').innerHTML();
  await page.locator('#essay-layout').scrollIntoViewIfNeeded();
  await toggle();
  for (const selector of ['#essay-intro', '#essay-caption', '#essay-quote', '#essay-link']) {
    await page.locator(selector).scrollIntoViewIfNeeded();
    await expect(page.locator(`${selector} > ${translation}`)).toHaveCount(1);
  }
  await expect.poll(() => layoutViolations(page, '#essay-intro,#essay-layout figure,#essay-quote,#essay-link')).toEqual([]);
  await expect(page.locator('#essay-link > a')).toHaveAttribute('href', '#essay-intro');
  await expect(page.locator('.essay-tools [data-state=done]')).toHaveCount(2);
  await page.locator('#essay-details > summary').click();
  await expect(page.locator(`#expanded-note > ${translation}`)).toContainText('展开后的补充说明');
  const introductoryRequests = server.calls.flatMap((call) => call.texts ?? []).filter((text) => text === 'The morning light changes the way we see familiar places.').length;
  await page.locator('#load-more').click();
  await expect(page.locator(`#spa-paragraph > ${translation}`)).toContainText('新加载的段落');
  await expect(page).toHaveURL(/#next-paragraph$/);
  expect(server.calls.flatMap((call) => call.texts ?? []).filter((text) => text === 'The morning light changes the way we see familiar places.')).toHaveLength(introductoryRequests);
  await page.locator('#save-note').click();
  await expect(page.locator('#save-note')).toHaveAttribute('aria-pressed', 'true');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => layoutViolations(page, '#essay-intro,#essay-layout figure,#essay-quote,#essay-link,#essay-details,#dynamic-copy')).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ animations: 'disabled', fullPage: true, path: testInfo.outputPath('article-expanded-mobile.png') });
  await toggle();
  await expect(page.locator('#essay-layout [data-cloudys-gloss]')).toHaveCount(0);
  await expect(page.locator('#spa-paragraph')).toHaveText('A newly loaded paragraph continues the story without replacing the earlier text.');
  await expect(page.locator('#save-note')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#spa-paragraph').evaluate((node) => node.remove());
  await page.locator('#essay-details').evaluate((node) => node.removeAttribute('open'));
  await page.locator('#save-note').evaluate((node) => node.removeAttribute('aria-pressed'));
  await expect(page.locator('#essay-layout')).toHaveJSProperty('innerHTML', original);
});

for (const position of ['fixed', 'absolute']) {
  test(`${position === 'fixed' ? '固定' : '绝对'}定位阅读面板：正文与吸顶标题可翻译，长内容在原高度内滚动且关闭后还原`, async ({ extension }, testInfo) => {
    const { page, server, toggle } = extension;
    await page.goto(`${server.url}/diverse-layout`);
    await page.locator(`#open-${position}-reader`).click();
    const shell = page.locator('#reader-shell');
    const original = await shell.innerHTML();
    const before = (await shell.boundingBox())!;
    await shell.evaluate((shell) => {
      const events: unknown[] = [];
      const record = (kind: string, detail?: unknown) => {
        if (events.length >= 240) return;
        events.push({ kind, detail, time: performance.now(), scrollTop: shell.scrollTop, scrollHeight: shell.scrollHeight,
          shell: shell.getBoundingClientRect().toJSON(),
          notes: [...shell.querySelectorAll('p')].map((node) => ({ id: node.id, rect: node.getBoundingClientRect().toJSON(), state: node.querySelector('[data-cloudys-gloss]')?.getAttribute('data-state') ?? 'untracked' })) });
      };
      (window as unknown as { readerDiagnostics: unknown[] }).readerDiagnostics = events;
      for (const [kind, rootMargin] of [['near', '500px 0px'], ['visible', '0px']]) {
        const observer = new IntersectionObserver((entries) => record(kind!, entries.map((entry) => ({ id: entry.target.id, intersects: entry.isIntersecting, ratio: entry.intersectionRatio, intersection: entry.intersectionRect.toJSON() }))), { rootMargin });
        for (const note of shell.querySelectorAll('p')) observer.observe(note);
      }
      shell.addEventListener('scroll', () => record('scroll'));
      new MutationObserver(() => record('mutation')).observe(shell, { childList: true, subtree: true, characterData: true });
      record('before-toggle');
    });
    await toggle();
    await expect(page.locator(`#reader-heading > ${translation}`)).toContainText('有限的阅读面板');
    await expect(page.locator(`#reader-note-1 > ${translation}`)).toContainText('面板笔记1');
    await expect(shell).toHaveCSS('position', position);
    await expect(shell).toHaveCSS('overflow-y', 'auto');
    await expect.poll(async () => (await shell.boundingBox())!.height).toBe(before.height);
    await page.locator('#reader-note-8').scrollIntoViewIfNeeded();
    try {
      await expect(page.locator(`#reader-note-8 > ${translation}`)).toContainText('面板笔记8');
    } finally {
      const diagnosticsPath = testInfo.outputPath('reader-viewport-diagnostics.json');
      await writeFile(diagnosticsPath, JSON.stringify({
        events: await page.evaluate(() => (window as unknown as { readerDiagnostics: unknown[] }).readerDiagnostics),
        calls: server.calls, finishedStreams: server.finishedStreams, abortedStreams: server.abortedStreams,
      }, null, 2));
      await testInfo.attach('reader-viewport-diagnostics', { contentType: 'application/json', path: diagnosticsPath });
      await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`${position}-reader-after-scroll.png`) });
    }
    expect(await shell.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    await expect(page.locator('#reader-heading')).toHaveCSS('position', 'sticky');
    const heading = (await page.locator('#reader-heading').boundingBox())!;
    const after = (await shell.boundingBox())!;
    expect(after.height).toBe(before.height);
    expect(heading.y).toBeGreaterThanOrEqual(after.y);
    expect(heading.y + heading.height).toBeLessThanOrEqual(after.y + after.height);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(async () => (await shell.boundingBox())!.height).toBe(before.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(await shell.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`${position}-reader-mobile.png`) });
    await toggle();
    await expect(shell).toHaveJSProperty('innerHTML', original);
    await shell.evaluate((node) => { node.scrollTop = 0; });
    await page.locator('#close-reader').click();
    await expect(shell).toBeHidden();
  });
}
