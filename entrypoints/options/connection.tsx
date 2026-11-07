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
  return <section id="connection" tabIndex={-1} class="card connection-card" aria-labelledby="connection-heading">
    <header class="card-head"><h2 id="connection-heading">模型连接</h2><p class="muted">网页、词卡和输入框翻译使用此服务。选择预设，或连接自己的 OpenAI 兼容服务。</p></header>
    <div class="segmented" role="group" aria-label="服务预设">
      {presets.map((preset) => <button type="button" key={preset.id} aria-pressed={active === preset.id}
        onClick={() => { setCustom(preset.id === 'custom'); preset.pick(); }}><span class="preset-title"><strong>{preset.title}</strong><span class="preset-indicator" aria-hidden="true" /></span><small>{preset.note}</small></button>)}
    </div>
    <div class="grid">
      <Field full label="服务地址 · Base URL" hint="以 /v1 结尾，或使用完整的 /chat/completions 地址。">
        <input ref={baseUrl} name="baseUrl" type="url" spellcheck={false} required value={settings.baseUrl} onInput={(event) => update('baseUrl', event.currentTarget.value)} />
      </Field>
      <Field label="模型名称 · Model" hint="填写服务中可用的模型标识。">
        <input name="model" spellcheck={false} required value={settings.model} onInput={(event) => update('model', event.currentTarget.value)} />
      </Field>
      <Field label="API Key（可选）" hint="仅保存在本机，本地服务可留空。">
        <input name="apiKey" type="password" autoComplete="off" placeholder="可选" value={settings.apiKey} onInput={(event) => update('apiKey', event.currentTarget.value)} />
      </Field>
    </div>
    <details class="advanced">
      <summary>高级参数<span class="muted">温度 {settings.temperature} · 超时 {settings.timeout / 1000} 秒 · 并发 {settings.concurrency}</span></summary>
      <div class="grid three">
        <Field label="温度" hint="0–2，越低越稳定。"><input name="temperature" type="number" min="0" max="2" step="0.1" value={settings.temperature} onInput={(event) => update('temperature', event.currentTarget.valueAsNumber)} /></Field>
        <Field label="超时（毫秒）" hint="等待单次请求的最长时间。"><input name="timeout" type="number" min="1000" max="300000" step="1000" value={settings.timeout} onInput={(event) => update('timeout', event.currentTarget.valueAsNumber)} /></Field>
        <Field label="并发请求数" hint="所有页面共享，最多 8 个。"><input name="concurrency" type="number" min="1" max="8" step="1" value={settings.concurrency} onInput={(event) => update('concurrency', event.currentTarget.valueAsNumber)} /></Field>
      </div>
      <p class="advanced-note muted">默认本机小模型使用 {defaults.concurrency} 并发。服务不支持并行、内存紧张或首段较慢时，可降至 1–2。</p>
    </details>
  </section>;
}
