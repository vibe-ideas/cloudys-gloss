import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { pdfReaderHash, pdfTabSource } from '../../src/pdf-link';
import '../../src/styles/popup.css';
type Status = { enabled: boolean; translated: number; pending: number; error: string };
type Pdf = ReturnType<typeof pdfTabSource>;
type View = { tone: 'on' | 'idle' | 'warn'; title: string; detail: string };

function describe(status: Status | undefined, pdf: Pdf, error: string): View {
  if (error) return { tone: 'warn', title: '当前页面无法翻译', detail: error };
  if (pdf) return { tone: 'idle', title: '这是一个 PDF', detail: pdf.local ? '本地 PDF：在阅读器中选择文件即可。' : '在阅读器中打开原文，开启双语后按页翻译。' };
  if (!status) return { tone: 'idle', title: '正在检查页面…', detail: '' };
  if (status.error) return { tone: 'warn', title: '翻译遇到问题', detail: status.error };
  if (!status.enabled) return { tone: 'idle', title: '双语未开启', detail: '按需翻译可见段落，结果缓存在本地。' };
  return { tone: 'on', title: status.pending ? '正在翻译…' : '双语阅读中', detail: `已翻译 ${status.translated} 段${status.pending ? '' : ' · 滚动以继续'}` };
}

function Popup() {
  const [status, setStatus] = useState<Status>(); const [error, setError] = useState('');
  const [pdf, setPdf] = useState<Pdf>();
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
  const view = describe(status, pdf, error);
  const pageAction = !!status && !pdf;
  return <main class="popup">
    <header class="popup-head"><div class="brand"><span class="logo">☁</span>Cloudy’s Gloss</div>
      <button class="ghost icon" title="模型设置" aria-label="模型设置" onClick={() => void browser.runtime.openOptionsPage()}>⚙</button></header>
    <section class={`state ${view.tone}`} role="status"><strong>{view.title}</strong>{view.detail && <span>{view.detail}</span>}</section>
    {pageAction
      ? <button class={status.enabled ? '' : 'primary'} onClick={() => void query(true)}>{status.enabled ? '关闭翻译 · 恢复原文' : '翻译当前网页'}</button>
      : <button class="primary" disabled={!pdf && !error} onClick={() => void openPdf(pdf?.url)}>{pdf ? '在双语阅读器中打开 PDF' : '打开 PDF 文件或链接'}</button>}
    {pageAction && <button class="ghost secondary" onClick={() => void openPdf()}>打开 PDF 文件或链接 ↗</button>}
    <p class="tagline">选中英文即可查看 AI 单词卡 · 你的模型，你的阅读。</p>
  </main>;
}
render(<Popup />, document.getElementById('app')!);
