import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cacheKey, ResultCache } from '../../src/cache';
import { TranslationService } from '../../src/service';
import { defaults } from '../../src/schema';
afterEach(() => vi.unstubAllGlobals());
describe('跨页面翻译缓存', () => {
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
