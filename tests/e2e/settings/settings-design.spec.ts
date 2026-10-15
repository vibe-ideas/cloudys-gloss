import { test, expect } from '../support/fixtures';
import type { BrowserContext } from '@playwright/test';

// These cases inspect extension-page DOM directly; Firefox only exposes the options page through the command bridge.
test.beforeEach(({ browserName }, testInfo) => { void browserName; test.skip(testInfo.project.name !== 'chromium', 'Extension page DOM is only reachable in Chromium'); });
const optionsPage = (context: BrowserContext) => context.pages().find(page => page.url().endsWith('/options.html'))!;

test('设置页预设反映当前地址，未保存提示只在草稿与已保存值不同时出现，保存后重开仍保持', async ({ extension }) => {
  const { options, context } = extension; const page = optionsPage(context);
  const preset = (name: string) => page.getByRole('group', { name: '服务预设' }).getByRole('button', { name });
  // The fixture saved a test server URL, which is neither built-in preset.
  await expect(preset('自定义')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('status')).not.toContainText('未保存');
  await expect(page.locator('[name="temperature"]')).toBeHidden();

  await preset('Ollama').click();
  await expect(preset('Ollama')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[name="baseUrl"]')).toHaveValue('http://localhost:11434/v1');
  await expect(page.getByRole('status')).toContainText('有未保存的更改');
  await options.click('保存设置'); await expect(page.getByRole('status')).toContainText('设置已保存');

  await options.fill('model', 'draft-model'); await expect(page.getByRole('status')).toContainText('有未保存的更改');
  await options.fill('model', 'qwen2.5:7b'); await expect(page.getByRole('status')).not.toContainText('未保存');
  await options.fill('concurrency', '2'); await expect(page.locator('.advanced summary')).toContainText('并发 2');

  await options.reload();
  await expect(preset('Ollama')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.advanced summary')).toContainText('并发 1');
});

test('弹窗在无法翻译的页面给出警示，并把打开 PDF 作为可用的主操作', async ({ extension }) => {
  const { context } = extension; const host = new URL(optionsPage(context).url()).host;
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${host}/popup.html`);
  await expect(popup.getByRole('status')).toContainText('当前页面无法翻译');
  await expect(popup.locator('.state')).toHaveClass(/warn/);
  await expect(popup.getByRole('button', { name: '翻译当前网页' })).toHaveCount(0);
  const reader = context.waitForEvent('page');
  await popup.getByRole('button', { name: '打开 PDF 文件或链接' }).click();
  await expect.poll(async () => (await reader).url()).toContain('/pdf.html');
});


test('从工具栏打开设置时使用独立标签页，再次打开复用该页并保留未保存草稿', async ({ extension }) => {
  const { context } = extension;
  const initial = optionsPage(context); const url = initial.url();
  await initial.close();
  const popup = await context.newPage();
  await popup.goto(new URL('popup.html', url).href);
  const opened = context.waitForEvent('page');
  await popup.getByRole('button', { name: '模型设置', exact: true }).click();
  const settings = await opened;
  await expect(settings).toHaveURL(url);
  await expect(settings.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
  await expect(settings.getByRole('button', { name: '保存设置', exact: true })).toBeEnabled();
  await settings.locator('[name="model"]').fill('unsaved-model');
  await popup.bringToFront();
  await popup.getByRole('button', { name: '模型设置', exact: true }).click();
  await expect.poll(() => settings.evaluate(async () => {
    const api = (globalThis as unknown as { chrome: typeof import('wxt/browser').browser }).chrome;
    return (await api.tabs.getCurrent())?.active;
  })).toBe(true);
  expect(context.pages().filter(page => page.url() === url)).toHaveLength(1);
  expect(context.pages().some(page => page.url().startsWith('chrome://extensions'))).toBe(false);
  await expect(settings.locator('[name="model"]')).toHaveValue('unsaved-model');
});

test('设置页在桌面和窄窗口中可按分区导航，表单与保存按钮不横向溢出', async ({ extension }, testInfo) => {
  const page = optionsPage(extension.context);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const navigation = page.getByRole('navigation', { name: '设置分区' });
    await navigation.getByRole('link', { name: '离线词库', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#dictionary$/);
    await expect(page.locator('#dictionary')).toBeFocused();
    await expect(page.getByRole('heading', { name: '我的离线词库' })).toBeInViewport();
    await expect(page.getByRole('button', { name: '保存设置', exact: true })).toBeInViewport();
    await navigation.getByRole('link', { name: '模型连接', exact: true }).click();
    await expect(page.locator('[name="baseUrl"]')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`settings-${width}.png`), fullPage: true });
  }
});
