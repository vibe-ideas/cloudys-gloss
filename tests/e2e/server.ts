import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
export async function startServer() {
  const calls: { texts?: string[]; word?: string; context?: string }[] = [];
  let delay = 0; let invalid = false;
  let streamGate: Promise<void> | undefined; let releaseStream: (() => void) | undefined;
  let finishedStreams = 0; let abortedStreams = 0;
  const token = crypto.randomUUID();
  const commands: { id: string; operation: string; args: unknown[] }[] = [];
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const server = createServer(async (request, response) => {
    if (request.url === `/bridge/${token}`) {
      response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(commands.shift() ?? null)); return;
    }
    if (request.url === `/reply/${token}`) {
      let raw = ''; for await (const chunk of request) raw += chunk;
      const result = JSON.parse(raw); const job = pending.get(result.id);
      if (job) { clearTimeout(job.timer); pending.delete(result.id); if (result.error) job.reject(new Error(result.error)); else job.resolve(result.value); }
      response.writeHead(204); response.end(); return;
    }
    if (request.url === '/v1/chat/completions') {
      let raw = ''; for await (const chunk of request) raw += chunk;
      const requestBody = JSON.parse(raw);
      const data = JSON.parse(requestBody.messages[1].content) as typeof calls[number]; calls.push(data);
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      const content = invalid ? { broken: true } : data.texts ? { translations: data.texts.map((text) => `中文译文：${text}`) } : {
        word: data.word, ipa: { us: '/ˈklaʊdi/', uk: '/ˈklaʊdi/' },
        senses: [{ partOfSpeech: 'adjective', meaning: '多云的；不清晰的' }], contextMeaning: '在当前句子中表示多云的天气',
        examples: [{ en: 'It is a cloudy morning.', zh: '这是一个多云的早晨。' }],
      };
      if (requestBody.stream) {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const closed = new Promise<void>((resolve) => response.once('close', () => { if (!response.writableEnded) abortedStreams++; resolve(); }));
        const write = (text: string) => response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
        if ('translations' in content && content.translations) {
          write('{"translations":[');
          for (const [index, text] of content.translations.entries()) {
            if (response.destroyed) return;
            write((index ? ',' : '') + JSON.stringify(text));
            if (index === 0 && streamGate) await Promise.race([streamGate, closed]);
          }
          write(']}');
        } else write(JSON.stringify(content));
        if (response.destroyed) return;
        finishedStreams++; response.end('data: [DONE]\n\n'); return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] })); return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'self'; script-src 'none'; connect-src 'none'; style-src 'unsafe-inline'" });
    if (request.url === '/large') {
      response.end(`<!doctype html><html><head><title>Long reading test</title><style>body{font:18px/1.8 system-ui;margin:40px;max-width:760px}p{min-height:90px;margin:24px 0}</style></head><body><main>${Array.from({ length: 2000 }, (_, index) => `<p id="row-${index}">Paragraph ${index}. Reading across languages should feel natural. A clear translation helps readers understand the ideas while keeping the original words in view.</p>`).join('')}</main></body></html>`); return;
    }
    response.end(`<!doctype html><html><head><title>Reading fixture</title><style>body{font:20px/1.8 system-ui;margin:48px;max-width:720px} .spacer{height:2200px} button{font-size:90px!important} p{margin:24px 0}</style></head><body><main><h1>A little clarity</h1><p id="first">A <strong>cloudy</strong> morning brings quiet thoughts.</p><p id="second">Read the original and discover another meaning.</p><pre>Never translate this code.</pre><div contenteditable="true">Private draft</div><div class="spacer"></div><p id="far">This distant paragraph waits until you scroll.</p></main></body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const control = <T>(operation: string, args: unknown[] = []) => new Promise<T>((resolve, reject) => {
    const id = crypto.randomUUID(); const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Firefox options bridge timed out: ${operation}`)); }, 10000);
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer }); commands.push({ id, operation, args });
  });
  return { url, calls, token, control, get finishedStreams() { return finishedStreams; }, get abortedStreams() { return abortedStreams; },
    holdStreams: () => { streamGate = new Promise<void>((resolve) => { releaseStream = resolve; }); },
    releaseStreams: () => { releaseStream?.(); streamGate = undefined; },
    setDelay: (value: number) => { delay = value; }, setInvalid: (value: boolean) => { invalid = value; }, close: () => new Promise<void>((resolve, reject) => { releaseStream?.(); for (const job of pending.values()) { clearTimeout(job.timer); job.reject(new Error('Test server closed')); } pending.clear(); server.closeAllConnections(); server.close((error) => error ? reject(error) : resolve()); }) };
}
