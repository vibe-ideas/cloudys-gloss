import { test, expect } from '../support/fixtures';

test('Delightful 划词先显示内置释义，慢模型和结构错误不遮挡词典，重试仍保留原词卡', async ({ extension }, testInfo) => {
  const { page, server } = extension;
  await page.locator('#first strong').evaluate(element => { element.textContent = 'Delightful'; });
  const timings: number[] = [];
  const open = async () => {
    await page.locator('h1').click();
    const box = (await page.locator('#first strong').boundingBox())!;
    await page.mouse.move(box.x, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width, box.y + box.height / 2, { steps: 8 }); await page.mouse.up();
    const launcher = page.getByRole('button', { name: '翻译所选内容', exact: true });
    await expect(launcher).toBeVisible();
    const start = performance.now(); await launcher.click();
    await expect(page.getByRole('region', { name: '本地词库释义' })).toContainText('令人愉快的');
    timings.push(performance.now() - start);
  };
  server.setDelay(5000);
  for (let i = 0; i < 2; i++) {
    await open();
    await expect(page.getByText('AI 语境解释准备中', { exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveAttribute('aria-busy', 'false');
    expect(timings[i]).toBeLessThan(1500);
    await page.getByRole('button', { name: '关闭词卡' }).click();
  }
  server.setDelay(0); server.setInvalid(true);
  await open();
  await expect(page.getByText('AI 语境解释暂不可用，词典释义仍可阅读。')).toBeVisible();
  await expect(page.getByRole('region', { name: '本地词库释义' })).toContainText('令人愉快的');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByText('错误原因', { exact: true }).click();
  await expect(page.getByText(/模型输出不符合结构要求/)).toBeVisible();
  server.setInvalid(false); server.setDelay(5000);
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByText('AI 语境解释准备中', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '本地词库释义' })).toContainText('令人愉快的');
  await page.screenshot({ path: testInfo.outputPath('dictionary-first.png') });
  await page.getByRole('button', { name: '关闭词卡' }).click();
  console.log(`${testInfo.project.name} dictionary cold/warm/error preview (ms): ${timings.map(ms => ms.toFixed(1)).join(', ')}`);
  await testInfo.attach('dictionary-preview-timing', { body: JSON.stringify({ browser: testInfo.project.name, timings, note: 'Includes Playwright click and visibility assertion; model delayed 5 seconds in first two trials.' }), contentType: 'application/json' });
});
