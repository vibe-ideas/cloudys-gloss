import { test, expect } from '../support/fixtures';

test('网页译文首段流式返回即补齐中西文间距，恢复原文再开启时缓存保持相同排版', async ({ extension }, testInfo) => {
  const { page, server, toggle } = extension;
  const source = 'A cloudy morning brings quiet thoughts.';
  const raw = '使用React构建API，支持3种模式。';
  const formatted = '使用 React 构建 API，支持 3 种模式。';
  await page.locator('h1').evaluate(element => element.remove());
  server.setTranslation(source, raw);
  // Each in-flight batch pauses after its first result, before stream completion.
  server.holdStreams();
  await toggle();
  const translation = page.locator('#first [data-cloudys-gloss="translation"]');
  await expect(translation).toContainText(formatted);
  expect(server.finishedStreams).toBe(0);
  server.releaseStreams();
  await expect(translation).toHaveAttribute('data-state', 'done');
  await expect(page.locator('#second [data-cloudys-gloss="translation"]')).toHaveAttribute('data-state', 'done');
  await page.screenshot({ path: testInfo.outputPath('chinese-spacing.png') });
  await toggle();
  await expect(page.locator('#first')).toHaveText(source);
  const calls = server.calls.length;
  await toggle();
  await expect(translation).toContainText(formatted);
  expect(server.calls.length).toBe(calls);
});
