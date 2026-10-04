import { writeFile } from 'node:fs/promises';
import { test, expect } from './fixtures';

test('常见组件：页眉、面包屑、按钮、表单标签和表头默认显示双语，窄屏无重叠且交互名称保持原样', async ({ extension }, testInfo) => {
  const { page, server, toggle } = extension;
  await page.goto(`${server.url}/component-design`);
  const header = await page.locator('#header').innerHTML();
  await toggle();
  await expect(page.locator('#header a').first().locator('[data-state=done]')).toHaveText('产品与解决方案');
  await expect(page.locator('.breadcrumbs [aria-current] > [data-state=done]')).toHaveText('快速开始');
  await expect(page.locator('#save > [data-state=done]')).toHaveText('保存当前更改');
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toHaveAccessibleName('Save changes');
  await expect(page.locator('#save')).toHaveAccessibleDescription('Stores the current form. 保存当前更改');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.locator('#save')).toHaveAttribute('data-clicked', 'true');
  await expect(page.locator('#disabled')).toBeDisabled();
  await page.locator('table').scrollIntoViewIfNeeded();
  await expect(page.locator('th [data-state=done]')).toHaveCount(3);
  await expect(page.locator('label[for=email] > [data-state=done]')).toHaveText('电子邮箱地址');
  await page.locator('#email').click();
  await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.press('Backspace');
  await expect(page.locator('#email')).toHaveValue('');
  await page.keyboard.type('changed@example.test');
  await expect(page.locator('#email')).toHaveValue('changed@example.test');
  await page.getByRole('checkbox', { name: 'Email updates', exact: true }).check();
  await expect(page.getByRole('checkbox', { name: 'Email updates', exact: true })).toHaveAccessibleDescription('接收邮件更新');
  await expect(page.getByRole('textbox', { name: 'Email address', exact: true })).toHaveAccessibleDescription('电子邮箱地址');
  for (const width of [1100, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect.poll(() => page.evaluate(() => {
      const visible = [...document.querySelectorAll<HTMLElement>('[data-gloss-mode=component][data-state=done]')].filter(node => node.getBoundingClientRect().height > 0);
      const contained = visible.every(node => {
        const rect = node.getBoundingClientRect(); const parent = node.parentElement!.getBoundingClientRect();
        return rect.bottom <= parent.bottom + 1 && rect.right <= parent.right + 1;
      });
      const sources = [...document.querySelectorAll('header a,.breadcrumbs li,.toolbar button,[role=tab]')];
      const separated = sources.every((node, i) => sources.slice(i + 1).every(other => {
        if (node.parentElement !== other.parentElement) return true;
        const a = node.getBoundingClientRect(); const b = other.getBoundingClientRect();
        return a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1;
      }));
      return contained && separated && document.documentElement.scrollWidth <= innerWidth;
    })).toBe(true);
    await page.screenshot({ fullPage: true, animations: 'disabled', path: testInfo.outputPath(`components-${width}.png`) });
  }
  expect(server.calls.flatMap(call => call.texts ?? []).some(text => /private@example|changed@example/.test(text))).toBe(false);
  await toggle();
  await expect(page.locator('#header')).toHaveJSProperty('innerHTML', header);
  await expect(page.locator('#email')).toHaveValue('changed@example.test');
  await expect(page.locator('#updates')).toBeChecked();
  await expect(page.locator('#save')).toHaveAttribute('aria-describedby', 'save-help');
  await expect(page.locator('main [data-cloudys-gloss]')).toHaveCount(0);
});

test('折叠、标签面板和菜单只改变显隐属性时，展开后增量翻译且点击与键盘操作正常', async ({ extension }, testInfo) => {
  const { page, server, toggle } = extension;
  await page.goto(`${server.url}/component-design`); await toggle();
  await expect(page.locator('summary > [data-state=done]')).toHaveText('高级选项与说明');
  expect(server.calls.flatMap(call => call.texts ?? [])).not.toContain('Download report');
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await expect(page.locator('#settings-panel p > [data-state=done]')).toContainText('切换标签');
  await page.locator('summary').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('details')).toHaveAttribute('open', '');
  await expect(page.locator('details p > [data-state=done]')).toContainText('展开后的说明');
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Download report', exact: true }).locator('[data-state=done]')).toHaveText('下载当前报告');
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  await expect(page.locator('#menu')).toBeHidden();
  await page.getByRole('button', { name: 'Open dialog', exact: true }).click();
  await expect(page.locator('dialog p > [data-state=done]')).toContainText('此对话框');
  await page.locator('dialog p').hover();
  const modalHint = page.locator('[data-cloudys-gloss=component-hint] .tip');
  await expect(modalHint).toContainText('此对话框');
  await expect(modalHint).toBeVisible();
  await expect.poll(() => modalHint.evaluate(node => {
    const rect = node.getBoundingClientRect();
    const host = (node.getRootNode() as ShadowRoot).host;
    return host.matches(':popover-open') && host.closest('dialog[open]') !== null && rect.width > 0 && rect.height > 0;
  })).toBe(true);
  await expect(modalHint).toHaveCSS('pointer-events', 'none');
  await expect.poll(() => modalHint.evaluate(node => {
    const tip = node.getBoundingClientRect(); const close = document.querySelector('#close-dialog')!.getBoundingClientRect();
    return tip.right <= close.left || close.right <= tip.left || tip.bottom <= close.top || close.bottom <= tip.top;
  })).toBe(true);
  await expect.poll(() => page.locator('#close-dialog').evaluate(node => {
    const rect = node.getBoundingClientRect(); const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return target === node || !!target && node.contains(target);
  })).toBe(true);
  await page.screenshot({ animations: 'disabled', caret: 'initial', path: testInfo.outputPath('modal-translation-hint.png') });
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(page.locator('dialog')).not.toBeVisible();
});

test('固定与吸顶控件不撑开壳，键盘提示在缩窄与鼠标移出后保持可见，长译文滚动和Esc均正常', async ({ extension }, testInfo) => {
  const { page, server, toggle } = extension;
  await page.goto(`${server.url}/component-design`);
  const heights = await page.locator('.fixed-tools,.sticky-tools').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
  await toggle();
  await expect(page.locator('#fixed-help > [data-state=done]')).toHaveText('固定工具栏帮助');
  expect(await page.locator('.fixed-tools,.sticky-tools').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height))).toEqual(heights);
  await page.locator('#fixed-help').focus();
  const hint = page.locator('[data-cloudys-gloss=component-hint]');
  await expect(hint.locator('.tip')).toContainText('固定工具栏帮助');
  const source = (await page.locator('#fixed-help').boundingBox())!; const tip = (await hint.locator('.tip').boundingBox())!;
  expect(tip.y + tip.height).toBeLessThanOrEqual(source.y);
  await page.keyboard.press('Escape'); await expect(hint).toBeHidden();
  await expect(page.locator('#fixed-help')).toBeFocused();
  await page.locator('#sticky-account').hover(); await expect(hint.locator('.tip')).toContainText('吸顶账户入口');
  await page.mouse.move(1, 120); await expect(hint).toBeHidden();
  await page.setViewportSize({ width: 390, height: 640 });
  await page.locator('#long-help').focus();
  await expect(hint.locator('.tip')).toContainText('需要完整保留');
  // Some engines deliver the resize/pointer exit after the control's focusin.
  // Replay that ordering directly rather than hoping a CI machine reproduces it.
  await page.locator('#long-help').evaluate(node => {
    window.dispatchEvent(new Event('resize'));
    node.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse', relatedTarget: document.body }));
  });
  await expect(hint.locator('.tip')).toBeVisible();
  await expect(page.locator('#long-help')).toBeFocused();
  const bounds = (await hint.locator('.tip').boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(11); expect(bounds.y).toBeGreaterThanOrEqual(11);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(379); expect(bounds.y + bounds.height).toBeLessThanOrEqual(629);
  await hint.locator('.tip').evaluate(node => { node.scrollTop = node.scrollHeight; });
  await expect(hint).toBeVisible();
  await expect.poll(() => hint.locator('.tip').evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  await page.setViewportSize({ width: 360, height: 600 });
  await expect(hint.locator('.tip')).toBeVisible();
  await expect(page.locator('#long-help')).toBeFocused();
  let resized: unknown;
  try {
    await expect.poll(async () => {
      resized = await hint.locator('.tip').evaluate(node => {
        const bounds = node.getBoundingClientRect();
        return { inside: bounds.x >= 11 && bounds.y >= 11 && bounds.right <= innerWidth - 11 && bounds.bottom <= innerHeight - 11,
          scrolled: node.scrollTop > 0, scrollTop: node.scrollTop, bounds: bounds.toJSON(), viewport: [innerWidth, innerHeight] };
      });
      return resized;
    }).toMatchObject({ inside: true, scrolled: true });
  } finally {
    const geometryPath = testInfo.outputPath('hint-resize-geometry.json');
    await writeFile(geometryPath, JSON.stringify(resized ?? { error: '提示几何尚不可读取' }, null, 2));
    await testInfo.attach('hint-resize-geometry.json', { contentType: 'application/json', path: geometryPath });
  }
  await expect(page.locator('[data-cloudys-gloss=component-hint]')).toHaveCount(1);
  await page.screenshot({ animations: 'disabled', caret: 'initial', path: testInfo.outputPath('hint-resize-360.png') });
  await toggle(); await expect(hint).toHaveCount(0);
  await expect(page.locator('#fixed-help')).not.toHaveAttribute('aria-describedby');
});
