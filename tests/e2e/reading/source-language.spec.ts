import { test, expect } from '../support/fixtures';

test('中英混合网页只翻译外文语义块，中文技术段落保留原样，SPA 语言切换后增量处理', async ({ extension }, testInfo) => {
  const { page, server, toggle } = extension;
  const english = 'Read the original and discover another meaning.';
  const mixed = 'Read the 中文 guide before deployment.';
  await page.locator('main').evaluate(element => {
    document.documentElement.lang = 'en';
    element.innerHTML = '<header><h1>技术文档</h1><nav><a href="#home">首页</a><a href="#api">API设置</a><a href="#guide">English guide</a></nav></header><p id="chinese">使用 Kubernetes 与 PostgreSQL 部署服务，API 支持 3 种模式。</p><p id="address">请访问 https://example.com/technical/guide，联系 support@example.com。</p><p id="english">Read the original and discover another meaning.</p><p id="mixed">Read the 中文 guide before deployment.</p><p id="changing">这是一段中文内容，GPU 保持原样。</p>';
  });
  const originalChinese = await page.locator('#chinese').innerHTML();
  const originalAddress = await page.locator('#address').innerHTML();
  await toggle();
  await expect(page.locator('#english [data-state="done"]')).toBeVisible();
  await expect(page.locator('#mixed [data-state="done"]')).toBeVisible();
  await expect(page.locator('nav a').last().locator('[data-state="done"]')).toHaveCount(1);
  expect(server.calls.flatMap(call => call.texts ?? []).sort()).toEqual(['English guide', english, mixed].sort());
  await expect(page.locator('#chinese')).toHaveJSProperty('innerHTML', originalChinese);
  await expect(page.locator('#address')).toHaveJSProperty('innerHTML', originalAddress);
  await expect(page.locator('h1 [data-cloudys-gloss], #changing [data-cloudys-gloss]')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('mixed-language-page.png') });

  const changed = 'This paragraph has changed to English.';
  await page.locator('#changing').evaluate((element, text) => { element.textContent = text; }, changed);
  await expect(page.locator('#changing [data-state="done"]')).toBeVisible();
  expect(server.calls.flatMap(call => call.texts ?? []).filter(text => text === changed)).toHaveLength(1);
  await page.locator('#english').evaluate(element => { element.textContent = '现在改成中文内容，API 名称不需要再译。'; });
  await expect(page.locator('#english [data-cloudys-gloss]')).toHaveCount(0);
  await toggle();
  await expect(page.locator('#chinese')).toHaveJSProperty('innerHTML', originalChinese);
  await expect(page.locator('#english')).toHaveText('现在改成中文内容，API 名称不需要再译。');
  await expect(page.locator('#changing')).toHaveText(changed);
});
