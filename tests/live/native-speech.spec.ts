import { test, expect } from '../e2e/support/fixtures';

test('Firefox macOS 词卡通过本地助手播放美式和英式发音，结束后恢复可播放状态', async ({ extension }) => {
  test.skip(process.platform !== 'darwin' || process.arch !== 'arm64', '需要已安装本地助手的 Apple Silicon macOS');
  const { page, server } = extension;
  await expect(page.locator('[data-cloudys-gloss="floating-control"]')).toBeAttached();
  const bounds = (await page.locator('#first strong').boundingBox())!;
  await page.mouse.move(bounds.x, bounds.y + bounds.height / 2); await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width, bounds.y + bounds.height / 2, { steps: 8 }); await page.mouse.up();
  await page.getByRole('button', { name: '翻译所选内容', exact: true }).click();
  const card = page.getByRole('dialog', { name: 'AI 单词卡' });
  await expect(card.getByRole('button', { name: '美式发音' })).toBeVisible();
  const modelRequests = server.calls.length;
  for (const accent of ['美式发音', '英式发音', '美式发音']) {
    const button = card.getByRole('button', { name: accent });
    await button.click(); await expect(button).toHaveAttribute('aria-busy', 'true');
    await expect(button).toHaveAttribute('aria-busy', 'false');
    await expect(card.locator('.error')).toHaveCount(0);
  }
  expect(server.calls.length).toBe(modelRequests);
});
