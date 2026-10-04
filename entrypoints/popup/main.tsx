import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { pdfReaderHash, pdfTabSource } from '../../src/pdf-link';
import '../../src/app.css';
type Status = { enabled: boolean; translated: number; pending: number; error: string };
function Popup() {
  const [status, setStatus] = useState<Status>(); const [error, setError] = useState('');
  const [pdf, setPdf] = useState<ReturnType<typeof pdfTabSource>>();
  const openPdf = async (url?: string) => {
    try {
      await browser.tabs.create({ url: browser.runtime.getURL('/pdf.html') + pdfReaderHash(url) });
      window.close();
    } catch { setError('PDF 阅读器无法打开，请重试。'); }
  };
  const query = async (toggle = false) => {
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.id === undefined) throw new Error('没有可翻译的页面');
      const source = pdfTabSource(tab.url); setPdf(source);
      if (source) { setStatus(undefined); setError(''); return; }
      setStatus(await browser.tabs.sendMessage(tab.id, { type: toggle ? 'page:toggle' : 'page:status' }) as Status); setError('');
    } catch { setStatus(undefined); setError('请打开普通网页，或使用 PDF 阅读器。更新扩展后请刷新网页。'); }
  };
  useEffect(() => { void query(); const timer = setInterval(() => void query(), 1000); return () => clearInterval(timer); }, []);
  return <main class="popup"><div class="brand"><span class="logo">☁</span>Cloudy’s Gloss</div><h1>读原文，也读懂。</h1><p class="muted">一键开启双语阅读，选中英文即可查看 AI 单词卡。</p>
    <button class="primary" disabled={!status && !pdf} onClick={() => void (pdf ? openPdf(pdf.url) : query(true))}>{pdf ? '在双语阅读器中打开 PDF' : status?.enabled ? '关闭翻译 · 恢复原文' : '翻译当前网页'}</button>
    <p class="status" role="status">{error || status?.error || (pdf ? pdf.local ? '本地 PDF：在阅读器中选择文件即可。' : '先打开原文，开启双语后按页翻译。' : status?.enabled ? `已翻译 ${status.translated} 段${status.pending ? ' · 正在翻译…' : ' · 滚动以继续'}` : '按需翻译 · 本地缓存')}</p>
    <button class="pdf-entry" onClick={() => void openPdf()}>打开 PDF 文件或链接 ↗</button>
    <div class="bottom"><span class="muted" style={{ fontSize: 11 }}>你的模型，你的阅读。</span><button onClick={() => void browser.runtime.openOptionsPage()}>模型设置 ↗</button></div>
  </main>;
}
render(<Popup />, document.getElementById('app')!);
