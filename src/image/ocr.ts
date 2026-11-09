import type { OcrResult, InitializationSummary } from '@paddleocr/paddleocr-js';

export type OcrMode = 'tiny' | 'small';
type Pending = { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> };

/** One lazy worker/model session per reader. Termination makes cancellation immediate. */
export class LocalOcr {
  private worker?: Worker;
  private pending = new Map<number, Pending>();
  private serial = 0;
  private generation = 0;
  private initialized?: Promise<InitializationSummary>;
  constructor(private assets: string, readonly mode: OcrMode = 'tiny') {}
  private request<T>(type: string, payload: unknown, transfer: Transferable[] = []) {
    this.worker ??= new Worker(new URL('worker.js', this.assets), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent) => {
      const message = event.data;
      if (message?.kind !== 'worker-transport-response') return;
      const job = this.pending.get(message.requestId); if (!job) return;
      clearTimeout(job.timer); this.pending.delete(message.requestId);
      if (message.status === 'error') job.reject(new Error(message.error?.message || '图片文字识别失败'));
      else job.resolve(message.payload);
    };
    this.worker.onerror = () => this.destroy(new Error('图片识别线程无法启动，请重新打开图片'));
    this.worker.onmessageerror = () => this.destroy(new Error('图片识别结果无法读取，请重新打开图片'));
    const requestId = ++this.serial;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => this.destroy(new Error('图片识别超时，请裁剪图片后重试')), 60000);
      this.pending.set(requestId, { resolve: value => resolve(value as T), reject, timer });
      try { this.worker!.postMessage({ kind: 'worker-transport-request', requestId, type, payload }, transfer); }
      catch (reason) { clearTimeout(timer); this.pending.delete(requestId); reject(reason); }
    });
  }
  prepare() {
    const name = `PP-OCRv6_${this.mode}`;
    return this.initialized ??= this.request<{ summary: InitializationSummary }>('init', { options: {
      pipelineConfig: {
        pipelineName: 'OCR', raw: {}, warnings: [], unsupportedFeatures: [], pipelineBatchSize: 1,
        textDetectionBatchSize: 1, textRecognitionBatchSize: 8,
        modelSelection: { textDetectionModelName: `${name}_det`, textRecognitionModelName: `${name}_rec` },
        assets: { det: { url: new URL(`${name}_det.tar`, this.assets).href }, rec: { url: new URL(`${name}_rec.tar`, this.assets).href } },
        runtimeDefaults: {},
      },
      ortOptions: { backend: 'wasm', wasmPaths: this.assets, numThreads: 1, simd: true, proxy: false },
    } }).then(value => value.summary).catch(error => { this.destroy(); throw error; });
  }
  async recognize(image: Blob) {
    const generation = this.generation;
    await this.prepare();
    const bitmap = await createImageBitmap(image);
    if (generation !== this.generation) { bitmap.close(); throw new Error('图片识别已取消'); }
    if (bitmap.width * bitmap.height > 24000000) { bitmap.close(); throw new Error('图片超过 2400 万像素，请裁剪后重试'); }
    try {
      const result = await this.request<OcrResult[]>('predict', { sources: [{ kind: 'imageBitmap', imageBitmap: bitmap }], params: { textDetLimitSideLen: 1280, textDetLimitType: 'max', textRecScoreThresh: 0.35 } }, [bitmap]);
      if (!result[0]) throw new Error('未识别到图片文字');
      return result[0];
    } finally { bitmap.close(); }
  }
  destroy(reason = new Error('图片识别已取消')) {
    this.generation++;
    this.worker?.terminate(); this.worker = undefined; this.initialized = undefined;
    for (const job of this.pending.values()) { clearTimeout(job.timer); job.reject(reason); }
    this.pending.clear();
  }
}
