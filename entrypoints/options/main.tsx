import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { defaults, SettingsSchema, type Settings } from '../../src/schema';
import { send } from '../../src/messaging';
import { ModelControls } from '../../src/model-controls';
import '../../src/app.css';
function Options() {
  const [settings, setSettings] = useState<Settings>(defaults);
  const [status, setStatus] = useState(''); const [error, setError] = useState(false); const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => { void send<Settings>({ type: 'settings:get' }).then((value) => { setSettings(value); setReady(true); }).catch((error: Error) => { setStatus(error.message); setError(true); }); }, []);
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings((old) => ({ ...old, [key]: value }));
  const perform = async (action: 'save' | 'test' | 'clear') => {
    setBusy(true); setError(false); setStatus(action === 'test' ? '正在连接模型并验证翻译输出…' : '正在处理…');
    try {
      if (action === 'clear') { await send({ type: 'cache:clear' }); setStatus('本地翻译与词卡缓存已清空'); return; }
      const result = SettingsSchema.safeParse(settings);
      if (!result.success) throw new Error(result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('；'));
      if (action === 'save') { await send({ type: 'settings:save', settings: result.data }); setStatus('设置已保存。新请求立即生效；主题更新请刷新网页。'); }
      else { const started = performance.now(); await send({ type: 'connection:test', id: crypto.randomUUID(), settings: result.data }); setStatus(`连接成功，模型已返回有效中文译文 · ${((performance.now() - started) / 1000).toFixed(2)} 秒`); }
    } catch (error) { setError(true); setStatus(error instanceof Error ? error.message : '操作失败'); }
    finally { setBusy(false); }
  };
  return <main class="layout">
    <div class="topbar"><div class="brand"><span class="logo">☁</span>Cloudy’s Gloss</div><span class="badge">LOCAL FIRST</span></div>
    <div class="intro"><div class="eyebrow">A little clarity, in every word.</div><h1>让阅读，多一层理解。</h1><p class="muted">保留原文的节奏，用你选择的模型翻译与理解。</p></div>
    <form onSubmit={(event) => { event.preventDefault(); void perform('save'); }}>
      <section class="card"><h2>模型连接</h2><p class="muted">所有模型请求均由扩展后台发起。选择预设，或连接自己的兼容服务。</p>
        <div class="presets">
          <button type="button" onClick={() => setSettings({ ...defaults, theme: settings.theme })}>mlx-serve · 默认</button>
          <button type="button" onClick={() => setSettings({ ...settings, baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b' })}>Ollama</button>
          <span class="muted" style={{ padding: '9px 4px', fontSize: 12 }}>Magpie / 其他兼容服务：填写下方地址</span>
        </div>
        <p class="muted" style={{ fontSize: 12 }}>默认使用本地 mlx-serve。安装本地助手后可按需启动，或使用下方服务管理按钮。已有配置会保留；切换时选择 mlx-serve 并保存设置。</p>
        <div class="grid">
          <label class="full">Base URL<input name="baseUrl" type="url" required value={settings.baseUrl} onInput={(event) => update('baseUrl', event.currentTarget.value)} /><small>例如 http://127.0.0.1:8080/v1；也支持完整 /chat/completions 地址。</small></label>
          <label>API Key<input name="apiKey" type="password" autoComplete="off" placeholder="本地服务通常可留空" value={settings.apiKey} onInput={(event) => update('apiKey', event.currentTarget.value)} /></label>
          <label>Model<input name="model" required value={settings.model} onInput={(event) => update('model', event.currentTarget.value)} /><small>填写服务中实际可用的模型标识。</small></label>
          <label>Temperature<input name="temperature" type="number" min="0" max="2" step="0.1" value={settings.temperature} onInput={(event) => update('temperature', event.currentTarget.valueAsNumber)} /></label>
          <label>Timeout（毫秒）<input name="timeout" type="number" min="1000" max="300000" step="1000" value={settings.timeout} onInput={(event) => update('timeout', event.currentTarget.valueAsNumber)} /></label>
          <label>Concurrency<input name="concurrency" type="number" min="1" max="8" step="1" value={settings.concurrency} onInput={(event) => update('concurrency', event.currentTarget.valueAsNumber)} /><small>本地模型建议 1–2，所有页面共享并发上限。</small></label>
          <label>词卡外观<select name="theme" value={settings.theme} onChange={(event) => update('theme', event.currentTarget.value as Settings['theme'])}><option value="system">跟随系统</option><option value="light">Light · 浅色</option><option value="dark">Dark · 深色</option></select></label>
          <label class="full">本地模型按需启动<select name="autoStartLocalModel" value={String(settings.autoStartLocalModel)} onChange={(event) => update('autoStartLocalModel', event.currentTarget.value === 'true')}><option value="true">开启 · 翻译时自动启动 MLX</option><option value="false">关闭 · 仅手动启动</option></select><small>仅针对 8080 端口上的默认 MLX 模型。命中缓存时不会启动；冷启动完成后自动继续翻译。</small></label>
        </div>
        <div class="actions"><button class="primary" disabled={busy || !ready} type="submit">保存设置</button><button type="button" disabled={busy || !ready} onClick={() => void perform('test')}>测试连接</button></div>
        <p class={`status ${error ? 'error' : ''}`} role="status">{status}</p>
      </section>
    </form>
    <ModelControls />
    <section class="card"><h2>留在本地的阅读记忆</h2><p class="muted">译文和词卡缓存在当前浏览器，最多 1,500 条，30 天过期。模型、地址或温度变更后自动使用独立缓存。</p><button disabled={busy || !ready} onClick={() => void perform('clear')}>清空缓存</button></section>
    <p class="footer">只有开启翻译或划词时，相关文本才会发送到你配置的服务。<br />API Key 保存在本机扩展存储中，不同步到云端。音标来自内置离线词典，缺失时留空；多读音会并列显示。发音使用浏览器系统语音。</p>
  </main>;
}
render(<Options />, document.getElementById('app')!);
