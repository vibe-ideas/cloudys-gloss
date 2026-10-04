import { describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleProvider, completionUrl } from '../../src/provider';
import { defaults } from '../../src/schema';
const signal = () => new AbortController().signal;
const reply = (value: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }));
describe('OpenAI-compatible 模型请求', () => {
  it('模型流式照抄不足八词的英文短句时不推送原文，并以纯文本重试返回中文', async () => {
    const source = 'The service is ready now.';
    const body = `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify({ translations: [source] }) }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`;
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '服务现在已就绪。' }, finish_reason: 'stop' }] })));
    const item = vi.fn();
    expect(await new OpenAICompatibleProvider(defaults, fetcher).translate([source], signal(), item)).toEqual(['服务现在已就绪。']);
    expect(item).not.toHaveBeenCalledWith(0, source);
    expect(item).toHaveBeenCalledWith(0, '服务现在已就绪。');
    expect(fetcher).toHaveBeenCalledTimes(2);
    const retry = JSON.parse(fetcher.mock.calls[1]![1]!.body as string);
    expect(retry.stream).toBe(false);
    expect(retry.messages[1].content).toBe(source);
  });
  it.each(['The University of New York.', 'The Lord of the Rings.', "console.log('Status ready.');", '{"text":"The system is ready."}'])('短内容为专名或代码示例时允许保持原样：%s', async (source) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply({ translations: [source] }));
    expect(await new OpenAICompatibleProvider(defaults, fetcher).translate([source], signal())).toEqual([source]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('配置离线词典时覆盖模型编造的音标，缺失口音保持空白', async () => {
    const card = { word: 'cloudy', ipa: { us: 'wrong', uk: 'wrong' }, senses: [{ partOfSpeech: 'adjective', meaning: '多云的' }], contextMeaning: '多云的', examples: [{ en: 'A cloudy sky.', zh: '多云的天空。' }] };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply(card));
    const dictionary = { lookup: vi.fn().mockResolvedValue({ us: '/ˈklaʊdi/', uk: '' }) };
    const result = await new OpenAICompatibleProvider(defaults, fetcher, dictionary).lookup('cloudy', '', signal());
    expect(result.ipa).toEqual({ us: '/ˈklaʊdi/', uk: '' });
    expect(dictionary.lookup).toHaveBeenCalledWith('cloudy', expect.any(AbortSignal));
  });

  it('词卡音标类型错误时指出 ipa 字段并只修复一次，不混入全文翻译指令', async () => {
    const card = { word: 'light', ipa: { us: 'laɪt', uk: 'laɪt' }, senses: [{ partOfSpeech: 'adjective', meaning: '轻的' }], contextMeaning: '背包重量轻', examples: [{ en: 'This bag is light.', zh: '这个包很轻。' }] };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(reply({ ...card, ipa: '' })).mockResolvedValueOnce(reply(card));
    expect(await new OpenAICompatibleProvider(defaults, fetcher).lookup('light', 'This bag is light.', signal())).toEqual(card);
    const repair = JSON.parse(fetcher.mock.calls[1]![1]!.body as string).messages.at(-1).content;
    expect(repair).toContain('ipa'); expect(repair).not.toContain('translations');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('模型把输入包装字段塞进译文时先拒绝，再回退成正文且不推送错误包装', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(reply({ translations: ['{"texts":"你好"}'] }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '你好' } }] })));
    const item = vi.fn();
    expect(await new OpenAICompatibleProvider(defaults, fetcher).translate(['Hello'], signal(), item)).toEqual(['你好']);
    expect(item).not.toHaveBeenCalledWith(0, '{"texts":"你好"}');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('原文本身是 JSON 示例时保留其结构，不把合法译文误判为额外包装', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply({ translations: ['{"text":"你好"}'] }));
    expect(await new OpenAICompatibleProvider(defaults, fetcher).translate(['{"text":"Hello"}'], signal())).toEqual(['{"text":"你好"}']);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('JSON 示例首次返回格式错误时，纯文本回退仍保留示例自身的 JSON 结构', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(reply({ translations: [] }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{"text":"你好"}' } }] })));
    expect(await new OpenAICompatibleProvider(defaults, fetcher).translate(['{"text":"Hello"}'], signal(), () => {})).toEqual(['{"text":"你好"}']);
  });
  it('离线模式下仅模型音标字段格式错误时直接采用词典，不浪费一次模型重试', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply({ word: 'light', ipa: 'invalid', senses: [{ partOfSpeech: 'adjective', meaning: '轻的' }], contextMeaning: '轻的', examples: [{ en: 'A light bag.', zh: '一个轻包。' }] }));
    const dictionary = { lookup: vi.fn().mockResolvedValue({ us: '/laɪt/', uk: '/laɪt/' }) };
    const result = await new OpenAICompatibleProvider(defaults, fetcher, dictionary).lookup('light', '', signal());
    expect(result.ipa).toEqual({ us: '/laɪt/', uk: '/laɪt/' }); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('模型返回合法 JSON 但只复制英文长句时要求重译，避免将原文误缓存为中文', async () => {
    const source = 'This domain is for use in documentation examples without needing permission.';
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(reply({ translations: [source] })).mockResolvedValueOnce(reply({ translations: ['该域名用于文档示例，无需许可。'] }));
    expect(await new OpenAICompatibleProvider(defaults, fetcher).translate([source], signal())).toEqual(['该域名用于文档示例，无需许可。']);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('小模型首次返回错误 JSON 时只补问一次，校验成功后返回正确译文', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(reply({ translations: [{ translation: '你好' }] })).mockResolvedValueOnce(reply({ translations: ['你好'] }));
    expect(await new OpenAICompatibleProvider(defaults, fetcher).translate(['Hello'], signal())).toEqual(['你好']);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetcher.mock.calls[1]![1]!.body as string).messages).toHaveLength(4);
  });
  it('Ollama、MLX 与完整端点地址生成正确的 completions URL', () => {
    expect(completionUrl('http://localhost:11434/v1/')).toBe('http://localhost:11434/v1/chat/completions');
    expect(completionUrl('http://localhost:8080/v1/chat/completions')).toBe('http://localhost:8080/v1/chat/completions');
  });
  it('多个语义块通过一次请求返回顺序对应的中文译文', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply({ translations: ['你好', '世界'] }));
    expect(await new OpenAICompatibleProvider(defaults, fetcher).translate(['Hello', 'World'], signal())).toEqual(['你好', '世界']);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string).max_tokens).toBeGreaterThan(512);
  });
  it('MLX 达到输出上限时明确报告截断，不把不完整 JSON 当成译文', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"translations":[' }, finish_reason: 'length' }] })));
    await expect(new OpenAICompatibleProvider(defaults, fetcher).translate(['Hello'], signal())).rejects.toThrow('截断');
  });
  it('模型连续两次漏译一段时拒绝错误映射到原文', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => reply({ translations: ['你好'] }));
    await expect(new OpenAICompatibleProvider(defaults, fetcher).translate(['Hello', 'World'], signal())).rejects.toThrow('数量');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('词卡缺少音标、词性与例句时返回结构错误', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => reply({ word: 'hello' }));
    await expect(new OpenAICompatibleProvider(defaults, fetcher).lookup('hello', '', signal())).rejects.toThrow('结构');
  });
  it('用户取消请求时终止正在进行的网络请求', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason));
    }));
    const controller = new AbortController();
    const pending = new OpenAICompatibleProvider(defaults, fetcher).translate(['Hello'], controller.signal);
    controller.abort(new Error('cancelled'));
    await expect(pending).rejects.toThrow('cancelled');
  });
  it('网关返回鉴权错误时报告 HTTP 状态且不泄露响应内容', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('secret', { status: 401 }));
    await expect(new OpenAICompatibleProvider(defaults, fetcher).translate(['Hello'], signal())).rejects.toThrow('HTTP 401');
  });
  it('模型迟迟不响应时按 Timeout 中断网络并显示超时原因', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason));
      }));
      const pending = new OpenAICompatibleProvider({ ...defaults, timeout: 1000 }, fetcher).translate(['Hello'], signal());
      const assertion = expect(pending).rejects.toThrow('超时');
      await vi.advanceTimersByTimeAsync(1000); await assertion;
      expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    } finally { vi.useRealTimers(); }
  });
});
