import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { getDocument, PDFWorker, type PDFDocumentLoadingTask, type PDFDocumentProxy, type PDFPageProxy, type RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { cancel, send, translateStream } from '../../src/messaging';
import { MAX_PDF_BYTES, pdfUrl, readPdfUrl, validatePdf } from '../../src/pdf/io';
import { pdfBatches, pdfParagraphs } from '../../src/pdf/text';
import './style.css';

const MAX_CANVAS_PIXELS = 3000000;
type Translation = { text: string; done: boolean; error?: boolean };
const errorText = (reason: unknown) => reason instanceof Error ? reason.name === 'PasswordException'
  ? '此 PDF 需要密码。请先在原阅读器中解锁并另存后打开。' : reason.message : 'PDF 打开失败，请重新选择文件';

function PdfPage({ document, number, enabled }: { document: PDFDocumentProxy; number: number; enabled: boolean }) {
  const host = useRef<HTMLElement>(null); const canvas = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false); const [everNear, setEverNear] = useState(false); const [paragraphs, setParagraphs] = useState<string[] | null>(null);
  const [rows, setRows] = useState<Translation[]>([]); const [error, setError] = useState('');
  const [truncated, setTruncated] = useState(false); const [retry, setRetry] = useState(0);
  const [working, setWorking] = useState(false); const [failed, setFailed] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => { setNear(!!entry?.isIntersecting); if (entry?.isIntersecting) setEverNear(true); }, { rootMargin: '240px' });
    observer.observe(host.current!); return () => observer.disconnect();
  }, []);
  const initialized = useRef(false);
  useEffect(() => {
    if (!everNear || initialized.current) return;
    initialized.current = true;
    let active = true; let page: PDFPageProxy | undefined; let task: RenderTask | undefined; let paintGeneration = 0;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const element = canvas.current!;
    const paint = async () => {
      if (!page || !active || !element.parentElement) return;
      const currentPaint = ++paintGeneration; task?.cancel();
      // PDF.js prohibits concurrent renders into the same canvas.
      await task?.promise.catch(() => {});
      if (!active || currentPaint !== paintGeneration) return;
      const original = page.getViewport({ scale: 1 });
      const cssScale = Math.min(1.6, element.parentElement.clientWidth / original.width);
      const cssViewport = page.getViewport({ scale: cssScale });
      const density = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(MAX_CANVAS_PIXELS / (cssViewport.width * cssViewport.height)));
      const viewport = page.getViewport({ scale: cssScale * density });
      element.width = Math.max(1, Math.floor(viewport.width)); element.height = Math.max(1, Math.floor(viewport.height));
      // Intrinsic aspect ratio also holds during the resize debounce, before the
      // higher-resolution canvas is repainted for its new CSS width.
      element.style.width = `${cssViewport.width}px`; element.style.height = 'auto';
      task = page.render({ canvas: element, viewport, annotationMode: 0 });
      await task.promise;
    };
    const resize = new ResizeObserver(() => {
      clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { void paint().catch(() => {}); }, 150);
    });
    void (async () => {
      try {
        page = await document.getPage(number);
        if (!active) { page.cleanup(); return; }
        const [text] = await Promise.all([page.getTextContent(), paint()]);
        if (!active) return;
        const result = pdfParagraphs(text.items);
        setParagraphs(result.paragraphs); setTruncated(result.truncated);
        resize.observe(element.parentElement!);
      } catch (reason) { if (active) setError(`本页读取失败：${errorText(reason)}。可关闭文件后重新打开。`); }
    })();
    return () => {
      active = false; resize.disconnect(); clearTimeout(resizeTimer); task?.cancel();
      void task?.promise.catch(() => {}).finally(() => page?.cleanup());
      if (!task) page?.cleanup(); element.width = 0; element.height = 0;
    };
  }, [document, number, everNear]);

  useEffect(() => {
    if (!enabled || !near || !paragraphs?.length) return;
    let active = true; let requestId: string | undefined;
    setWorking(true); setFailed(false);
    setRows((previous) => paragraphs.map((_, index) => previous[index]?.done ? previous[index]! : { text: '', done: false }));
    void (async () => {
      const batches = pdfBatches(paragraphs).map((batch) => batch.filter((index) => !rows[index]?.done)).filter((batch) => batch.length);
      for (const batch of batches) {
        if (!active) break;
        requestId = crypto.randomUUID();
        const paint = (index: number, text: string, done: boolean) => {
          if (!active) return;
          setRows((previous) => { const next = [...previous]; next[batch[index]!] = { text, done }; return next; });
        };
        try {
          const translations = await translateStream(requestId, batch.map((index) => paragraphs[index]!), paint);
          translations.forEach((text, index) => paint(index, text, true));
        } catch {
          if (active) {
            setFailed(true);
            setRows((previous) => { const next = [...previous]; for (const index of batch) if (!next[index]?.done) next[index] = { text: '', done: false, error: true }; return next; });
          }
        } finally { requestId = undefined; }
      }
      if (active) setWorking(false);
    })();
    return () => { active = false; if (requestId) cancel(requestId); setWorking(false); setRows((previous) => previous.map((row) => row.done ? row : { text: '', done: false })); };
  }, [paragraphs, enabled, near, retry]);

  const complete = rows.filter((row) => row.done).length;
  const status = error || (paragraphs === null ? '正在读取本页…' : !paragraphs.length ? '本页未检出可提取的文字，可能是扫描件。当前版本暂不支持 OCR。'
    : !enabled ? complete ? `双语已暂停，保留 ${complete} 段已完成译文` : '原文已就绪，点击“开启双语”翻译本页'
      : failed && !working ? `本页 ${complete} / ${paragraphs.length} 段已完成，部分翻译失败，可重试`
        : `${complete === paragraphs.length ? '本页翻译完成' : near ? '正在翻译' : '回到本页后继续翻译'} · ${complete} / ${paragraphs.length} 段`);
  return <section class="pdf-page" ref={host} aria-label={`第 ${number} 页`}>
    <div class="page-status" role="status">{status}</div>
    {failed && enabled && !working && <button class="retry" onClick={() => setRetry((value) => value + 1)}>重试未完成译文</button>}
    <div class="reading-columns">
      <section class="original-pane" aria-label={`第 ${number} 页原始 PDF`}>
        <h2>原始页面 <span>第 {number} 页</span></h2>
        <div class="canvas-wrap"><canvas ref={canvas} aria-label={`PDF 第 ${number} 页图像；可复制的原文位于旁边的段落区`} role="img" /></div>
      </section>
      <section class="text-pane" aria-label="原文与中文对照">
        <h2>逐段对照 <span>可选择并复制原文</span></h2>
        {paragraphs?.map((text, index) => <article class="pdf-paragraph" key={index} data-paragraph={index}>
          <p class="source" lang="en">{text}</p>
          {rows[index]?.text && <p class={`translation ${rows[index]?.done ? 'done' : 'streaming'}`} lang="zh-CN">{rows[index]!.text}</p>}
          {enabled && !rows[index]?.text && !rows[index]?.error && <div class="translation-wait" aria-hidden="true"><i /><i /></div>}
          {rows[index]?.error && <p class="paragraph-error">此段暂未完成，可用上方按钮重试</p>}
        </article>)}
        {paragraphs?.length === 0 && <p class="empty-text">此页可查看原图，但没有可翻译的文字。若其他页包含文本，可继续翻页。</p>}
        {truncated && <p class="notice">此页文字过多，当前展示前 200 段或 100,000 个字符。原始页面仍完整保留。</p>}
      </section>
    </div>
  </section>;
}

function PdfReader() {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
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
    setDocument(null); setEnabled(false); setLoading(false); setError(''); setNumber(1); setPageInput('1'); setName('');
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
  return <main class="pdf-reader">
    <header class="reader-heading"><div class="brand"><span class="cloud">☁</span>Cloudy’s Gloss</div><button onClick={() => void send({ type: 'settings:open' })}>模型设置</button></header>
    <div class="intro"><span class="eyebrow">PDF · 双语阅读</span><h1>原文与理解，同页展开。</h1><p>保留原始 PDF，逐页查看中文。开启双语后，当前页文字才会发送到你配置的模型。</p></div>
    <section class="open-card" aria-label="打开 PDF">
      <div class="file-action"><button class="file-button" disabled={loading} onClick={() => fileInput.current?.click()}>选择本地 PDF</button><span>最大 40 MB · 文件保留在本机</span>
        <input ref={fileInput} tabIndex={-1} aria-label="本地 PDF 文件" type="file" accept="application/pdf,.pdf" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void open(file); }} />
      </div>
      <form onSubmit={(event) => { event.preventDefault(); if (!loading) void open(url); }}>
        <label for="pdf-url">或打开在线 PDF</label><div class="url-row"><input id="pdf-url" name="pdf-url" type="url" required placeholder="https://example.com/document.pdf" value={url} disabled={loading} onInput={(event) => setUrl(event.currentTarget.value)} /><button type="submit" disabled={loading}>打开</button></div>
      </form>
      {loading && <div class="load-status"><span role="status">正在打开 {name}…</span><button onClick={clear}>取消打开</button></div>}
      {error && <p class="load-error" role="alert">{error}</p>}
    </section>
    {document && <>
      <div class="reader-toolbar"><div class="document-name" title={name}>{name}<small>{document.numPages} 页</small></div>
        <nav class="pagination" aria-label="PDF 分页"><button disabled={number === 1} onClick={() => go(number - 1)} aria-label="上一页">←</button>
          <form onSubmit={(event) => { event.preventDefault(); go(Number(pageInput)); }}><label for="page-number">页码</label><input id="page-number" name="page-number" type="number" min="1" max={document.numPages} value={pageInput} onInput={(event) => setPageInput(event.currentTarget.value)} /><span>/ {document.numPages}</span><button type="submit">跳转</button></form>
          <button disabled={number === document.numPages} onClick={() => go(number + 1)} aria-label="下一页">→</button>
        </nav>
        <div class="reader-actions"><button class={enabled ? '' : 'primary'} onClick={() => setEnabled((value) => !value)}>{enabled ? '暂停双语' : '开启双语'}</button><button onClick={clear}>关闭文件</button></div>
      </div>
      <PdfPage key={`${documentId}:${number}`} document={document} number={number} enabled={enabled} />
    </>}
    <footer>仅处理当前页，切页或关闭即取消未完成的请求。扫描件暂不支持 OCR。<br />需要登录的 PDF 可先下载，再选择本地文件打开。</footer>
  </main>;
}
render(<PdfReader />, document.getElementById('app')!);
