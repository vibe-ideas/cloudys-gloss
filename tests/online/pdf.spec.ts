import { test, expect } from '../e2e/pdf-browser';
import { writeFile } from 'node:fs/promises';
test('Mozilla 公开多栏论文通过真实扩展阅读器显示原稿和逐段双语', async ({ pdf }, testInfo) => {
  const { driver, server } = pdf;
  await driver.command('fill', ['#pdf-url', 'https://mozilla.github.io/pdf.js/web/compressed.tracemonkey-pldi-09.pdf']);
  await driver.command('click', ['打开']);
  await expect.poll(async () => (await driver.snapshot()).source.length).toBeGreaterThan(5);
  const original = await driver.snapshot(); expect(original.error).toBe(''); expect(original.canvasVisible).toBe(true); expect(server.calls).toHaveLength(0);
  await driver.command('click', ['开启双语']);
  await expect.poll(async () => (await driver.snapshot()).translations.length).toBe(original.source.length);
  await driver.screenshot(testInfo.outputPath('mozilla-pdf.png'));
  await driver.viewport(390, 640);
  await expect.poll(async () => (await driver.snapshot()).width).toBe(390);
  const narrow = await driver.snapshot(); expect(narrow.overflow).toBe(false); expect(narrow.canvasVisible).toBe(true);
  const report = { browser: testInfo.project.name, document: original.name, paragraphs: original.source.length, translations: narrow.translations.length, canvasPixels: narrow.pixels, narrowWidth: narrow.width, overflow: narrow.overflow, actualPdf: true, model: 'deterministic fixture' };
  await writeFile(testInfo.outputPath('public-pdf.json'), JSON.stringify(report, null, 2));
});
