import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('https://api.github.com/repos/vibe-ideas/cloudys-gloss/releases/latest', route => route.fulfill({ json: { assets: [] } }));
});

for (const width of [390, 1440]) {
  test(`${width}px 产品页保留完整内容，双语演示可恢复，词卡支持关闭且页面不横向溢出`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('好奇');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole('button', { name: '试试双语阅读' }).click();
    await expect(page.locator('[data-translation]').first()).toBeVisible();
    await expect(page.locator('[data-translation]').last()).toBeVisible();
    await page.getByRole('button', { name: '恢复原文' }).click();
    await expect(page.locator('[data-translation]').first()).toBeHidden();
    await page.getByRole('button', { name: 'latency', exact: true }).click();
    await expect(page.locator('#word-card')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#word-card')).toBeHidden();
    await expect(page.getByRole('button', { name: 'latency', exact: true })).toBeFocused();
    await page.getByText('Firefox 为什么需要手动安装一次？', { exact: true }).click();
    await expect(page.getByText('0.1.9 及以前的安装包没有更新地址。', { exact: false })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test('GitHub API 不可用时仍可获取安装包，视频及字幕资源可读取且不自动播放', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('[data-download="chrome"]')).toHaveAttribute('href', 'https://github.com/vibe-ideas/cloudys-gloss/releases/latest');
  await expect(page.getByRole('link', { name: '下载 Firefox XPI' })).toHaveAttribute('href', /releases\/latest\/download\/cloudys-gloss-firefox-unsigned\.xpi$/);
  await expect(page.locator('video')).not.toHaveAttribute('autoplay');
  for (const asset of ['/assets/demo.mp4', '/assets/demo-poster.jpg', '/assets/demo.vtt']) expect((await request.get(asset)).ok()).toBe(true);
});

test('减少动态效果模式下双语演示仍可开启与恢复，键盘可进入下载入口', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.locator('#translate-demo').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('[data-translation]').last()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-translation]').last()).toBeHidden();
  await page.getByRole('link', { name: '下载 Firefox XPI' }).focus();
  await expect(page.getByRole('link', { name: '下载 Firefox XPI' })).toBeFocused();
});
