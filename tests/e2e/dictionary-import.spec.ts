import { test, expect } from './fixtures';
import { starDictFixture } from '../helpers/stardict-fixture';

test('导入压缩 StarDict 后重开设置仍可查询；模型忙碌时先展示本地释义，停用和删除立即影响后续查询', async ({ extension }, testInfo) => {
  const { options, page, server, toggle } = extension;
  await options.dictionaryFiles(starDictFixture({ gzip: true, aliases: [['graphics processor', 0]] }));
  await options.click('导入词库');
  await expect.poll(() => options.dictionaryText('status')).toContain('已导入');
  await options.reload();
  await expect.poll(() => options.dictionaryText('list')).toContain('科技测试词库');
  await options.fill('dictionaryQuery', 'graphics processor'); await options.click('查询本地词库');
  await expect.poll(() => options.dictionaryText('results')).toContain('图形处理器');
  await options.fill('dictionaryQuery', 'RAG'); await options.click('查询本地词库');
  await expect.poll(() => options.dictionaryText('results')).toContain('检索增强生成');
  await options.screenshot(testInfo.outputPath('dictionary-settings.png'));
  server.holdStreams();
  try {
    await toggle(); await expect(page.locator('[data-state="partial"]').first()).toBeVisible();
    const bounds = (await page.locator('#first strong').boundingBox())!;
    await page.mouse.move(bounds.x, bounds.y + bounds.height / 2); await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width, bounds.y + bounds.height / 2, { steps: 8 }); await page.mouse.up();
    await page.getByRole('button', { name: '翻译所选内容', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'AI 单词卡' });
    await expect(dialog.getByText('本地释义：多云的；不清晰的。', { exact: true })).toBeVisible();
    await expect(dialog.getByText('AI 语境解释准备中')).toBeVisible();
    expect(server.calls.filter(call => call.word)).toHaveLength(0);
    const rect = (await dialog.boundingBox())!; expect(rect.x).toBeGreaterThanOrEqual(0); expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(rect.y + rect.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    await page.screenshot({ path: testInfo.outputPath('imported-definition.png') });
    server.releaseStreams(); await expect(dialog.getByText('多云的；不清晰的', { exact: true })).toBeVisible();
    await expect(dialog.getByText('本地释义：多云的；不清晰的。', { exact: true })).toBeVisible();
  } finally { server.releaseStreams(); }
  await options.click('停用 科技测试词库');
  await expect.poll(() => options.dictionaryText('list')).toContain('已停用');
  await options.click('查询本地词库'); await expect.poll(() => options.dictionaryText('results')).toContain('没有收录');
  await options.click('启用 科技测试词库');
  await expect.poll(() => options.dictionaryText('list')).toContain('已启用');
  await options.click('删除 科技测试词库'); await options.click('确认删除 科技测试词库');
  await expect.poll(() => options.dictionaryText('list')).toContain('尚未导入');
  await options.click('查询本地词库'); await expect.poll(() => options.dictionaryText('results')).toContain('没有收录');
});

test('导入恶意 HTML 仅显示安全文本；新词库损坏时原有词库仍可查询', async ({ extension }) => {
  const { options } = extension;
  await options.dictionaryFiles(starDictFixture({ sequence: 'h', entries: [['safe', '<div>安全释义 &amp; 中文</div><script>throw new Error("EXECUTED")</script><img src="https://invalid.example/tracker">']] }));
  await options.click('导入词库'); await expect.poll(() => options.dictionaryText('status')).toContain('已导入');
  await options.fill('dictionaryQuery', 'safe'); await options.click('查询本地词库');
  await expect.poll(() => options.dictionaryText('results')).toContain('安全释义 & 中文');
  expect(await options.dictionaryText('results')).not.toContain('EXECUTED');
  const broken = starDictFixture(); broken[0]!.buffer = Buffer.from(broken[0]!.buffer.toString().replace('wordcount=4', 'wordcount=8'));
  await options.dictionaryFiles(broken); await options.click('导入词库');
  await expect.poll(() => options.dictionaryText('status')).toContain('wordcount');
  await options.click('查询本地词库'); await expect.poll(() => options.dictionaryText('results')).toContain('安全释义 & 中文');
});
