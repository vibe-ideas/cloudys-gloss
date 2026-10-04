import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readingFixture, readingTranslations } from './reading-fixture';
import { layoutFixture, layoutTranslations } from './layout-fixture';
import { diverseFixture, diverseTranslations } from './diverse-layout-fixture';
import { auxiliaryFixture } from './auxiliary-fixture';
import { componentPerformanceFixture } from './performance-fixture';
import { pdfFixture } from './pdf-fixture';
import { componentFixture, componentTranslations } from './component-fixture';
export async function startServer() {
  const calls: { texts?: string[]; word?: string; context?: string; example?: string }[] = [];
  let delay = 0; let invalid = false;
  let streamGate: Promise<void> | undefined; let releaseStream: (() => void) | undefined;
  let finishedStreams = 0; let abortedStreams = 0;
  const token = crypto.randomUUID();
  const commands: { id: string; operation: string; args: unknown[] }[] = [];
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const server = createServer(async (request, response) => {
    if (request.url === '/pdf-fixture.pdf') {
      response.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': pdfFixture.byteLength }); response.end(pdfFixture); return;
    }
    if (request.url === '/slow-pdf.pdf') {
      response.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': pdfFixture.byteLength }); response.write(pdfFixture.subarray(0, 8));
      const timer = setTimeout(() => response.end(pdfFixture.subarray(8)), 1000); timer.unref();
      response.once('close', () => clearTimeout(timer)); return;
    }
    if (request.url === '/not-a-pdf.pdf') {
      response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><p>This is an HTML document.</p>'); return;
    }
    if (request.url === '/large-pdf.pdf') {
      response.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': 41 * 1024 * 1024 }); response.end('%PDF-1.7'); return;
    }
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
      if (requestBody.messages[0].content.includes('as plain text')) {
        const text = requestBody.messages[1].content as string;
        calls.push({ texts: [text] });
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ choices: [{ message: { content: invalid ? '{"broken":true}' : `中文译文：${text}` } }] }));
        return;
      }
      const data = JSON.parse(requestBody.messages[1].content) as typeof calls[number]; calls.push(data);
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      const content = invalid ? { broken: true } : data.texts ? { translations: data.texts.map((text) => componentTranslations[text] ?? diverseTranslations[text] ?? layoutTranslations[text] ?? readingTranslations[text] ?? `中文译文：${text}`) } : {
        word: data.word, ipa: { us: '/ˈklaʊdi/', uk: '/ˈklaʊdi/' },
        senses: [{ partOfSpeech: 'adjective', meaning: '多云的；不清晰的' }], contextMeaning: '在当前句子中表示多云的天气',
        examples: data.example ? [{ zh: '多云的早晨让人思绪宁静。' }]
          : [{ en: 'It is a cloudy morning.', zh: '这是一个多云的早晨。' }],
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
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': `default-src 'self'; script-src ${['/layout-design', '/diverse-layout', '/auxiliary-content', '/component-design'].includes(request.url ?? '') ? "'unsafe-inline'" : "'none'"}; connect-src 'none'; style-src 'unsafe-inline'` });
    if (request.url === '/reading-design') { response.end(readingFixture); return; }
    if (request.url === '/layout-design') { response.end(layoutFixture); return; }
    if (request.url === '/diverse-layout') { response.end(diverseFixture); return; }
    if (request.url === '/auxiliary-content') { response.end(auxiliaryFixture); return; }
    if (request.url === '/component-performance') { response.end(componentPerformanceFixture); return; }
    if (request.url === '/component-design') { response.end(componentFixture); return; }
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
