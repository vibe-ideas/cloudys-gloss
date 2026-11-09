import { browser } from 'wxt/browser';
import { ResultCache, cacheKey } from '../../src/core/cache';
import { send, cancel } from '../../src/core/messaging';
import { createId } from '../../src/core/id';
import { LocalOcr } from '../../src/image/ocr';
import { readImage } from '../../src/image/io';
import { ImageOcrSchema, imageTextNeedsTranslation, validateImageTranslation, type ImageOcr, type ReadingLine } from '../../src/image/regions';
import { InlineImageRequest, type InlineImageJob, type InlineImageUpdate } from '../../src/image/inline-protocol';
import { protectTranslationLiterals } from '../../src/core/translation-literals';

const port = browser.runtime.connect({ name: 'image-inline-processor' });
const cache = new ResultCache('cloudys-gloss-image-ocr', 48, 7 * 86400000);
let ocr: LocalOcr | undefined; let operation: AbortController | undefined; let generation = 0;
const requests = new Set<string>();
const stop = () => { generation++; operation?.abort(); ocr?.destroy(); ocr = undefined; for (const id of requests) cancel(id); requests.clear(); };
const post = (value: InlineImageUpdate) => {
  const status = document.querySelector('[role="status"]');
  if (status) status.textContent = value.type === 'progress' ? value.status : value.type === 'error' ? value.error : value.done ? '图片处理完成，译文已显示在原文章中。空闲 30 秒后此页自动关闭。' : '正在本机翻译图片文字，可以返回原文章继续阅读。';
  try { port.postMessage(value); } catch { stop(); }
};

async function process(job: InlineImageJob) {
  // A subsequent image supersedes an active job but reuses an idle OCR model.
  if (operation) stop();
  const current = ++generation; const controller = new AbortController(); operation = controller;
  const started = performance.now();
  const progress = (status: string) => { if (current === generation) post({ type: 'progress', id: job.id, status }); };
  const timer = setTimeout(() => { if (current !== generation) return; controller.abort(new Error('图片处理超时，请重试或在阅读页处理')); ocr?.destroy(); for (const id of requests) cancel(id); }, 180000);
  try {
    progress('正在读取图片…');
    const blob = await readImage(job.url, controller.signal);
    // Animated content needs a frozen frame; use the reader which provides that preview.
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
    let animated = blob.type === 'image/gif';
    if (blob.type === 'image/png') {
      const view = new DataView(bytes.buffer);
      for (let offset = 8; offset + 12 <= bytes.length;) { const type = tag(offset + 4); if (type === 'acTL') { animated = true; break; } if (type === 'IDAT') break; const size = view.getUint32(offset); offset += 12 + size; }
    }
    if (blob.type === 'image/webp') {
      const view = new DataView(bytes.buffer);
      for (let offset = 12; offset + 8 <= bytes.length;) { if (tag(offset) === 'ANIM') { animated = true; break; } const size = view.getUint32(offset + 4, true); offset += 8 + size + size % 2; }
    }
    if (animated || blob.type === 'image/avif') throw new Error('动画或 AVIF 请点击“打开图片阅读页”，使用冻结画面核对译文');
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
    const key = await cacheKey(['image-ocr-v1', 'paddleocr-js-0.4.2', 'small', 1280, hash]);
    controller.signal.throwIfAborted();
    const hit = ImageOcrSchema.safeParse(await cache.get(key)); let value: ImageOcr;
    if (hit.success) value = hit.data;
    else {
      progress('正在本机精细识别…');
      ocr ??= new LocalOcr(browser.runtime.getURL('/ocr-resources/'), 'small');
      value = ImageOcrSchema.parse(await ocr.recognize(blob)); controller.signal.throwIfAborted(); await cache.set(key, value);
    }
    controller.signal.throwIfAborted(); if (current !== generation) return;
    const items: ReadingLine[] = value.items.map(line => ({ ...line, translation: !imageTextNeedsTranslation(line.text) || protectTranslationLiterals(line.text).literalOnly ? line.text : undefined }));
    const emit = (done: boolean) => { if (current === generation) post({ type: 'result', id: job.id, done, image: value.image, items, ms: performance.now() - started }); };
    emit(false);
    const indices = items.flatMap((line, index) => line.score >= .85 && !line.translation ? [index] : []);
    // Match the reader's context and cache keys; website captions are not OCR instructions.
    const context = items.map(line => line.text).join('\n').slice(0, 12000);
    const translationProgress = () => progress(`正在本机翻译 ${indices.filter(index => !!items[index]!.translation && !items[index]!.error).length} / ${indices.length} 个文字区域…`);
    for (let start = 0; start < indices.length; start += 8) {
      controller.signal.throwIfAborted(); if (current !== generation) return;
      const batch = indices.slice(start, start + 8); const id = createId(); requests.add(id);
      translationProgress();
      try {
        const translated = await send<string[]>({ type: 'image:translate', id, texts: batch.map(index => items[index]!.text), context });
        controller.signal.throwIfAborted(); if (current !== generation) return;
        batch.forEach((index, i) => { const line = items[index]!; const text = translated[i]; if (text && validateImageTranslation(line.text, text)) line.translation = text; else line.error = '译文未通过中文或数字校验'; });
      } catch (reason) {
        controller.signal.throwIfAborted(); if (current !== generation) return;
        batch.forEach(index => { items[index]!.error = reason instanceof Error ? reason.message.slice(0, 1000) : '翻译失败'; });
      } finally { requests.delete(id); }
      emit(false);
      translationProgress();
    }
    emit(true);
  } catch (reason) {
    if (current === generation) post({ type: 'error', id: job.id, error: (reason instanceof Error ? reason.message : '图片处理失败').slice(0, 1000) });
  } finally { clearTimeout(timer); if (current === generation) operation = undefined; }
}
port.onMessage.addListener((raw: unknown) => {
  if (raw && typeof raw === 'object' && 'type' in raw && raw.type === 'stop') { stop(); operation = undefined; return; }
  const parsed = InlineImageRequest.safeParse(raw); if (parsed.success) void process(parsed.data);
});
port.onDisconnect.addListener(stop);
window.addEventListener('pagehide', stop);
port.postMessage({ token: location.hash.slice(1) });
