import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { BrandMark } from '../../src/ui/brand-mark';
import { ModelControls } from '../../src/model/model-controls';
import { DictionarySettings } from '../../src/dictionaries/settings';
import { useSettings } from './use-settings';
import { Connection } from './connection';
import { Preferences } from './preferences';
import { ActionBar } from './action-bar';
import '../../src/styles/settings.css';

const FORM_ID = 'settings-form';
const SECTIONS = [
  ['connection', '模型连接'], ['preferences', '阅读偏好'], ['service', '本地模型服务'],
  ['dictionary', '离线词库'], ['cache', '缓存与隐私'],
] as const;

function SectionNavigation() {
  const [active, setActive] = useState('connection');
  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const bottom = Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight;
        const section = [...SECTIONS].reverse().find(([id]) => (document.getElementById(id)?.getBoundingClientRect().top ?? Infinity) <= 160);
        setActive(bottom ? 'cache' : section?.[0] ?? 'connection');
      });
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, []);
  return <nav class="settings-nav" aria-label="设置分区">
    {SECTIONS.map(([id, label]) => <a key={id} href={`#${id}`} aria-current={active === id ? 'location' : undefined} onClick={() => setActive(id)}>{label}<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m9 6 6 6-6 6" /></svg></a>)}
  </nav>;
}

function Options() {
  const form = useSettings();
  return <div class="layout">
    <header class="topbar"><div class="brand"><BrandMark className="logo" />Cloudy’s Gloss</div><span class="local-note">本地优先，安心阅读</span></header>
    <div class="settings-workspace">
      <aside class="settings-sidebar">
        <SectionNavigation />
        <p class="sidebar-note">让工具适应<br />你的阅读习惯。</p>
      </aside>
      <main class="settings-content">
        <div class="intro"><h1>设置</h1><p class="muted">连接你的模型，找到舒服的阅读方式。</p></div>
        <form id={FORM_ID} aria-busy={!form.ready || form.busy} onSubmit={(event) => { event.preventDefault(); void form.perform('save'); }}>
          <Connection form={form} />
          <Preferences form={form} />
        </form>
        <ModelControls />
        <DictionarySettings />
        <section id="cache" tabIndex={-1} class="card" aria-labelledby="cache-heading">
          <div class="card-head split"><div><h2 id="cache-heading">本地阅读缓存</h2><p class="muted">译文与词卡保存在当前浏览器，最多 1,500 条，30 天过期；更换模型、地址或温度后自动分开缓存。</p></div>
            <button disabled={form.busy || !form.ready} onClick={() => void form.perform('clear')}>清空缓存</button></div>
          <div class="privacy-note"><h3>你的数据，留在你的掌控中</h3><p>只有开启翻译、确认划词或触发输入框快捷翻译时，相关文本才会发送到你配置的服务。输入框草稿不写入缓存。</p><p>API Key 只保存在本机扩展存储，不同步到云端。音标来自内置离线词典，发音使用系统语音。</p></div>
        </section>
        <p class="footer">Cloudy’s Gloss · 为专注阅读而设</p>
        <ActionBar form={form} formId={FORM_ID} />
      </main>
    </div>
  </div>;
}
render(<Options />, document.getElementById('app')!);
