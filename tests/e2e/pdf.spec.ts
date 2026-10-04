import { test, expect } from './pdf-browser';
import { createPdfFixture, pdfFixture } from './pdf-fixture';

test('在线多页 PDF 仅解析当前页，显式开启后流式双语，窄屏与离屏返回时原稿完整', async ({ pdf }, testInfo) => {
  const { driver, server } = pdf;
  await driver.command('fill', ['#pdf-url', `${server.url}/pdf-fixture.pdf`]); await driver.command('click', ['打开']);
  await expect.poll(async () => (await driver.snapshot()).source.length).toBe(3);
  let snapshot = await driver.snapshot();
  expect(snapshot.name).toContain('20 页'); expect(snapshot.canvases).toBe(1); expect(snapshot.canvasVisible).toBe(true);
  expect(snapshot.canvasAspect).toBeCloseTo(612 / 792, 2);
  expect(snapshot.pixels).toBeLessThanOrEqual(3000000); expect(server.calls).toHaveLength(0);
  expect(snapshot.source[1]).toContain('A calm layout');
  await driver.command('click', ['开启双语']);
  await expect.poll(async () => (await driver.snapshot()).translations.length).toBe(3);
  expect(server.calls.flatMap((call) => call.texts ?? []).join(' ')).not.toMatch(/page (2|20)\b/);
  expect((await driver.snapshot()).status).toContain('本页翻译完成');
  await driver.screenshot(testInfo.outputPath('pdf-desktop.png'));
  await driver.viewport(390, 240); await expect.poll(async () => (await driver.snapshot()).width).toBe(390); await driver.command('scroll', ['0']);
  await driver.command('frame'); await driver.command('scroll', ['500']); await driver.command('frame'); await driver.command('scroll', ['0']); await driver.command('frame');
  await driver.viewport(390, 640);
  await expect.poll(async () => (await driver.snapshot()).width).toBe(390);
  await expect.poll(async () => (await driver.snapshot()).canvasVisible).toBe(true);
  await expect.poll(async () => (await driver.snapshot()).canvasAspect).toBeCloseTo(612 / 792, 2);
  snapshot = await driver.snapshot(); expect(snapshot.overflow).toBe(false); expect(snapshot.canvases).toBe(1);
  await driver.screenshot(testInfo.outputPath('pdf-mobile.png'));
});

test('本地 PDF 翻译途中切页立即取消旧页，点击与表单提交跳转正确，扫描页给出说明且关闭释放内容', async ({ pdf }) => {
  const { driver, server } = pdf;
  await driver.command('file', [pdfFixture.toString('base64'), 'local-reading.pdf']);
  await expect.poll(async () => (await driver.snapshot()).source.length).toBe(3);
  server.holdStreams();
  await driver.command('click', ['开启双语']);
  await expect.poll(() => server.calls.length).toBeGreaterThan(0);
  await driver.command('click', ['下一页']);
  await expect.poll(() => server.abortedStreams).toBeGreaterThan(0);
  server.releaseStreams();
  await expect.poll(async () => (await driver.snapshot()).translations.length).toBe(3);
  let snapshot = await driver.snapshot();
  expect(snapshot.page).toBe('2'); expect(snapshot.source.join(' ')).toContain('Page 2'); expect(snapshot.translations.join(' ')).not.toContain('page 1');
  await driver.command('fill', ['#page-number', '3']); await driver.command('click', ['跳转']);
  await expect.poll(async () => (await driver.snapshot()).status).toContain('暂不支持 OCR');
  snapshot = await driver.snapshot(); expect(snapshot.page).toBe('3'); expect(snapshot.source).toHaveLength(0); expect(snapshot.status).not.toContain('翻译完成');
  await driver.command('fill', ['#page-number', '4']); await driver.command('submit', ['#page-number']);
  await expect.poll(async () => (await driver.snapshot()).source.join(' ')).toContain('Page 4');
  await driver.command('click', ['关闭文件']);
  snapshot = await driver.snapshot(); expect(snapshot.canvases).toBe(0); expect(snapshot.source).toHaveLength(0); expect(snapshot.translations).toHaveLength(0);
});

test('非 PDF、超大下载和损坏文件显示可恢复错误，换文件清除旧页与旧译文且不自动发送模型', async ({ pdf }) => {
  const { driver, server } = pdf;
  await driver.command('fill', ['#pdf-url', `${server.url}/not-a-pdf.pdf`]); await driver.command('click', ['打开']);
  await expect.poll(async () => (await driver.snapshot()).error).toContain('不是有效的 PDF');
  await driver.command('fill', ['#pdf-url', `${server.url}/large-pdf.pdf`]); await driver.command('click', ['打开']);
  await expect.poll(async () => (await driver.snapshot()).error).toContain('超过 40 MB');
  await driver.command('file', [Buffer.from('broken').toString('base64'), 'broken.pdf']);
  await expect.poll(async () => (await driver.snapshot()).error).toContain('不是有效的 PDF');
  await driver.command('file', [pdfFixture.toString('base64'), 'first.pdf']);
  await expect.poll(async () => (await driver.snapshot()).source.length).toBe(3);
  await driver.command('click', ['开启双语']);
  await expect.poll(async () => (await driver.snapshot()).translations.length).toBe(3);
  const before = server.calls.length;
  await driver.command('file', [createPdfFixture(1).toString('base64'), 'replacement.pdf']);
  await expect.poll(async () => (await driver.snapshot()).name).toBe('replacement.pdf1 页');
  await expect.poll(async () => (await driver.snapshot()).source.length).toBe(3);
  const snapshot = await driver.snapshot(); expect(snapshot.error).toBe(''); expect(snapshot.translations).toHaveLength(0); expect(server.calls).toHaveLength(before);
});

test('慢 PDF 下载取消后可立即打开本地文件，旧下载不会重新覆盖当前文档', async ({ pdf }) => {
  const { driver, server } = pdf;
  await driver.command('fill', ['#pdf-url', `${server.url}/slow-pdf.pdf`]); await driver.command('click', ['打开']);
  await expect.poll(async () => (await driver.snapshot()).status).toContain('正在打开');
  await driver.command('click', ['取消打开']);
  await driver.command('file', [createPdfFixture(1).toString('base64'), 'after-cancel.pdf']);
  await expect.poll(async () => (await driver.snapshot()).source.length).toBe(3);
  // This delay deliberately outlives the server's delayed response to check for
  // late writes; ordinary UI readiness above uses polling rather than sleeps.
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const state = await driver.snapshot(); expect(state.name).toBe('after-cancel.pdf1 页'); expect(state.error).toBe('');
  expect(server.calls).toHaveLength(0);
});
