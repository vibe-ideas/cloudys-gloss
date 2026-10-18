import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { capturePlayerCaptions } from '../../src/video/capture';
import { MAX_CAPTION_BYTES } from '../../src/video/protocol';

const url = 'https://www.youtube.com/api/timedtext?v=example&lang=en';
const savedFetch = window.fetch;
let observer: ReturnType<typeof capturePlayerCaptions> | undefined;
beforeEach(() => vi.useFakeTimers());
afterEach(() => { observer?.stop(); observer = undefined; window.fetch = savedFetch; vi.restoreAllMocks(); vi.useRealTimers(); });

describe('复用 YouTube 播放器收到的字幕', () => {
  it('播放器 fetch 的原始 Promise 和正文保持可用，扩展读取副本而不再次下载', async () => {
    const response = new Response('字幕正文'); const promise = Promise.resolve(response);
    const request = vi.fn(() => promise); window.fetch = request;
    const publish = vi.fn(); const begin = vi.fn(() => publish);
    observer = capturePlayerCaptions('example', begin);
    const returned = window.fetch(url);
    expect(returned).toBe(promise); expect(await (await returned).text()).toBe('字幕正文');
    await vi.advanceTimersByTimeAsync(0);
    expect(publish).toHaveBeenCalledExactlyOnceWith('字幕正文'); expect(request).toHaveBeenCalledOnce();
  });
  it('其他视频、音视频和非 GET 请求不读取正文，扩展自身重试也不递归观察', async () => {
    window.fetch = vi.fn(async () => new Response('body'));
    const begin = vi.fn(() => vi.fn()); observer = capturePlayerCaptions('example', begin);
    await window.fetch(url.replace('example', 'other')); await window.fetch('https://www.youtube.com/videoplayback');
    await window.fetch(url, { method: 'POST' }); await observer.fetch(url);
    expect(begin).not.toHaveBeenCalled();
  });
  it('超过 4 MiB 的字幕副本被丢弃，播放器仍可完整读取自己的响应', async () => {
    window.fetch = vi.fn(async () => new Response('x'.repeat(MAX_CAPTION_BYTES + 1)));
    const publish = vi.fn(); observer = capturePlayerCaptions('example', () => publish);
    const response = await window.fetch(url); const body = await response.text();
    await vi.advanceTimersByTimeAsync(0);
    expect(body.length).toBe(MAX_CAPTION_BYTES + 1); expect(publish).toHaveBeenCalledExactlyOnceWith(undefined);
  });
  it('最多读取两个并发副本，超时只取消副本，不中止播放器的原请求', async () => {
    window.fetch = vi.fn(() => new Promise<Response>(() => {}));
    const publish = vi.fn(); const begin = vi.fn(() => publish); observer = capturePlayerCaptions('example', begin);
    void window.fetch(url); void window.fetch(url + '&name=two'); void window.fetch(url + '&name=three');
    expect(begin).toHaveBeenCalledTimes(2); await vi.advanceTimersByTimeAsync(10000);
    expect(publish).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
  });
  it('播放器通过 XHR 收到文本字幕时复用原文，关闭后恢复原方法且不覆盖其他扩展', () => {
    const open = vi.spyOn(XMLHttpRequest.prototype, 'open').mockImplementation(() => {});
    const send = vi.spyOn(XMLHttpRequest.prototype, 'send').mockImplementation(function (this: XMLHttpRequest) {
      Object.defineProperties(this, { status: { value: 200 }, responseText: { value: 'XHR 字幕' } });
      this.dispatchEvent(new Event('loadend'));
    });
    const publish = vi.fn(); observer = capturePlayerCaptions('example', () => publish);
    const xhr = new XMLHttpRequest(); xhr.open('GET', url); xhr.send();
    expect(publish).toHaveBeenCalledExactlyOnceWith('XHR 字幕'); expect(send).toHaveBeenCalledOnce();
    const otherFetch = vi.fn(async () => new Response('other')); window.fetch = otherFetch;
    observer.stop(); expect(window.fetch).toBe(otherFetch); expect(XMLHttpRequest.prototype.open).toBe(open); expect(XMLHttpRequest.prototype.send).toBe(send);
  });
  it('关闭字幕后到达的网络响应不会继续读取或发布', async () => {
    let resolve!: (response: Response) => void;
    window.fetch = vi.fn(() => new Promise<Response>(done => { resolve = done; }));
    const publish = vi.fn(); observer = capturePlayerCaptions('example', () => publish);
    const pending = window.fetch(url); observer.stop();
    resolve(new Response('迟到正文')); expect(await (await pending).text()).toBe('迟到正文');
    await vi.advanceTimersByTimeAsync(0);
    expect(publish).toHaveBeenCalledExactlyOnceWith(undefined);
  });
});
