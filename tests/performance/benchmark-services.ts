import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { cpus } from 'node:os';
import { OfflinePronunciationDictionary } from '../../src/pronunciation';
import { OpenAICompatibleProvider } from '../../src/provider';
import { SettingsSchema } from '../../src/schema';

// Compare already-running local services, without starting or stopping any process.
const services = JSON.parse(process.env.BENCH_SERVICES ?? '[]') as { name: string; baseUrl: string }[];
if (services.length < 1 || services.some((s) => !['127.0.0.1', 'localhost'].includes(new URL(s.baseUrl).hostname))) throw new Error('Set BENCH_SERVICES to at least one localhost {name,baseUrl} entries');
const output = process.env.BENCH_OUTPUT!;
if (!output || existsSync(output)) throw new Error('Set BENCH_OUTPUT to a fresh directory');
mkdirSync(output, { recursive: true });
const pronunciation = new OfflinePronunciationDictionary(async (dialect) => readFileSync(`public/dictionaries/${dialect}.tsv`, 'utf8'));
const model = process.env.MODEL_NAME ?? 'Qwen/Qwen3-1.7B-MLX-4bit';
type Scenario = { id: string; texts: string[] } | { id: string; word: string; context: string };
const scenarios: Scenario[] = JSON.parse(readFileSync('tests/performance/scenarios.json', 'utf8'));
const article = scenarios.find((s) => s.id === 'article');
if (!article || !('texts' in article)) throw new Error('Missing article fixture');
const longText = article.texts.join('\n\n');
writeFileSync(`${output}/metadata.json`, JSON.stringify({ date: new Date().toISOString(), chip: cpus()[0]?.model, model, services,
  order: [services.map((s) => s.name), [...services].reverse().map((s) => s.name)], temperature: 0,
  notes: ['Two reverse-order blocks, three measured requests per block after a warmup.', 'Server prompt caches retain their configured settings. No extension result cache.',
    'HTTP decode TPS = (completion_tokens - 1) / seconds from first content to finish event; not kernel throughput.', 'Ordinary desktop apps remain open. Provider success only checks structure, not semantic quality.'] }, null, 2));
type Usage = { prompt_tokens: number; completion_tokens: number; total_tokens: number };
async function throughput(baseUrl: string, model: string) {
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
const record = (row: unknown) => appendFileSync(`${output}/results.jsonl`, JSON.stringify(row) + '\n');
for (const [block, order] of [services, [...services].reverse()].entries()) for (const service of order) {
  await throughput(service.baseUrl, model);
  for (let repetition = 0; repetition < 3; repetition++) {
    const result = await throughput(service.baseUrl, model);
    record({ kind: 'tps', service: service.name, block, repetition, ...result });
    console.log(service.name, 'TPS', result.decodeTps.toFixed(1));
  }
  const provider = new OpenAICompatibleProvider(SettingsSchema.parse({ baseUrl: service.baseUrl, model, temperature: 0, timeout: 120000, concurrency: 1 }), undefined, pronunciation);
  for (const scenario of scenarios) {
    const start = performance.now();
    try {
      const result = 'texts' in scenario ? await provider.translate(scenario.texts, new AbortController().signal, () => {})
        : await provider.lookup(scenario.word, scenario.context, new AbortController().signal);
      record({ kind: 'provider', service: service.name, block, scenario: scenario.id, success: true, elapsedMs: performance.now() - start, result });
    } catch (error) { record({ kind: 'provider', service: service.name, block, scenario: scenario.id, success: false, error: String(error) }); }
  }
}
