import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImageOcrSchema, imageTextNeedsTranslation, lineGeometry, localImageModel, validateImageTranslation } from '../../src/image/regions';
import { LocalOcr } from '../../src/image/ocr';
import { imageUrl, readImage, MAX_IMAGE_BYTES } from '../../src/image/io';
import { RequestSchema } from '../../src/core/schema';
import { defaults } from '../../src/core/schema';
import { OpenAICompatibleProvider } from '../../src/model/provider';
import { protectImageTerminology } from '../../src/image/terminology';

afterEach(() => vi.unstubAllGlobals());

describe('离线图片翻译', () => {
  it('译文改变百分比、负号、分子分母或重复数字时不覆盖图表，空白排版差异仍允许', () => {
    expect(validateImageTranslation('58% (23/40), -2.5', '通过率 58 %（23/40），-2.5')).toBe(true);
    for (const result of ['通过率 58%（23/41），-2.5', '通过率 58%（23/40），2.5', '通过率 58%（23/40），-2.5，100']) expect(validateImageTranslation('58% (23/40), -2.5', result)).toBe(false);
    expect(validateImageTranslation('5 of 5', '5 个')).toBe(false);
  });
  it('普通图注复制英文时不算翻译成功，专名和数字仍可保持原文', () => {
    expect(validateImageTranslation('not available on Linux', 'not available on Linux')).toBe(false);
    expect(validateImageTranslation('not available on Linux', 'Linux 上不可用')).toBe(true);
    expect(validateImageTranslation('8 tasks, 40 trials per driver', '8 tasks, 40 trials per 驱动程序')).toBe(false);
    expect(validateImageTranslation('Ubuntu 24.04 with XFCE, 8 tasks', 'Ubuntu 24.04 with XFCE，8 个任务')).toBe(false);
    expect(validateImageTranslation('Scale, AgentEnv', 'Scale, AgentEnv')).toBe(true);
  });
  it('计算机图表的后台、驱动程序及测试框架用可核对标记保护，风景图片仍按原文翻译', () => {
    const source = 'A driver in the background needs a harness.';
    const protectedText = protectImageTerminology(source, 'Linux computer driver benchmark');
    expect(protectedText.restore(protectedText.text)).toBe('A 驱动程序 in the 后台 needs a 测试框架.');
    expect(() => protectedText.restore('标记丢失')).toThrow('术语标记');
    expect(protectImageTerminology(source, 'A landscape in a painting').text).toBe(source);
  });
  it('版本号、百分比和比值作为完整标记恢复，模型不能简化版本号或颠倒分子分母', () => {
    const source = 'Ubuntu 24.04 with 58% (23/40)'; const protectedText = protectImageTerminology(source, 'A product comparison');
    expect(protectedText.text).not.toContain('24.04'); expect(protectedText.text).not.toContain('23/40');
    expect(protectedText.restore(protectedText.text)).toBe(source);
    expect(() => protectedText.restore('Ubuntu 24.4 with 58% (40/23)')).toThrow('标记');
  });
  it('版本化软件的组件标签直接保留组件名，普通动词句里的 with 仍交给模型判断', () => {
    const label = protectImageTerminology('Python 3.12 with NumPy, 4 tasks', 'Linux computer benchmark');
    expect(label.restore(label.text)).toBe('Python 3.12 （配有 NumPy）, 4 tasks');
    expect(protectImageTerminology('The driver works with Windows.', 'Linux computer driver benchmark').text).toContain('with Windows');
  });
  it('图片批次一处复制英文时仅补译该处，保留其他中文并把同图语境作为数据传入', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ translations: ['not available on Linux', '通过率 ZXIMG0QXZ'] }) } }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'Linux 上不可用' } }] })));
    const result = await new OpenAICompatibleProvider(defaults, fetcher).translateImage(['not available on Linux', 'pass rate 58%'], 'Computer driver benchmark', new AbortController().signal);
    expect(result).toEqual(['Linux 上不可用', '通过率 58%']); expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(JSON.parse(String(fetcher.mock.calls[0]![1]!.body)).messages[1].content).context).toBe('Computer driver benchmark');
    expect(JSON.parse(String(fetcher.mock.calls[1]![1]!.body)).messages[1].content).toContain('not available on Linux');
  });
  it('图片一处补译仍失败时仅标记该处未完成，其他有效译文保留且不重复请求', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ translations: ['Read the label.', '清晰输出。'] }) } }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'Read the label.' } }] })));
    const result = await new OpenAICompatibleProvider(defaults, fetcher).translateImage(['Read the label.', 'Clear output.'], 'A book page', new AbortController().signal);
    expect(result).toEqual(['', '清晰输出。']); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('模型地址仅允许回环主机，远端域名、伪装 localhost 和带凭据的地址均不使用', () => {
    for (const value of ['http://127.0.0.1:8080/v1', 'http://localhost:9000/v1', 'http://[::1]:8080/v1']) expect(localImageModel(value)).toBe(true);
    for (const value of ['https://api.example.com/v1', 'https://localhost.example.com/v1', 'http://user:pass@localhost/v1', 'file:///tmp/model', 'invalid']) expect(localImageModel(value)).toBe(false);
  });
  it('技术图里的独立驱动名称、任务编号和纯数字保留原样，说明句仍翻译', () => {
    for (const text of ['cua-driver', 'browser-use', 'agent-desktop', 'IR-01', '58% (23/40)', '已经是中文']) expect(imageTextNeedsTranslation(text)).toBe(false);
    expect(imageTextNeedsTranslation('Full background pass')).toBe(true);
  });
  it('图片包含旋转标签时保留角度与尺寸，越界识别框不会覆盖原图', () => {
    const line = { text: 'Label', score: .95, poly: [[10, 20], [10, 60], [0, 60], [0, 20]] as [number, number][] };
    expect(lineGeometry(line, { width: 100, height: 100 })).toEqual({ x: 10, y: 20, width: 40, height: 10, angle: 90 });
    expect(lineGeometry(line, { width: 5, height: 100 })).toBeUndefined();
    expect(ImageOcrSchema.safeParse({ image: { width: 100, height: 100 }, items: [{ ...line, poly: [[NaN, 1]] }] }).success).toBe(false);
  });
  it('图片链接拒绝脚本、本地文件和带凭据地址，请求只接受有界的图片内容', async () => {
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'http://user:pass@example.com/image.png']) expect(() => imageUrl(url)).toThrow();
    const fetch = vi.fn().mockResolvedValue(new Response('<html>not an image</html>', { headers: { 'content-type': 'text/html' } })); vi.stubGlobal('fetch', fetch);
    await expect(readImage('https://example.com/image', new AbortController().signal)).rejects.toThrow('无法读取');
    fetch.mockResolvedValueOnce(new Response('x', { headers: { 'content-type': 'image/png', 'content-length': String(MAX_IMAGE_BYTES + 1) } }));
    await expect(readImage('https://example.com/image', new AbortController().signal)).rejects.toThrow('20 MB');
    expect(RequestSchema.safeParse({ type: 'image:open', url: 'data:text/html,hello' }).success).toBe(false);
  });
});

describe('取消图片识别', () => {
  function worker() {
    const instance = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: undefined as undefined | ((event: MessageEvent) => void), onerror: undefined as undefined | (() => void) };
    vi.stubGlobal('Worker', vi.fn(function() { return instance; }));
    return instance;
  }
  it('用户在模型初始化时停止处理，立即结束等待并释放线程，不再后台下载或推理', async () => {
    const instance = worker(); const ocr = new LocalOcr('https://extension.test/ocr-resources/');
    const result = ocr.recognize(new Blob(['x'])); const rejected = expect(result).rejects.toThrow('取消'); ocr.destroy();
    await rejected; expect(instance.terminate).toHaveBeenCalledTimes(1); expect(instance.postMessage).toHaveBeenCalledTimes(1);
  });
  it('用户在图片解码期间停止处理，迟到的位图被关闭且不提交识别请求', async () => {
    const instance = worker(); const ocr = new LocalOcr('https://extension.test/ocr-resources/');
    let resolve!: (value: unknown) => void;
    const pending = new Promise(yes => { resolve = yes; }); const decode = vi.fn().mockReturnValue(pending); vi.stubGlobal('createImageBitmap', decode);
    const result = ocr.recognize(new Blob(['x']));
    instance.onmessage!({ data: { kind: 'worker-transport-response', status: 'success', requestId: 1, payload: { summary: {} } } } as MessageEvent);
    await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(1)); ocr.destroy(); const bitmap = { close: vi.fn() }; resolve(bitmap);
    await expect(result).rejects.toThrow('取消'); expect(bitmap.close).toHaveBeenCalledTimes(1); expect(instance.postMessage).toHaveBeenCalledTimes(1);
  });
});
