import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { cpus, totalmem } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { OpenAICompatibleProvider } from '../../src/provider';
import { SettingsSchema } from '../../src/schema';

// Dedicated localhost server; never stops or changes the user's normal MLX service.
const python = process.env.MLX_PYTHON;
if (!python) throw new Error('Set MLX_PYTHON to a Python environment containing mlx-lm');
const output = path.resolve(process.env.BENCH_OUTPUT ?? `artifacts/benchmark/mlx-models-${Date.now()}`);
mkdirSync(output, { recursive: true });
if (existsSync(path.join(output, 'results.jsonl'))) throw new Error('Choose a fresh BENCH_OUTPUT directory to avoid mixing runs');
const models = (process.env.BENCH_MODELS ?? 'mlx-community/Qwen2.5-3B-Instruct-4bit,mlx-community/Qwen2.5-1.5B-Instruct-4bit,Qwen/Qwen3-1.7B-MLX-4bit').split(',');
const port = Number(process.env.BENCH_PORT ?? 18081);
const baseUrl = `http://127.0.0.1:${port}/v1`;
type Scenario = { id: string; texts: string[] } | { id: string; word: string; context: string };
const scenarios: Scenario[] = JSON.parse(readFileSync('tests/performance/scenarios.json', 'utf8'));
const article = scenarios.find((scenario) => scenario.id === 'article');
if (!article || !('texts' in article)) throw new Error('Missing article input');
const longText = article.texts.join('\n\n');
const command = (file: string, args: string[]) => execFileSync(file, args, { encoding: 'utf8', timeout: 30000 }).trim();
writeFileSync(path.join(output, 'metadata.json'), JSON.stringify({
  date: new Date().toISOString(), chip: cpus()[0]?.model, memoryGiB: totalmem() / 1024 ** 3,
  versions: command(python, ['-c', 'import importlib.metadata as m; print("mlx",m.version("mlx"),"mlx-lm",m.version("mlx-lm"))']),
  models, order: [models, [...models].reverse()], scenarios, longText,
  temperature: 0, promptCache: false, concurrency: 1, enableThinking: false,
  tpsDefinition: '(completion_tokens - 1) / seconds from first nonempty content delta to finish event; HTTP estimate, not native kernel throughput',
  notes: ['Three TPS samples per block, two reverse-order blocks; warmup excluded.',
    'Provider scenarios run once per block, including real validation and fallback. Schema success does not establish language quality.',
    'Normal apps and the idle production MLX service may remain resident. Per-process memory only; not combined machine memory.',
    'Memory sampled after scenarios via vmmap; not a continuously sampled peak. Short-context workload only.'],
}, null, 2));
let child: ChildProcess | undefined;
async function stop() {
  const running = child; child = undefined;
  if (!running) return;
  running.kill('SIGTERM');
  for (let i = 0; i < 100 && running.exitCode === null && running.signalCode === null; i++) await delay(100);
  if (running.exitCode === null && running.signalCode === null) running.kill('SIGKILL');
}
process.on('SIGINT', () => { child?.kill('SIGTERM'); process.exit(130); });
process.on('SIGTERM', () => { child?.kill('SIGTERM'); process.exit(143); });
type Usage = { prompt_tokens: number; completion_tokens: number; total_tokens: number };
async function throughput(model: string) {
  const start = performance.now();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST', signal: AbortSignal.timeout(60000), headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, temperature: 0, max_tokens: 1024, stream: true, stream_options: { include_usage: true },
      messages: [{ role: 'system', content: 'Translate the following text into Simplified Chinese. Output ONLY the Chinese translation. No explanation.' }, { role: 'user', content: longText }] }),
  });
  if (!response.ok || !response.body) throw new Error(`TPS request failed: HTTP ${response.status}`);
  const reader = response.body.getReader(); const decoder = new TextDecoder();
  let buffer = ''; let firstMs: number | undefined; let finishMs: number | undefined;
  let usage: Usage | undefined; let text = ''; let finishReason: string | undefined;
  const events: { elapsedMs: number; event: unknown }[] = [];
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end: number;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
      if (!line.startsWith('data:') || line.slice(5).trim() === '[DONE]') continue;
      const event = JSON.parse(line.slice(5)); const elapsedMs = performance.now() - start;
      events.push({ elapsedMs, event });
      if (event.usage) usage = event.usage;
      const choice = event.choices?.[0];
      if (choice?.delta?.content) { firstMs ??= elapsedMs; text += choice.delta.content; }
      if (choice?.finish_reason) { finishMs = elapsedMs; finishReason = choice.finish_reason; }
    }
  }
  if (!usage || firstMs === undefined || finishMs === undefined || finishMs <= firstMs) throw new Error('Missing usage or stream timing');
  const totalMs = performance.now() - start;
  return { usage, firstMs, finishMs, totalMs, finishReason, text, events,
    decodeTps: (usage.completion_tokens - 1) * 1000 / (finishMs - firstMs),
    endToEndTps: usage.completion_tokens * 1000 / totalMs };
}
const rows: Record<string, unknown>[] = [];
const record = (row: Record<string, unknown>) => { rows.push(row); appendFileSync(path.join(output, 'results.jsonl'), JSON.stringify(row) + '\n'); };
try {
  // Avoid accidentally benchmarking a server we did not start.
  let occupied = false;
  try { await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(500) }); occupied = true; } catch { /* Available. */ }
  if (occupied) throw new Error(`Port ${port} already has a server`);
  for (const [block, order] of [models, [...models].reverse()].entries()) for (const model of order) {
    const id = `${block}-${model.replaceAll('/', '--')}`;
    const fd = openSync(path.join(output, `${id}.log`), 'w');
    child = spawn(python, ['-m', 'mlx_lm.server', '--model', model, '--host', '127.0.0.1', '--port', String(port),
      '--max-tokens', '4096', '--decode-concurrency', '1', '--prompt-concurrency', '1', '--prompt-cache-size', '0',
      '--chat-template-args', '{"enable_thinking":false}'], { stdio: ['ignore', fd, fd] });
    closeSync(fd);
    let spawnError: Error | undefined; child.on('error', (error) => { spawnError = error; });
    let ready = false;
    for (let i = 0; i < 240; i++) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw new Error(`Server exited; see ${id}.log`);
      try { const response = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(500) }); if (response.ok) { ready = true; break; } } catch { /* Wait for model load. */ }
      await delay(500);
    }
    if (!ready) throw new Error(`Server startup timed out: ${id}`);
    await throughput(model); // Warmup, deliberately not included in measured samples.
    for (let repetition = 0; repetition < 3; repetition++) {
      const result = await throughput(model); record({ kind: 'tps', model, block, repetition, ...result });
      console.log(model, block, 'TPS', result.decodeTps.toFixed(1), 'TTFT', result.firstMs.toFixed(0), 'tokens', result.usage.completion_tokens);
    }
    let requests = 0;
    const provider = new OpenAICompatibleProvider(SettingsSchema.parse({ baseUrl, model, temperature: 0, timeout: 60000, concurrency: 1 }),
      (input, init) => { requests++; return fetch(input, init); });
    for (const scenario of scenarios) {
      const start = performance.now(); let firstMs: number | undefined; requests = 0;
      try {
        const result = 'texts' in scenario ? await provider.translate(scenario.texts, new AbortController().signal, (_index, text) => { if (text) firstMs ??= performance.now() - start; })
          : await provider.lookup(scenario.word, scenario.context, new AbortController().signal);
        record({ kind: 'provider', model, block, scenario: scenario.id, success: true, totalMs: performance.now() - start, firstMs, requests, result });
      } catch (error) { record({ kind: 'provider', model, block, scenario: scenario.id, success: false, totalMs: performance.now() - start, firstMs, requests, error: String(error) }); }
      console.log(model, block, scenario.id, rows.at(-1)?.success, Math.round(performance.now() - start), 'ms');
    }
    writeFileSync(path.join(output, `${id}-memory.txt`), command('vmmap', ['-summary', String(child.pid)]));
    await stop(); await delay(500);
  }
} finally { await stop(); }
console.log('Results:', output);
