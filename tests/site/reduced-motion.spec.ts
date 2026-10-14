import { test, expect } from '@playwright/test';

test('减少动态效果模式下双语演示仍可开启与恢复，键盘可进入下载入口', async ({ page }) => {
  await page.route('https://api.github.com/**', route => route.abort());
  await page.goto('/');
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  expect(await page.locator('.hero-art').evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  await page.locator('#translate-demo').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('[data-translation]').last()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-translation]').last()).toBeHidden();
  await page.getByRole('link', { name: '下载 Firefox XPI' }).focus();
  await expect(page.getByRole('link', { name: '下载 Firefox XPI' })).toBeFocused();
});
