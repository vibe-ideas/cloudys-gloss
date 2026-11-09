import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { BrandMark } from '../../src/ui/brand-mark';
import { LocalOcr, type OcrMode } from '../../src/image/ocr';
import { ImageOcrSchema, imageTextNeedsTranslation, lineGeometry, validateImageTranslation, type ImageOcr, type ReadingLine } from '../../src/image/regions';
import { readImage, imageUrl } from '../../src/image/io';
import { ResultCache, cacheKey } from '../../src/core/cache';
import { send, cancel } from '../../src/core/messaging';
import { createId } from '../../src/core/id';
import { protectTranslationLiterals } from '../../src/core/translation-literals';
import './style.css';

const cache = new ResultCache('cloudys-gloss-image-ocr', 48, 7 * 86400000);
const message = (error: unknown) => error instanceof Error ? error.message : '图片处理失败，请重试';

function ImageReader() {
  const ocr = useRef<LocalOcr | undefined>(undefined);
  const imageContext = useRef('');
  const requests = useRef(new Set<string>());
  const operation = useRef<AbortController | undefined>(undefined);
  const generation = useRef(0);
  const objectUrl = useRef(''); const source = useRef<Blob | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<OcrMode>('small');
  const [recognizeOnly, setRecognizeOnly] = useState(false);
  const [status, setStatus] = useState('选择图片，识别和翻译都在本机完成。');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState(''); const [name, setName] = useState('');
  const [image, setImage] = useState<ImageOcr['image']>();
  const [lines, setLines] = useState<ReadingLine[]>([]);
  const [showOriginal, setOriginal] = useState(false);
  const [fullSize, setFullSize] = useState(false);
  const [ocrMs, setOcrMs] = useState(0); const [totalMs, setTotalMs] = useState(0); const [cached, setCached] = useState(false);
  const stop = () => {
    generation.current++; operation.current?.abort(); ocr.current?.destroy(); ocr.current = undefined;
    for (const id of requests.current) cancel(id); requests.current.clear();
    setBusy(false); setStatus('已停止，保留已完成的识别与译文。');
  };
  useEffect(() => {
    return () => { generation.current++; operation.current?.abort(); ocr.current?.destroy(); for (const id of requests.current) cancel(id); requests.current.clear(); URL.revokeObjectURL(objectUrl.current); };
  }, []);

  const translateLines = async (input: ReadingLine[], current: number, started: number) => {
    imageContext.current = input.map(line => line.text).join('\n').slice(0, 12000);
    const next = input.map(line => ({ ...line }));
    const indices = next.flatMap((line, index) => (line.score >= .85 || line.confirmed) && imageTextNeedsTranslation(line.text) && !line.translation ? [index] : []);
    for (let start = 0; start < indices.length; start += 8) {
      if (current !== generation.current) return;
      const batch = indices.slice(start, start + 8); const id = createId(); requests.current.add(id);
      setStatus(`正在本机翻译 ${Math.min(start + 8, indices.length)} / ${indices.length} 个文字区域…`);
      try {
        const values = await send<string[]>({ type: 'image:translate', id, texts: batch.map(index => next[index]!.text), context: imageContext.current });
        if (current !== generation.current) return;
        batch.forEach((index, item) => {
          const value = values[item]; const line = next[index]!;
          if (value && validateImageTranslation(line.text, value)) { line.translation = value; line.error = undefined; }
          else line.error = '译文未通过中文或数字校验，请核对后重试';
        });
      } catch (reason) {
        if (current !== generation.current) return;
        batch.forEach(index => { next[index]!.error = message(reason); });
      } finally { requests.current.delete(id); }
      setLines([...next]);
    }
    if (current !== generation.current) return;
    const failures = next.filter(line => line.error).length;
    const uncertain = next.filter(line => line.score < .85 && !line.confirmed).length;
    setStatus(`图片处理完成 · ${next.length} 个文字区域${uncertain ? ` · ${uncertain} 处识别需核对` : ''}${failures ? ` · ${failures} 处翻译待重试` : ''}`);
    setTotalMs(performance.now() - started); setBusy(false);
  };
  const recognize = async (blob: Blob, current: number, signal: AbortSignal, started: number, bypass = false) => {
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('');
    const key = await cacheKey(['image-ocr-v1', 'paddleocr-js-0.4.2', mode, 1280, hash]);
    const hit = bypass ? undefined : ImageOcrSchema.safeParse(await cache.get(key));
    signal.throwIfAborted();
    let value: ImageOcr;
    const clock = performance.now();
    if (hit?.success) { value = hit.data; setCached(true); }
    else {
      if (ocr.current?.mode !== mode) { ocr.current?.destroy(); ocr.current = new LocalOcr(browser.runtime.getURL('/ocr-resources/'), mode); }
      value = ImageOcrSchema.parse(await ocr.current.recognize(blob)); signal.throwIfAborted();
      await cache.set(key, value); setCached(false);
    }
    if (current !== generation.current) return;
    if (value.image.width * value.image.height > 24000000) throw new Error('图片超过 2400 万像素，请裁剪后重试');
    setOcrMs(performance.now() - clock); setImage(value.image);
    const next = value.items.map(line => ({ ...line, translation: !imageTextNeedsTranslation(line.text) || protectTranslationLiterals(line.text).literalOnly ? line.text : undefined }));
    setLines(next);
    if (!next.length) { setBusy(false); setStatus('没有识别到文字，可用精细模式重新识别，或选择更清晰的图片。'); return; }
    if (recognizeOnly) { setBusy(false); setStatus(`识别完成 · ${next.length} 个文字区域`); setTotalMs(performance.now() - started); return; }
    await translateLines(next, current, started);
  };
  const open = (input: File | string) => {
    if (busy) stop();
    else { generation.current++; operation.current?.abort(); }
    const current = ++generation.current; const controller = new AbortController(); operation.current = controller;
    const started = performance.now(); setBusy(true); setError(''); setLines([]); setImage(undefined); setOcrMs(0); setTotalMs(0);
    setStatus('正在读取图片…');
    setName(typeof input === 'string' ? '网页图片' : input.name);
    const timer = setTimeout(() => controller.abort(new Error('图片读取超时，请下载后打开本地文件')), 60000);
    void readImage(input, controller.signal).then(async blob => {
      if (current !== generation.current) return;
      clearTimeout(timer); source.current = blob;
      const bitmap = await createImageBitmap(blob);
      if (current !== generation.current) { bitmap.close(); return; }
      const size = { width: bitmap.width, height: bitmap.height };
      if (size.width * size.height > 24000000) { bitmap.close(); throw new Error('图片超过 2400 万像素，请裁剪后重试'); }
      // Freeze the same decoded frame used by OCR, including GIF/APNG/WebP animations.
      const canvas = new OffscreenCanvas(size.width, size.height);
      try { canvas.getContext('2d')!.drawImage(bitmap, 0, 0); } finally { bitmap.close(); }
      const preview = await canvas.convertToBlob({ type: 'image/png' });
      if (current !== generation.current) return;
      URL.revokeObjectURL(objectUrl.current); objectUrl.current = URL.createObjectURL(preview);
      setImage(size); setOriginal(false); setStatus('正在本机识别文字…');
      await recognize(blob, current, controller.signal, started);
    }).catch(reason => { if (current === generation.current) { setError(message(controller.signal.aborted ? controller.signal.reason : reason)); setBusy(false); setStatus('图片处理未完成'); } }).finally(() => clearTimeout(timer));
  };
  useEffect(() => {
    const initial = new URLSearchParams(location.hash.slice(1)).get('url');
    if (initial) { try { imageUrl(initial); setUrl(initial); open(initial); } catch (reason) { setError(message(reason)); } }
  }, []);
  const retry = (rescan = false) => {
    if (!source.current) return;
    setError(''); setBusy(true);
    const current = ++generation.current; const controller = new AbortController(); operation.current = controller;
    const started = performance.now();
    if (rescan) {
      setStatus('正在本机识别文字…');
      void recognize(source.current, current, controller.signal, started, true).catch(reason => { if (current === generation.current) { setBusy(false); setError(message(reason)); } });
    } else void translateLines(lines.map(line => ({ ...line, error: undefined })), current, started);
  };
  return <main class="image-reader" data-ocr-ms={ocrMs} data-total-ms={totalMs} data-ocr-cached={cached}>
    <header><div class="brand"><BrandMark className="logo" />Cloudy’s Gloss <span>图片翻译</span></div><button onClick={() => void send({ type: 'settings:open' })}>模型设置</button></header>
    <section class="intro"><h1>读懂图片里的文字。</h1><p>本机识别，离线翻译。保留原图，随时核对。</p></section>
    <section class="open-image" aria-label="选择图片">
      <div class="file-row"><button class="primary" disabled={busy} onClick={() => fileInput.current?.click()}>选择本地图片</button><span>PNG / JPEG / WebP / GIF · 最大 20 MB</span>
        <input ref={fileInput} aria-label="本地图片" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif" onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) open(file); }} />
      </div>
      <form onSubmit={event => { event.preventDefault(); if (!busy) open(url); }}><label for="image-url">或使用图片链接</label><div class="url-row"><input id="image-url" type="url" value={url} required placeholder="https://example.com/image.png" disabled={busy} onInput={event => setUrl(event.currentTarget.value)} /><button disabled={busy}>打开图片</button></div></form>
    </section>
    <section class="toolbar"><label>识别模式 <select aria-label="识别模式" value={mode} disabled={busy} onChange={event => setMode(event.currentTarget.value as OcrMode)}><option value="tiny">快速 · 清晰大字</option><option value="small">精细 · 小字优先</option></select></label><label><input type="checkbox" checked={recognizeOnly} disabled={busy} onChange={event => setRecognizeOnly(event.currentTarget.checked)} />仅识别文字</label>
      <span>翻译：本机模型 · 结合图片语境</span>
      {image && <><button disabled={busy} onClick={() => retry(true)}>重新识别</button><button disabled={busy || !lines.length} onClick={() => retry()}>翻译待处理文字</button><button aria-pressed={showOriginal} onClick={() => setOriginal(value => !value)}>{showOriginal ? '查看译图' : '查看原图'}</button><button aria-pressed={fullSize} onClick={() => setFullSize(value => !value)}>{fullSize ? '适合窗口' : '原始尺寸'}</button></>}
      {busy && <button onClick={stop}>停止处理</button>}
    </section>
    <div class="progress"><p role="status">{status}</p>{(ocrMs > 0 || cached) && <small>识别 {cached ? '缓存命中' : `${(ocrMs / 1000).toFixed(2)} 秒`}{totalMs > 0 ? ` · 本次处理 ${(totalMs / 1000).toFixed(2)} 秒` : ''}</small>}</div>
    {error && <p class="error" role="alert">{error}</p>}
    {image && <section class="image-layout"><div class="picture-card"><div class="picture-caption">{name}<small>原图尺寸 {image.width} × {image.height} · 数字保留原样</small></div>
      <div class="picture-scroll"><div class="picture" style={{ aspectRatio: `${image.width}/${image.height}`, width: fullSize ? `${image.width}px` : '100%' }}>
        <img src={objectUrl.current} alt="待翻译的原图" />
        {!showOriginal && lines.map((line, index) => {
          const bounds = lineGeometry(line, image);
          if (!bounds || !line.translation || line.translation === line.text || line.score < .85 && !line.confirmed) return null;
          return <div key={index} class="translated-region" title={`${line.text}\n${line.translation}`} style={{ left: `${bounds.x / image.width * 100}%`, top: `${bounds.y / image.height * 100}%`, width: `${bounds.width / image.width * 100}%`, height: `${bounds.height / image.height * 100}%`, transform: `rotate(${bounds.angle}deg)`, fontSize: `${Math.min(bounds.height * .78, bounds.width / Math.max(line.translation.length, 1) * .95) / image.width * 100}cqw` }}>{line.translation}</div>;
        })}
      </div></div>
    </div><aside class="text-card"><h2>文字与译文</h2><p>低置信度文字保留原图。可修正识别文字，再翻译。</p>
      <ol>{lines.map((line, index) => <li key={index} data-confidence={line.score} class={line.score < .85 && !line.confirmed ? 'uncertain' : ''}>
        <label for={`line-${index}`}>区域 {index + 1}{line.score < .85 && !line.confirmed ? ' · 请核对' : ''}</label>
        <textarea id={`line-${index}`} aria-label={`区域 ${index + 1} 原文`} value={line.text} disabled={busy} rows={2} onInput={event => { const text = event.currentTarget.value; setLines(value => value.map((item, i) => i === index ? { ...item, text, translation: undefined, error: undefined, confirmed: true } : item)); }} />
        <div class="translation">{line.error ? <span class="error">{line.error}</span> : line.translation || (line.score < .85 && !line.confirmed ? '请核对后勾选，再点击翻译待处理文字。' : '等待翻译')}</div>
        {line.score < .85 && <label class="confirm"><input type="checkbox" checked={!!line.confirmed} disabled={busy} onChange={event => { const confirmed = event.currentTarget.checked; setLines(value => value.map((item, i) => i === index ? { ...item, confirmed } : item)); }} />已核对原文</label>}
      </li>)}</ol>
    </aside></section>}
    <footer>识别模型已随插件打包；翻译仅使用本机模型。图片链接的首次读取需要网络，选择本地文件可断网使用。GIF 读取静态帧。</footer>
  </main>;
}
render(<ImageReader />, document.getElementById('app')!);
