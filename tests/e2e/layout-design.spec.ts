import { test, expect } from './fixtures';

test('复杂产品页翻译后按钮和标签双语可用，大标题清晰，固定高度卡片与后续内容不重叠，关闭恢复布局', async ({ extension }, testInfo) => {
  const { page, server, toggle } = extension;
  await page.goto(`${server.url}/layout-design`);
  const original = await page.locator('main').innerHTML();
  const controls = await page.locator('.actions').boundingBox();
  await toggle();
  await expect(page.locator('.headline > [data-state="done"]')).toContainText('每一个想法');
  await expect(page.locator('#card-two p > [data-state="done"]')).toContainText('清晰可读');
  await expect(page.locator('.actions [data-state=done],[role=tablist] [data-state=done]')).toHaveCount(4);
  expect((await page.locator('.actions').boundingBox())!.height).toBeGreaterThanOrEqual(controls!.height);
  await page.getByRole('tab', { name: 'Battery', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Battery', exact: true })).toHaveAttribute('aria-selected', 'true');
  const headline = page.locator('.headline > [data-state="done"]');
  await expect(headline).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(headline).toHaveCSS('font-size', '28px');
  for (const width of [1100, 390, 1100]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('.row').scrollIntoViewIfNeeded();
    await expect(page.locator('.row > [data-state="done"]')).toContainText('独占下一行');
    await expect.poll(async () => page.evaluate(() => {
      const cards = [...document.querySelectorAll('.card')];
      const contained = cards.every((card) => {
        const translation = card.querySelector('[data-state="done"]')!;
        const content = translation.getBoundingClientRect(); const bounds = card.getBoundingClientRect();
        return content.bottom <= bounds.bottom + 1 && card.scrollHeight <= card.clientHeight + 1;
      });
      const after = document.querySelector('.after')!.getBoundingClientRect();
      const below = cards.every(card => card.getBoundingClientRect().bottom <= after.top);
      const first = cards[0]!.getBoundingClientRect(); const second = cards[1]!.getBoundingClientRect();
      const separated = first.right <= second.left || first.bottom <= second.top;
      const row = document.querySelector('.row')!;
      const range = document.createRange(); range.selectNode(row.firstChild!);
      const rowSeparated = row.querySelector('[data-state="done"]')!.getBoundingClientRect().top >= range.getBoundingClientRect().bottom;
      return contained && below && separated && rowSeparated && document.documentElement.scrollWidth <= document.documentElement.clientWidth;
    })).toBe(true);
    await page.locator('.overlay-stage').scrollIntoViewIfNeeded();
    await expect(page.locator('.overlay-stage [data-gloss-mode=hint][data-state=done]')).toHaveCount(2);
    await expect(page.locator('.overlay-stage [data-gloss-mode=hint]').first()).toBeHidden();
    await page.screenshot({ fullPage: true, animations: 'disabled', path: testInfo.outputPath(`layout-${width}.png`) });
  }
  const requests = server.calls.flatMap(call => call.texts ?? []);
  expect(requests).toContain('Fixed overlay label.');
  expect(requests).toContain('Buy');
  // Restore the user interaction too, so the remaining DOM difference is ours.
  await page.getByRole('tab', { name: 'Camera', exact: true }).click();
  await toggle();
  await expect(page.locator('main')).toHaveJSProperty('innerHTML', original);
});

test('网页在翻译期间更新卡片高度后，译文仍完整，关闭翻译保留网页的新高度和颜色', async ({ extension }) => {
  const { page, server, toggle } = extension;
  await page.goto(`${server.url}/layout-design`);
  await toggle();
  const card = page.locator('#card-two');
  await expect(card.locator('p > [data-state="done"]')).toContainText('清晰可读');
  await expect.poll(() => card.evaluate(node => (node as HTMLElement).style.height)).toBe('auto');
  // The host changes the same property after the extension has grown it.
  // Another overflow pass must remember this newer host value for restoration.
  await card.evaluate(node => {
    (node as HTMLElement).style.setProperty('height', '90px', 'important');
    (node as HTMLElement).style.setProperty('min-height', '0px', 'important');
    (node as HTMLElement).style.setProperty('color', 'rgb(30, 50, 70)');
  });
  await expect.poll(() => card.evaluate(node => (node as HTMLElement).style.height)).toBe('auto');
  await expect.poll(() => card.evaluate(node => node.scrollHeight <= node.clientHeight + 1)).toBe(true);
  await toggle();
  await expect(card).toHaveCSS('height', '90px');
  await expect(card).toHaveCSS('min-height', '0px');
  await expect(card).toHaveCSS('color', 'rgb(30, 50, 70)');
  await expect(card.locator('[data-cloudys-gloss]')).toHaveCount(0);
});
