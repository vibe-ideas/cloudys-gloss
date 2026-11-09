import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { Window } from 'happy-dom';
import { semanticBlocks, semanticText, splitText, translationKind } from '../../src/page/blocks';
import { OpenAICompatibleProvider, type ProviderDiagnostic } from '../../src/model/provider';
import { defaults, SettingsSchema } from '../../src/core/schema';
import { ConcurrencyQueue } from '../../src/core/queue';

// Run against an exported rendered article, without extension result caching.
// This isolates model/protocol costs; it does not measure scrolling or painting.
const output = process.env.BENCH_OUTPUT;
const input = process.env.BENCH_ARTICLE;
if (!output || existsSync(output) || !input) throw new Error('Set fresh BENCH_OUTPUT and BENCH_ARTICLE (rendered HTML)');
const settings = SettingsSchema.parse({ ...defaults, baseUrl: process.env.MODEL_BASE_URL ?? defaults.baseUrl,
  model: process.env.MODEL_NAME ?? defaults.model, concurrency: Number(process.env.BENCH_CONCURRENCY ?? 1) });
// The legacy control differs only by removing the newly added soft switch.
const legacy = process.env.BENCH_LEGACY === '1';
const plain = process.env.BENCH_PLAIN === '1';
const exactExample = process.env.BENCH_EXACT_EXAMPLE === '1';
const requestedRepairs = Number(process.env.BENCH_REPAIRS ?? 1);
if (requestedRepairs !== 1 && requestedRepairs !== 2) throw new Error('BENCH_REPAIRS must be 1 or 2');
const repairConcurrency: 1 | 2 = requestedRepairs;
const selected = process.env.BENCH_BATCHES?.split(',').map(Number);
const proseItems = Number(process.env.BENCH_ITEMS ?? 2);
const batchCharacters = Number(process.env.BENCH_CHARS ?? 1800);
if (!Number.isInteger(proseItems) || proseItems < 1 || proseItems > 16 || !Number.isInteger(batchCharacters) || batchCharacters < 900 || batchCharacters > 12000) throw new Error('Invalid batch limits');
if (!['127.0.0.1', 'localhost'].includes(new URL(settings.baseUrl).hostname)) throw new Error('Local model endpoint required');
const html = readFileSync(input, 'utf8');
const window = new Window();
Object.assign(globalThis, { document: window.document, Element: window.Element, HTMLElement: window.HTMLElement,
  Node: window.Node, NodeFilter: window.NodeFilter });
window.document.body.innerHTML = html;
const article = window.document.querySelector('article.markdown-body') ?? window.document.querySelector('article');
if (article) window.document.body.innerHTML = article.outerHTML;
const elements = semanticBlocks(window.document.body as unknown as Element);
const blocks = elements.map(element => ({
  text: semanticText(element), kind: translationKind(element),
}));
if (!blocks.length) throw new Error('The HTML contains no translatable article blocks');
const chunks = blocks.flatMap((block, blockIndex) => splitText(block.text, 900).map(text => ({ ...block, text, blockIndex })));
const batches: typeof chunks[] = [];
for (const chunk of chunks) {
  const batch = batches.at(-1);
  const limit = plain ? 1 : chunk.kind === 'component' ? 8 : proseItems;
  if (batch && batch[0]!.kind === chunk.kind && batch.length < limit
    && batch.reduce((sum, item) => sum + item.text.length, 0) + chunk.text.length <= batchCharacters) batch.push(chunk);
  else batches.push([chunk]);
}
mkdirSync(output, { recursive: true });
if (selected && selected.some(index => !Number.isInteger(index) || index < 0 || index >= batches.length)) throw new Error('Invalid BENCH_BATCHES indices');
elements.forEach((element, index) => element.setAttribute('data-bench-block', String(index)));
writeFileSync(`${output}/replay.html`, '<!doctype html><meta charset="utf-8"><style>body{max-width:840px;margin:40px auto;padding:0 24px;font:16px/1.7 system-ui}img{max-width:100%}table{border-collapse:collapse}td,th{padding:8px;border:1px solid #ccc}</style>' + window.document.body.innerHTML);
const sources = Object.fromEntries(['model/provider', 'core/schema', 'core/stream', 'core/translation-result', 'page/blocks'].map(name =>
  [`src/${name}.ts`, readFileSync(`src/${name}.ts`, 'utf8')]));
writeFileSync(`${output}/pipeline.json`, JSON.stringify(sources, null, 2));
writeFileSync(`${output}/corpus.json`, JSON.stringify({ blocks, batches }, null, 2));
writeFileSync(`${output}/metadata.json`, JSON.stringify({ date: new Date().toISOString(), chip: cpus()[0]?.model,
  settings: { ...settings, apiKey: undefined }, articleSha256: createHash('sha256').update(html).digest('hex'),
  legacy, plain, exactExample, selected, proseItems, batchCharacters, repairConcurrency, modelRevision: process.env.MODEL_REVISION ?? 'unrecorded', runtime: process.env.BENCH_RUNTIME ?? 'unrecorded',
  blocks: blocks.length, chunks: chunks.length, batches: batches.length, characters: chunks.reduce((sum, item) => sum + item.text.length, 0),
  scope: 'production semantic extraction and 900-character chunks; configurable bounded provider pool with validation and repairs; no result cache or browser rendering',
  promptCache: 'server unchanged; not cleared' }, null, 2));
if (process.env.BENCH_EXTRACT_ONLY === '1') { console.log(`${blocks.length} blocks, ${batches.length} batches`); await window.happyDOM.close(); process.exit(0); }
const started = performance.now();
const requestQueue = new ConcurrencyQueue(settings.concurrency);
let activeRequests = 0; let peakRequests = 0;
let firstMs: number | undefined; let requests = 0; let repairs = 0; let failed = 0; let completedBatches = 0;
async function runBatch(index: number, batch: typeof chunks) {
  const start = performance.now(); const diagnostics: (ProviderDiagnostic & { atMs: number })[] = [];
  const responses: Promise<unknown>[] = [];
  const provider = new OpenAICompatibleProvider(settings, async (url, init) => {
    const body = JSON.parse(String(init?.body));
    // This benchmark is loopback-only and uses a server known to support usage.
    if (body.stream) body.stream_options = { include_usage: true };
    if (exactExample && body.stream) body.messages[0].content = body.messages[0].content.replace(
      '{"translations":["中文译文1","中文译文2"]}', JSON.stringify({ translations: batch.map((_, index) => `中文译文${index + 1}`) }));
    if (legacy) body.messages[0].content = body.messages[0].content.replace(/\n\/no_think$/, '');
    const response = await fetch(url, { ...init, body: JSON.stringify(body) });
    if (selected) responses.push(response.clone().text().then(raw => ({ body, raw })));
    return response;
  }, undefined, event => diagnostics.push({ ...event, atMs: performance.now() - started }), {
    repairConcurrency,
    schedule: (request, signal) => requestQueue.run(async () => {
      activeRequests++; peakRequests = Math.max(peakRequests, activeRequests);
      try { return await request(); } finally { activeRequests--; }
    }, signal),
  });
  let translations: string[] = []; let error: string | undefined;
  try {
    if (plain) {
      // Experimental protocol control: reuse the production repair prompt and
      // validation without changing the shipped translation route.
      const translate = Reflect.get(provider, 'plainTranslation') as (text: string, signal: AbortSignal) => Promise<string>;
      translations = [await translate.call(provider, batch[0]!.text, AbortSignal.timeout(settings.timeout))];
      firstMs ??= performance.now() - started;
    } else translations = await provider.translate(batch.map(item => item.text), new AbortController().signal,
      (_index, text) => { if (text) firstMs ??= performance.now() - started; });
  }
  catch (caught) { error = String(caught); failed += batch.length; }
  const calls = diagnostics.filter(event => event.event === 'start');
  requests += calls.length; repairs += plain ? 0 : calls.filter(event => event.operation === 'translation-repair').length;
  const elapsedMs = performance.now() - start;
  appendFileSync(`${output}/results.jsonl`, JSON.stringify({ index, elapsedMs, translations, error, diagnostics,
    responses: selected ? await Promise.all(responses) : undefined }) + '\n');
  console.log(`${index + 1}/${batches.length} ${Math.round(elapsedMs)}ms ${calls.length} requests${error ? ` ERROR ${error}` : ''}`);
  writeFileSync(`${output}/summary.json`, JSON.stringify({ completedBatches: ++completedBatches, totalBatches: selected ? batches.filter((_, i) => selected.includes(i)).length : batches.length,
    elapsedMs: performance.now() - started, firstMs, requests, repairs, failed, peakRequests }, null, 2));
}
let cursor = 0;
await Promise.all(Array.from({ length: settings.concurrency }, async (_, worker) => {
  await new Promise(resolve => setTimeout(resolve, worker * 20));
  while (cursor < batches.length) {
    const index = cursor++;
    if (!selected || selected.includes(index)) await runBatch(index, batches[index]!);
  }
}));
console.log(readFileSync(`${output}/summary.json`, 'utf8'));
await window.happyDOM.close();
