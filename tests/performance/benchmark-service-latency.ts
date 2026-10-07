import 'fake-indexeddb/auto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { TranslationService } from '../../src/service';
import { ResultCache } from '../../src/cache';
import { defaults } from '../../src/schema';

// Real local inference, identical workloads, alternating before/after order.
// IndexedDB is emulated here: this measures the background service, not browser rendering.
const output = process.env.BENCH_OUTPUT;
const baseline = process.env.BASELINE_DIR;
if (!output || existsSync(output) || !baseline) throw new Error('Set fresh BENCH_OUTPUT and BASELINE_DIR containing the frozen src files');
const baseUrl = process.env.MODEL_BASE_URL ?? defaults.baseUrl;
if (!['127.0.0.1', 'localhost'].includes(new URL(baseUrl).hostname)) throw new Error('Local model endpoint required');
mkdirSync(output, { recursive: true });
const before = await import(pathToFileURL(resolve(baseline, 'service.ts')).href) as typeof import('../../src/service');
const settings = { ...defaults, baseUrl, model: process.env.MODEL_NAME ?? defaults.model, concurrency: 1 };
const sourceFiles = ['service.ts', 'queue.ts', 'cache.ts', 'provider.ts', 'schema.ts', 'stream.ts', 'dictionary-context.ts', 'pronunciation.ts'];
writeFileSync(`${output}/pipelines.json`, JSON.stringify(Object.fromEntries([['before', baseline], ['after', 'src']].map(([name, dir]) =>
  [name, Object.fromEntries(sourceFiles.map((file) => [file, readFileSync(resolve(dir!, file), 'utf8')]))])), null, 2));
writeFileSync(`${output}/metadata.json`, JSON.stringify({ date: new Date().toISOString(), settings: { ...settings, apiKey: undefined },
  order: ['before', 'after', 'after', 'before'], cache: 'fresh emulated IndexedDB per workload; server prompt cache unchanged',
  scope: 'service completion and request counts, no browser rendering; synthetic public corpus; 2 repetitions per version' }, null, 2));
const corpus = JSON.parse(readFileSync('tests/performance/scenarios.json', 'utf8')) as { id: string; texts?: string[] }[];
const texts = (id: string) => corpus.find((scenario) => scenario.id === id)!.texts!;
const originalFetch = globalThis.fetch;
for (const [round, version] of ['before', 'after', 'after', 'before'].entries()) {
  for (const workload of ['duplicate-pages', 'interactive-after-prefetch']) {
    const start = performance.now();
    const calls: { startedMs: number; texts: string[] }[] = [];
    globalThis.fetch = async (input, init) => {
      const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
      let source: string[];
      try { source = (JSON.parse(body.messages[1]!.content) as { texts: string[] }).texts; }
      catch { source = [body.messages[1]!.content]; }
      calls.push({ startedMs: performance.now() - start, texts: source });
      return originalFetch(input, init);
    };
    const Service = version === 'before' ? before.TranslationService : TranslationService;
    const service = new Service(new ResultCache(crypto.randomUUID()));
    const timings: Record<string, { firstItemMs?: number; completedMs: number; translations: string[] }> = {};
    const run = async (name: string, input: string[], priority: 'interactive' | 'visible' | 'prefetch' = 'visible') => {
      const called = performance.now(); let firstItemMs: number | undefined;
      const translations = await service.translate(settings, input, new AbortController().signal,
        (_index, text) => { if (text) firstItemMs ??= performance.now() - called; }, priority === 'interactive', priority);
      timings[name] = { firstItemMs, completedMs: performance.now() - called, translations };
    };
    try {
      if (workload === 'duplicate-pages') {
        await Promise.all([run('page-a', texts('article')), run('page-b', texts('article'))]);
      } else {
        const pending = [run('blocker', [texts('article')[0]!])];
        while (!calls.length) await new Promise((done) => setTimeout(done, 1));
        pending.push(run('prefetch', [texts('article')[1]!], 'prefetch'));
        await new Promise((done) => setTimeout(done, 20));
        pending.push(run('visible', [texts('reading')[0]!]));
        await new Promise((done) => setTimeout(done, 20));
        pending.push(run('interactive', [texts('technical')[1]!], 'interactive'));
        await Promise.all(pending);
      }
      const row = { version, round, workload, elapsedMs: performance.now() - start, requestCount: calls.length, calls, timings };
      appendFileSync(`${output}/results.jsonl`, JSON.stringify(row) + '\n');
      console.log(version, workload, `${row.elapsedMs.toFixed(0)}ms`, `${calls.length} requests`,
        timings.interactive ? `interactive ${timings.interactive.completedMs.toFixed(0)}ms` : '');
    } finally { globalThis.fetch = originalFetch; }
  }
}
