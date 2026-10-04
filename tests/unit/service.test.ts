import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResultCache } from '../../src/cache';
import { TranslationService } from '../../src/service';
import { defaults } from '../../src/schema';
afterEach(() => vi.unstubAllGlobals());
describe('跨页面翻译缓存', () => {
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
