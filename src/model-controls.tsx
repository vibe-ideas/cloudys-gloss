import { useEffect, useState } from 'preact/hooks';
import { send } from './messaging';
import type { LocalModelStatus, ModelAction } from './local-model';

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
  return <section class="card" aria-label="本地模型服务">
    <h2>本地模型服务</h2>
    <p class="muted">Apple Silicon Mac 上管理默认 mlx-serve。首次运行一次 pnpm model:bridge 安装浏览器助手，之后可以在这里启停。</p>
    <p class={`status ${error ? 'error' : ''}`} data-testid="model-status" aria-live="polite">{message}</p>
    <div class="actions">
      <button disabled={busy || !model?.installed} onClick={() => void control('start')}>启动模型</button>
      <button disabled={busy || !model?.running} onClick={() => void control('stop')}>停止模型</button>
      <button disabled={busy || !model?.installed} onClick={() => void control('restart')}>重启模型</button>
      <button disabled={busy} onClick={() => void control('status')}>刷新状态</button>
      <button disabled={busy || !model?.installed} onClick={() => void control('autostart', !model?.autostart)}>{model?.autostart ? '关闭登录自启' : '开启登录自启'}</button>
    </div>
    <small>启动与停止不改变登录自启偏好。切换自启时，正在运行的模型会重启。开启按需启动后，下次未命中缓存的翻译会再次启动模型。</small>
  </section>;
}
