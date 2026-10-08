import { test, expect } from '../support/fixtures';

test('扩展重新注入并遇到更新遗留悬浮球时，移入只展开一个，翻译与恢复仍各执行一次', async ({ extension }, testInfo) => {
  const { page, options, server } = extension;
  const host = page.locator('[data-cloudys-gloss="floating-control"]');
  await expect(host).toHaveCount(1);
  // Recreate orphaned Shadow DOM from an unloaded extension realm.
  await host.evaluate(element => {
    const stale = element.cloneNode(false) as HTMLElement;
    stale.attachShadow({ mode: 'open' }).innerHTML = element.shadowRoot!.innerHTML;
    document.documentElement.append(stale);
  });
  await expect(host).toHaveCount(2);
  await options.reinject(server.url);
  await expect(host).toHaveCount(1);
  await host.locator('.dock').hover();
  const width = await page.evaluate(() => document.documentElement.clientWidth);
  await expect.poll(async () => (await host.locator('.capsule').boundingBox())!.x + 70).toBe(width - 10);
  await expect(host.locator('.orb')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('single-orb-after-reinjection.png') });
  await host.locator('.orb').click();
  await expect(page.locator('#first > [data-state="done"]')).toBeVisible();
  expect(server.calls.flatMap(call => call.texts ?? []).filter(text => text === 'A cloudy morning brings quiet thoughts.')).toHaveLength(1);
  await host.locator('.orb').click();
  await expect(page.locator('[data-cloudys-gloss="translation"]')).toHaveCount(0);
  // Replace a live session too; its listeners must not survive the handoff.
  await options.reinject(server.url); await expect(host).toHaveCount(1);
  await host.locator('.dock').hover();
  await host.getByRole('button', { name: '翻译快捷菜单' }).click();
  await host.getByRole('button', { name: '本页隐藏悬浮球' }).click();
  await page.setViewportSize({ width: 800, height: 700 });
  await expect(host).toHaveCount(0);
});
