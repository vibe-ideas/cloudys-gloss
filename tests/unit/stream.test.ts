import { describe, expect, it, vi } from 'vitest';
import { readCompletionStream, TranslationStream } from '../../src/stream';
import { OpenAICompatibleProvider } from '../../src/provider';
import { defaults } from '../../src/schema';
const encoder = new TextEncoder();
const frame = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\r\n\r\n`;
describe('模型流式翻译', () => {
  it('小模型批次 JSON 错误时每段只回退一次纯文本翻译，第一段先返回且不等待第二段', async () => {
    let second!: (value: Response) => void;
    const envelope = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(envelope('{"wrong":true}'))
      .mockResolvedValueOnce(envelope('第一段中文')).mockImplementationOnce(() => new Promise((resolve) => { second = resolve; }));
    const item = vi.fn(); let done = false;
    const result = new OpenAICompatibleProvider(defaults, fetcher).translate(['Hello', 'World'], new AbortController().signal, item).then((value) => { done = true; return value; });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    expect(item).toHaveBeenCalledWith(0, '第一段中文'); expect(done).toBe(false);
    second(envelope('第二段中文'));
    expect(await result).toEqual(['第一段中文', '第二段中文']); expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('中文和 JSON 转义跨网络分片时，完整的一段先返回，第二段仍可等待', async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const response = new Response(new ReadableStream({ start(controller) { stream = controller; } }));
    const item = vi.fn(); const parser = new TranslationStream(item);
    let finished = false;
    const result = readCompletionStream(response, new AbortController().signal, (delta) => parser.push(delta)).then((value) => { finished = true; return value; });
    const first = encoder.encode(': keepalive\r\n\r\n' + frame('{"translations":["你好\\n世界","'));
    for (const byte of first) stream.enqueue(new Uint8Array([byte]));
    await vi.waitFor(() => expect(item).toHaveBeenCalledWith(0, '你好\n世界'));
    expect(item).toHaveBeenCalledTimes(1); expect(finished).toBe(false);
    stream.enqueue(encoder.encode(frame('第二段"]}') + 'data: [DONE]\r\n\r\n')); stream.close();
    expect((await result).choices[0]!.message.content).toBe('{"translations":["你好\\n世界","第二段"]}');
    expect(item).toHaveBeenLastCalledWith(1, '第二段');
  });
  it('响应流被取消时停止读取，不继续返回迟到译文', async () => {
    const cancelled = vi.fn(); const controller = new AbortController();
    const response = new Response(new ReadableStream({ cancel: cancelled }));
    const result = readCompletionStream(response, controller.signal, vi.fn());
    controller.abort(new Error('停止翻译'));
    await expect(result).rejects.toThrow('停止翻译'); expect(cancelled).toHaveBeenCalledTimes(1);
  });
  it('响应流没有结束标记就断开时报告未完成，不把半截结果标记为成功', async () => {
    await expect(readCompletionStream(new Response(frame('{"translations":["你好"]}')), new AbortController().signal, vi.fn())).rejects.toThrow('未完成');
  });
  it('兼容网关忽略 stream 并返回普通 JSON 时仍能完成翻译', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"translations":["你好"]}' } }] })));
    expect(await new OpenAICompatibleProvider(defaults, fetcher).translate(['Hello'], new AbortController().signal, vi.fn())).toEqual(['你好']);
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string).stream).toBe(true);
  });
  it('模型拒绝流式参数时仅回退一次普通请求，保持兼容旧网关', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 422 })).mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{"translations":["你好"]}' } }] })));
    expect(await new OpenAICompatibleProvider(defaults, fetcher).translate(['Hello'], new AbortController().signal, vi.fn())).toEqual(['你好']);
    expect(JSON.parse(fetcher.mock.calls[1]![1]!.body as string).stream).toBe(false);
  });
});
