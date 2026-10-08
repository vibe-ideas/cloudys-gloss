import { describe, expect, it, vi } from 'vitest';
import { dictionaryExample } from '../../src/model/dictionary-context';
import { OpenAICompatibleProvider } from '../../src/model/provider';
import { defaults } from '../../src/core/schema';

describe('词卡从上下文选择真实例句', () => {
  it('上下文只有一个含所选词的短句时保留完整原句及标点', () => {
    const context = 'The room is quiet. Please light the candle before the guests arrive. Then close the door.';
    expect(dictionaryExample('light', context)).toBe('Please light the candle before the guests arrive.');
  });

  it('只匹配完整单词，不把 fine 错配到 fined 或 fine-tuned', () => {
    expect(dictionaryExample('fine', 'He was fined for parking.')).toBeUndefined();
    expect(dictionaryExample('fine', 'This is a fine-tuned model.')).toBeUndefined();
    expect(dictionaryExample('fine', 'I feel FINE now.')).toBe('I feel FINE now.');
  });

  it('短语必须连续精确出现，不把 take off 配到 take it off', () => {
    expect(dictionaryExample('take off', 'The plane will take off in ten minutes.')).toBe('The plane will take off in ten minutes.');
    expect(dictionaryExample('take off', 'Please take it off now.')).toBeUndefined();
    expect(dictionaryExample('give up', 'Please do not give up.')).toBe('Please do not give up.');
  });

  it('多个句子都包含所选词时不猜测划词对应的句子', () => {
    expect(dictionaryExample('bank', 'The bank opens at nine. We sat on the bank of the river.')).toBeUndefined();
  });

  it('超过 25 词的原句和没有句末标点的片段不被截断成例句', () => {
    expect(dictionaryExample('light', `This light ${'word '.repeat(24)}ends.`)).toBeUndefined();
    expect(dictionaryExample('light', 'This light bag')).toBeUndefined();
    expect(dictionaryExample('light', `Light ${'word '.repeat(23)}ends.`)).toBeDefined();
  });

  it('所选文本中的正则符号按字面匹配，不改变搜索条件', () => {
    expect(dictionaryExample('c++', 'I use C++ every day.')).toBe('I use C++ every day.');
    expect(dictionaryExample('a.b', 'The token aXb is wrong.')).toBeUndefined();
  });
});

const signal = () => new AbortController().signal;
const reply = (value: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }));
const base = { word: 'fine', senses: [{ partOfSpeech: 'noun', meaning: '罚款' }], contextMeaning: '罚款' };
const example = 'He paid a fine for parking in front of the fire exit.';
const pronunciation = { lookup: vi.fn(async () => ({ us: '/faɪn/', uk: '/faɪn/' })) };

describe('词卡将原句和专门生成的中译组成例句', () => {
  it('实测 light 词卡把英文原句复制到 zh 时要求修复，成功后才展示中文例句', async () => {
    const source = 'This backpack is surprisingly light, even with a laptop and two books inside.';
    const content = { word: 'light', senses: [{ partOfSpeech: '形容词', meaning: '轻的' }], contextMeaning: '轻的' };
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(reply({ ...content, examples: [{ zh: source }] }))
      .mockResolvedValueOnce(reply({ ...content, examples: [{ zh: '这个背包出奇地轻，尽管里面装着一台笔记本电脑和两本书。' }] }));
    const card = await new OpenAICompatibleProvider(defaults, fetcher, pronunciation).lookup('light', source, signal());
    expect(card.examples[0]!.en).toBe(source);
    expect(card.examples[0]!.zh).toContain('出奇地轻');
    expect(fetcher).toHaveBeenCalledTimes(2);
    const repair = JSON.parse(fetcher.mock.calls[1]![1]!.body as string).messages.at(-1).content;
    expect(repair).toContain('examples.0.zh'); expect(repair).toContain('必须包含中文');
  });

  it('实测 charge 的固定原句和生成例句均两次复制英文作中译时失败，总请求不超过四次', async () => {
    const source = 'The hotel will charge you twenty dollars for parking.';
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => reply({ word: 'charge',
      senses: [{ partOfSpeech: '动词', meaning: '收取' }], contextMeaning: '收取费用', examples: [{ zh: source }] }));
    await expect(new OpenAICompatibleProvider(defaults, fetcher, pronunciation).lookup('charge', source, signal())).rejects.toThrow('结构');
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('无可用短句时生成的每条例句都必须有中文，不能用首条有效掩盖另一条英文', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => reply({ ...base,
      examples: [{ en: 'He paid a fine.', zh: '他支付了罚款。' }, { en: 'She paid a fine.', zh: 'She paid a fine.' }] }));
    await expect(new OpenAICompatibleProvider(defaults, fetcher, pronunciation).lookup('fine', '', signal())).rejects.toThrow('结构');
    expect(fetcher).toHaveBeenCalledTimes(2);
    const repair = JSON.parse(fetcher.mock.calls[1]![1]!.body as string).messages.at(-1).content;
    expect(repair).toContain('examples.1.zh');
  });

  it('固定英文原句显式传给模型，返回中译后保留 fine 的名词用法', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply({ ...base, examples: [{ zh: '他因在消防出口前停车而支付了罚款。' }] }));
    const card = await new OpenAICompatibleProvider(defaults, fetcher, pronunciation).lookup('fine', example, signal());
    const messages = JSON.parse(fetcher.mock.calls[0]![1]!.body as string).messages;
    expect(JSON.parse(messages[1].content).example).toBe(example);
    expect(messages[0].content).toContain('不要输出 en 字段');
    expect(card.examples).toEqual([{ en: example, zh: '他因在消防出口前停车而支付了罚款。' }]);
    expect(card.ipa).toEqual({ us: '/faɪn/', uk: '/faɪn/' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('模型另造不同英文例句时拒绝拼接其中文，修复后才展示原句对应翻译', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(reply({ ...base, examples: [{ en: 'He was fined for speeding.', zh: '他因超速而被罚款。' }] }))
      .mockResolvedValueOnce(reply({ ...base, examples: [{ zh: '他因在消防出口前停车而支付了罚款。' }] }));
    const card = await new OpenAICompatibleProvider(defaults, fetcher, pronunciation).lookup('fine', example, signal());
    expect(card.examples[0]!.en).toBe(example);
    expect(card.examples[0]!.zh).not.toContain('超速');
    expect(fetcher).toHaveBeenCalledTimes(2);
    const repair = JSON.parse(fetcher.mock.calls[1]![1]!.body as string).messages.at(-1).content;
    expect(repair).toContain('examples.0.en');
  });

  it('模型漏掉原句中译时不把空例句补齐为有效词卡', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => reply({ ...base, examples: [{}] }));
    await expect(new OpenAICompatibleProvider(defaults, fetcher, pronunciation).lookup('fine', example, signal())).rejects.toThrow('结构');
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('固定原句两次校验失败后仅回退一次生成路径，英文和中文按模型返回的配对一起保留', async () => {
    const generated = { ...base, examples: [{ en: 'He paid a fine.', zh: '他支付了罚款。' }] };
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(reply({ ...base, examples: [{ zh: example }] }))
      .mockResolvedValueOnce(reply({ ...base, examples: [{ zh: example }] }))
      .mockResolvedValueOnce(reply(generated));
    const card = await new OpenAICompatibleProvider(defaults, fetcher, pronunciation).lookup('fine', example, signal());
    expect(card.examples).toEqual(generated.examples);
    expect(fetcher).toHaveBeenCalledTimes(3);
    const firstInput = JSON.parse(JSON.parse(fetcher.mock.calls[0]![1]!.body as string).messages[1].content);
    const fallbackMessages = JSON.parse(fetcher.mock.calls[2]![1]!.body as string).messages;
    expect(firstInput.example).toBe(example);
    expect(JSON.parse(fallbackMessages[1].content)).toEqual({ word: 'fine', context: example });
    expect(fallbackMessages).toHaveLength(2);
    expect(fallbackMessages[0].content).toContain('只给一个相关义项');
  });

  it('生成路径首次输出错误时还有一次修复机会，第四次有效响应后结束', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(reply({ ...base, examples: [{ zh: example }] }))
      .mockResolvedValueOnce(reply({ ...base, examples: [{ zh: example }] }))
      .mockResolvedValueOnce(reply({ ...base, examples: [{ en: example, zh: example }] }))
      .mockResolvedValueOnce(reply({ ...base, examples: [{ en: example, zh: '他因在消防出口前停车而支付了罚款。' }] }));
    const card = await new OpenAICompatibleProvider(defaults, fetcher, pronunciation).lookup('fine', example, signal());
    expect(card.examples[0]!.zh).toContain('支付了罚款');
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it.each([
    ['HTTP 鉴权错误', () => Promise.resolve(new Response('unauthorized', { status: 401 }))],
    ['网络断开', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['无效 API 响应包', () => Promise.resolve(new Response(JSON.stringify({ choices: [] })))],
    ['达到输出长度上限', () => Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: '{}' }, finish_reason: 'length' }] })))],
  ] as const)('固定原句请求发生%s时立即失败，不改走生成路径重试', async (_name, response) => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(response);
    await expect(new OpenAICompatibleProvider(defaults, fetcher, pronunciation).lookup('fine', example, signal())).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('固定原句请求超时后结束，不启动新一轮生成请求', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn<typeof fetch>().mockImplementation((_input, init) => new Promise((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
      }));
      const pending = new OpenAICompatibleProvider({ ...defaults, timeout: 1000 }, fetcher, pronunciation).lookup('fine', example, signal());
      const rejection = expect(pending).rejects.toThrow('超时');
      await vi.advanceTimersByTimeAsync(1000); await rejection;
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });

  it('用户取消固定原句请求后直接终止，不启动生成例句回退', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
    }));
    const controller = new AbortController();
    const pending = new OpenAICompatibleProvider(defaults, fetcher, pronunciation).lookup('fine', example, controller.signal);
    const rejection = expect(pending).rejects.toThrow('selection changed');
    controller.abort(new Error('selection changed')); await rejection;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('没有可用上下文短句时仍允许模型生成配对英文例句和中文翻译', async () => {
    const generated = { ...base, examples: [{ en: 'He paid a fine.', zh: '他支付了罚款。' }] };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply(generated));
    const card = await new OpenAICompatibleProvider(defaults, fetcher, pronunciation).lookup('fine', '', signal());
    expect(card.examples).toEqual(generated.examples);
    const input = JSON.parse(JSON.parse(fetcher.mock.calls[0]![1]!.body as string).messages[1].content);
    expect(input).not.toHaveProperty('example');
  });

  it('未配置离线词典时固定原句分支仍校验并保留模型音标', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply({ ...base, ipa: { us: '/faɪn/', uk: '/faɪn/' }, examples: [{ zh: '他因在消防出口前停车而支付了罚款。' }] }));
    const card = await new OpenAICompatibleProvider(defaults, fetcher).lookup('fine', example, signal());
    expect(card.examples[0]!.en).toBe(example);
    expect(card.ipa).toEqual({ us: '/faɪn/', uk: '/faɪn/' });
  });
});
