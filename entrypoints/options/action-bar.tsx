import type { SettingsForm } from './use-settings';

/** Always-visible bar: every page-level action reports here, so feedback never scrolls out of view. */
export function ActionBar({ form, formId }: { form: SettingsForm; formId: string }) {
  const { notice, dirty, busy, ready, perform } = form;
  const text = notice.text || (!ready ? '正在读取设置…' : dirty ? '有未保存的更改' : '修改后，点击保存设置');
  return <div class={`action-bar${dirty ? ' dirty' : ''}${busy ? ' busy' : ''}`} aria-busy={busy}>
    <p class={`status${notice.error ? ' error' : ''}`} role="status"><span class="save-indicator" aria-hidden="true" />{text}</p>
    <div class="action-buttons">
      <button type="button" disabled={busy || !ready} onClick={() => void perform('test')}>测试连接</button>
      <button class="primary" type="submit" form={formId} disabled={busy || !ready}>保存设置</button>
    </div>
  </div>;
}
