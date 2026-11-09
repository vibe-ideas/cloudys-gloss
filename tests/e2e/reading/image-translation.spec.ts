import { test, expect } from '../support/fixtures';

function imageTranslations(server: { setTranslation: (source: string, translated: string) => void }) {
  for (const [source, translated] of Object.entries({
    'Linux (XFCE)': 'Linux (XFCE)', 'Scale, AgentEnv': 'Scale, AgentEnv', 'Codex Computer Use': 'Codex Computer Use',
    'ZXIMG0QXZ tasks, ZXIMG1QXZ trials per ZXIMG2QXZ': '每个 ZXIMG2QXZ 进行 ZXIMG0QXZ 项任务、ZXIMG1QXZ 次试验',
    'one Windows ZXIMG0QXZ VM, run by Cua': '一台 Windows ZXIMG0QXZ 虚拟机，由 Cua 运行',
    'Ubuntu ZXIMG0QXZ ZXIMG1QXZ, ZXIMG2QXZ tasks': 'Ubuntu ZXIMG0QXZ ZXIMG1QXZ，ZXIMG2QXZ 项任务',
    'not available on Linux': 'Linux 上不可用', 'run by Cua': '由 Cua 运行',
    'no Linux ZXIMG0QXZ': '没有 Linux ZXIMG0QXZ', 'ZXIMG0QXZ →': 'ZXIMG0QXZ →',
  })) server.setTranslation(source, translated);
}

test('图片翻译图标可辨识操作，进度从零开始，窄图停靠空白处后仍可停止', async ({ extension }, testInfo) => {
  test.setTimeout(90000);
  const { page, server } = extension; imageTranslations(server); server.setDelay(3000);
  await page.goto(server.url + '/article-images');
  const image = page.locator('#chart'); const toolbar = page.locator('[data-cloudys-gloss="image-launcher"]');
  await image.hover();
  const translate = toolbar.getByRole('button', { name: '翻译这张图片', exact: true });
  await expect(translate.locator('svg')).toBeVisible(); await expect(translate).toHaveText('');
  await translate.focus(); await page.keyboard.press('Tab');
  await expect(toolbar.getByRole('button', { name: '打开图片阅读页', exact: true })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('image-toolbar-idle.png') });
  await translate.click();
  await expect(toolbar.getByRole('status')).toHaveText(/^0\/\d+$/, { timeout: 70000 });
  await expect(toolbar.getByRole('status')).toHaveAttribute('title', /正在本机翻译/);
  const wide = (await toolbar.boundingBox())!;
  expect(wide.height).toBeLessThanOrEqual(36); expect(wide.width).toBeLessThanOrEqual(220);
  await page.screenshot({ path: testInfo.outputPath('compact-image-progress.png') });
  await image.evaluate(node => { (node as HTMLElement).style.width = '160px'; });
  await page.mouse.move(8, 8);
  await image.hover({ position: { x: 2, y: 2 } });
  await expect(toolbar).toBeVisible();
  const narrow = (await toolbar.boundingBox())!; const picture = (await image.boundingBox())!;
  expect(narrow.height).toBeLessThanOrEqual(36); expect(narrow.width).toBeLessThanOrEqual(148);
  await expect(toolbar).toHaveAttribute('data-dock', 'outside');
  const overlap = Math.max(0, Math.min(narrow.x + narrow.width, picture.x + picture.width) - Math.max(narrow.x, picture.x))
    * Math.max(0, Math.min(narrow.y + narrow.height, picture.y + picture.height) - Math.max(narrow.y, picture.y));
  expect(overlap).toBe(0);
  const reader = toolbar.getByRole('button', { name: '打开图片阅读页', exact: true });
  await expect(reader).toBeVisible();
  const readerBox = (await reader.boundingBox())!; expect(readerBox.x + readerBox.width).toBeLessThanOrEqual(narrow.x + narrow.width);
  await page.screenshot({ path: testInfo.outputPath('compact-image-narrow.png') });
  await toolbar.getByRole('button', { name: '停止图片翻译', exact: true }).click();
  await expect(toolbar.getByRole('status')).toHaveText('已停止');
  await page.keyboard.press('Escape'); await expect(toolbar).toBeHidden();
});

test('图片翻译失败时显示未译数量，警示图标可用键盘打开阅读页查看详情', async ({ extension }, testInfo) => {
  test.setTimeout(90000);
  const { page, server, options } = extension; server.setTranslationFailure(503);
  await page.goto(server.url + '/article-images'); await page.locator('#chart').hover();
  const toolbar = page.locator('[data-cloudys-gloss="image-launcher"]');
  await toolbar.getByRole('button', { name: '翻译这张图片', exact: true }).click();
  const details = toolbar.getByRole('button', { name: /打开阅读页查看详情/ });
  await expect(details).toContainText(/\d+ 处未译/, { timeout: 70000 });
  await expect(details.locator('svg')).toBeVisible();
  await expect(toolbar.getByRole('button', { name: '重试图片翻译', exact: true })).toBeVisible();
  await details.focus();
  await page.screenshot({ path: testInfo.outputPath('image-toolbar-warning.png') });
  await page.keyboard.press('Enter');
  await expect.poll(() => options.image<boolean>('ready')).toBe(true);
});

test('文章内图片原位显示译文，切换原图及缩放滚动不改排版，换图后清除旧译文', async ({ extension }, testInfo) => {
  test.setTimeout(90000);
  const { page, context, server } = extension; imageTranslations(server);
  await page.goto(server.url + '/article-images');
  const image = page.locator('#chart'); await expect(image).toBeVisible();
  await page.locator('[data-cloudys-gloss="image-launcher"]').waitFor({ state: 'attached' });
  const before = await image.boundingBox(); const after = await page.locator('#after-chart').boundingBox(); const tabs = context.pages().length;
  await image.hover();
  // The article's scripts cannot initiate privileged OCR by faking a click.
  await page.getByRole('button', { name: '翻译这张图片', exact: true }).evaluate(node => (node as HTMLButtonElement).click());
  await expect(page.locator('[data-cloudys-gloss="image-overlay"]')).toHaveCount(0);
  await page.getByRole('button', { name: '翻译这张图片', exact: true }).click({ timeout: 5000 });
  const overlay = page.locator('[data-cloudys-gloss="image-overlay"]');
  await expect(overlay.getByRole('status')).toContainText('图片翻译完成', { timeout: 70000 });
  await expect(overlay.locator('.translated-region').first()).toBeVisible();
  await page.evaluate(() => { const header = document.createElement('header'); header.id = 'occluding-header'; header.style.cssText = 'position:fixed;inset:0 0 auto;height:400px;background:white;z-index:2147483646'; document.body.append(header); });
  await expect(overlay.locator('.translated-region').first()).toBeHidden();
  await page.locator('#occluding-header').evaluate(node => node.remove());
  await expect(overlay.locator('.translated-region').first()).toBeVisible();
  expect(page.url()).toBe(server.url + '/article-images');
  expect(await image.boundingBox()).toEqual(before); expect(await page.locator('#after-chart').boundingBox()).toEqual(after);
  // Extension processor is inactive: clicking a linked chart never follows its anchor.
  await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe('visible');
  await image.hover(); await page.getByRole('button', { name: '查看原图', exact: true }).click(); await expect(overlay).toBeHidden();
  await image.hover(); await page.getByRole('button', { name: '查看图片译文', exact: true }).click(); await expect(overlay).toBeVisible();
  await page.setViewportSize({ width: 800, height: 800 });
  await expect.poll(async () => { const a = await image.boundingBox(); const b = await overlay.boundingBox(); return a && b ? Math.abs(a.width - b.width) : 1000; }).toBeLessThan(2);
  await page.evaluate(() => window.scrollBy(0, 90));
  await expect.poll(async () => { const a = await image.boundingBox(); const b = await overlay.boundingBox(); return a && b ? Math.abs(Math.max(0, a.y) - b.y) : 1000; }).toBeLessThan(2);
  await page.screenshot({ path: testInfo.outputPath('article-image-inline.png'), fullPage: true });
  await image.evaluate(node => { (node as HTMLImageElement).src = '/article-chart.png?replacement'; });
  await expect(overlay).toHaveCount(0);
  await page.goto(server.url);
  await expect.poll(() => context.pages().length).toBeLessThanOrEqual(tabs);
});

test('右键文章内图片后从菜单通道翻译所选图片，重复图片地址不会错误覆盖第一张', async ({ extension }) => {
  test.setTimeout(90000);
  const { page, options, server } = extension; imageTranslations(server);
  await page.goto(server.url + '/article-images');
  await page.locator('#chart').evaluate(image => { const copy = image.cloneNode(true) as HTMLImageElement; copy.id = 'second-chart'; image.closest('figure')!.after(copy); });
  const selected = page.locator('#second-chart'); await expect.poll(() => selected.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await selected.click({ button: 'right' }); await page.keyboard.press('Escape');
  expect(await options.contextImage(server.url, server.url + '/article-chart.png')).toBe(true);
  const overlay = page.locator('[data-cloudys-gloss="image-overlay"]'); await expect(overlay).toHaveAttribute('data-image-state', 'done', { timeout: 70000 });
  await expect(overlay.locator('.translated-region').first()).toBeVisible();
  const expected = await selected.boundingBox(); const actual = await overlay.boundingBox(); expect(Math.abs(actual!.y - Math.max(0, expected!.y))).toBeLessThan(2);
});

test('打开本地英文图表后识别主要系统标签与百分比，在原图上显示译文且不请求云端', async ({ extension }, testInfo) => {
  test.setTimeout(90000);
  const { context, page } = extension; imageTranslations(extension.server);
  // The content button opens the actual reader even when BiDi cannot navigate to extension URLs.
  await page.locator('[data-cloudys-gloss="floating-control"]').waitFor();
  await page.locator('[data-cloudys-gloss="floating-control"] .dock').hover();
  await page.getByRole('button', { name: '翻译快捷菜单' }).click();
  const next = testInfo.project.name === 'firefox' ? undefined : context.waitForEvent('page');
  await page.getByRole('button', { name: '离线图片翻译' }).click();
  await expect.poll(() => extension.options.image<boolean>('ready')).toBe(true);
  if (testInfo.project.name === 'firefox') {
    await context.route(/^https?:/, route => [extension.server.url, extension.server.controlUrl].some(url => route.request().url().startsWith(url)) ? route.continue() : route.abort());
    const bytes = await import('node:fs/promises').then(fs => fs.readFile('tests/fixtures/image-ocr/cua-background.png'));
    await extension.options.image('file', [bytes.toString('base64'), 'cua-background.png']);
    await expect.poll(async () => (await extension.options.image<{ status: string }>('snapshot')).status, { timeout: 70000 }).toContain('图片处理完成');
    const value = await extension.options.image<{ lines: { source: string }[]; overlays: number }>('snapshot');
    expect(value.lines.map(line => line.source).join(' ')).toContain('macOS'); expect(value.overlays).toBeGreaterThan(0);
    for (const label of ['Windows', 'Linux(XFCE)', '58%(23/40)', '28%(11/40)', '33%(13/40)', '3%(1/40)']) expect(value.lines.map(line => line.source).join('').replaceAll(' ', '')).toContain(label);
    return;
  }
  const reader = (await next)!;
  const external: string[] = [];
  reader.on('request', request => { if (/^https?:/.test(request.url()) && !request.url().startsWith(extension.server.url)) external.push(request.url()); });
  if (process.env.OCR_MODE) await reader.getByLabel('识别模式').selectOption(process.env.OCR_MODE);
  await reader.getByLabel('本地图片', { exact: true }).setInputFiles('tests/fixtures/image-ocr/cua-background.png');
  await expect(reader.getByRole('status')).toContainText('图片处理完成', { timeout: 70000 });
  const result = await reader.locator('.text-card textarea').evaluateAll(nodes => nodes.map(node => (node as HTMLTextAreaElement).value));
  console.log(JSON.stringify({ browser: testInfo.project.name, status: await reader.getByRole('status').innerText(), ocrMs: await reader.locator('main').getAttribute('data-ocr-ms'), result }));
  expect(result.join(' ')).toContain('macOS');
  for (const label of ['Windows', 'Linux (XFCE)', '58%(23/40)', '28%(11/40)', '33%(13/40)', '3%(1/40)']) expect(result.join(' ').replaceAll(' ', '')).toContain(label.replaceAll(' ', ''));
  await expect(reader.locator('.translated-region').first()).toBeVisible();
  await reader.screenshot({ path: testInfo.outputPath('translated-image.png'), fullPage: true });
  const before = await reader.locator('.picture').boundingBox();
  await reader.getByRole('button', { name: '查看原图', exact: true }).click();
  await expect(reader.locator('.translated-region')).toHaveCount(0);
  expect(await reader.locator('.picture').boundingBox()).toEqual(before);
  await reader.getByRole('button', { name: '查看译图', exact: true }).click();
  await reader.getByLabel('本地图片', { exact: true }).setInputFiles('tests/fixtures/image-ocr/cua-background.png');
  await expect(reader.getByRole('status')).toContainText('图片处理完成');
  await expect(reader.locator('main')).toHaveAttribute('data-ocr-cached', 'true');
  expect(external).toEqual([]);
});

test('本地图片在远端模型配置下仍可识别且拒绝上传，Chromium 同时验证断网处理', async ({ extension }, testInfo) => {
  const { context, page, options } = extension;
  await options.fill('baseUrl', 'https://cloud-model.invalid/v1'); await options.click('保存设置');
  await page.locator('[data-cloudys-gloss="floating-control"] .dock').hover();
  await page.getByRole('button', { name: '翻译快捷菜单' }).click();
  const next = testInfo.project.name === 'firefox' ? undefined : context.waitForEvent('page'); await page.getByRole('button', { name: '离线图片翻译' }).click();
  await expect.poll(() => options.image<boolean>('ready')).toBe(true);
  if (testInfo.project.name === 'firefox') {
    // BiDi hides the extension realm. The test copy reads the actual DOM via its options bridge.
    // Keep the loopback test-control channel online; no remote model request is allowed.
    await context.route(/^https?:/, route => [extension.server.url, extension.server.controlUrl].some(url => route.request().url().startsWith(url)) ? route.continue() : route.abort());
    const remote: string[] = []; context.on('request', request => { if (request.url().includes('cloud-model.invalid')) remote.push(request.url()); });
    const bytes = await import('node:fs/promises').then(fs => fs.readFile('tests/fixtures/image-ocr/cua-background.png'));
    await options.image('file', [bytes.toString('base64'), 'cua-background.png']);
    await expect.poll(async () => (await options.image<{ status: string }>('snapshot')).status, { timeout: 70000 }).toContain('图片处理完成');
    const value = await options.image<{ lines: { source: string; translation: string }[] }>('snapshot');
    expect(value.lines.map(line => line.source).join(' ')).toContain('macOS');
    expect(value.lines.some(line => line.translation.includes('仅使用本机模型'))).toBe(true);
    expect(remote).toEqual([]);
    return;
  }
  const reader = (await next)!;
  const remote: string[] = [];
  context.on('request', request => { if (request.url().includes('cloud-model.invalid')) remote.push(request.url()); });
  await context.setOffline(true);
  await reader.getByLabel('本地图片', { exact: true }).setInputFiles('tests/fixtures/image-ocr/cua-background.png');
  await expect(reader.getByRole('status')).toContainText('图片处理完成', { timeout: 60000 });
  await expect(reader.getByRole('status')).toContainText('翻译待重试');
  await expect(reader.locator('.translation .error').first()).toContainText('仅使用本机模型');
  expect((await reader.locator('.text-card textarea').evaluateAll(nodes => nodes.map(node => (node as HTMLTextAreaElement).value))).join(' ')).toContain('macOS');
  expect(remote).toEqual([]);
});
