import { test, expect } from './fixtures';

test('悬浮球：一键双语与恢复、拖动不误触、窄屏贴边、快捷菜单打开设置并支持本页隐藏', async ({ extension }, testInfo) => {
  const { page, context, server } = extension;
  const host = page.locator('[data-cloudys-gloss="floating-control"]');
  await expect(host).toHaveCount(1);
  const orb = host.getByRole('button', { name: '翻译当前网页', exact: true });
  await expect(orb).toBeVisible();
  expect(await orb.evaluate((element) => getComputedStyle(element).fontSize)).not.toBe('90px');
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('floating-idle.png') });
  server.setDelay(500);
  await host.locator('.dock').hover();
  await orb.click();
  await expect(host.getByRole('button', { name: '恢复原文', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#first [data-cloudys-gloss="translation"]')).toBeVisible();
  await host.locator('.dock').hover();
  await host.getByRole('button', { name: '恢复原文', exact: true }).click();
  await expect(page.locator('[data-cloudys-gloss="translation"]')).toHaveCount(0);
  const count = server.calls.length;
  const box = (await orb.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(32, 160, { steps: 12 }); await page.mouse.up();
  await expect(orb).toHaveAttribute('aria-pressed', 'false');
  expect((await orb.boundingBox())!.x).toBeLessThan(40);
  expect(server.calls).toHaveLength(count);
  await page.mouse.move(150, 100);
  await expect.poll(async () => (await host.locator('.capsule').boundingBox())!.x).toBe(-35);
  await page.setViewportSize({ width: 390, height: 500 });
  await host.locator('.dock').hover();
  await host.getByRole('button', { name: '翻译快捷菜单' }).click();
  await expect(host.getByText('专注阅读，随时翻译', { exact: true })).toBeVisible();
  const menu = await host.locator('.menu').boundingBox();
  expect(menu!.y).toBeGreaterThanOrEqual(0); expect(menu!.y + menu!.height).toBeLessThanOrEqual(500);
  expect(menu!.x).toBeGreaterThanOrEqual(0); expect(menu!.x + menu!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('floating-control.png') });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('floating-control-dark.png') });
  await page.emulateMedia({ colorScheme: 'light' });
  await host.getByRole('button', { name: '模型设置', exact: true }).click();
  await expect.poll(() => context.pages().some((tab) => tab.url().endsWith('/options.html'))).toBe(true);
  await page.bringToFront();
  await host.locator('.dock').hover();
  await host.getByRole('button', { name: '翻译快捷菜单' }).click();
  await host.getByRole('button', { name: '本页隐藏悬浮球' }).click();
  await expect(host).toHaveCount(0);
  await page.reload(); await expect(host).toHaveCount(1);
});

test('双语阅读：只请求视口附近语义块，SPA 增量翻译，关闭恢复原文，再开启命中缓存', async ({ extension }) => {
  const { page, server, toggle } = extension;
  const original = await page.locator('main').innerHTML();
  await toggle();
  await expect(page.locator('#first > [data-state="done"]')).toContainText('中文译文：A cloudy morning');
  expect(server.calls.filter((call) => call.texts).flatMap((call) => call.texts)).not.toContain('This distant paragraph waits until you scroll.');
  expect(server.calls.some((call) => call.texts?.includes('A cloudy morning brings quiet thoughts.'))).toBeTruthy();
  expect(server.calls.flatMap((call) => call.texts ?? []).some((text) => text.includes('Private draft') || text.includes('Never translate'))).toBeFalsy();
  await page.evaluate(() => { const p = document.createElement('p'); p.id = 'added'; p.textContent = 'A new paragraph arrives.'; document.querySelector('#second')!.after(p); history.pushState({}, '', '/spa'); });
  await expect(page.locator('#added [data-cloudys-gloss]')).toContainText('中文译文');
  await page.locator('#far').scrollIntoViewIfNeeded();
  await expect(page.locator('#far [data-state="done"]')).toContainText('中文译文');
  await page.locator('#added').evaluate((element) => element.remove());
  await toggle(); expect(await page.locator('main').innerHTML()).toBe(original);
  const count = server.calls.length;
  await page.evaluate(() => window.scrollTo(0, 0)); await toggle();
  await expect(page.locator('#first [data-cloudys-gloss]')).toBeVisible();
  expect(server.calls).toHaveLength(count);
  await toggle(); await expect(page.locator('[data-cloudys-gloss="translation"]')).toHaveCount(0);
});

test('划词词卡：立即显示加载态，展示音标释义例句，隔离页面 CSS 且始终只有一个浮层', async ({ extension }, testInfo) => {
  const { page, server } = extension; server.setDelay(600);
  const select = async () => {
    await page.locator('h1').click();
    const bounds = (await page.locator('#first strong').boundingBox())!;
    await page.mouse.move(bounds.x, bounds.y + bounds.height / 2); await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width, bounds.y + bounds.height / 2, { steps: 8 }); await page.mouse.up();
    await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe('cloudy');
  };
  await select(); await expect(page.getByRole('dialog')).toBeVisible(); await expect(page.getByText('正在理解上下文…')).toBeVisible();
  await expect(page.getByText('多云的；不清晰的')).toBeVisible();
  await expect(page.getByRole('button', { name: '美式发音' })).toContainText('/ˈkɫaʊdi/');
  await expect(page.getByRole('button', { name: '英式发音' })).toContainText('/klˈaʊdi/');
  await expect(page.getByText('adjective', { exact: true })).toBeVisible(); await expect(page.locator('[data-cloudys-gloss="popover"]').getByText('A cloudy morning brings quiet thoughts.', { exact: true })).toBeVisible();
  await expect(page.getByText('多云的早晨让人思绪宁静。')).toBeVisible();
  const font = await page.getByRole('button', { name: '美式发音' }).evaluate((element) => getComputedStyle(element).fontSize); expect(font).toBe('12px');
  await page.screenshot({ path: testInfo.outputPath('word-card-light.png') });
  await page.emulateMedia({ colorScheme: 'dark' }); await page.screenshot({ path: testInfo.outputPath('word-card-dark.png') });
  const calls = server.calls.length; await select(); await expect(page.getByText('多云的；不清晰的')).toBeVisible();
  expect(server.calls).toHaveLength(calls); await expect(page.locator('[data-cloudys-gloss="popover"]')).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 500 });
  await expect.poll(async () => { const box = (await page.getByRole('dialog').boundingBox())!; return box.x >= 12 && box.x + box.width <= 390 && box.y + box.height <= 500; }).toBe(true);
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('设置页通过后台连接模型，结构错误可见且清空缓存后能够重新请求', async ({ extension }, testInfo) => {
  const { options, server } = extension;
  await options.click('测试连接');
  await expect.poll(() => options.status()).toContain('连接成功');
  server.setInvalid(true); await options.click('测试连接');
  await expect.poll(() => options.status()).toContain('结构');
  await options.click('清空缓存');
  await expect.poll(() => options.status()).toContain('已清空');
  await options.screenshot(testInfo.outputPath('options.png'));
});


test('悬浮球默认只露一半，移入展开、移出收起，键盘聚焦和菜单打开时保持展开', async ({ extension }, testInfo) => {
  const { page } = extension;
  const host = page.locator('[data-cloudys-gloss="floating-control"]');
  const capsule = host.locator('.capsule');
  const width = await page.evaluate(() => document.documentElement.clientWidth);
  const rightEdge = async () => { const box = (await capsule.boundingBox())!; return box.x + box.width; };
  await page.mouse.move(100, 100);
  await expect.poll(rightEdge).toBe(width + 35);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  await page.screenshot({ path: testInfo.outputPath('edge-collapsed.png') });
  await host.locator('.dock').hover();
  await expect.poll(rightEdge).toBe(width - 10);
  await page.screenshot({ path: testInfo.outputPath('edge-expanded.png') });
  await page.mouse.move(100, 100);
  await expect.poll(rightEdge).toBe(width + 35);
  // Tab enters the first extension button after the document's last focusable field.
  await page.locator('[contenteditable]').focus();
  await page.keyboard.press('Tab');
  await expect(host.locator('.orb')).toBeFocused();
  await expect.poll(rightEdge).toBe(width - 10);
  await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
  await expect(host.locator('.menu')).toBeVisible();
  await page.locator('[contenteditable]').focus();
  await expect.poll(rightEdge).toBe(width - 10);
  await page.keyboard.press('Escape');
  await expect(host.locator('.menu')).toHaveCount(0);
  await expect.poll(rightEdge).toBe(width + 35);
});


test.describe('系统开启减少动态效果', () => {
  test.use({ motion: 'reduce' });
  test('悬浮球直接展开，段落加载提示静止，首段译文仍及时显示', async ({ extension }) => {
    const { page, server } = extension;
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    const host = page.locator('[data-cloudys-gloss="floating-control"]');
    const capsule = host.locator('.capsule');
    expect(await capsule.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe('0s');
    await host.locator('.dock').hover();
    const box = (await capsule.boundingBox())!;
    expect(box.x + box.width).toBe(await page.evaluate(() => document.documentElement.clientWidth - 10));
    server.holdStreams();
    await host.getByRole('button', { name: '翻译当前网页', exact: true }).click();
    await expect(page.locator('[data-state="partial"]').first()).toContainText('中文译文');
    const dot = page.locator('[data-state="translating"] [data-gloss-part="loader"] i').first();
    await expect(dot).toBeVisible();
    expect(await dot.evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
    await host.getByRole('button', { name: '恢复原文', exact: true }).click();
    await expect(page.locator('[data-cloudys-gloss="motion"]')).toHaveCount(0);
  });
});


test('网页拦截鼠标事件时，拖选单词仍展示词卡，点击卡外关闭', async ({ extension }) => {
  const { page } = extension;
  await page.locator('main').evaluate((element) => {
    element.addEventListener('pointerup', (event) => event.stopPropagation());
    element.addEventListener('pointerdown', (event) => event.stopPropagation());
  });
  const bounds = (await page.locator('#first strong').boundingBox())!;
  await page.mouse.move(bounds.x, bounds.y + bounds.height / 2); await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width, bounds.y + bounds.height / 2, { steps: 8 }); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe('cloudy');
  await expect(page.getByRole('dialog', { name: 'AI 单词卡' })).toBeVisible({ timeout: 3000 });
  await expect(page.getByRole('button', { name: '美式发音' })).toContainText('/ˈkɫaʊdi/');
  await page.locator('h1').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
