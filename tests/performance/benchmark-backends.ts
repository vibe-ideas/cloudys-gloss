import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, openSync, closeSync, writeFileSync, appendFileSync, existsSync, readFileSync } from 'node:fs';
import { homedir, cpus, totalmem, release } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { OpenAICompatibleProvider } from '../../src/model/provider';
import { SettingsSchema } from '../../src/core/schema';

// Benchmarks the actual provider, including streamed paragraphs, validation and retries.
// No extension result cache. Only one backend runs at a time. See report for quantization caveats.
type Engine = 'mlx' | 'llama';
type Scenario = { id: string; texts: string[] } | { id: string; word: string; context: string };
const scenarios: Scenario[] = JSON.parse(readFileSync("tests/performance/scenarios.json", "utf8"));
const out = path.resolve(process.env.BENCH_OUTPUT ?? `artifacts/benchmark/${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(out, { recursive: true });
const python = process.env.MLX_PYTHON;
const gguf = process.env.GGUF_MODEL ?? path.join(homedir(), '.cache/cloudys-gloss/bench-models/qwen2.5-3b-instruct-q4_k_m.gguf');
if (!python || !existsSync(python) || !existsSync(gguf)) throw new Error('Set MLX_PYTHON to the installed mlx-lm Python and GGUF_MODEL to the model file');
const model = 'mlx-community/Qwen2.5-3B-Instruct-4bit';
const order = (process.env.BENCH_ORDER ?? 'mlx,llama,llama,mlx').split(',') as Engine[];
const modes = (process.env.BENCH_MODES ?? 'uncached,cached').split(',');
const repeats = Number(process.env.BENCH_REPEATS ?? 2);
const chosen = scenarios.filter((s) => !process.env.BENCH_CASES || process.env.BENCH_CASES.split(',').includes(s.id));
const nativeFetch = globalThis.fetch;
const stamp = () => Math.round(performance.now());
const command = (file: string, args: string[]) => execFileSync(file, args, { encoding: 'utf8', timeout: 60000 }).trim();
const metadata = { date: new Date().toISOString(), chip: cpus()[0]?.model, totalMemoryGiB: totalmem() / 1024 ** 3,
  macOSKernel: release(), power: command('pmset', ['-g', 'batt']), thermal: command('pmset', ['-g', 'therm']),
  llamaVersion: command('llama', ['--version']), mlxVersion: command(python, ['-c', 'import importlib.metadata as m; print("mlx",m.version("mlx"),"mlx-lm",m.version("mlx-lm"))']),
  model, gguf, order, modes, repeats, scenarios: chosen,
  notes: ['Same base model, different 4-bit quantizations; not bit-identical weights or equal quality.',
    'Provider wall-clock includes JSON validation/fallback; no IndexedDB result cache, no browser rendering or queue wait.',
    'Serial requests, one backend resident; ABBA order per cache mode. Existing user apps remain running.',
    'Startup uses OS-warm disk cache; not a reboot/disk-cold benchmark. Memory is macOS physical footprint, not RSS.',
    'uncached disables backend prompt reuse; cached enables each engine\'s native prompt cache, which may differ.'] };
writeFileSync(path.join(out, 'metadata.json'), JSON.stringify(metadata, null, 2));
type Attempt = { request: unknown; status?: number; firstTokenMs?: number; elapsedMs?: number; usage?: unknown; raw?: string };
type Result = { engine: Engine; mode: string; block: number; repetition: number; scenario: string; kind: string;
  elapsedMs: number; firstTranslationMs?: number; success: boolean; error?: string; result?: unknown; attempts: Attempt[] };
const results: Result[] = [];
const boots: unknown[] = [];
let child: ChildProcess | undefined;
async function stop() {
  if (!child) return;
  const current = child; child = undefined;
  current.kill('SIGTERM');
  for (let i = 0; i < 100 && current.exitCode === null && current.signalCode === null; i++) await delay(100);
  if (current.exitCode === null && current.signalCode === null) { current.kill('SIGKILL'); await delay(500); }
}
process.on('SIGINT', () => { child?.kill('SIGTERM'); process.exit(130); });
process.on('SIGTERM', () => { child?.kill('SIGTERM'); process.exit(143); });

async function measure(engine: Engine, mode: string, block: number, repetition: number, scenario: Scenario): Promise<Result> {
  const attempts: Attempt[] = [];
  const begin = stamp(); let firstTranslationMs: number | undefined;
  const fetcher: typeof fetch = async (input, init) => {
    const attempt: Attempt = { request: JSON.parse(String(init?.body)) }; attempts.push(attempt);
    const started = stamp();
    const response = await nativeFetch(input, init); attempt.status = response.status;
    if (response.headers.get('content-type')?.includes('text/event-stream') && response.body) {
      let buffer = ''; const decoder = new TextDecoder(); const raw: string[] = [];
      const stream = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          const text = decoder.decode(chunk, { stream: true }); raw.push(text); buffer += text;
          let end: number;
          while ((end = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
            if (!line.startsWith('data:') || line.slice(5).trim() === '[DONE]') continue;
            try {
              const event = JSON.parse(line.slice(5));
              if (event.choices?.some((choice: { delta?: { content?: string } }) => choice.delta?.content) && attempt.firstTokenMs === undefined) attempt.firstTokenMs = stamp() - started;
              if (event.usage) attempt.usage = event.usage;
            } catch { /* Provider independently validates malformed streams. */ }
          }
          controller.enqueue(chunk);
        },
        flush() { attempt.elapsedMs = stamp() - started; attempt.raw = raw.join(''); },
      }));
      return new Response(stream, { status: response.status, headers: response.headers });
    }
    const body = await response.text(); attempt.raw = body; attempt.elapsedMs = stamp() - started;
    try { attempt.usage = JSON.parse(body).usage; } catch { /* Provider reports this error. */ }
    return new Response(body, { status: response.status, headers: response.headers });
  };
  const settings = SettingsSchema.parse({ baseUrl: 'http://127.0.0.1:18080/v1', model: engine === 'mlx' ? model : 'qwen2.5-3b', temperature: 0, timeout: 60000, concurrency: 1 });
  const provider = new OpenAICompatibleProvider(settings, fetcher);
  const base = { engine, mode, block, repetition, scenario: scenario.id, kind: 'texts' in scenario ? 'translation' : 'dictionary' };
  try {
    const result = 'texts' in scenario
      ? await provider.translate(scenario.texts, new AbortController().signal, (_index, text) => { if (text && firstTranslationMs === undefined) firstTranslationMs = stamp() - begin; })
      : await provider.lookup(scenario.word, scenario.context, new AbortController().signal);
    return { ...base, elapsedMs: stamp() - begin, firstTranslationMs, success: true, result, attempts };
  } catch (error) { return { ...base, elapsedMs: stamp() - begin, firstTranslationMs, success: false, error: String(error), attempts }; }
}

try {
  if (process.argv.includes('--check')) { console.log('Benchmark configuration validated:', out); process.exit(0); }
  for (const mode of modes) for (const [block, engine] of order.entries()) {
    if (!['mlx', 'llama'].includes(engine)) throw new Error('Unknown engine');
    const args = engine === 'mlx'
      ? ['-m', 'mlx_lm.server', '--model', model, '--host', '127.0.0.1', '--port', '18080', '--max-tokens', '4096', '--decode-concurrency', '1', '--prompt-concurrency', '1', '--prompt-cache-size', mode === 'uncached' ? '0' : '10']
      : ['-m', gguf, '--host', '127.0.0.1', '--port', '18080', '--alias', 'qwen2.5-3b', '-c', '4096', '-np', '1', '-ngl', '99', '-fa', 'on', '--temp', '0', '--top-k', '0', '--top-p', '1', '--min-p', '0', ...(mode === 'uncached' ? ['--no-cache-prompt', '--cache-ram', '0'] : [])];
    const logPath = path.join(out, `${mode}-${block}-${engine}.log`); const fd = openSync(logPath, 'w'); const started = stamp();
    child = spawn(engine === 'mlx' ? python : 'llama-server', args, { stdio: ['ignore', fd, fd] }); closeSync(fd);
    const pid = child.pid;
    console.log('START', mode, block, engine, 'pid', pid);
    let ready = false;
    for (let i = 0; i < 240; i++) {
      if (child.exitCode !== null) throw new Error(`Server exited: ${logPath}`);
      try { const response = await nativeFetch('http://127.0.0.1:18080/v1/models', { signal: AbortSignal.timeout(500) }); if (response.ok) { ready = true; break; } } catch { /* Wait for this server, up to 120s. */ }
      await delay(500);
    }
    if (!ready) throw new Error(`Server startup timed out: ${logPath}`);
    const readyMs = stamp() - started;
    const warmup = await measure(engine, mode, block, -1, { id: 'warmup', texts: ['The sun rises in the east and sets in the west.', 'Reading a new book is a good way to learn.'] });
    boots.push({ engine, mode, block, args, pid, readyMs, firstRequest: warmup, readyAndFirstRequestMs: stamp() - started });
    writeFileSync(path.join(out, 'startup.json'), JSON.stringify(boots, null, 2));
    if (!warmup.success) throw new Error(`Warmup failed: ${warmup.error}`);
    for (let repetition = 0; repetition < repeats; repetition++) {
      // Rotate scenario order while preserving identical inputs and schedule for each engine pair.
      const offset = (repetition + (block >= 2 ? 1 : 0)) % chosen.length;
      for (const scenario of [...chosen.slice(offset), ...chosen.slice(0, offset)]) {
        const result = await measure(engine, mode, block, repetition, scenario); results.push(result);
        appendFileSync(path.join(out, 'results.jsonl'), JSON.stringify(result) + '\n');
        console.log(engine, mode, scenario.id, result.success ? 'OK' : result.error, `first=${result.firstTranslationMs ?? '-'}ms total=${result.elapsedMs}ms calls=${result.attempts.length}`);
        await delay(150);
      }
    }
    writeFileSync(path.join(out, `${mode}-${block}-${engine}-memory.txt`), command('vmmap', ['-summary', String(pid)]));
    await stop(); await delay(1500);
  }
} finally {
  await stop();
  const groups = [];
  const median = (xs: number[]) => { const sorted = [...xs].sort((a, b) => a - b); const i = Math.floor(sorted.length / 2); return sorted.length ? (sorted.length % 2 ? sorted[i]! : (sorted[i - 1]! + sorted[i]!) / 2) : null; };
  for (const mode of modes) for (const engine of ['mlx', 'llama']) for (const kind of ['translation', 'dictionary']) {
    const rows = results.filter((r) => r.mode === mode && r.engine === engine && r.kind === kind);
    if (!rows.length) continue;
    groups.push({ mode, engine, kind, count: rows.length, successes: rows.filter((r) => r.success).length,
      extraRequests: rows.reduce((sum, r) => sum + r.attempts.length - 1, 0),
      medianTotalMs: median(rows.map((r) => r.elapsedMs)), medianFirstTranslationMs: median(rows.flatMap((r) => r.firstTranslationMs === undefined ? [] : [r.firstTranslationMs])),
      minTotalMs: Math.min(...rows.map((r) => r.elapsedMs)), maxTotalMs: Math.max(...rows.map((r) => r.elapsedMs)) });
  }
  writeFileSync(path.join(out, 'summary.json'), JSON.stringify(groups, null, 2));
  console.log('RESULTS', out, JSON.stringify(groups));
}
