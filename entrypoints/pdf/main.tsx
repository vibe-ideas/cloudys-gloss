import { render } from 'preact';
import { BrandMark } from '../../src/ui/brand-mark';
import { useEffect, useRef, useState } from 'preact/hooks';
import { getDocument, PDFWorker, type PDFDocumentLoadingTask, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { send } from '../../src/core/messaging';
import { MAX_PDF_BYTES, pdfUrl, readPdfUrl, validatePdf } from '../../src/pdf/io';
import { PdfPage, type PdfView } from './Page';
import './style.css';

const errorText = (reason: unknown) => reason instanceof Error ? reason.name === 'PasswordException'
  ? '此 PDF 需要密码。请先在原阅读器中解锁并另存后打开。' : reason.message : 'PDF 打开失败，请重新选择文件';

function PdfReader() {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [view, setView] = useState<PdfView>({ mode: 'layout', zoom: 0, original: false });
  const [documentId, setDocumentId] = useState(0); const [name, setName] = useState('');
  const [number, setNumber] = useState(1); const [pageInput, setPageInput] = useState('1');
  const [url, setUrl] = useState(''); const [loading, setLoading] = useState(false);
  const [error, setError] = useState(''); const [enabled, setEnabled] = useState(false);
  const sourceRef = useRef<AbortController | null>(null); const loadingTask = useRef<PDFDocumentLoadingTask | null>(null);
  const worker = useRef<{ port: Worker; pdf: PDFWorker } | null>(null);
  const generation = useRef(0); const fileInput = useRef<HTMLInputElement>(null);
  const clear = () => {
    generation.current++; sourceRef.current?.abort(); sourceRef.current = null;
    if (loadingTask.current) void loadingTask.current.destroy().catch(() => {}); loadingTask.current = null;
    worker.current?.pdf.destroy(); worker.current?.port.terminate(); worker.current = null;
    setDocument(null); setView({ mode: 'layout', zoom: 0, original: false }); setEnabled(false); setLoading(false); setError(''); setNumber(1); setPageInput('1'); setName('');
  };
  useEffect(() => () => { generation.current++; sourceRef.current?.abort(); void loadingTask.current?.destroy(); worker.current?.pdf.destroy(); worker.current?.port.terminate(); }, []);
  const open = async (source: File | string) => {
    clear(); const current = generation.current; const controller = new AbortController(); sourceRef.current = controller;
    let abortTask: (() => void) | undefined;
    setLoading(true); setName(typeof source === 'string' ? '在线 PDF' : source.name);
    const timeout = setTimeout(() => controller.abort(new Error('PDF 下载超时，请重试或先下载到本地')), 60000);
    try {
      if (typeof source !== 'string' && source.size > MAX_PDF_BYTES) throw new Error('PDF 超过 40 MB，请选择较小的文件');
      const bytes = typeof source === 'string' ? await readPdfUrl(source, controller.signal) : validatePdf(new Uint8Array(await source.arrayBuffer()));
      controller.signal.throwIfAborted(); if (generation.current !== current) return;
      // Provide the real local worker port explicitly: PDF.js's URL-origin check
      // treats extension schemes as opaque and otherwise creates a CSP-blocked
      // blob wrapper that can silently fall back to parsing on the UI thread.
      const port = new Worker(new URL(workerUrl, location.href), { type: 'module' });
      const pdfWorker = PDFWorker.create({ port }); worker.current = { port, pdf: pdfWorker };
      const task = getDocument({ data: bytes, worker: pdfWorker, useWasm: false, enableXfa: false,
        canvasMaxAreaInBytes: 16000000,
        cMapUrl: new URL('/pdf-resources/cmaps/', location.href).href, cMapPacked: true,
        standardFontDataUrl: new URL('/pdf-resources/standard_fonts/', location.href).href,
        wasmUrl: new URL('/pdf-resources/decoders/', location.href).href });
      loadingTask.current = task;
      // Terminating a Worker may leave its outstanding message promise pending.
      // Race document readiness against cancellation so the UI always recovers.
      const result = await new Promise<PDFDocumentProxy>((resolve, reject) => {
        abortTask = () => { void task.destroy().catch(() => {}); pdfWorker.destroy(); port.terminate(); reject(controller.signal.reason); };
        controller.signal.addEventListener('abort', abortTask, { once: true });
        task.promise.then(resolve, reject);
      });
      if (generation.current !== current) { await task.destroy(); return; }
      setDocument(result); setDocumentId(current); setLoading(false);
      if (typeof source === 'string') { try { setName(decodeURIComponent(pdfUrl(source).pathname.split('/').pop() || '在线 PDF')); } catch { setName('在线 PDF'); } }
    } catch (reason) {
      if (generation.current === current) { worker.current?.pdf.destroy(); worker.current?.port.terminate(); worker.current = null; setError(controller.signal.aborted ? errorText(controller.signal.reason) : errorText(reason)); setLoading(false); }
    } finally { clearTimeout(timeout); if (abortTask) controller.signal.removeEventListener('abort', abortTask); }
  };
  useEffect(() => {
    const initial = new URLSearchParams(location.hash.slice(1)).get('url');
    if (initial) { setUrl(initial); void open(initial); }
  }, []);
  const go = (next: number) => {
    if (!document) return;
    const valid = Math.max(1, Math.min(document.numPages, Math.round(next)));
    if (!Number.isFinite(valid)) { setPageInput(String(number)); return; }
    setNumber(valid); setPageInput(String(valid)); window.scrollTo({ top: 0 });
  };
  const picker = <section class="open-card" aria-label="打开 PDF">
    <div class="file-action"><button class="file-button" disabled={loading} onClick={() => fileInput.current?.click()}>选择本地 PDF</button><span>最大 40 MB · 文件保留在本机</span>
      <input ref={fileInput} tabIndex={-1} aria-label="本地 PDF 文件" type="file" accept="application/pdf,.pdf" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void open(file); }} />
    </div>
    <form onSubmit={(event) => { event.preventDefault(); if (!loading) void open(url); }}>
      <label for="pdf-url">或打开在线 PDF</label><div class="url-row"><input id="pdf-url" name="pdf-url" type="url" required placeholder="https://example.com/document.pdf" value={url} disabled={loading} onInput={(event) => setUrl(event.currentTarget.value)} /><button type="submit" disabled={loading}>打开</button></div>
    </form>
    {loading && <div class="load-status"><span role="status">正在打开 {name}…</span><button onClick={clear}>取消打开</button></div>}
    {error && <p class="load-error" role="alert">{error}</p>}
  </section>;
  return <main class={`pdf-reader ${document ? 'has-document' : ''}`}>
    <header class="reader-heading"><div class="brand"><BrandMark className="logo" />Cloudy’s Gloss</div><button onClick={() => void send({ type: 'settings:open' })}>模型设置</button></header>
    {!document && <div class="intro"><span class="eyebrow">PDF · 双语阅读</span><h1>原文与理解，同页展开。</h1><p>保留原始 PDF，逐页查看中文。开启双语后，当前页文字才会发送到你配置的模型。</p></div>}
    {document ? <details class="file-picker" open={loading || !!error}><summary>打开其他文件</summary>{picker}</details> : picker}
    {document && <>
      <div class="reader-toolbar"><div class="document-name" title={name}>{name}<small>{document.numPages} 页</small></div>
        <nav class="pagination" aria-label="PDF 分页"><button disabled={number === 1} onClick={() => go(number - 1)} aria-label="上一页">←</button>
          <form onSubmit={(event) => { event.preventDefault(); go(Number(pageInput)); }}><label for="page-number">页码</label><input id="page-number" name="page-number" type="number" min="1" max={document.numPages} value={pageInput} onInput={(event) => setPageInput(event.currentTarget.value)} /><span>/ {document.numPages}</span><button type="submit">跳转</button></form>
          <button disabled={number === document.numPages} onClick={() => go(number + 1)} aria-label="下一页">→</button>
        </nav>
        <div class="reader-actions"><button class={enabled ? '' : 'primary'} onClick={() => { setEnabled(value => !value); if (!enabled) setView(value => ({ ...value, original: false })); }}>{enabled ? '暂停双语' : '开启双语'}</button><button onClick={clear}>关闭文件</button></div>
      </div>
      <PdfPage key={`${documentId}:${number}`} document={document} number={number} enabled={enabled} view={view} onView={setView} />
    </>}
    {!document && <footer>仅处理当前页，切页或关闭即取消未完成的请求。扫描件暂不支持 OCR。<br />需要登录的 PDF 可先下载，再选择本地文件打开。</footer>}
  </main>;
}
render(<PdfReader />, document.getElementById('app')!);
