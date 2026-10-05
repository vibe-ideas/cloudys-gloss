import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { cancel, translateStream } from '../../src/messaging';
import { buildPdfLayout, type PdfLayout } from '../../src/pdf/layout';
import { PdfPagePainter } from '../../src/pdf/render';
import { pdfBatches } from '../../src/pdf/text';
import { fitPdfText, retainsPdfNumbers, type PdfTypeset } from '../../src/pdf/typeset';

type Translation = { text: string; done: boolean; error?: string; retrying?: boolean; busy?: boolean };
export type PdfView = { mode: 'layout' | 'read'; zoom: number; original: boolean };
type Props = { document: PDFDocumentProxy; number: number; enabled: boolean; view: PdfView; onView: (value: PdfView) => void };
const PAGE_GAP = 24;
const NUMBER_ERROR = '译文中的数值与原文不一致或有遗漏，已保留原文。请重试这一段，或在模型设置中更换模型。';
const failureReason = (reason: unknown) => reason instanceof Error && reason.message.trim() ? reason.message.slice(0, 500) : '翻译失败，服务未返回可用的错误信息，请重试。';
const CSS_UNITS = 96 / 72;
const px = (value: number) => `${value}px`;

export function PdfPage({ document: pdf, number, enabled, view, onView }: Props) {
  const original = useRef<HTMLCanvasElement>(null); const translated = useRef<HTMLCanvasElement>(null); const background = useRef<HTMLCanvasElement>(null);
  const scroll = useRef<HTMLDivElement>(null); const dialog = useRef<HTMLDialogElement>(null);
  const painter = useRef<PdfPagePainter | null>(null);
  const [size, setSize] = useState({ width: 612, height: 792 });
  const [layout, setLayout] = useState<PdfLayout | null>(null);
  const [rows, setRows] = useState<Translation[]>([]);
  const [error, setError] = useState(''); const [working, setWorking] = useState(false);
  const [retry, setRetry] = useState(0);
  const versions = useRef(new Map<number, number>());
  const manualRequests = useRef(new Map<number, string>());
  const previouslyEnabled = useRef(enabled);
  const [renderer, setRenderer] = useState(0); const [revision, setRevision] = useState(0);
  const [paintState, setPaintState] = useState({ ready: false, safe: false, textSafe: false, pixels: 0 });
  const [width, setWidth] = useState(1000); const [narrow, setNarrow] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const anchor = useRef<{ x: number; y: number } | null>(null); const oldScale = useRef(1);
  const positions = useRef({ layout: { x: 0, y: 0 }, read: { x: 0, y: 0 } });
  const currentMode = useRef<'layout' | 'read'>('layout');
  const masked = useRef({ revision: -1, keys: new Set<number>() });
  const fitCache = useRef(new Map<number, { text: string; fit: PdfTypeset }>());
  const measureContext = useMemo(() => globalThis.document.createElement('canvas').getContext('2d')!, []);
  const columns = narrow ? 1 : 2;
  const naturalWidth = size.width * columns + (columns - 1) * PAGE_GAP;
  const scale = view.zoom ? view.zoom / 100 * CSS_UNITS : Math.max(0.05, (width - 32) / naturalWidth);

  useEffect(() => {
    const element = scroll.current!;
    const observer = new ResizeObserver(() => { setWidth(element.clientWidth); setNarrow(window.innerWidth < 800); });
    observer.observe(element); return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let active = true; let page: PDFPageProxy | undefined; let instance: PdfPagePainter | undefined;
    void (async () => {
      try {
        page = await pdf.getPage(number);
        if (!active) { page.cleanup(); return; }
        const viewport = page.getViewport({ scale: 1 });
        setSize({ width: viewport.width, height: viewport.height });
        instance = new PdfPagePainter(page, original.current!, translated.current!, background.current!);
        painter.current = instance; setRenderer(value => value + 1);
        const content = await page.getTextContent();
        if (active) setLayout(buildPdfLayout(content.items, content.styles, viewport));
      } catch { if (active) setError('本页读取失败，可关闭文件后重新打开。'); }
    })();
    return () => {
      active = false; painter.current = null;
      if (instance) void instance.dispose().finally(() => page?.cleanup()); else page?.cleanup();
    };
  }, [pdf, number]);

  useEffect(() => {
    if (!painter.current) return;
    let active = true;
    const timer = setTimeout(() => {
      void painter.current?.render(scale).then(result => {
        if (!active || !result) return;
        setPaintState({ ready: true, safe: result.safe, textSafe: result.textSafe, pixels: result.pixels }); setRevision(value => value + 1);
      }).catch(() => { if (active) setError('页面绘制失败，可关闭文件后重新打开。'); });
    }, paintState.ready ? 120 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [renderer, scale]);

  useLayoutEffect(() => {
    const element = scroll.current!;
    const point = anchor.current;
    if (point) {
      const spread = element.querySelector<HTMLElement>('.spread-space')!;
      const box = spread.getBoundingClientRect(), viewport = element.getBoundingClientRect();
      element.scrollLeft += box.left - viewport.left + point.x * scale - element.clientWidth / 2;
      element.scrollTop += box.top - viewport.top + point.y * scale - element.clientHeight / 2;
    }
    else if (oldScale.current !== scale) element.scrollTop = element.scrollTop / oldScale.current * scale;
    oldScale.current = scale; anchor.current = null;
  }, [scale]);
  const zoom = (value: number) => {
    const element = scroll.current!;
    const box = element.querySelector<HTMLElement>('.spread-space')!.getBoundingClientRect(), viewport = element.getBoundingClientRect();
    anchor.current = { x: (viewport.left + element.clientWidth / 2 - box.left) / scale, y: (viewport.top + element.clientHeight / 2 - box.top) / scale };
    onView({ ...view, zoom: value });
  };

  const blocks = layout?.blocks ?? [];
  // Render visibility is checked before exposing extraction or sending text.
  // Stable keys avoid cancelling/re-requesting translations on harmless zooms.
  const readable = useMemo(() => layout?.blocks.map(block => paintState.textSafe && !!painter.current?.canRead(block.inkRects)) ?? [], [layout, revision, paintState.textSafe]);
  const visibilityKey = readable.map(value => value ? '1' : '0').join('');
  useEffect(() => {
    if (!enabled || !layout || !paintState.ready) return;
    let active = true; let requestId: string | undefined;
    const pending = layout.blocks.map((block, index) => block.translatable && readable[index] && (!rows[index]?.done || rows[index]?.error) && !manualRequests.current.has(index) ? index : -1).filter(index => index >= 0);
    const attempts = new Map(pending.map(index => [index, versions.current.get(index) ?? 0]));
    const current = (index: number) => active && attempts.get(index) === (versions.current.get(index) ?? 0);
    const batches = pdfBatches(pending.map(index => layout.blocks[index]!.text)).map(batch => batch.map(index => pending[index]!));
    setWorking(batches.length > 0);
    setRows(previous => { const next = [...previous]; for (const index of pending) next[index] = { text: '', done: false, busy: true }; return next; });
    void (async () => {
      for (const scheduled of batches) {
        if (!active) break;
        const batch = scheduled.filter(current);
        if (!batch.length) continue;
        requestId = crypto.randomUUID();
        const paint = (index: number, text: string, done: boolean) => {
          if (!active) return;
          const blockIndex = batch[index]!;
          if (!current(blockIndex)) return;
          const changedNumbers = done && !retainsPdfNumbers(layout.blocks[blockIndex]!.text, text);
          setRows(previous => { const next = [...previous]; next[blockIndex] = changedNumbers ? { text: '', done: false, error: NUMBER_ERROR } : { text, done, busy: !done }; return next; });
        };
        try { const result = await translateStream(requestId, batch.map(index => layout.blocks[index]!.text), paint, { bypassCache: retry > 0 }); result.forEach((text, index) => paint(index, text, true)); }
        catch (reason) { if (active) setRows(previous => { const next = [...previous]; for (const index of batch) if (current(index) && !next[index]?.done) next[index] = { text: '', done: false, error: next[index]?.error || failureReason(reason) }; return next; }); }
        finally { requestId = undefined; }
      }
      if (active) setWorking(false);
    })();
    return () => { active = false; if (requestId) cancel(requestId); setWorking(false); setRows(previous => previous.map(row => row?.done || row?.error || row?.retrying ? row : { text: '', done: false })); };
  }, [layout, visibilityKey, enabled, retry]);

  const safe = paintState.safe && !layout?.truncated && blocks.every(block => block.layoutSafe);
  const hasReadableText = readable.some(Boolean);
  const reading = hasReadableText && (view.mode === 'read' || paintState.ready && !safe && !view.original);
  useLayoutEffect(() => {
    const mode = reading ? 'read' : 'layout';
    if (currentMode.current !== mode) {
      currentMode.current = mode;
      const point = positions.current[mode];
      scroll.current!.scrollLeft = point.x; scroll.current!.scrollTop = point.y;
    }
  }, [reading]);
  const display = blocks.map((block, index) => {
    const text = rows[index]?.text;
    if (!readable[index] || !text || text === block.text || !retainsPdfNumbers(block.text, text) || !safe) return null;
    let cached = fitCache.current.get(index);
    if (!cached || cached.text !== text) {
      const weight = block.fontSize >= 18 ? 600 : 400;
      let font = '';
      const fit = fitPdfText(text, block.box, block.fontSize, (value, size) => {
        const next = `${weight} ${size}px system-ui, sans-serif`;
        if (font !== next) { measureContext.font = next; font = next; }
        return measureContext.measureText(value).width;
      });
      cached = { text, fit }; fitCache.current.set(index, cached);
    }
    const color = painter.current?.textColor(block.inkRects);
    return color ? { ...cached.fit, color } : null;
  });
  useLayoutEffect(() => {
    const current = painter.current; if (!current || !paintState.ready) return;
    const keys = new Set(display.flatMap((value, index) => !view.original && !reading && value?.lines.length ? [index] : []));
    if (masked.current.revision !== revision || [...masked.current.keys].some(index => !keys.has(index))) { current.reset(); masked.current = { revision, keys: new Set() }; }
    for (const index of keys) if (!masked.current.keys.has(index)) { current.cover(blocks[index]!.inkRects); masked.current.keys.add(index); }
  });

  useEffect(() => {
    const element = dialog.current;
    if (selected !== null && element && !element.open) element.showModal();
    if (selected === null && element?.open) element.close();
  }, [selected]);
  // Manual retries own one block and share the background concurrency queue.
  // Their version prevents an older page batch from overwriting a newer result.
  const stopManual = () => {
    for (const [index, id] of manualRequests.current) {
      versions.current.set(index, (versions.current.get(index) ?? 0) + 1);
      manualRequests.current.delete(index); cancel(id);
    }
    setRows(previous => previous.map(row => row?.retrying ? { ...row, retrying: false } : row));
  };
  useEffect(() => () => stopManual(), [layout, visibilityKey]);
  useEffect(() => {
    if (previouslyEnabled.current && !enabled) stopManual();
    previouslyEnabled.current = enabled;
  }, [enabled]);
  const retryBlock = async (index: number) => {
    const block = blocks[index];
    if (!block?.translatable || !readable[index] || rows[index]?.busy || manualRequests.current.has(index)) return;
    const id = crypto.randomUUID();
    versions.current.set(index, (versions.current.get(index) ?? 0) + 1);
    manualRequests.current.set(index, id);
    const current = () => manualRequests.current.get(index) === id;
    setRows(previous => { const next = [...previous]; next[index] = { ...next[index], text: next[index]?.text ?? '', done: next[index]?.done ?? false, error: undefined, retrying: true }; return next; });
    try {
      // Keep the last good translation until the replacement is validated.
      const [text] = await translateStream(id, [block.text], () => {}, { bypassCache: true });
      if (!current()) return;
      if (!retainsPdfNumbers(block.text, text!)) throw new Error(NUMBER_ERROR);
      setRows(previous => { const next = [...previous]; next[index] = { text: text!, done: true }; return next; });
    } catch (reason) {
      if (current()) setRows(previous => { const next = [...previous]; next[index] = { ...next[index]!, retrying: false, error: failureReason(reason) }; return next; });
    } finally { if (current()) manualRequests.current.delete(index); }
  };
  const retryLabel = (index: number) => rows[index]?.busy ? '翻译中…' : rows[index]?.retrying ? '正在重试…' : rows[index]?.error ? '重试这一段' : rows[index]?.done ? '重新翻译这一段' : '翻译这一段';
  const manualCount = rows.filter(row => row?.retrying).length;
  const requested = blocks.filter((block, index) => block.translatable && readable[index]).length;
  const complete = blocks.filter((block, index) => block.translatable && readable[index] && rows[index]?.done).length;
  const failures = rows.filter(row => row?.error).length;
  const status = error || (manualCount ? `正在重试 ${manualCount} 段 · 保留其他译文` : !layout || !paintState.ready ? '正在读取本页…' : !blocks.length ? '本页未检出可提取的文字，可能是扫描件。当前版本暂不支持 OCR。'
    : !hasReadableText ? '本页文字可见性无法确认，保留原稿，未向模型发送提取文字。'
    : !enabled ? complete ? `双语已暂停，保留 ${complete} 段已完成译文` : '原文已就绪，点击“开启双语”翻译本页'
      : !requested ? '本页无需翻译，可直接查看原稿' : failures && !working ? `本页 ${complete} / ${requested} 段已完成，未完成区域保留原文`
        : `${complete === requested ? '本页翻译完成' : '正在翻译'} · ${complete} / ${requested} 段`);
  const chosen = selected === null || !readable[selected] ? undefined : blocks[selected];
  return <section class="pdf-page" aria-label={`第 ${number} 页`} data-mode={reading ? 'read' : 'layout'} data-pixels={paintState.pixels}>
    <div class="view-toolbar">
      <div class="view-modes" aria-label="阅读方式"><button aria-pressed={!reading && !view.original} onClick={() => onView({ ...view, mode: 'layout', original: false })}>页面对照</button><button disabled={!hasReadableText} aria-pressed={reading} onClick={() => onView({ ...view, mode: 'read', original: false })}>阅读模式</button></div>
      <div class="zoom-controls">{!reading && <><button aria-label="缩小页面" disabled={scale / CSS_UNITS <= 0.5} onClick={() => zoom(Math.max(50, Math.round(scale / CSS_UNITS * 100) - 25))}>−</button><output aria-label="页面缩放">{Math.round(scale / CSS_UNITS * 100)}%</output><button aria-label="放大页面" disabled={scale / CSS_UNITS >= 2} onClick={() => zoom(Math.min(200, Math.round(scale / CSS_UNITS * 100) + 25))}>＋</button><button onClick={() => zoom(100)}>100%</button><button onClick={() => zoom(0)}>适合宽度</button></>}<button aria-pressed={view.original} onClick={() => onView({ ...view, mode: 'layout', original: !view.original })}>{view.original ? '显示译文' : '显示原文'}</button></div>
    </div>
    <div class="status-row"><div class="page-status" role="status">{status}</div>{!!failures && enabled && !working && !manualCount && <button class="retry" onClick={() => setRetry(value => value + 1)}>重试未完成译文</button>}</div>
    {!!failures && <details class="pdf-failures"><summary>{failures} 段翻译失败 · 查看原因与重试</summary>
      <ul>{blocks.map((block, index) => readable[index] && rows[index]?.error && <li key={block.id}>
        <button class="failure-source" onClick={() => setSelected(index)}>第 {index + 1} 段 · {block.text.slice(0, 60)}</button>
        <p>{rows[index]!.error}{rows[index]?.done && ' 上次成功的译文已保留。'}</p>
        <button disabled={rows[index]?.retrying || rows[index]?.busy} onClick={() => void retryBlock(index)} aria-label={`单独重试第 ${index + 1} 段`}>{retryLabel(index)}</button>
      </li>)}</ul>
    </details>}
    {reading && view.mode === 'layout' && blocks.length > 0 && <p class="layout-notice">本页包含暂不支持的特殊排版，已保留原稿并使用阅读模式。下一页会重新判断。</p>}
    <div class={`spread-scroll ${reading ? 'flow-mode' : ''}`} ref={scroll} onScroll={event => { positions.current[currentMode.current] = { x: event.currentTarget.scrollLeft, y: event.currentTarget.scrollTop }; }} tabIndex={0} aria-label="PDF 阅读区域">
      <div class="spread-space" hidden={reading} style={{ width: px(naturalWidth * scale), height: px(size.height * scale) }}>
        <div class={`spread-native ${narrow ? 'single-page' : ''}`} style={{ width: px(naturalWidth), height: px(size.height), transform: `scale(${scale})`, gridTemplateColumns: `repeat(${columns}, ${size.width}px)` }}>
          <section class="pdf-sheet original-sheet" aria-label={`第 ${number} 页原始 PDF`} style={{ width: px(size.width), height: px(size.height) }}>
            <canvas ref={original} role="img" aria-label={`PDF 第 ${number} 页原稿；阅读模式可复制原文`} />
          </section>
          <section class="pdf-sheet translated-sheet" aria-label={view.original ? '原始页面' : '同版式译文'} style={{ width: px(size.width), height: px(size.height) }}>
            <canvas ref={translated} aria-hidden="true" />
            {!view.original && safe && blocks.map((block, index) => {
              if (!readable[index]) return null;
              const value = display[index];
              return <div key={block.id} class={`pdf-block ${value?.lines.length ? 'has-translation' : ''} ${rows[index]?.error ? 'has-error' : ''}`} data-error={rows[index]?.error ? 'true' : undefined} aria-busy={rows[index]?.retrying || undefined} title={rows[index]?.error ? `翻译失败：${rows[index]!.error} 点选查看原因与重试。` : undefined} data-block={index} data-overflow={value?.overflow ? 'true' : 'false'}
                role="button" tabIndex={0} aria-label={`查看第 ${index + 1} 段原文与译文${rows[index]?.error ? '，翻译失败，查看原因与重试' : value?.overflow ? '，展开全文' : ''}`}
                style={{ left: px(block.box.x), top: px(block.box.y), width: px(block.box.width), height: px(block.box.height), color: value?.color, fontSize: value ? px(value.fontSize) : undefined, lineHeight: value ? `${value.lineHeight}px` : undefined, fontWeight: block.fontSize >= 18 ? 600 : 400 }}
                onClick={() => setSelected(index)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(index); } }}>
                {value?.lines.map((line, lineIndex) => <span class="fitted-line" key={lineIndex}>{line}</span>)}
                {value?.overflow && <span class="expand-label" aria-hidden="true">展开 ↗</span>}
              </div>;
            })}
          </section>
        </div>
      </div>
      <div class="reading-flow" hidden={!reading}>
        <p class="reading-note">按段阅读与复制；点击“显示原文”可查看完整原稿。</p>
        {blocks.map((block, index) => readable[index] && <article class="pdf-paragraph" key={block.id} data-paragraph={index}>
          <p class="source" lang="en">{block.text}</p>
          {rows[index]?.text && <p class={`translation ${rows[index]?.done ? 'done' : 'streaming'}`} lang="zh-CN">{rows[index]!.text}</p>}
          {enabled && block.translatable && !rows[index]?.text && !rows[index]?.error && <div class="translation-wait" aria-hidden="true"><i /><i /></div>}
          {rows[index]?.error && <p class="paragraph-error">{rows[index]!.error}{rows[index]?.done && ' 上次成功的译文已保留。'}</p>}
          {block.translatable && <div class="paragraph-actions"><button disabled={rows[index]?.retrying || rows[index]?.busy} onClick={() => void retryBlock(index)} aria-label={`重新翻译第 ${index + 1} 段`}>{retryLabel(index)}</button>
            {rows[index]?.error && <button onClick={() => setSelected(index)}>查看错误原因</button>}</div>}
        </article>)}
      </div>
    </div>
    <canvas ref={background} hidden aria-hidden="true" />
    {!reading && blocks.length > 0 && <p class="reading-note">{view.original ? '正在显示原稿 · 切回译文可继续对照' : `${narrow ? '单页阅读，可切换原文与译文' : '左侧原稿，右侧译文'} · 点选文字查看完整内容 · 未完成区域保留原稿`}</p>}
    {paintState.ready && hasReadableText && readable.some(value => !value) && <p class="notice">部分文字被图形遮挡或无法确认可见性，已保留原稿，不提取或发送这些区域。</p>}
    {layout?.truncated && <p class="notice">此页文字过多，当前处理前 200 段或 100,000 个字符。原始页面完整保留。</p>}
    <dialog class="pdf-detail" aria-labelledby="pdf-detail-title" ref={dialog} onClose={() => setSelected(null)} onCancel={() => setSelected(null)}>
      <header><h2 id="pdf-detail-title">原文与译文</h2><button aria-label="关闭段落详情" onClick={() => setSelected(null)}>✕</button></header>
      {chosen && <div class="detail-body"><p class="detail-source">{chosen.text}</p><p class="detail-translation">{selected !== null && rows[selected]?.text || (chosen.translatable ? '译文尚未完成，原稿保持不变。' : '此处为数字、标识或无需翻译的内容，保留原文。')}</p>
        {selected !== null && rows[selected]?.error && <p class="paragraph-error" role="alert"><strong>翻译失败原因</strong><br />{rows[selected]!.error}{rows[selected]?.done && ' 上次成功的译文已保留。'}</p>}</div>}
      {chosen?.translatable && selected !== null && <footer class="detail-actions"><button disabled={rows[selected]?.retrying || rows[selected]?.busy} onClick={() => void retryBlock(selected)}>{retryLabel(selected)}</button><span role="status">{rows[selected]?.retrying ? '正在重新请求这一段…' : '只重新请求当前段落'}</span></footer>}
    </dialog>
  </section>;
}
