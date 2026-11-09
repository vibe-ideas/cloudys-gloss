import { afterEach, describe, expect, it, vi } from 'vitest';
import { imageDisplay } from '../../src/image/display';
import { InlineImageBroker } from '../../src/image/inline-broker';

const api = vi.hoisted(() => ({ create: vi.fn(), remove: vi.fn(), offscreenCreate: vi.fn(), offscreenClose: vi.fn(), contexts: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: {
  runtime: { id: 'test-addon', getURL: (path: string) => 'chrome-extension://test-addon' + path, getContexts: api.contexts },
  tabs: { create: api.create, remove: api.remove },
  offscreen: { createDocument: api.offscreenCreate, closeDocument: api.offscreenClose },
} }));
type Listener = (value?: unknown) => void;
function connection(name: string, tab = 7, url = 'https://article.example/post') {
  const messages = new Set<Listener>(); const disconnects = new Set<Listener>(); let closed = false;
  const value = { name, sender: { id: 'test-addon', tab: { id: tab }, frameId: 0, url },
    onMessage: { addListener: (listener: Listener) => messages.add(listener) }, onDisconnect: { addListener: (listener: Listener) => disconnects.add(listener) },
    postMessage: vi.fn(), disconnect: vi.fn(() => { if (!closed) { closed = true; disconnects.forEach(listener => listener()); } }),
  };
  return { value: value as unknown as Parameters<InlineImageBroker['connect']>[0], post: value.postMessage, disconnect: value.disconnect,
    receive: (message: unknown) => messages.forEach(listener => listener(message)) };
}
const job = { type: 'start', id: '76ba9c56-b9d0-4fbd-8d20-701fd9fb5318', url: 'https://images.example/chart.png' };
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

describe('网页文章内的图片翻译', () => {
  it('contain 留白、cover 裁剪与 fill 拉伸时，译文坐标跟随实际图片内容', () => {
    expect(imageDisplay(400, 300, 800, 400, 'contain', '50% 50%')).toEqual({ left: 0, top: 50, scaleX: .5, scaleY: .5 });
    expect(imageDisplay(400, 300, 800, 400, 'cover', '100% 0%')).toEqual({ left: -200, top: 0, scaleX: .75, scaleY: .75 });
    expect(imageDisplay(400, 300, 800, 400, 'fill', '50% 50%')).toEqual({ left: 0, top: 0, scaleX: .5, scaleY: .75 });
    expect(imageDisplay(0, 300, 800, 400, 'contain', '50% 50%')).toBeUndefined();
    expect(imageDisplay(400, 300, 800, 400, 'cover', 'right 10px bottom 5px')).toBeUndefined();
  });
  it('读者点击文章图片后在后台处理，只有该处理页可把译文送回原文章', async () => {
    api.create.mockResolvedValue({ id: 22 }); api.remove.mockResolvedValue(undefined);
    const broker = new InlineImageBroker(false); const owner = connection('image-inline-owner'); broker.connect(owner.value); owner.receive(job);
    await vi.waitFor(() => expect(api.create).toHaveBeenCalledOnce());
    const url = api.create.mock.calls[0]![0].url as string; expect(api.create.mock.calls[0]![0].active).toBe(false);
    const token = url.split('#')[1];
    const stranger = connection('image-inline-processor', 23, url); broker.connect(stranger.value); stranger.receive({ token });
    await vi.waitFor(() => expect(stranger.disconnect).toHaveBeenCalled()); expect(owner.post).not.toHaveBeenCalled();
    const processor = connection('image-inline-processor', 22, url); broker.connect(processor.value); processor.receive({ token });
    await vi.waitFor(() => expect(processor.post).toHaveBeenCalledWith(job));
    processor.receive({ type: 'progress', id: job.id, status: '正在本机识别…' }); expect(owner.post).toHaveBeenCalledWith({ type: 'progress', id: job.id, status: '正在本机识别…' });
    const count = owner.post.mock.calls.length;
    processor.receive({ type: 'progress', id: crypto.randomUUID(), status: '迟到的旧任务' }); expect(owner.post).toHaveBeenCalledTimes(count);
    owner.disconnect(); await vi.waitFor(() => expect(api.remove).toHaveBeenCalledWith(22)); expect(broker.size).toBe(0);
  });
  it('文章关闭或读者停止翻译时，正在运行的图片处理同时取消', async () => {
    api.create.mockResolvedValue({ id: 22 }); api.remove.mockResolvedValue(undefined);
    const broker = new InlineImageBroker(false); const owner = connection('image-inline-owner'); broker.connect(owner.value); owner.receive(job);
    await vi.waitFor(() => expect(api.create).toHaveBeenCalledOnce());
    const url = api.create.mock.calls[0]![0].url as string; const processor = connection('image-inline-processor', 22, url); broker.connect(processor.value); processor.receive({ token: url.split('#')[1] });
    await vi.waitFor(() => expect(processor.post).toHaveBeenCalledWith(job));
    owner.receive({ type: 'stop' }); expect(processor.post).toHaveBeenLastCalledWith({ type: 'stop' });
    const count = owner.post.mock.calls.length; processor.receive({ type: 'progress', id: job.id, status: '已取消的任务' }); expect(owner.post).toHaveBeenCalledTimes(count);
    owner.disconnect(); expect(processor.disconnect).toHaveBeenCalled(); await vi.waitFor(() => expect(api.remove).toHaveBeenCalledWith(22));
  });
  it('图片完成后保留后台模型供下一张复用，空闲 30 秒自动关闭处理页', async () => {
    vi.useFakeTimers(); api.create.mockResolvedValue({ id: 22 }); api.remove.mockResolvedValue(undefined);
    const broker = new InlineImageBroker(false); const owner = connection('image-inline-owner'); broker.connect(owner.value); owner.receive(job);
    await vi.advanceTimersByTimeAsync(0);
    const url = api.create.mock.calls[0]![0].url as string; const processor = connection('image-inline-processor', 22, url); broker.connect(processor.value); processor.receive({ token: url.split('#')[1] });
    await Promise.resolve(); await Promise.resolve();
    processor.receive({ type: 'result', id: job.id, done: true, image: { width: 400, height: 200 }, items: [], ms: 3000 });
    await vi.advanceTimersByTimeAsync(29000); expect(api.remove).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000); expect(api.remove).toHaveBeenCalledWith(22); expect(broker.size).toBe(0);
  });
  it('网页伪装处理页、脚本图片地址及额外子框架均不能启动本机图片任务', () => {
    const broker = new InlineImageBroker(false); const owner = connection('image-inline-owner'); broker.connect(owner.value);
    owner.receive({ ...job, url: 'javascript:alert(1)' }); expect(api.create).not.toHaveBeenCalled();
    const subframe = connection('image-inline-owner'); subframe.value.sender!.frameId = 1; broker.connect(subframe.value); expect(subframe.disconnect).toHaveBeenCalled();
    const stranger = connection('image-inline-processor'); broker.connect(stranger.value); stranger.receive({ token: 'forged' }); expect(stranger.disconnect).toHaveBeenCalled();
    owner.disconnect();
  });
  it('Chrome 两篇文章同时翻译时只开一个离屏处理文档，依次返回各自译文并在文章关闭后释放', async () => {
    api.offscreenCreate.mockResolvedValue(undefined); api.offscreenClose.mockResolvedValue(undefined); api.contexts.mockResolvedValue([]);
    const released = vi.fn(); const broker = new InlineImageBroker(true, released);
    const first = connection('image-inline-owner'); const second = connection('image-inline-owner', 8);
    broker.connect(first.value); broker.connect(second.value); first.receive(job);
    const next = { ...job, id: crypto.randomUUID(), url: 'https://images.example/next.png' }; second.receive(next);
    await vi.waitFor(() => expect(api.offscreenCreate).toHaveBeenCalledOnce()); expect(api.create).not.toHaveBeenCalled();
    const url = api.offscreenCreate.mock.calls[0]![0].url as string;
    const processor = connection('image-inline-processor', 22, url); delete processor.value.sender!.tab;
    broker.connect(processor.value); processor.receive({ token: url.split('#')[1] });
    await vi.waitFor(() => expect(processor.post).toHaveBeenCalledWith(job)); expect(processor.post).not.toHaveBeenCalledWith(next);
    processor.receive({ type: 'result', id: job.id, done: true, image: { width: 400, height: 200 }, items: [], ms: 3000 });
    expect(first.post).toHaveBeenCalledWith(expect.objectContaining({ id: job.id, type: 'result' })); expect(second.post).not.toHaveBeenCalled();
    expect(processor.post).toHaveBeenLastCalledWith(next);
    first.disconnect(); expect(processor.disconnect).not.toHaveBeenCalled(); second.disconnect();
    await vi.waitFor(() => expect(api.offscreenClose).toHaveBeenCalledOnce()); expect(released).toHaveBeenCalledWith(processor.value.sender);
  });
  it('Chrome 后台重启遗留图片处理文档时先释放再重建，其他用途的离屏文档不会被关闭', async () => {
    api.offscreenCreate.mockResolvedValue(undefined); api.offscreenClose.mockResolvedValue(undefined);
    api.contexts.mockResolvedValue([{ documentUrl: 'chrome-extension://test-addon/image-process.html#old-session' }]);
    const broker = new InlineImageBroker(true); const owner = connection('image-inline-owner'); broker.connect(owner.value); owner.receive(job);
    await vi.waitFor(() => expect(api.offscreenCreate).toHaveBeenCalledOnce()); expect(api.offscreenClose).toHaveBeenCalledOnce();
    expect(api.offscreenClose.mock.invocationCallOrder[0]).toBeLessThan(api.offscreenCreate.mock.invocationCallOrder[0]!);
    owner.disconnect(); await vi.waitFor(() => expect(api.offscreenClose).toHaveBeenCalledTimes(2));
    api.offscreenCreate.mockClear(); api.offscreenClose.mockClear(); api.contexts.mockResolvedValue([{ documentUrl: 'chrome-extension://test-addon/other-feature.html' }]);
    const next = connection('image-inline-owner'); broker.connect(next.value); next.receive(job);
    await vi.waitFor(() => expect(next.post).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    expect(api.offscreenCreate).not.toHaveBeenCalled(); expect(api.offscreenClose).not.toHaveBeenCalled(); next.disconnect();
  });
});
