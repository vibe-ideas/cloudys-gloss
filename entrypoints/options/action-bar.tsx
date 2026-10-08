import type { SettingsForm } from './use-settings';

/** Always-visible bar: every page-level action reports here, so feedback never scrolls out of view. */
export function ActionBar({ form, formId }: { form: SettingsForm; formId: string }) {
  const { notice, dirty, busy, ready, perform } = form;
  const text = notice.text || (dirty ? '有未保存的更改' : '');
  return <div class={`action-bar${dirty ? ' dirty' : ''}`}>
    <p class={`status${notice.error ? ' error' : ''}`} role="status">{text}</p>
    <div class="action-buttons">
      <button type="button" disabled={busy || !ready} onClick={() => void perform('test')}>测试连接</button>
      <button class="primary" type="submit" form={formId} disabled={busy || !ready}>保存设置</button>
    </div>
  </div>;
}
