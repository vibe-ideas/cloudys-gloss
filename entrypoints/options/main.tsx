import { render } from 'preact';
import { ModelControls } from '../../src/model-controls';
import { DictionarySettings } from '../../src/dictionaries/settings';
import { useSettings } from './use-settings';
import { Connection } from './connection';
import { Preferences } from './preferences';
import { ActionBar } from './action-bar';
import '../../src/styles/settings.css';

const FORM_ID = 'settings-form';

function Options() {
  const form = useSettings();
  return <main class="layout">
    <header class="topbar"><div class="brand"><span class="logo">☁</span>Cloudy’s Gloss</div><span class="badge">LOCAL FIRST</span></header>
    <div class="intro"><div class="eyebrow">A little clarity, in every word.</div><h1>让阅读，多一层理解。</h1><p class="muted">保留原文的节奏，用你选择的模型翻译与理解。</p></div>
    <form id={FORM_ID} onSubmit={(event) => { event.preventDefault(); void form.perform('save'); }}>
      <Connection form={form} />
      <Preferences form={form} />
    </form>
    <ModelControls />
    <DictionarySettings />
    <section class="card" aria-labelledby="cache-heading">
      <div class="card-head split"><div><h2 id="cache-heading">本地阅读缓存</h2><p class="muted">译文与词卡保存在当前浏览器，最多 1,500 条，30 天过期；更换模型、地址或温度后自动分开缓存。</p></div>
        <button disabled={form.busy || !form.ready} onClick={() => void form.perform('clear')}>清空缓存</button></div>
    </section>
    <p class="footer">开启翻译、确认划词或在输入框连按四下空格时，相关文本才会发送到你配置的服务；输入框草稿不写入缓存。<br />API Key 只存在本机扩展存储，不同步到云端。音标来自内置离线词典，发音使用系统语音。</p>
    <ActionBar form={form} formId={FORM_ID} />
  </main>;
}
render(<Options />, document.getElementById('app')!);
