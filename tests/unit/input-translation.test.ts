import { afterEach, describe, expect, it, vi } from 'vitest';
import { InputTranslation } from '../../src/input-translation';

let controller: InputTranslation;
afterEach(() => { controller?.destroy(); document.body.replaceChildren(); vi.restoreAllMocks(); });
function setup(text = '请在周五之前审核这个修改。', type = 'textarea') {
  const editor = document.createElement(type === 'textarea' ? 'textarea' : 'input');
  if (editor instanceof HTMLInputElement) editor.type = type;
  document.body.append(editor); editor.value = text; editor.focus(); editor.setSelectionRange(text.length, text.length);
  let resolve!: (text: string) => void; let reject!: (error: Error) => void;
  const translate = vi.fn(() => new Promise<string>((yes, no) => { resolve = yes; reject = no; }));
  const cancel = vi.fn(); controller = new InputTranslation({ translate, cancel });
  return { editor, translate, cancel, resolve: (text: string) => resolve(text), reject: (error: Error) => reject(error) };
}
function key(editor: HTMLElement, key: string, options: KeyboardEventInit = {}, trusted = true) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, composed: true, ...options });
  Object.defineProperty(event, 'isTrusted', { value: trusted });
  editor.dispatchEvent(event);
  if (!event.defaultPrevented && key === ' ' && (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement)) {
    const start = editor.selectionStart!;
    editor.setRangeText(' ', start, editor.selectionEnd!, 'end'); editor.setSelectionRange(start + 1, start + 1);
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: ' ' }));
  }
  return event;
}
const four = (editor: HTMLElement) => { for (let i = 0; i < 4; i++) key(editor, ' '); };
const status = () => document.querySelector('[data-cloudys-gloss="input-translation"]')?.shadowRoot?.textContent ?? '';

describe('输入框连续四下空格翻译为英文', () => {
  it('前三次按键正常输入空格，第四次消费快捷指令并请求整个草稿，完成后可撤销', async () => {
    const source = '请在周五之前审核这个修改。';
    const { editor, translate, resolve } = setup(source);
    for (let i = 0; i < 3; i++) key(editor, ' ');
    expect(editor.value).toBe(source + '   '); expect(translate).not.toHaveBeenCalled();
    expect(key(editor, ' ').defaultPrevented).toBe(true);
    expect(editor.value).toBe(source); expect(translate).toHaveBeenCalledWith(expect.any(String), source);
    resolve('Please review this change before Friday.');
    await vi.waitFor(() => expect(editor.value).toBe('Please review this change before Friday.'));
    document.querySelector('[data-cloudys-gloss="input-translation"]')!.shadowRoot!.querySelector('button')!.click();
    expect(editor.value).toBe(source);
  });
  it('光标在句子中间时仅移除触发的三个空格，完整前后文本一起翻译', () => {
    const { editor, translate } = setup('请审核这个修改。'); editor.setSelectionRange(2, 2);
    four(editor); expect(editor.value).toBe('请审核这个修改。');
    expect(translate).toHaveBeenCalledWith(expect.any(String), '请审核这个修改。');
  });
  it('输入法选词、长按连发、组合键以及网页伪造按键均不请求模型', () => {
    const { editor, translate } = setup();
    editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); four(editor);
    editor.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    for (let i = 0; i < 4; i++) key(editor, ' ', { repeat: true });
    for (let i = 0; i < 4; i++) key(editor, ' ', { ctrlKey: true });
    for (let i = 0; i < 4; i++) key(editor, ' ', {}, false);
    expect(translate).not.toHaveBeenCalled();
  });
  it('两个空格之间超过 650 毫秒时不将普通输入拼成快捷指令', () => {
    const { editor, translate } = setup();
    let time = 0; vi.spyOn(performance, 'now').mockImplementation(() => time);
    for (let i = 0; i < 4; i++) { key(editor, ' '); time += 700; }
    expect(translate).not.toHaveBeenCalled();
  });
  it.each(['password', 'readonly', 'one-time-code', 'disabled', 'setting-off'])('%s 输入保护开启时四下空格不发送草稿', mode => {
    const { editor, translate } = setup('私密内容', mode === 'password' ? 'password' : 'textarea');
    if (mode === 'readonly') editor.readOnly = true;
    if (mode === 'disabled') editor.disabled = true;
    if (mode === 'one-time-code') editor.autocomplete = 'one-time-code';
    if (mode === 'setting-off') controller.setEnabled(false);
    four(editor); expect(translate).not.toHaveBeenCalled();
  });
  it('等待译文时继续输入会取消请求，旧结果晚到不会覆盖新草稿', async () => {
    const { editor, cancel, resolve } = setup(); four(editor);
    editor.value = '这是后面新写的内容。'; editor.dispatchEvent(new InputEvent('input', { bubbles: true, data: '。' }));
    expect(cancel).toHaveBeenCalledOnce(); resolve('Old translation.');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(editor.value).toBe('这是后面新写的内容。'); expect(status()).toBe('');
  });
  it('按 Esc 取消后后台拒绝请求，也不重新弹出失败提示', async () => {
    const { editor, cancel, reject } = setup(); four(editor); key(editor, 'Escape');
    reject(new Error('Aborted')); await new Promise(resolve => setTimeout(resolve, 0));
    expect(cancel).toHaveBeenCalledOnce(); expect(status()).toBe(''); expect(editor.value).toBe('请在周五之前审核这个修改。');
  });
  it('页面脚本静默改变 value 时丢弃旧结果，不覆盖程序更新', async () => {
    const { editor, resolve } = setup(); four(editor); editor.value = '程序更新'; resolve('Old translation.');
    await new Promise(resolve => setTimeout(resolve, 0)); expect(editor.value).toBe('程序更新');
  });
  it('模型返回 HTTP 错误时保留原文并显示原因，再按四下空格可重试', async () => {
    const { editor, translate, reject } = setup(); four(editor); reject(new Error('HTTP 503'));
    await vi.waitFor(() => expect(status()).toContain('HTTP 503'));
    expect(editor.value).toBe('请在周五之前审核这个修改。'); four(editor); expect(translate).toHaveBeenCalledTimes(2);
  });
  it('英文超过输入框 maxlength 时保留完整原文，避免提交截断的译文', async () => {
    const { editor, resolve } = setup('你好'); editor.maxLength = 8; four(editor); resolve('Hello, how are you today?');
    await vi.waitFor(() => expect(status()).toContain('超出输入框限制')); expect(editor.value).toBe('你好');
  });
  it('替换文本时发出 input 通知，使依赖输入事件的表单状态同步更新', async () => {
    const { editor, resolve } = setup(); let state = '';
    editor.addEventListener('input', () => { state = editor.value; }); four(editor); resolve('Please review this change.');
    await vi.waitFor(() => expect(state).toBe('Please review this change.'));
  });
  it('停用功能或销毁页面实例时终止未完成请求并移除提示', () => {
    const { editor, cancel } = setup(); four(editor); controller.destroy();
    expect(cancel).toHaveBeenCalledOnce(); expect(status()).toBe('');
  });
});
