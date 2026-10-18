import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCaptionTrackLoader, type CaptionTrack, type TrackMessage } from '../../src/video/track-loader';
import { MAX_CAPTION_BYTES } from '../../src/video/protocol';

const url = (language = 'en', extra = '') => `https://www.youtube.com/api/timedtext?v=example&lang=${language}&fmt=json3${extra}`;
const identity = (language = 'en', kind = '', name = '', vssId = '') => JSON.stringify([language, kind, name, vssId]);
const captions = (text = 'A complete sentence.') => JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: text }] }] });
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup(readMetadata: () => CaptionTrack[] | undefined = () => undefined) {
  const requests: { value: string; signal: AbortSignal; response: ReturnType<typeof deferred<Response>>; start: number }[] = [];
  const messages: TrackMessage[] = [];
  const fetcher = vi.fn((value: RequestInfo | URL, init?: RequestInit) => {
    expect(init?.credentials).toBe('same-origin');
    const response = deferred<Response>();
    requests.push({ value: String(value), signal: init!.signal!, response, start: performance.now() });
    return response.promise;
  });
  const metadata = vi.fn(readMetadata);
  const loader = createCaptionTrackLoader({ id: 'example', send: message => messages.push(message), fetch: fetcher, readMetadata: metadata });
  const tracks = () => messages.filter(message => message.type === 'track');
  const observe = (value: string) => loader.observe({ name: value, startTime: performance.now() + 100 });
  return { loader, requests, messages, metadata, tracks, observe };
}
async function settle() { await vi.advanceTimersByTimeAsync(0); }

describe('YouTube 完整字幕轨道恢复', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('字幕首请求失败后，500 毫秒重试成功即可发布完整轨道', async () => {
    const state = setup(); state.loader.start({ name: url(), startTime: -100 });
    state.requests[0]!.response.reject(new Error('network')); await settle();
    await vi.advanceTimersByTimeAsync(499); expect(state.requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1); expect(state.requests).toHaveLength(2);
    state.requests[1]!.response.resolve(new Response(captions())); await settle();
    expect(state.tracks()).toEqual([{ type: 'track', body: captions(), identity: identity() }]);
    await vi.advanceTimersByTimeAsync(20000); expect(state.requests).toHaveLength(2);
    state.loader.stop();
  });

  it('字幕持续失败时最多请求三次，播放器重复通知不会重新开始无限重试', async () => {
    const state = setup(); state.loader.start({ name: url(), startTime: -100 });
    for (let attempt = 0; attempt < 3; attempt++) {
      state.requests[attempt]!.response.reject(new Error('network')); await settle();
      state.observe(url());
      await vi.advanceTimersByTimeAsync(attempt === 0 ? 500 : 1500);
    }
    await vi.advanceTimersByTimeAsync(30000);
    expect(state.requests).toHaveLength(3); expect(state.tracks()).toEqual([]);
    state.loader.stop();
  });

  it('扩展自身请求的资源通知不会递归请求，也不会把已经切换的法语改回英语', async () => {
    const state = setup(); state.loader.start({ name: url(), startTime: -100 });
    const own = state.requests[0]!;
    state.loader.observe({ name: own.value, startTime: own.start });
    expect(state.requests).toHaveLength(1);
    state.observe(url('fr')); expect(state.requests).toHaveLength(2);
    state.loader.observe({ name: own.value, startTime: own.start });
    expect(state.requests[1]!.signal.aborted).toBe(false);
    own.response.resolve(new Response(captions('Old English.')));
    state.requests[1]!.response.resolve(new Response(captions('Bonjour.'))); await settle();
    expect(state.tracks().map(message => message.body)).toEqual([captions('Bonjour.')]);
    state.loader.stop();
  });

  it.each(['先失败再成功', '先成功再失败'])('同语言后发请求失败（%s）时，先发请求的有效字幕仍发布一次', async order => {
    const state = setup(); state.loader.start({ name: url(), startTime: -100 });
    state.observe(url('en', '&signature=refreshed'));
    const success = async () => { state.requests[0]!.response.resolve(new Response(captions())); await settle(); };
    const failure = async () => { state.requests[1]!.response.reject(new Error('network')); await settle(); };
    if (order === '先失败再成功') { await failure(); await success(); } else { await success(); await failure(); }
    expect(state.tracks()).toEqual([{ type: 'track', body: captions(), identity: identity() }]);
    expect(state.messages.at(-1)?.type).toBe('track');
    await vi.advanceTimersByTimeAsync(20000); expect(state.requests).toHaveLength(2);
    state.loader.stop();
  });

  it('用户切换字幕语言时取消旧请求，即使旧请求随后成功也只发布新语言', async () => {
    const state = setup(); state.loader.start({ name: url(), startTime: -100 });
    state.observe(url('fr')); expect(state.requests[0]!.signal.aborted).toBe(true);
    state.requests[0]!.response.resolve(new Response(captions('Old English.'))); await settle();
    expect(state.tracks()).toEqual([]);
    state.requests[1]!.response.resolve(new Response(captions('Bonjour.'))); await settle();
    expect(state.tracks().map(message => message.body)).toEqual([captions('Bonjour.')]);
    state.observe(url()); expect(state.requests).toHaveLength(3);
    state.requests[2]!.response.resolve(new Response(captions('English again.'))); await settle();
    expect(state.tracks().at(-1)?.body).toBe(captions('English again.'));
    state.loader.stop();
  });

  it('用户从人工英语切到自动英语时立即通知新选择，并丢弃迟到的人工字幕', async () => {
    const state = setup(); state.loader.start({ name: url(), startTime: -100 });
    state.observe(url('en', '&kind=asr'));
    expect(state.messages.filter(message => message.type === 'selection')).toEqual([
      { type: 'selection', identity: identity() }, { type: 'selection', identity: identity('en', 'asr') },
    ]);
    expect(state.requests[0]!.signal.aborted).toBe(true);
    state.requests[0]!.response.resolve(new Response(captions('Manual subtitles.')));
    state.requests[1]!.response.reject(new Error('ASR temporarily unavailable')); await settle();
    expect(state.tracks()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(500);
    state.requests[2]!.response.resolve(new Response(captions('Automatic subtitles.'))); await settle();
    expect(state.tracks()).toEqual([{ type: 'track', body: captions('Automatic subtitles.'), identity: identity('en', 'asr') }]);
    state.loader.stop();
  });

  it.each([
    ['name', 'Commentary', identity('en', '', 'Commentary')],
    ['vssId', '.en-commentary', identity('en', '', '', '.en-commentary')],
  ])('同语言轨道的 %s 变化时通知新选择，不把两条轨道当成同一份字幕', async (field, value, nextIdentity) => {
    const state = setup(); state.loader.start({ name: url(), startTime: -100 });
    state.requests[0]!.response.resolve(new Response(captions())); await settle();
    state.observe(url('en', `&${field}=${encodeURIComponent(value)}`));
    expect(state.messages.filter(message => message.type === 'selection').at(-1)).toEqual({ type: 'selection', identity: nextIdentity });
    expect(state.requests).toHaveLength(2); state.loader.stop();
  });

  it('同一轨道刷新签名或切换输出格式时不发送选择变化，也不取消仍可成功的请求', async () => {
    const state = setup(); state.loader.start({ name: url(), startTime: -100 });
    state.observe(url('en', '&signature=fresh&pot=player-token').replace('fmt=json3', 'fmt=srv3'));
    expect(state.messages.filter(message => message.type === 'selection')).toEqual([{ type: 'selection', identity: identity() }]);
    expect(state.requests[0]!.signal.aborted).toBe(false);
    state.requests[0]!.response.resolve(new Response(captions())); await settle();
    expect(state.tracks().at(-1)?.identity).toBe(identity()); state.loader.stop();
  });

  it('首次通过播放器元数据确认轨道时先发送稳定身份，恢复会话可据此识别旧轨道变化', async () => {
    const state = setup(() => [{ baseUrl: url('en', '&kind=asr'), languageCode: 'en', kind: 'asr' }]);
    state.loader.start();
    expect(state.messages[0]).toEqual({ type: 'selection', identity: identity('en', 'asr') });
    state.requests[0]!.response.resolve(new Response(captions())); await settle();
    expect(state.tracks().at(-1)?.identity).toBe(identity('en', 'asr')); state.loader.stop();
  });

  it('人工英语请求失败时，元数据中的自动英语不能替代用户已选的人工轨道', async () => {
    const state = setup(() => [{ baseUrl: url('en', '&kind=asr'), languageCode: 'en', kind: 'asr' }]);
    state.loader.start({ name: url(), startTime: -100 });
    state.requests[0]!.response.reject(new Error('manual captions unavailable')); await settle();
    expect(state.requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(state.requests.map(request => request.value)).toEqual([url(), url()]);
    expect(state.messages.filter(message => message.type === 'selection')).toEqual([{ type: 'selection', identity: identity() }]);
    state.loader.stop();
  });

  it('最近字幕地址失效后回退到播放器元数据，新的签名地址成功发布字幕', async () => {
    const replacement = url('en', '&signature=fresh');
    const state = setup(() => [{ baseUrl: replacement, languageCode: 'en' }]);
    state.loader.start({ name: url(), startTime: -100 });
    state.requests[0]!.response.reject(new Error('expired')); await settle();
    expect(state.metadata).toHaveBeenCalledTimes(1); expect(state.requests[1]!.value).toBe(replacement);
    state.requests[1]!.response.resolve(new Response(captions())); await settle();
    await vi.advanceTimersByTimeAsync(2000);
    expect(state.requests).toHaveLength(2); expect(state.tracks()).toHaveLength(1);
    state.loader.stop();
  });

  it('播放器元数据延迟就绪时有限重查，并在第三次发现轨道后加载字幕', async () => {
    let ready = false;
    const state = setup(() => ready ? [{ baseUrl: url(), languageCode: 'en' }] : undefined);
    state.loader.start(); await vi.advanceTimersByTimeAsync(500);
    expect(state.metadata).toHaveBeenCalledTimes(2); expect(state.requests).toHaveLength(0);
    ready = true; await vi.advanceTimersByTimeAsync(1500);
    expect(state.metadata).toHaveBeenCalledTimes(3);
    state.requests[0]!.response.resolve(new Response(captions())); await settle();
    expect(state.tracks()).toHaveLength(1); state.loader.stop();
  });

  it('播放器元数据始终未就绪时只查询三次，不启动无限轮询', async () => {
    const state = setup(); state.loader.start(); await vi.advanceTimersByTimeAsync(60000);
    expect(state.metadata).toHaveBeenCalledTimes(3); expect(state.requests).toHaveLength(0); state.loader.stop();
  });

  it('用户选择法语后请求失败，元数据中的英语轨道不会覆盖用户选择', async () => {
    const state = setup(() => [{ baseUrl: url(), languageCode: 'en' }, { baseUrl: url('fr', '&signature=fresh'), languageCode: 'fr' }]);
    state.loader.start({ name: url('fr'), startTime: -100 });
    state.requests[0]!.response.reject(new Error('expired')); await settle();
    expect(state.requests[1]!.value).toBe(url('fr', '&signature=fresh'));
    state.requests[1]!.response.resolve(new Response(captions('Bonjour.'))); await settle();
    expect(state.tracks().at(-1)?.body).toBe(captions('Bonjour.')); state.loader.stop();
  });

  it.each(['<html>Access denied</html>', '{"events":[]}', 'not captions'])('非空响应 %s 不能标记为完整字幕，重试获得有效 XML 后才成功', async invalid => {
    const state = setup(); state.loader.start({ name: url(), startTime: -100 });
    state.requests[0]!.response.resolve(new Response(invalid)); await settle();
    expect(state.tracks()).toHaveLength(0); await vi.advanceTimersByTimeAsync(500);
    const xml = '<transcript><text start="0" dur="2">Valid subtitles.</text></transcript>';
    state.requests[1]!.response.resolve(new Response(xml)); await settle();
    expect(state.tracks()).toEqual([{ type: 'track', body: xml, identity: identity() }]); state.loader.stop();
  });

  it('停止字幕会话后取消进行中的请求和元数据重查，迟到响应不再发布', async () => {
    const state = setup(); state.loader.start({ name: url(), startTime: -100 });
    state.requests[0]!.response.reject(new Error('network')); await settle();
    await vi.advanceTimersByTimeAsync(500); expect(state.requests).toHaveLength(2);
    state.loader.stop(); expect(state.requests[1]!.signal.aborted).toBe(true);
    const messageCount = state.messages.length; const reads = state.metadata.mock.calls.length;
    state.requests[1]!.response.resolve(new Response(captions()));
    state.observe(url('fr')); await vi.advanceTimersByTimeAsync(60000);
    expect(state.requests).toHaveLength(2); expect(state.messages).toHaveLength(messageCount);
    expect(state.metadata).toHaveBeenCalledTimes(reads);
  });

  it('字幕请求超过十秒未响应时取消请求，并在退避后重新请求', async () => {
    const state = setup(); state.loader.start({ name: url(), startTime: -100 });
    const pending = state.requests[0]!;
    pending.signal.addEventListener('abort', () => pending.response.reject(new DOMException('Aborted', 'AbortError')));
    await vi.advanceTimersByTimeAsync(9999); expect(pending.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1); expect(pending.signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(500); expect(state.requests).toHaveLength(2);
    state.requests[1]!.response.resolve(new Response(captions())); await settle();
    expect(state.tracks()).toHaveLength(1); state.loader.stop();
  });

  it('停止会话时中断尚未结束的正文流，不等待网络继续返回数据', async () => {
    const state = setup(); state.loader.start({ name: url(), startTime: -100 });
    const cancel = vi.fn();
    state.requests[0]!.response.resolve(new Response(new ReadableStream<Uint8Array>({ cancel })));
    await settle(); state.loader.stop(); await settle();
    expect(cancel).toHaveBeenCalledTimes(1); expect(state.tracks()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(30000); expect(state.requests).toHaveLength(1);
  });

  it('播放器产生大量候选地址时最多同时下载两条，并限制为八个候选', async () => {
    const state = setup(); state.loader.start({ name: url(), startTime: -100 });
    for (let i = 1; i < 20; i++) state.observe(url('en', `&signature=${i}`));
    expect(state.requests).toHaveLength(2);
    for (let i = 0; i < 24; i++) {
      if (!state.requests[i]) await vi.advanceTimersByTimeAsync(2000);
      state.requests[i]!.response.reject(new Error('network')); await settle();
    }
    await vi.advanceTimersByTimeAsync(30000);
    expect(state.requests).toHaveLength(24);
    expect(new Set(state.requests.map(request => request.value)).size).toBe(8);
    state.loader.stop();
  });

  it.each(['响应头', '流式正文'])('字幕%s超过 4 MiB 时拒绝发布并取消正文读取', async kind => {
    const state = setup(); state.loader.start({ name: url(), startTime: -100 });
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(MAX_CAPTION_BYTES + 1)); }, cancel });
    state.requests[0]!.response.resolve(new Response(body, { headers: kind === '响应头' ? { 'content-length': String(MAX_CAPTION_BYTES + 1) } : {} }));
    await settle(); expect(state.tracks()).toHaveLength(0); expect(cancel).toHaveBeenCalledTimes(1); state.loader.stop();
  });

  it('其他视频、外部站点和自动翻译地址不会触发字幕下载', () => {
    const state = setup();
    for (const invalid of [url().replace('example', 'other'), url().replace('www.youtube.com', 'evil.example'), `${url()}&tlang=zh`]) state.observe(invalid);
    expect(state.requests).toHaveLength(0); state.loader.stop();
  });
});
