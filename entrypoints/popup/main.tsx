import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import '../../src/app.css';
type Status = { enabled: boolean; translated: number; pending: number; error: string };
function Popup() {
  const [status, setStatus] = useState<Status>(); const [error, setError] = useState('');
  const query = async (toggle = false) => {
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.id === undefined) throw new Error('没有可翻译的页面');
      setStatus(await browser.tabs.sendMessage(tab.id, { type: toggle ? 'page:toggle' : 'page:status' }) as Status); setError('');
    } catch { setError('请打开普通网页。安装或更新扩展后请刷新页面。'); }
  };
  useEffect(() => { void query(); const timer = setInterval(() => void query(), 1000); return () => clearInterval(timer); }, []);
  return <main class="popup"><div class="brand"><span class="logo">☁</span>Cloudy’s Gloss</div><h1>读原文，也读懂。</h1><p class="muted">一键开启双语阅读，选中英文即可查看 AI 单词卡。</p>
    <button class="primary" disabled={!status} onClick={() => void query(true)}>{status?.enabled ? '关闭翻译 · 恢复原文' : '翻译当前网页'}</button>
    <p class="status" role="status">{error || status?.error || (status?.enabled ? `已翻译 ${status.translated} 段${status.pending ? ' · 正在翻译…' : ' · 滚动以继续'}` : '按需翻译 · 本地缓存')}</p>
    <div class="bottom"><span class="muted" style={{ fontSize: 11 }}>你的模型，你的阅读。</span><button onClick={() => void browser.runtime.openOptionsPage()}>模型设置 ↗</button></div>
  </main>;
}
render(<Popup />, document.getElementById('app')!);
