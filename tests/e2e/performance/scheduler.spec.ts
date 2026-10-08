import { test, expect } from '../support/fixtures';

// Exercise native tab/window visibility in an actual browser window.
test.use({ headed: true });

test('两千段长网页切出标签后暂停新增翻译，切回续译且保留已完成段落', async ({ extension }) => {
  const { page, options, server, toggle } = extension;
  await page.goto(`${server.url}/large`);
  await options.switchReadingTab(server.url, true);
  await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe('visible');
  server.holdStreams();
  await toggle();
  await expect.poll(() => server.calls.length).toBeGreaterThan(0);
  await options.switchReadingTab(server.url, false);
  await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe('hidden');
  server.releaseStreams();
  // Already submitted batches may finish. No new page batch should follow.
  await expect(page.locator('[data-state="translating"], [data-state="partial"]')).toHaveCount(0);
  await expect.poll(() => server.finishedStreams).toBeGreaterThan(0);
  await expect.poll(() => server.finishedStreams - server.calls.length).toBe(0);
  const count = server.calls.length;
  await page.waitForTimeout(300);
  expect(server.calls).toHaveLength(count);
  const completed = await page.locator('[data-state="done"]').evaluateAll(nodes => nodes.map(node => ({ id: node.parentElement!.id, text: node.textContent })));
  expect(completed.length).toBeGreaterThan(0);
  await options.switchReadingTab(server.url, true);
  await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe('visible');
  await expect.poll(() => server.calls.length).toBeGreaterThan(count);
  for (const item of completed) await expect(page.locator(`#${item.id} [data-state="done"]`)).toHaveText(item.text!);
  const texts = server.calls.flatMap(call => call.texts ?? []);
  expect(new Set(texts).size).toBe(texts.length);
});
