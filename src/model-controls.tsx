import { useEffect, useState } from 'preact/hooks';
import { send } from './messaging';
import type { LocalModelStatus, ModelAction } from './local-model';

type Tone = 'ok' | 'idle' | 'warn' | 'error';
function pill(model: LocalModelStatus | undefined, busy: boolean, error: boolean): [Tone, string] {
  if (busy) return ['idle', '处理中…'];
  if (!model) return error ? ['error', '未连接'] : ['idle', '检查中…'];
  if (!model.installed) return ['warn', '未安装'];
  return model.running ? ['ok', '运行中'] : ['idle', '已停止'];
}

export function ModelControls() {
  const [model, setModel] = useState<LocalModelStatus>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('正在检查本地助手…');
  const [error, setError] = useState(false);
  const control = async (action: ModelAction, enabled?: boolean) => {
    setBusy(true); setError(false);
    setMessage(action === 'start' || action === 'restart' ? '正在加载模型，首次启动可能需要一些时间…' : '正在处理…');
    try {
      const value = await send<LocalModelStatus>({ type: 'model:control', action, enabled });
      setModel(value);
      setMessage(!value.installed ? '请先运行 pnpm model:install 安装模型服务。'
        : `MLX ${value.running ? '已启动' : '已停止'} · 登录自启${value.autostart ? '开启' : '关闭'} · ${value.runtime}`);
    } catch (reason) { setError(true); setMessage(reason instanceof Error ? reason.message : '操作失败'); }
    finally { setBusy(false); }
  };
  useEffect(() => { void control('status'); }, []);
  const [tone, label] = pill(model, busy, error);
  const usable = !busy && !!model?.installed;
  return <section class="card" aria-labelledby="service-heading">
    <header class="card-head split"><div><h2 id="service-heading">本地模型服务</h2>
      <p class="muted">在 Apple Silicon Mac 上管理默认 mlx-serve。首次使用先运行一次 <code>pnpm model:bridge</code>。</p></div>
      <span class={`pill ${tone}`}>{label}</span></header>
    <p class={`service-message${error ? ' error' : ''}`} data-testid="model-status" aria-live="polite">{message}</p>
    <div class="actions">
      {model?.running
        ? <button disabled={!usable} onClick={() => void control('stop')}>停止模型</button>
        : <button class={usable ? 'primary' : ''} disabled={!usable} onClick={() => void control('start')}>启动模型</button>}
      <button disabled={!usable} onClick={() => void control('restart')}>重启模型</button>
      <button class="ghost" disabled={busy} onClick={() => void control('status')}>刷新状态</button>
    </div>
    <div class="row switch-row">
      <span class="row-text"><strong>登录时自动启动</strong><small>启停模型不改变此偏好；切换时正在运行的模型会重启。</small></span>
      <button class="switch" data-on={!!model?.autostart} disabled={!usable} onClick={() => void control('autostart', !model?.autostart)}>
        <span class="visually-hidden">{model?.autostart ? '关闭登录自启' : '开启登录自启'}</span></button>
    </div>
  </section>;
}
