import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '../e2e/support/fixtures';
import type { BrowserContext, Page } from '@playwright/test';

async function reader(context: BrowserContext, page: Page, firefox = false) {
  await page.locator('[data-cloudys-gloss="floating-control"] .dock').hover();
  await page.getByRole('button', { name: '翻译快捷菜单' }).click();
  const next = firefox ? undefined : context.waitForEvent('page'); await page.getByRole('button', { name: '离线图片翻译' }).click();
  return next ? await next : page;
}
async function sample(page: Page) {
  return { ocrMs: Number(await page.locator('main').getAttribute('data-ocr-ms')), totalMs: Number(await page.locator('main').getAttribute('data-total-ms')), cached: await page.locator('main').getAttribute('data-ocr-cached') === 'true',
    status: await page.getByRole('status').innerText(),
    lines: await page.locator('.text-card li').evaluateAll(nodes => nodes.map(node => ({ source: node.querySelector('textarea')!.value, score: Number(node.getAttribute('data-confidence')), translation: node.querySelector('.translation')!.textContent }))) };
}

test('两种离线模型识别 Cua 全部五张图表，记录逐图耗时、原始文字及置信度', async ({ extension }, testInfo) => {
  const view = await reader(extension.context, extension.page, testInfo.project.name === 'firefox');
  await expect.poll(() => extension.options.image<boolean>('ready')).toBe(true);
  const firefox = testInfo.project.name === 'firefox';
  if (firefox) await extension.options.image('only'); else await view.getByText('仅识别文字', { exact: true }).click();
  const external: string[] = []; view.on('request', request => { if (/^https?:/.test(request.url())) external.push(request.url()); });
  const directory = path.resolve(`artifacts/image-benchmark/${testInfo.project.name}-ocr-${Date.now()}`); await mkdir(directory, { recursive: true });
  const rows = [];
  for (const mode of ['tiny', 'small']) {
    if (firefox) await extension.options.image('mode', [mode]); else await view.getByLabel('识别模式').selectOption(mode);
    for (const file of ['fig1-background-full-pass-by-os.png', 'fig2-why-trials-miss.png', 'fig3-macos-background-per-task.png', 'fig4-macos-foreground-vs-background.png', 'fig5-macos-disturbances-by-criterion.png']) {
      if (firefox) await extension.options.image('file', [(await readFile(`artifacts/image-ocr-bench/${file}`)).toString('base64'), file]);
      else await view.getByLabel('本地图片', { exact: true }).setInputFiles(`artifacts/image-ocr-bench/${file}`);
      if (firefox) await expect.poll(async () => (await extension.options.image<{ status: string }>('snapshot')).status, { timeout: 70000 }).toContain('识别完成');
      else await expect(view.getByRole('status')).toContainText('识别完成', { timeout: 70000 });
      const row = { mode, file, ...firefox ? await extension.options.image<Awaited<ReturnType<typeof sample>>>('snapshot') : await sample(view) }; rows.push(row);
      console.log(JSON.stringify({ browser: testInfo.project.name, mode, file, ocrMs: row.ocrMs, cached: row.cached, regions: row.lines.length }));
    }
  }
  await writeFile(path.join(directory, 'results.json'), JSON.stringify({ browser: testInfo.project.name, userAgent: firefox ? 'Firefox Developer Edition; extension DOM via test bridge' : await view.evaluate(() => navigator.userAgent), external, rows }, null, 2));
  expect(external).toEqual([]); console.log('OCR results:', directory);
});

test('完整图片翻译使用真实本机 Qwen，记录首次处理、缓存复用、逐区原译文和截图', async ({ extension }, testInfo) => {
  test.skip(process.env.IMAGE_MODEL_LIVE !== '1', '仅显式测速时调用真实本机模型');
  await extension.options.fill('baseUrl', 'http://127.0.0.1:8080/v1');
  await extension.options.fill('model', 'Qwen/Qwen3-1.7B-MLX-4bit'); await extension.options.click('保存设置');
  const view = await reader(extension.context, extension.page, testInfo.project.name === 'firefox');
  await expect.poll(() => extension.options.image<boolean>('ready')).toBe(true);
  const firefox = testInfo.project.name === 'firefox';
  const directory = path.resolve(`artifacts/image-benchmark/${testInfo.project.name}-live-${Date.now()}`); await mkdir(directory, { recursive: true });
  const rows = [];
  for (const run of ['first', 'cached']) {
    if (firefox) await extension.options.image('file', [(await readFile('tests/fixtures/image-ocr/cua-background.png')).toString('base64'), 'cua-background.png']);
    else await view.getByLabel('本地图片', { exact: true }).setInputFiles('tests/fixtures/image-ocr/cua-background.png');
    if (firefox) await expect.poll(async () => (await extension.options.image<{ status: string }>('snapshot')).status, { timeout: 120000 }).toContain('图片处理完成');
    else await expect(view.getByRole('status')).toContainText('图片处理完成', { timeout: 120000 });
    const row = { run, ...firefox ? await extension.options.image<Awaited<ReturnType<typeof sample>>>('snapshot') : await sample(view) }; rows.push(row);
    await writeFile(path.join(directory, 'results.json'), JSON.stringify({ browser: testInfo.project.name, model: 'Qwen/Qwen3-1.7B-MLX-4bit', engine: 'model', rows }, null, 2));
    console.log(JSON.stringify({ browser: testInfo.project.name, run, ocrMs: row.ocrMs, totalMs: row.totalMs, cached: row.cached, status: row.status }));
    expect(row.status).not.toContain('翻译待重试');
    if (!firefox) await view.screenshot({ path: path.join(directory, `${run}.png`), fullPage: true });
  }
  await writeFile(path.join(directory, 'results.json'), JSON.stringify({ browser: testInfo.project.name, userAgent: firefox ? 'Firefox Developer Edition; extension DOM via test bridge' : await view.evaluate(() => navigator.userAgent), model: 'Qwen/Qwen3-1.7B-MLX-4bit', engine: 'model', rows }, null, 2));
  console.log('Full image results:', directory);
});

test('文章图片使用真实本机 Qwen 原位翻译，记录处理时长、译文和文章尺寸', async ({ extension }, testInfo) => {
  test.skip(process.env.IMAGE_MODEL_LIVE !== '1', '仅显式测速时调用真实本机模型');
  await extension.options.fill('baseUrl', 'http://127.0.0.1:8080/v1');
  await extension.options.fill('model', 'Qwen/Qwen3-1.7B-MLX-4bit'); await extension.options.click('保存设置');
  const { page, server } = extension;
  await page.goto(server.url + '/article-images');
  const image = page.locator('#chart'); await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.locator('[data-cloudys-gloss="image-launcher"]').waitFor({ state: 'attached' });
  const before = await image.boundingBox(); const paragraph = await page.locator('#after-chart').boundingBox();
  await image.hover(); await page.getByRole('button', { name: '翻译这张图片', exact: true }).click();
  const overlay = page.locator('[data-cloudys-gloss="image-overlay"]');
  await expect(overlay).toHaveAttribute('data-image-state', 'done', { timeout: 120000 });
  await expect(overlay.getByRole('status')).not.toContainText('翻译未完成');
  await expect(overlay.locator('.translated-region').first()).toBeVisible();
  const row = { browser: testInfo.project.name, model: 'Qwen/Qwen3-1.7B-MLX-4bit', totalMs: Number(await overlay.getAttribute('data-total-ms')), status: await overlay.getByRole('status').innerText(),
    labels: await overlay.locator('.translated-region').evaluateAll(nodes => nodes.map(node => ({ source: node.getAttribute('title')?.split('\n')[0], translation: node.textContent }))),
    before, after: await image.boundingBox(), paragraphBefore: paragraph, paragraphAfter: await page.locator('#after-chart').boundingBox() };
  expect(row.after).toEqual(before); expect(row.paragraphAfter).toEqual(paragraph);
  const directory = path.resolve(`artifacts/image-benchmark/${testInfo.project.name}-article-live-${Date.now()}`); await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'results.json'), JSON.stringify(row, null, 2)); await page.screenshot({ path: path.join(directory, 'article.png'), fullPage: true });
  console.log(JSON.stringify({ browser: row.browser, totalMs: row.totalMs, status: row.status, directory }));
});
