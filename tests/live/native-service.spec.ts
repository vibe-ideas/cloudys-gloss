import { test, expect } from '../e2e/support/fixtures';
import { defaults } from '../../src/core/schema';

test('浏览器启停真实 MLX 并保留自启偏好，服务停止后点击翻译会自动启动并显示中文', async ({ extension }, testInfo) => {
  const { options, page } = extension;
  let lastStatus = '';
  const modelStatus = async () => {
    const value = await options.modelStatus();
    if (value !== lastStatus) { console.log(`${testInfo.project.name}: ${value}`); lastStatus = value; }
    return value;
  };
  await expect.poll(() => modelStatus()).toMatch(/MLX 已(启动|停止)/);
  const originalAutostart = (await options.modelStatus()).includes('登录自启开启');
  try {
    // Explicitly test on-demand use with login startup switched off.
    if (originalAutostart) {
      await options.click('关闭登录自启');
      await expect.poll(() => modelStatus()).toContain('登录自启关闭');
    }
    if ((await options.modelStatus()).includes('已启动')) {
      await options.click('停止模型');
      await expect.poll(() => modelStatus()).toContain('MLX 已停止');
    }
    const manualStart = Date.now();
    await options.click('启动模型');
    await expect.poll(() => modelStatus()).toContain('MLX 已启动 · 登录自启关闭');
    const manualStartMs = Date.now() - manualStart;
    await options.click('停止模型');
    await expect.poll(() => modelStatus()).toContain('MLX 已停止 · 登录自启关闭');
    await options.fill('baseUrl', defaults.baseUrl); await options.fill('model', defaults.model);
    await options.fill('timeout', '120000'); await options.fill('concurrency', '1');
    await options.click('保存设置'); await expect.poll(() => options.status()).toContain('设置已保存');
    const started = Date.now();
    await page.locator('[data-cloudys-gloss="floating-control"] .dock').hover();
    await page.getByRole('button', { name: '翻译当前网页', exact: true }).click();
    await expect(page.locator('#first > [data-state="done"]')).toContainText(/[\u4e00-\u9fff]/);
    const translateFromStoppedMs = Date.now() - started;
    await options.click('刷新状态');
    await expect.poll(() => modelStatus()).toContain('MLX 已启动 · 登录自启关闭');
    await page.screenshot({ path: testInfo.outputPath('native-start-bilingual.png') });
    await options.screenshot(testInfo.outputPath('native-controls.png'));
    console.log(`${testInfo.project.name}: ${JSON.stringify({ manualStartMs, translateFromStoppedMs })}`);
    await testInfo.attach('native-startup', { body: JSON.stringify({ manualStartMs, translateFromStoppedMs }), contentType: 'application/json' });
    await page.locator('[data-cloudys-gloss="floating-control"] .dock').hover();
    await page.getByRole('button', { name: '恢复原文', exact: true }).click();
    await options.click('测试连接');
    await expect.poll(() => options.status()).toContain('连接成功');
  } finally {
    await options.click('刷新状态');
    await expect.poll(() => modelStatus()).toMatch(/MLX 已(启动|停止)/);
    const currentAutostart = (await options.modelStatus()).includes('登录自启开启');
    if (currentAutostart !== originalAutostart) {
      await options.click(originalAutostart ? '开启登录自启' : '关闭登录自启');
      await expect.poll(() => modelStatus()).toContain(originalAutostart ? '登录自启开启' : '登录自启关闭');
    }
  }
});
