import { test, expect } from '../support/fixtures';

for (const word of ['latency', 'Kubernetes']) {
  test(`模型忙碌时划选 ${word}，先显示真实音标及口音，已收录的本地释义不等待模型`, async ({ extension }, testInfo) => {
    const { page, server, toggle } = extension;
    server.holdStreams();
    await toggle();
    await expect(page.locator('[data-state="partial"]').first()).toBeVisible();
    await page.locator('#first strong').evaluate((element, text) => { element.textContent = text; }, word);
    const bounds = (await page.locator('#first strong').boundingBox())!;
    await page.mouse.move(bounds.x, bounds.y + bounds.height / 2); await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width, bounds.y + bounds.height / 2, { steps: 8 }); await page.mouse.up();
    await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe(word);
    const start = Date.now();
    await page.getByRole('button', { name: '翻译所选内容', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'AI 单词卡' });
    try {
      if (word === 'latency') await expect(dialog.getByRole('button', { name: '英式发音' })).toContainText('/ˈleɪ.tən.si/');
      else {
        await expect(dialog.locator('[aria-label="未标注口音的词典音标"]')).toContainText('/k(j)uːbəˈnɛtɪs/');
        await expect(dialog.getByRole('button', { name: '英式发音' })).toContainText('音标暂无');
      }
      await testInfo.attach('offline-ipa-latency.json', { body: JSON.stringify({ word, clickToObservedIpaMs: Date.now() - start }), contentType: 'application/json' });
      if (word === 'latency') {
        await expect(dialog.getByRole('region', { name: '本地词库释义' })).toContainText('潜伏');
        await expect(dialog.getByText('AI 语境解释准备中', { exact: true })).toBeVisible();
        await expect(dialog).toHaveAttribute('aria-busy', 'false');
      } else {
        await expect(dialog.getByText('释义准备中', { exact: true })).toBeVisible();
        await expect(dialog).toHaveAttribute('aria-busy', 'true');
      }
      expect(server.calls.filter(call => call.word)).toHaveLength(0);
      const rect = (await dialog.boundingBox())!;
      expect(rect.x).toBeGreaterThanOrEqual(0); expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(page.viewportSize()!.width);
      await page.screenshot({ path: testInfo.outputPath(`${word}-offline.png`) });
    } finally { server.releaseStreams(); }
  });
}

test('网页翻译占用模型时，cloudy 词卡先显示离线音标与释义，模型空闲后原位置补齐 AI 解释', async ({ extension }, testInfo) => {
  const { page, server, toggle } = extension;
  server.holdStreams();
  await toggle();
  await expect(page.locator('[data-state="partial"]').first()).toBeVisible();
  const bounds = (await page.locator('#first strong').boundingBox())!;
  await page.mouse.move(bounds.x, bounds.y + bounds.height / 2); await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width, bounds.y + bounds.height / 2, { steps: 8 }); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe('cloudy');
  await page.getByRole('button', { name: '翻译所选内容', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'AI 单词卡' });
  try {
    await expect(dialog.getByRole('button', { name: '美式发音' })).toContainText('/ˈkɫaʊdi/');
    await expect(dialog.getByRole('button', { name: '英式发音' })).toContainText('/klˈaʊdi/');
    await expect(dialog.getByRole('region', { name: '本地词库释义' })).toContainText('多云的');
    await expect(dialog.getByText('AI 语境解释准备中', { exact: true })).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-busy', 'false');
    expect(server.calls.filter(call => call.word)).toHaveLength(0);
    const before = (await dialog.boundingBox())!;
    await page.screenshot({ path: testInfo.outputPath('dictionary-offline-preview.png') });
    server.releaseStreams();
    await expect(dialog.getByText('多云的；不清晰的')).toBeVisible();
    await expect(dialog.getByRole('region', { name: '本地词库释义' })).toContainText('多云的');
    await expect(dialog).toHaveAttribute('aria-busy', 'false');
    const after = (await dialog.boundingBox())!;
    expect(after.x).toBe(before.x); expect(after.y).toBe(before.y);
    expect(server.calls.filter(call => call.word)).toHaveLength(1);
    await expect(page.locator('[data-cloudys-gloss="popover"]')).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath('dictionary-complete.png') });
  } finally { server.releaseStreams(); }
});
