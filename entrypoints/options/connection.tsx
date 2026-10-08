import { useRef, useState } from 'preact/hooks';
import { defaults } from '../../src/core/schema';
import { Field } from './field';
import type { SettingsForm } from './use-settings';

const OLLAMA = { baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b' };
type Preset = 'mlx' | 'ollama' | 'custom';
const detect = (baseUrl: string): Preset => baseUrl === defaults.baseUrl ? 'mlx' : baseUrl === OLLAMA.baseUrl ? 'ollama' : 'custom';

export function Connection({ form }: { form: SettingsForm }) {
  const { settings, update, replace } = form;
  const [custom, setCustom] = useState(false);
  const baseUrl = useRef<HTMLInputElement>(null);
  const active = custom ? 'custom' : detect(settings.baseUrl);
  const presets: { id: Preset; title: string; note: string; pick: () => void }[] = [
    { id: 'mlx', title: 'mlx-serve', note: '本地默认', pick: () => replace({ ...defaults, theme: settings.theme, inputTranslation: settings.inputTranslation }) },
    { id: 'ollama', title: 'Ollama', note: '本地 11434', pick: () => replace({ ...settings, ...OLLAMA }) },
    { id: 'custom', title: '自定义', note: 'OpenAI 兼容', pick: () => baseUrl.current?.select() },
  ];
  return <section class="card" aria-labelledby="connection-heading">
    <header class="card-head"><h2 id="connection-heading">模型连接</h2><p class="muted">请求均由扩展后台发起。选一个预设，或填写自己的兼容服务。</p></header>
    <div class="segmented" role="group" aria-label="服务预设">
      {presets.map((preset) => <button type="button" key={preset.id} aria-pressed={active === preset.id}
        onClick={() => { setCustom(preset.id === 'custom'); preset.pick(); }}><strong>{preset.title}</strong><small>{preset.note}</small></button>)}
    </div>
    <div class="grid">
      <Field full label="Base URL" hint="例如 http://127.0.0.1:8080/v1，也支持完整的 /chat/completions 地址。">
        <input ref={baseUrl} name="baseUrl" type="url" required value={settings.baseUrl} onInput={(event) => update('baseUrl', event.currentTarget.value)} />
      </Field>
      <Field label="Model" hint="服务中实际可用的模型标识。">
        <input name="model" required value={settings.model} onInput={(event) => update('model', event.currentTarget.value)} />
      </Field>
      <Field label="API Key" hint="仅保存在本机，本地服务可留空。">
        <input name="apiKey" type="password" autoComplete="off" placeholder="可选" value={settings.apiKey} onInput={(event) => update('apiKey', event.currentTarget.value)} />
      </Field>
    </div>
    <details class="advanced">
      <summary>高级参数<span class="muted">温度 {settings.temperature} · 超时 {settings.timeout / 1000} 秒 · 并发 {settings.concurrency}</span></summary>
      <div class="grid three">
        <Field label="Temperature"><input name="temperature" type="number" min="0" max="2" step="0.1" value={settings.temperature} onInput={(event) => update('temperature', event.currentTarget.valueAsNumber)} /></Field>
        <Field label="Timeout（毫秒）"><input name="timeout" type="number" min="1000" max="300000" step="1000" value={settings.timeout} onInput={(event) => update('timeout', event.currentTarget.valueAsNumber)} /></Field>
        <Field label="Concurrency" hint="本地模型建议 1–2，所有页面共享。"><input name="concurrency" type="number" min="1" max="8" step="1" value={settings.concurrency} onInput={(event) => update('concurrency', event.currentTarget.valueAsNumber)} /></Field>
      </div>
    </details>
  </section>;
}
