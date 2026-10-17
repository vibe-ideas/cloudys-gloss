import { test, expect } from './pdf-browser';
import { createPdfFixture } from './pdf-fixture';

test('PDF 译文在段落详情与阅读模式中保留相同中西文间距，数字校验和排版保持正常', async ({ pdf }) => {
  const { driver, server } = pdf;
  server.setTranslation('Reading page 1', '阅读第1页API指南');
  await driver.command('file', [createPdfFixture(1).toString('base64'), 'spacing.pdf']);
  await expect.poll(async () => (await driver.snapshot()).source.length).toBe(3);
  await driver.command('click', ['开启双语']);
  await expect.poll(async () => (await driver.snapshot()).status).toContain('本页翻译完成');
  await driver.command('open-block', ['0']);
  await expect.poll(async () => (await driver.snapshot()).dialog.translation).toBe('阅读第 1 页 API 指南');
  await driver.command('click', ['关闭段落详情']);
  await driver.command('click', ['阅读模式']);
  const state = await driver.snapshot();
  expect(state.translations).toContain('阅读第 1 页 API 指南');
  expect(state.errors).toHaveLength(0);
  expect(state.overflow).toBe(false);
});
