import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cacheKey, ResultCache } from '../../src/cache';
import { TranslationService } from '../../src/service';
import { defaults } from '../../src/schema';
afterEach(() => vi.unstubAllGlobals());
describe('跨页面翻译缓存', () => {
  it.each([1, 2])('并发 %i 时两个页面的重叠段落只推理一次，各自返回原顺序结果', async (concurrency) => {
    const finishes: (() => void)[] = [];
    const sent: string[][] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input, init) => {
      const { texts } = JSON.parse(JSON.parse(init.body).messages[1].content) as { texts: string[] };
      sent.push(texts);
      await new Promise<void>((resolve) => finishes.push(resolve));
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ translations: texts.map((text) => `中文${text}`) }) } }] }));
    }));
    const service = new TranslationService(new ResultCache(crypto.randomUUID()));
    const settings = { ...defaults, concurrency };
    const first = service.translate(settings, ['Shared', 'First'], new AbortController().signal);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const second = service.translate(settings, ['Second', 'Shared'], new AbortController().signal);
    // Let cache lookup and subscription finish before releasing the first batch.
    await new Promise((resolve) => setTimeout(resolve, 20));
    finishes[0]!();
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    finishes[1]!();
    expect(await first).toEqual(['中文Shared', '中文First']);
    expect(await second).toEqual(['中文Second', '中文Shared']);
    expect(sent.flat().filter((text) => text === 'Shared')).toHaveLength(1);
  });
  it('共享段落时一个页面关闭不会取消另一页，全部关闭才中止模型且再次进入可重新请求', async () => {
    let upstream!: AbortSignal;
    const fetcher = vi.fn(async (_input, init) => {
      upstream = init.signal;
      return await new Promise<Response>((_resolve, reject) => upstream.addEventListener('abort', () => reject(upstream.reason), { once: true }));
    });
    vi.stubGlobal('fetch', fetcher);
    const service = new TranslationService(new ResultCache(crypto.randomUUID()));
    const a = new AbortController(); const b = new AbortController();
    const first = service.translate(defaults, ['Shared'], a.signal).catch((error: unknown) => error);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const item = vi.fn();
    const second = service.translate(defaults, ['Shared'], b.signal, item).catch((error: unknown) => error);
    await new Promise((resolve) => setTimeout(resolve, 20));
    a.abort(new Error('页面 A 关闭'));
    expect(await first).toMatchObject({ message: '页面 A 关闭' });
    expect(upstream.aborted).toBe(false);
    b.abort(new Error('页面 B 关闭'));
    expect(await second).toMatchObject({ message: '页面 B 关闭' });
    expect(upstream.aborted).toBe(true);
    fetcher.mockImplementationOnce(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"translations":["重新翻译"]}' } }] })));
    expect(await service.translate(defaults, ['Shared'], new AbortController().signal)).toEqual(['重新翻译']);
    expect(fetcher).toHaveBeenCalledTimes(2); expect(item).not.toHaveBeenCalled();
  });
  it('显式重翻不共享旧请求，旧请求晚返回也不会覆盖新译文缓存', async () => {
    const finishes: ((value: Response) => void)[] = [];
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => finishes.push(resolve)));
    vi.stubGlobal('fetch', fetcher);
    const service = new TranslationService(new ResultCache(crypto.randomUUID()));
    const settings = { ...defaults, concurrency: 2 }; const signal = new AbortController().signal;
    const old = service.translate(settings, ['Shared'], signal);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const retry = service.translate(settings, ['Shared'], signal, undefined, true);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    const response = (text: string) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ translations: [text] }) } }] }));
    finishes[1]!(response('新译文')); expect(await retry).toEqual(['新译文']);
    finishes[0]!(response('旧译文')); expect(await old).toEqual(['旧译文']);
    expect(await service.translate(settings, ['Shared'], signal)).toEqual(['新译文']);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('首次重翻尚未完成时另一页面请求相同段落，共享最新重翻并由其结果填充缓存', async () => {
    let finish!: (value: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
    vi.stubGlobal('fetch', fetcher);
    const service = new TranslationService(new ResultCache(crypto.randomUUID()));
    const settings = { ...defaults, concurrency: 2 }; const signal = new AbortController().signal;
    const retry = service.translate(settings, ['Shared'], signal, undefined, true);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    const ordinary = service.translate(settings, ['Shared'], signal);
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(fetcher).toHaveBeenCalledOnce();
    finish(new Response(JSON.stringify({ choices: [{ message: { content: '{"translations":["最新重翻译文"]}' } }] })));
    expect(await retry).toEqual(['最新重翻译文']); expect(await ordinary).toEqual(['最新重翻译文']);
    expect(await service.translate(settings, ['Shared'], signal)).toEqual(['最新重翻译文']);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('单段重新翻译绕过旧缓存，更新该段结果且其他段落仍命中缓存', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{"translations":["旧译文","保留译文"]}' } }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{"translations":["新译文"]}' } }] })));
    vi.stubGlobal('fetch', fetcher);
    const service = new TranslationService(new ResultCache(crypto.randomUUID()));
    const signal = new AbortController().signal;
    await service.translate(defaults, ['Hello', 'World'], signal);
    expect(await service.translate(defaults, ['Hello'], signal, undefined, true)).toEqual(['新译文']);
    expect(JSON.parse(JSON.parse(fetcher.mock.calls[1]![1].body).messages[1].content).texts).toEqual(['Hello']);
    expect(await service.translate(defaults, ['Hello', 'World'], signal)).toEqual(['新译文', '保留译文']);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('单段重新翻译遇到服务错误时保留已有缓存供后续阅读', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{"translations":["已有译文"]}' } }] })))
      .mockResolvedValueOnce(new Response('Unavailable', { status: 503 }));
    vi.stubGlobal('fetch', fetcher);
    const service = new TranslationService(new ResultCache(crypto.randomUUID()));
    const signal = new AbortController().signal;
    await service.translate(defaults, ['Hello'], signal);
    await expect(service.translate(defaults, ['Hello'], signal, undefined, true)).rejects.toThrow('HTTP 503');
    expect(await service.translate(defaults, ['Hello'], signal)).toEqual(['已有译文']);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('已缓存词卡的词典恢复后补齐音标，不重新请求或唤醒模型', async () => {
    const card = { word: 'light', ipa: { us: '', uk: '' }, senses: [{ partOfSpeech: 'adjective', meaning: '轻的' }], contextMeaning: '轻的', examples: [{ en: 'A light bag.', zh: '一个轻包。' }] };
    const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(card) } }] })));
    vi.stubGlobal('fetch', fetcher);
    const dictionary = { lookup: vi.fn().mockResolvedValueOnce({ us: '', uk: '' }).mockResolvedValue({ us: '/laɪt/', uk: '/laɪt/' }) };
    const ensureModel = vi.fn().mockResolvedValue(undefined);
    const service = new TranslationService(new ResultCache(crypto.randomUUID()), ensureModel, dictionary);
    expect((await service.dictionary(defaults, 'light', '', new AbortController().signal)).ipa.us).toBe('');
    expect((await service.dictionary(defaults, 'light', '', new AbortController().signal)).ipa.us).toBe('/laɪt/');
    expect(fetcher).toHaveBeenCalledTimes(1); expect(ensureModel).toHaveBeenCalledTimes(1);
  });
  it('提示词升级后不再读取旧版错误译文，新结果写入后可正常命中', async () => {
    const cache = new ResultCache(crypto.randomUUID());
    const oldKey = await cacheKey([defaults.baseUrl, defaults.model, defaults.temperature, defaults.apiKey, 'zh-CN', 'translation-v2', 'Hello']);
    await cache.set(oldKey, '旧版错误译文');
    const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"translations":["你好"]}' } }] })));
    vi.stubGlobal('fetch', fetcher);
    const service = new TranslationService(cache);
    expect(await service.translate(defaults, ['Hello'], new AbortController().signal)).toEqual(['你好']);
    expect(await service.translate(defaults, ['Hello'], new AbortController().signal)).toEqual(['你好']);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('连接检测遇到小模型错误 JSON 时使用网页翻译的回退流程，获得中文后才成功', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{"translations":["wrong","length"]}' } }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '今天天气多云，请带把伞。' } }] })));
    vi.stubGlobal('fetch', fetcher);
    const service = new TranslationService(new ResultCache(crypto.randomUUID()));
    expect(await service.test(defaults, new AbortController().signal)).toEqual(['今天天气多云，请带把伞。']);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('译文完全命中缓存时不唤醒模型，只有首次请求需要等待模型就绪', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"translations":["你好"]}' } }] }))));
    const ensureModel = vi.fn().mockResolvedValue(undefined);
    const service = new TranslationService(new ResultCache(crypto.randomUUID()), ensureModel);
    const signal = new AbortController().signal;
    await service.translate(defaults, ['Hello'], signal);
    expect(await service.translate(defaults, ['Hello'], signal)).toEqual(['你好']);
    expect(ensureModel).toHaveBeenCalledTimes(1);
  });
  it('同批部分段落命中缓存时先推送缓存译文，不等待未命中段落的模型请求', async () => {
    const service = new TranslationService(new ResultCache(crypto.randomUUID()));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{"translations":["已缓存"]}' } }] })));
    vi.stubGlobal('fetch', fetcher);
    const signal = new AbortController().signal;
    await service.translate(defaults, ['Cached'], signal);
    let finish!: (response: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const item = vi.fn(); let done = false;
    const result = service.translate(defaults, ['Cached', 'New'], signal, item).then((value) => { done = true; return value; });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(item).toHaveBeenCalledWith(0, '已缓存', true); expect(done).toBe(false);
    finish(new Response(JSON.stringify({ choices: [{ message: { content: '{"translations":["新译文"]}' } }] })));
    expect(await result).toEqual(['已缓存', '新译文']);
  });
  it('同批重复段落只送一次，第二次直接复用缓存，换模型后重新请求', async () => {
    const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
      const body = JSON.parse(options.body as string);
      const { texts } = JSON.parse(body.messages[1].content) as { texts: string[] };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ translations: texts.map((text) => `中文${text}`) }) } }] }));
    });
    vi.stubGlobal('fetch', fetcher);
    const service = new TranslationService(new ResultCache(crypto.randomUUID()));
    const signal = new AbortController().signal;
    expect(await service.translate(defaults, ['Hello', 'Hello'], signal)).toEqual(['中文Hello', '中文Hello']);
    await service.translate(defaults, ['Hello'], signal); expect(fetcher).toHaveBeenCalledTimes(1);
    await service.translate({ ...defaults, model: 'another-model' }, ['Hello'], signal); expect(fetcher).toHaveBeenCalledTimes(2);
  });
});


describe('翻译进度接收异常后的请求清理', () => {
  it('同批先注册新段落、后推送缓存译文时接收方抛错，后续翻译仍可正常完成并缓存', async () => {
    const cache = new ResultCache(crypto.randomUUID());
    const cachedKey = await cacheKey([defaults.baseUrl, defaults.model, defaults.temperature, defaults.apiKey, 'zh-CN', 'translation-v4', 'Cached']);
    await cache.set(cachedKey, '已有译文');
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"translations":["新译文"]}' } }] })));
    vi.stubGlobal('fetch', fetcher);
    const service = new TranslationService(cache); const signal = new AbortController().signal;
    await expect(service.translate(defaults, ['Uncached', 'Cached'], signal, (index) => {
      if (index === 1) throw new Error('接收页面已卸载');
    })).rejects.toThrow('接收页面已卸载');
    expect(await service.translate(defaults, ['Uncached'], signal)).toEqual(['新译文']);
    expect(await service.translate(defaults, ['Uncached', 'Cached'], signal)).toEqual(['新译文', '已有译文']);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('一个页面接收缓存译文时抛错，只取消该页新增段落，另一页等待的共享翻译继续完成', async () => {
    const cache = new ResultCache(crypto.randomUUID());
    const cachedKey = await cacheKey([defaults.baseUrl, defaults.model, defaults.temperature, defaults.apiKey, 'zh-CN', 'translation-v4', 'Cached']);
    await cache.set(cachedKey, '已有译文');
    let finish!: (value: Response) => void; let upstream!: AbortSignal;
    const fetcher = vi.fn((_input, init) => {
      upstream = init.signal;
      return new Promise<Response>((resolve) => { finish = resolve; });
    });
    vi.stubGlobal('fetch', fetcher);
    const service = new TranslationService(cache); const signal = new AbortController().signal;
    const first = service.translate(defaults, ['Shared'], signal);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await expect(service.translate(defaults, ['Shared', 'Uncached', 'Cached'], signal, (index) => {
      if (index === 2) throw new Error('第二个页面已卸载');
    })).rejects.toThrow('第二个页面已卸载');
    expect(upstream.aborted).toBe(false);
    finish(new Response(JSON.stringify({ choices: [{ message: { content: '{"translations":["共享译文"]}' } }] })));
    expect(await first).toEqual(['共享译文']);
    expect(await service.translate(defaults, ['Shared'], signal)).toEqual(['共享译文']);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
