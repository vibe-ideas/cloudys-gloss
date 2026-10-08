import { test, expect } from '../support/fixtures';
import type { Page } from '@playwright/test';

async function prepare(page: Page) {
  await expect(page.locator('[data-cloudys-gloss="floating-control"]')).toHaveCount(1);
  await page.evaluate(() => {
    const form = document.createElement('form'); form.id = 'compose';
    form.innerHTML = '<label>Message<textarea id="draft" rows="4"></textarea></label><input id="plain"><input id="secret" type="password"><div id="rich" contenteditable="true" role="textbox" aria-label="Rich message"></div><div id="shadow"></div>';
    form.addEventListener('submit', event => { event.preventDefault(); form.dataset.submitted = 'true'; });
    form.addEventListener('input', event => {
      const editor = event.target as HTMLInputElement;
      if (editor.id === 'draft') form.dataset.draft = editor.value;
    });
    form.querySelector('#shadow')!.attachShadow({ mode: 'open' }).innerHTML = '<input aria-label="Shadow draft">';
    document.body.prepend(form);
  });
}
async function four(page: Page) { for (let i = 0; i < 4; i++) await page.keyboard.press('Space'); }
const notice = (page: Page) => page.locator('[data-cloudys-gloss="input-translation"]');

test('多行草稿四下空格后后台返回英文、表单收到输入事件，撤销恢复原文且不自动提交', async ({ extension }) => {
  const { page, server } = extension; await prepare(page);
  const source = '请审核这个修改。\n周五前给我反馈。';
  const english = 'Please review this change.\nGive me feedback before Friday.';
  server.setTranslation(source, english);
  await page.locator('#draft').fill(source); await four(page);
  await expect(page.locator('#draft')).toHaveValue(english);
  await expect(page.locator('#compose')).toHaveAttribute('data-draft', english);
  expect(server.calls.filter(call => call.text)).toEqual([{ text: source }]);
  await notice(page).getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.locator('#draft')).toHaveValue(source);
  await expect(page.locator('#compose')).not.toHaveAttribute('data-submitted', 'true');
});

test('富文本草稿保留段落换行作为翻译输入，替换后原生撤销恢复原有加粗内容', async ({ extension }, testInfo) => {
  const { page, server } = extension; await prepare(page);
  const source = '请审核这个修改。\n周五前给我反馈。';
  const english = 'Please review this change.\nGive me feedback before Friday.';
  server.setTranslation(source, english);
  await page.locator('#rich').evaluate(element => {
    element.innerHTML = '<p><strong>请审核</strong>这个修改。</p><p>周五前给我反馈。</p>';
    (element as HTMLElement).focus();
    const range = document.createRange(); range.selectNodeContents(element.lastChild!); range.collapse(false);
    const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  });
  await four(page);
  await expect(page.locator('#rich')).toContainText('Please review this change.');
  await expect(page.locator('#rich')).toContainText('Give me feedback before Friday.');
  expect(server.calls.filter(call => call.text)).toEqual([{ text: source }]);
  await page.screenshot({ path: testInfo.outputPath('input-translation.png') });
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('#rich strong')).toHaveText('请审核');
  await expect(page.locator('#rich p')).toHaveCount(2);
});

test('慢请求期间用户继续修改草稿或按 Esc，后台旧译文返回后不覆盖当前内容', async ({ extension }) => {
  const { page, server } = extension; await prepare(page); server.setDelay(500);
  await page.locator('#draft').fill('请审核这个修改。'); await four(page);
  await expect.poll(() => server.calls.filter(c => c.text).length).toBe(1);
  await page.keyboard.insertText('我又加了一句。');
  await expect(notice(page)).toHaveCount(0);
  await page.waitForTimeout(650);
  await expect(page.locator('#draft')).toHaveValue('请审核这个修改。我又加了一句。');
  await four(page); await expect(notice(page)).toContainText('正在翻译');
  await page.keyboard.press('Escape'); await page.waitForTimeout(650);
  await expect(notice(page)).toHaveCount(0);
  await expect(page.locator('#draft')).toHaveValue('请审核这个修改。我又加了一句。');
});

test('密码框、输入法选词和长按空格不触发，结束输入法后四次独立按键才翻译', async ({ extension }) => {
  const { page, server } = extension; await prepare(page);
  await page.locator('#secret').fill('私密内容'); await four(page);
  await page.locator('#draft').fill('请审核这个修改。');
  await page.locator('#draft').evaluate(element => element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
  await four(page);
  await page.locator('#draft').evaluate(element => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  for (let i = 0; i < 5; i++) await page.keyboard.down('Space');
  await page.keyboard.up('Space');
  expect(server.calls).toHaveLength(0);
  await page.locator('#draft').fill('请审核这个修改。'); await four(page);
  await expect(page.locator('#draft')).toHaveValue('Please review this change before Friday.');
  expect(server.calls.filter(call => call.text)).toHaveLength(1);
});

test('服务报错后原文保留并显示原因，四下空格重试可成功', async ({ extension }) => {
  const { page, server } = extension; await prepare(page); server.setTranslationFailure(503);
  await page.locator('#plain').fill('请审核这个修改。'); await four(page);
  await expect(notice(page)).toContainText('HTTP 503');
  await expect(page.locator('#plain')).toHaveValue('请审核这个修改。');
  server.setTranslationFailure(0); await four(page);
  await expect(page.locator('#plain')).toHaveValue('Please review this change before Friday.');
});

test('开放 Shadow DOM 内的输入框也能通过后台翻译为英文', async ({ extension }) => {
  const { page, server } = extension; await prepare(page);
  const input = page.getByRole('textbox', { name: 'Shadow draft' });
  await input.fill('请审核这个修改。'); await four(page);
  await expect(input).toHaveValue('Please review this change before Friday.');
  expect(server.calls.filter(call => call.text)).toHaveLength(1);
});

test('设置关闭快捷翻译后已打开网页保留四个空格，重新开启后无需刷新即可翻译', async ({ extension }) => {
  const { page, server, options } = extension; await prepare(page);
  await options.select('inputTranslation', 'false'); await options.click('保存设置');
  await expect.poll(() => options.status()).toContain('设置已保存');
  await page.locator('#plain').fill('请审核这个修改。'); await four(page);
  await expect(page.locator('#plain')).toHaveValue('请审核这个修改。    ');
  expect(server.calls).toHaveLength(0);
  await options.select('inputTranslation', 'true'); await options.click('保存设置');
  await expect.poll(() => options.status()).toContain('设置已保存');
  await page.locator('#plain').fill('请审核这个修改。'); await four(page);
  await expect(page.locator('#plain')).toHaveValue('Please review this change before Friday.');
});
