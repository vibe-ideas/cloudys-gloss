import { describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleProvider, completionUrl } from '../../src/provider';
import { defaults } from '../../src/schema';
const signal = () => new AbortController().signal;
const reply = (value: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }));
describe('OpenAI-compatible 模型请求', () => {
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
