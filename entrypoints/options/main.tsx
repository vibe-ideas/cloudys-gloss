import { render } from 'preact';
import { BrandMark } from '../../src/ui/brand-mark';
import { ModelControls } from '../../src/model/model-controls';
import { DictionarySettings } from '../../src/dictionaries/settings';
import { useSettings } from './use-settings';
import { Connection } from './connection';
import { Preferences } from './preferences';
import { ActionBar } from './action-bar';
import '../../src/styles/settings.css';

const FORM_ID = 'settings-form';

function Options() {
  const form = useSettings();
  return <div class="layout">
    <header class="topbar"><div class="brand"><BrandMark className="logo" />Cloudy’s Gloss</div><span class="badge">LOCAL FIRST</span></header>
    <div class="settings-workspace">
      <aside class="settings-sidebar">
        <div class="eyebrow">PREFERENCES</div>
        <nav class="settings-nav" aria-label="设置分区">
          <a href="#connection">模型连接</a>
          <a href="#preferences">阅读偏好</a>
          <a href="#service">本地模型服务</a>
          <a href="#dictionary">离线词库</a>
          <a href="#cache">缓存与隐私</a>
        </nav>
        <p class="sidebar-note">让工具适应你的阅读习惯。</p>
      </aside>
      <main class="settings-content">
        <div class="intro"><h1>设置</h1><p class="muted">选择翻译模型，调整阅读体验。修改后点击「保存设置」。</p></div>
        <form id={FORM_ID} onSubmit={(event) => { event.preventDefault(); void form.perform('save'); }}>
          <Connection form={form} />
          <Preferences form={form} />
        </form>
        <ModelControls />
        <DictionarySettings />
        <section id="cache" tabIndex={-1} class="card" aria-labelledby="cache-heading">
          <div class="card-head split"><div><h2 id="cache-heading">本地阅读缓存</h2><p class="muted">译文与词卡保存在当前浏览器，最多 1,500 条，30 天过期；更换模型、地址或温度后自动分开缓存。</p></div>
            <button disabled={form.busy || !form.ready} onClick={() => void form.perform('clear')}>清空缓存</button></div>
        </section>
        <p class="footer">开启翻译、确认划词或在输入框连按四下空格时，相关文本才会发送到你配置的服务；输入框草稿不写入缓存。<br />API Key 只存在本机扩展存储，不同步到云端。音标来自内置离线词典，发音使用系统语音。</p>
        <ActionBar form={form} formId={FORM_ID} />
      </main>
    </div>
  </div>;
}
render(<Options />, document.getElementById('app')!);
