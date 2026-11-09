import { browser } from 'wxt/browser';
import { InlineImageEvent, InlineImageRequest, type InlineImageJob } from './inline-protocol';

type Port = ReturnType<typeof browser.runtime.connect>;
type Session = { owner: Port; job?: InlineImageJob };
type Processor = { token: string; port?: Port; resource: Promise<number | undefined>; offscreenCreated?: boolean; current?: { session: Session; job: InlineImageJob }; idle?: ReturnType<typeof setTimeout>; startup?: ReturnType<typeof setTimeout>; closed: boolean };

/** One shared, lazy OCR document. Chrome uses offscreen; Firefox uses an inactive tab.
 * Jobs from different articles are serialized so they cannot multiply model memory. */
export class InlineImageBroker {
  private sessions = new Set<Session>();
  private processor?: Processor;
  private resourceQueue: Promise<unknown> = Promise.resolve();
  constructor(private offscreen = !import.meta.env.FIREFOX, private released: (sender: Port['sender']) => void = () => {}) {}
  get size() { return this.processor ? 1 : 0; }
  connect(port: Port) {
    if (port.name === 'image-inline-owner') {
      if (port.sender?.id !== browser.runtime.id || port.sender?.tab?.id === undefined || port.sender.frameId !== 0 || !/^https?:/.test(port.sender.url ?? '')) { port.disconnect(); return true; }
      const session: Session = { owner: port }; this.sessions.add(session);
      port.onDisconnect.addListener(() => {
        this.cancel(session); this.sessions.delete(session);
        if (!this.sessions.size) this.close(); else this.drain();
      });
      port.onMessage.addListener((raw: unknown) => {
        if (raw && typeof raw === 'object' && 'type' in raw && raw.type === 'stop') { this.cancel(session); this.drain(); return; }
        const parsed = InlineImageRequest.safeParse(raw); if (!parsed.success) return;
        this.cancel(session); session.job = parsed.data; this.drain();
      });
      return true;
    }
    if (port.name !== 'image-inline-processor') return false;
    let started = false;
    port.onMessage.addListener((raw: unknown) => {
      if (started) return; started = true;
      const processor = this.processor;
      const token = raw && typeof raw === 'object' && 'token' in raw ? raw.token : undefined;
      if (!processor || token !== processor.token || processor.port || port.sender?.id !== browser.runtime.id || port.sender.url !== browser.runtime.getURL('/image-process.html') + `#${processor.token}`) { port.disconnect(); return; }
      void processor.resource.then(tabId => {
        if (processor.closed || processor.port || (!this.offscreen && port.sender?.tab?.id !== tabId) || (this.offscreen && port.sender?.tab)) { port.disconnect(); return; }
        clearTimeout(processor.startup); processor.port = port;
        port.onDisconnect.addListener(() => { if (!processor.closed) this.fail('图片处理页已关闭，请重试'); });
        port.onMessage.addListener((message: unknown) => {
          const parsed = InlineImageEvent.safeParse(message); const current = processor.current;
          if (!parsed.success || !current || parsed.data.id !== current.job.id || processor.closed) return;
          this.post(current.session, parsed.data);
          if (parsed.data.type === 'error' || parsed.data.type === 'result' && parsed.data.done) {
            current.session.job = undefined; processor.current = undefined; this.drain();
          }
        });
        this.drain();
      }).catch(() => port.disconnect());
    });
    return true;
  }
  private post(session: Session, message: unknown) { try { session.owner.postMessage(message); } catch { /* Owner disconnect cleans up its job. */ } }
  private cancel(session: Session) {
    session.job = undefined;
    if (this.processor?.current?.session === session) {
      this.processor.current = undefined;
      try { this.processor.port?.postMessage({ type: 'stop' }); } catch { this.fail('图片处理连接已断开，请重试'); }
    }
  }
  private drain() {
    const waiting = [...this.sessions].find(session => session.job);
    if (!waiting) {
      const processor = this.processor;
      if (processor && !processor.idle) processor.idle = setTimeout(() => this.close(), 30000);
      return;
    }
    if (!this.processor) this.open();
    const processor = this.processor!; clearTimeout(processor.idle); processor.idle = undefined;
    if (!processor.port || processor.current) return;
    processor.current = { session: waiting, job: waiting.job! };
    try { processor.port.postMessage(waiting.job); } catch { this.fail('图片处理连接已断开，请重试'); }
  }
  private open() {
    const token = crypto.randomUUID();
    const processor: Processor = { token, closed: false, resource: Promise.resolve(undefined) };
    this.processor = processor;
    processor.startup = setTimeout(() => this.fail('图片处理页未能启动，请重试或打开图片阅读页'), 15000);
    processor.resource = this.resourceQueue.then(async () => {
      if (processor.closed) return undefined;
      const url = browser.runtime.getURL('/image-process.html') + `#${token}`;
      if (this.offscreen) {
        // A browser/service-worker restart can leave an orphaned offscreen document.
        if (typeof browser.runtime.getContexts === 'function') {
          const existing = await browser.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
          if (existing.some(context => context.documentUrl?.split('#')[0] === browser.runtime.getURL('/image-process.html'))) await browser.offscreen.closeDocument();
          else if (existing.length) throw new Error('扩展的其他离屏任务正在运行');
        }
        if (processor.closed) return undefined;
        await browser.offscreen.createDocument({ url, reasons: ['WORKERS'], justification: '在本机 Worker 中识别用户选择的文章图片，避免后台标签页限速。' });
        processor.offscreenCreated = true;
        return undefined;
      }
      const tab = await browser.tabs.create({ url, active: false });
      if (tab.id === undefined) throw new Error('无法创建本机图片处理页');
      return tab.id;
    });
    this.resourceQueue = processor.resource.catch(() => {});
    void processor.resource.catch(() => { if (!processor.closed) this.fail('无法启动本机图片识别，请重试或打开图片阅读页'); });
  }
  private fail(error: string) {
    for (const session of this.sessions) if (session.job) { this.post(session, { type: 'error', id: session.job.id, error }); session.job = undefined; }
    this.close();
  }
  private close() {
    const processor = this.processor; if (!processor || processor.closed) return;
    processor.closed = true; this.processor = undefined; clearTimeout(processor.idle); clearTimeout(processor.startup);
    if (processor.port) this.released(processor.port.sender);
    processor.port?.disconnect();
    this.resourceQueue = this.resourceQueue.then(async () => {
      const tabId = await processor.resource.catch(() => undefined);
      if (this.offscreen && processor.offscreenCreated) await browser.offscreen.closeDocument().catch(() => {});
      else if (tabId !== undefined) await browser.tabs.remove(tabId).catch(() => {});
    });
  }
}
