/** Parse only complete strings in the expected array, never render JSON punctuation. */
export class TranslationStream {
  private buffer = '';
  private cursor = -1;
  private count = 0;
  private expectValue = true;
  private stopped = false;
  constructor(private item: (index: number, text: string) => void) {}
  push(delta: string) {
    this.buffer += delta;
    if (this.stopped) return;
    if (this.cursor < 0) {
      const prefix = /^\s*(?:```(?:json)?\s*)?\{\s*"translations"\s*:\s*\[/.exec(this.buffer);
      if (!prefix) return;
      this.cursor = prefix[0].length;
    }
    while (this.cursor < this.buffer.length) {
      while (/\s/.test(this.buffer[this.cursor] ?? '') && this.cursor < this.buffer.length) this.cursor++;
      const char = this.buffer[this.cursor];
      if (!char) return;
      if (char === ']') { this.stopped = true; return; }
      if (!this.expectValue) {
        if (char !== ',') { this.stopped = true; return; }
        this.cursor++; this.expectValue = true; continue;
      }
      if (char !== '"' || this.count >= 16) { this.stopped = true; return; }
      let end = this.cursor + 1;
      for (; end < this.buffer.length; end++) {
        if (this.buffer[end] === '\\') { end++; continue; }
        if (this.buffer[end] === '"') break;
      }
      if (end >= this.buffer.length) return;
      try {
        const text: unknown = JSON.parse(this.buffer.slice(this.cursor, end + 1));
        if (typeof text !== 'string' || !text || text.length > 20000) { this.stopped = true; return; }
        this.item(this.count++, text);
      } catch { this.stopped = true; return; }
      this.cursor = end + 1; this.expectValue = false;
    }
  }
}

/** OpenAI-compatible SSE; handles split UTF-8, CRLF, comments and multiline data. */
export async function readCompletionStream(response: Response, signal: AbortSignal, delta: (text: string) => void) {
  if (!response.body) throw new Error('模型没有返回响应流');
  const reader = response.body.getReader(); const decoder = new TextDecoder();
  let buffer = ''; let content = ''; let finish: string | null = null; let done = false;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  const event = (value: string) => {
    const data = value.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
    if (!data || done) return;
    if (data.trim() === '[DONE]') { done = true; return; }
    const parsed = JSON.parse(data);
    if (parsed.error) throw new Error('模型流返回错误，请检查模型服务');
    const choice = parsed.choices?.[0];
    if (typeof choice?.delta?.content === 'string') { content += choice.delta.content; delta(choice.delta.content); }
    if (typeof choice?.finish_reason === 'string') finish = choice.finish_reason;
    if (content.length > 400000) throw new Error('模型响应过长');
  };
  try {
    while (!done) {
      signal.throwIfAborted();
      const next = await reader.read(); signal.throwIfAborted();
      buffer += next.done ? decoder.decode() : decoder.decode(next.value, { stream: true });
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        event(buffer.slice(0, boundary.index)); buffer = buffer.slice(boundary.index + boundary[0].length);
      }
      if (buffer.length > 400000) throw new Error('模型流事件过长');
      if (next.done) { if (buffer.trim()) event(buffer); break; }
    }
    if (!done && !finish) throw new Error('模型连接中断，译文未完成，请重试');
    return { choices: [{ message: { content }, finish_reason: finish }] };
  } finally {
    signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock();
  }
}
