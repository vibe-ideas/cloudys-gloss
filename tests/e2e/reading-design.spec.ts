import { test, expect } from './fixtures';

test('深色导航显示紧凑双语，浅深正文译文紧随原文且不受网页样式污染，不重复展示原样结果且窄屏和恢复正常', async ({ extension }, testInfo) => {
  const { page, server, toggle } = extension;
  await page.goto(`${server.url}/reading-design`);
  const original = await page.locator('main').innerHTML();
  const navBefore = await page.locator('nav').boundingBox();
  const navMarkup = await page.locator('nav').innerHTML();
  await toggle();
  await expect(page.locator('h1 > [data-state="done"]')).toContainText('给思考留一点空间');
  await expect(page.locator('#dark-copy > [data-state="done"]')).toContainText('无论明暗');
  await expect(page.locator('nav a > [data-state=done]')).toHaveCount(6);
  await expect(page.getByRole('link', { name: 'Store', exact: true })).toHaveAttribute('href', '#');
  const navAfter = (await page.locator('nav').boundingBox())!;
  expect(navAfter).toMatchObject({ x: navBefore!.x, y: navBefore!.y });
  expect(navAfter.height).toBeGreaterThanOrEqual(navBefore!.height);
  expect(navAfter.width).toBe(await page.evaluate(() => document.documentElement.clientWidth));
  expect(server.calls.flatMap((call) => call.texts ?? [])).toContain('Store');
  await expect(page.locator('#linked-copy > [data-state="done"]')).toContainText('原文链接');
  await expect(page.locator('#linked-copy > a')).toHaveAttribute('href', '#original');
  await expect(page.locator('figcaption > [data-state="done"]')).toContainText('细小的文字');
  for (const selector of ['#light-copy', '#dark-copy', 'h1', 'figcaption']) {
    const appearance = await page.locator(selector).evaluate((source) => {
      const node = source.querySelector<HTMLElement>('[data-state="done"]')!;
      const style = getComputedStyle(node); const original = getComputedStyle(source);
      const text = getComputedStyle(node.querySelector('[data-gloss-part="text"]')!);
      return { color: style.color, sourceColor: original.color, textColor: text.color, opacity: style.opacity,
        border: style.borderLeftWidth, padding: style.paddingLeft, spacing: text.letterSpacing,
        fontSize: parseFloat(style.fontSize), sourceSize: parseFloat(original.fontSize) };
    });
    expect(appearance.color).toBe(appearance.sourceColor);
    expect(appearance.textColor).toBe(appearance.sourceColor);
    expect(appearance).toMatchObject({ opacity: '1', border: '0px', padding: '0px', spacing: 'normal' });
    expect(appearance.fontSize).toBeLessThanOrEqual(appearance.sourceSize);
  }
  await page.locator('#unchanged').scrollIntoViewIfNeeded();
  await expect(page.locator('#unchanged > [data-state="done"]')).toHaveCSS('display', 'none');
  await expect(page.locator('#actions a > [data-state=done]')).toHaveCount(2);
  expect(server.calls.flatMap((call) => call.texts ?? [])).not.toContain('Learn more Buy');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ animations: 'disabled', fullPage: true, path: testInfo.outputPath('bilingual-mixed.png') });
  await page.locator('body').evaluate((body) => body.classList.add('night'));
  const darkColors = await page.locator('#light-copy').evaluate((source) => [getComputedStyle(source).color, getComputedStyle(source.querySelector('[data-state="done"]')!).color]);
  expect(darkColors[1]).toBe(darkColors[0]);
  await page.screenshot({ animations: 'disabled', fullPage: true, path: testInfo.outputPath('bilingual-dark.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ animations: 'disabled', fullPage: true, path: testInfo.outputPath('bilingual-mobile.png') });
  await toggle();
  await expect(page.locator('main')).toHaveJSProperty('innerHTML', original);
  await expect(page.locator('nav')).toHaveJSProperty('innerHTML', navMarkup);
});
