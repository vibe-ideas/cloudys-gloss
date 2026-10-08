import { test, expect } from './fixtures';
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
