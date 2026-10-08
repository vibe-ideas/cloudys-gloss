import { test, expect } from '../support/fixtures';

test('普通 HTTP 网页没有 randomUUID 时，双语正文、页眉译文与划词卡仍可用且关闭恢复原文', async ({ extension }) => {
  const { page, server } = extension;
  const errors: string[] = []; const directModelRequests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (request.url().startsWith(`${server.url}/v1/`)) directModelRequests.push(request.url()); });
  await page.route('http://gloss-http.test/reading', (route) => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>Ordinary HTTP reading</title>
      <style>body{margin:24px;font:20px/1.6 system-ui,sans-serif}header{position:fixed;top:0;left:24px;right:24px;height:44px;display:flex;align-items:center;background:white}main{margin-top:80px}h1{font-size:26px}a{color:#345}</style></head>
      <body><div id="reading-fixture"><header><a id="fixed-link" href="#reading-copy">Help center</a></header>
      <main><h1>Reading in every browser</h1><p id="reading-copy">A <strong>cloudy</strong> morning brings quiet thoughts.</p></main></div></body></html>`,
  }));
  await page.goto('http://gloss-http.test/reading');
  expect(await page.evaluate(() => ({ secure: isSecureContext, uuid: typeof crypto.randomUUID })))
    .toEqual({ secure: false, uuid: 'undefined' });
  const original = await page.locator('#reading-fixture').innerHTML();
  const control = page.locator('[data-cloudys-gloss="floating-control"]');
  await control.locator('.dock').hover();
  await control.getByRole('button', { name: '翻译当前网页', exact: true }).click();
  await expect(page.locator('#reading-copy > [data-state="done"]')).toContainText('中文译文：A cloudy morning');
  await expect(page.locator('#fixed-link > [data-state="done"]')).toContainText('中文译文：Help center');
  await page.locator('#fixed-link').focus();
  const hint = page.locator('[data-cloudys-gloss="component-hint"]');
  await expect(hint).toBeVisible();
  await expect(hint.locator('.tip')).toContainText('中文译文：Help center');
  await page.keyboard.press('Escape'); await expect(hint).toBeHidden();

  await page.locator('h1').click();
  const word = (await page.locator('#reading-copy strong').boundingBox())!;
  await page.mouse.move(word.x, word.y + word.height / 2); await page.mouse.down();
  await page.mouse.move(word.x + word.width, word.y + word.height / 2, { steps: 8 }); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe('cloudy');
  await page.getByRole('button', { name: '翻译所选内容', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'AI 单词卡' })).toBeVisible();
  await expect(page.getByText('多云的；不清晰的', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
  await control.locator('.dock').hover();
  await control.getByRole('button', { name: '恢复原文', exact: true }).click();
  await expect(page.locator('#reading-fixture')).toHaveJSProperty('innerHTML', original);
  await expect(hint).toHaveCount(0);
  expect(server.calls.some((call) => call.texts?.includes('A cloudy morning brings quiet thoughts.'))).toBe(true);
  expect(directModelRequests).toEqual([]);
  expect(errors).toEqual([]);
});
