import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installCaptionWarmup, type EarlyCaptionStore } from '../../src/video/warmup';

const url = 'https://www.youtube.com/api/timedtext?v=example&lang=en';
const savedFetch = window.fetch;
let store: EarlyCaptionStore | undefined;
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('location', { href: 'https://www.youtube.com/watch?v=example' }); });
afterEach(() => { store?.dispose(); store = undefined; window.fetch = savedFetch; vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('播放器提前下载的字幕在点击双语后复用', () => {
  it('页面启动缓存仅被动读取原生请求，点击后可取出一次且不会自行发起下载', async () => {
    const fetcher = vi.fn(async () => new Response('提前下载的字幕')); window.fetch = fetcher;
    store = installCaptionWarmup(); expect(fetcher).not.toHaveBeenCalled();
    await window.fetch(url + '&signature=private&pot=private'); await vi.advanceTimersByTimeAsync(0);
    document.dispatchEvent(new Event('yt-navigate-finish'));
    await vi.advanceTimersByTimeAsync(30000);
    expect(window.fetch).toBe(fetcher);
    expect(store.take('example')).toEqual({ url, body: '提前下载的字幕' });
    expect(store.take('example')).toBeUndefined(); expect(fetcher).toHaveBeenCalledOnce();
  });
  it('页面在点击前换了字幕轨道，只保留最新选择且迟到旧响应不能覆盖', async () => {
    const resolves: ((response: Response) => void)[] = [];
    window.fetch = vi.fn(() => new Promise<Response>(resolve => resolves.push(resolve)));
    store = installCaptionWarmup(); void window.fetch(url); void window.fetch(url + '&name=new');
    resolves[1]!(new Response('新轨道')); await vi.advanceTimersByTimeAsync(0);
    resolves[0]!(new Response('旧轨道')); await vi.advanceTimersByTimeAsync(0);
    expect(store.take('example')?.body).toBe('新轨道');
  });
  it('SPA 离开视频时清空字幕，不会把上一部影片的正文交给新视频', async () => {
    window.fetch = vi.fn(async () => new Response('旧影片')); store = installCaptionWarmup();
    await window.fetch(url); await vi.advanceTimersByTimeAsync(0);
    document.dispatchEvent(new Event('yt-navigate-start'));
    vi.stubGlobal('location', { href: 'https://www.youtube.com/watch?v=other' });
    document.dispatchEvent(new Event('yt-navigate-finish'));
    expect(store.take('other')).toBeUndefined();
  });
});
