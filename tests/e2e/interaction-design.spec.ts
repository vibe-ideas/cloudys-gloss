import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

async function selectWord(page: Page) {
  const bounds = (await page.locator('#first strong').boundingBox())!;
  await page.mouse.move(bounds.x, bounds.y + bounds.height / 2); await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width, bounds.y + bounds.height / 2, { steps: 8 }); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe('cloudy');
  await page.getByRole('button', { name: '翻译所选内容', exact: true }).click();
}

test('窄屏文章划词后词卡不遮挡原词，卡内可滚动，文章滚动后关闭词卡', async ({ extension }, testInfo) => {
  const { page } = extension;
  await page.setViewportSize({ width: 390, height: 500 });
  await page.locator('h1').evaluate((element) => { element.style.fontSize = '24px'; element.style.margin = '100px 0 0'; });
  await selectWord(page);

  const card = page.getByRole('dialog', { name: 'AI 单词卡' });
  await expect(card.getByRole('button', { name: '美式发音' })).toBeVisible();
  const source = (await page.locator('#first strong').boundingBox())!;
  const bounds = (await card.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(12);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(378);
  expect(bounds.y).toBeGreaterThanOrEqual(12);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(488.5);
  expect(bounds.y >= source.y + source.height + 9 || bounds.y + bounds.height <= source.y - 9).toBe(true);
  await card.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(card).toBeVisible();
  expect(await card.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath('word-card-narrow-scroll.png') });
  await page.locator('#far').scrollIntoViewIfNeeded();
  await expect(card).toHaveCount(0);
});

test('文章窗口缩窄使原文重排后，已打开的词卡继续贴近当前选区并保持可见', async ({ extension }, testInfo) => {
  const { page } = extension;
  await page.locator('h1').evaluate((element) => { element.textContent = 'A little clarity for careful readers'; element.style.fontSize = '28px'; });
  await selectWord(page);

  const card = page.getByRole('dialog', { name: 'AI 单词卡' });
  await expect(card.getByRole('button', { name: '美式发音' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 500 });
  await expect.poll(async () => {
    const source = (await page.locator('#first strong').boundingBox())!;
    const bounds = await card.boundingBox();
    return !!bounds && bounds.x >= 12 && bounds.x + bounds.width <= 378 && bounds.y >= 12 && bounds.y + bounds.height <= 488.5 &&
      (Math.abs(bounds.y - source.y - source.height - 10) < 2 || Math.abs(bounds.y + bounds.height - source.y + 10) < 2);
  }).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('word-card-reflow.png') });
});

test('网页拦截指针事件时菜单仍能点外关闭，键盘关闭菜单后回到展开入口', async ({ extension }) => {
  const { page } = extension;
  const host = page.locator('[data-cloudys-gloss="floating-control"]');
  const more = host.getByRole('button', { name: '翻译快捷菜单' });
  await page.locator('main').evaluate((element) => { element.addEventListener('pointerdown', (event) => event.stopPropagation()); });
  await host.locator('.dock').hover(); await more.click();
  await expect(host.locator('.menu')).toBeVisible();
  await page.locator('h1').click(); await expect(host.locator('.menu')).toHaveCount(0);
  await host.locator('.dock').hover(); await more.click();
  await host.getByRole('button', { name: '模型设置', exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(host.locator('.menu')).toHaveCount(0); await expect(more).toBeFocused();
});

test('键盘选词后确认小按钮才进入词卡操作，Esc关闭词卡并恢复原阅读控件焦点', async ({ extension }) => {
  const { page } = extension;
  await page.locator('#first').evaluate((element) => {
    element.setAttribute('tabindex', '0'); (element as HTMLElement).focus();
    const range = document.createRange(); range.selectNodeContents(element.querySelector('strong')!);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  });
  await page.keyboard.press('Shift+ArrowRight');
  await expect(page.getByRole('button', { name: '翻译所选内容', exact: true })).toBeFocused();
  await expect(page.getByRole('dialog', { name: 'AI 单词卡' })).toHaveCount(0);
  await page.keyboard.press('Enter');
  const card = page.getByRole('dialog', { name: 'AI 单词卡' });
  await expect(card).toBeFocused();
  await page.keyboard.press('Tab'); await expect(card.getByRole('button', { name: '关闭词卡' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0); await expect(page.locator('#first')).toBeFocused();
});


test('划词入口在窄屏保持屏幕内，取消选区或点击网页后消失且不请求模型', async ({ extension }) => {
  const { page, server } = extension;
  await page.setViewportSize({ width: 390, height: 500 });
  const select = async () => {
    const bounds = (await page.locator('#first strong').boundingBox())!;
    await page.mouse.move(bounds.x, bounds.y + bounds.height / 2); await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width, bounds.y + bounds.height / 2, { steps: 8 }); await page.mouse.up();
  };
  const launch = page.getByRole('button', { name: '翻译所选内容', exact: true });
  await select(); await expect(launch).toBeVisible();
  const box = (await launch.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(12); expect(box.x + box.width).toBeLessThanOrEqual(378);
  expect(box.y).toBeGreaterThanOrEqual(12); expect(box.y + box.height).toBeLessThanOrEqual(488);
  await page.evaluate(() => getSelection()?.removeAllRanges()); await expect(launch).toHaveCount(0);
  await select(); await expect(launch).toBeVisible();
  await page.locator('h1').click(); await expect(launch).toHaveCount(0);
  expect(server.calls).toHaveLength(0);
});
