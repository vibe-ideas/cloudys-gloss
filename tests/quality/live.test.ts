import { afterAll, describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { cpus } from 'node:os';
import { OpenAICompatibleProvider } from '../../src/provider';
import { SettingsSchema } from '../../src/schema';
import { parseCorpus, assess } from './corpus';

const corpusPath = process.env.QUALITY_CORPUS ?? 'tests/quality/cases.json';
const corpusText = readFileSync(corpusPath, 'utf8');
const corpus = parseCorpus(JSON.parse(corpusText));

if (!process.env.MODEL_BASE_URL || !process.env.MODEL_NAME || !process.env.QUALITY_OUTPUT) {
  throw new Error('真实质量评测需要 MODEL_BASE_URL、MODEL_NAME、QUALITY_OUTPUT；可选 MODEL_API_KEY。普通 pnpm test 不调用模型。');
}
const settings = SettingsSchema.parse({ baseUrl: process.env.MODEL_BASE_URL, model: process.env.MODEL_NAME,
  apiKey: process.env.MODEL_API_KEY ?? '', temperature: 0, timeout: 120000, concurrency: 1 });
const repetitions = Number(process.env.QUALITY_REPEATS ?? 2);
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 10) throw new Error('QUALITY_REPEATS 必须为 1–10');
const output = path.resolve(process.env.QUALITY_OUTPUT);
if (existsSync(path.join(output, 'results.json'))) throw new Error('QUALITY_OUTPUT 已有结果，请使用新目录');
mkdirSync(output, { recursive: true });
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const corpusHash = sha(corpusText);
const requestOptions = process.env.QUALITY_THINKING === 'enabled' && process.env.QUALITY_RUNTIME?.startsWith('mlx-serve')
  ? { enable_thinking: true, reasoning_budget_tokens: Number(process.env.QUALITY_REASONING_BUDGET ?? 128) } : {};
const providerHash = sha(['provider', 'schema', 'stream'].map((name) => readFileSync(`src/${name}.ts`, 'utf8')).join('\n')
  + (Object.keys(requestOptions).length ? JSON.stringify(requestOptions) : ''));
writeFileSync(path.join(output, 'pipeline.json'), JSON.stringify({ requestOptions, sources: Object.fromEntries(
  ['provider', 'schema', 'stream'].map((name) => [`src/${name}.ts`, readFileSync(`src/${name}.ts`, 'utf8')])),
}, null, 2) + '\n');
const modelLabel = process.env.MODEL_LABEL ?? settings.model;
const metadata = { date: new Date().toISOString(), model: modelLabel, modelRevision: process.env.MODEL_REVISION ?? 'unrecorded',
  corpusVersion: corpus.version, corpusHash, providerHash, repetitions, temperature: 0, concurrency: 1, requestOptions,
  chip: cpus()[0]?.model, route: 'OpenAICompatibleProvider.translate with streaming callback, validation and fallback',
  runtime: process.env.QUALITY_RUNTIME ?? 'unrecorded', promptCache: process.env.QUALITY_PROMPT_CACHE ?? 'unrecorded',
  enableThinking: process.env.QUALITY_THINKING ?? 'unrecorded', cache: 'no extension result cache',
  reviewPolicy: 'Automatic guards are not a semantic quality score; reviews.json records the current review status' };
writeFileSync(path.join(output, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
type Result = { id: string; repetition: number; title: string; translations: string[]; outputHash: string;
  elapsedMs: number; firstMs?: number; requests: number; assessment: ReturnType<typeof assess>; error?: string };
const results: Result[] = [];
const flush = () => writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2) + '\n');
afterAll(() => {
  flush();
  const unique = [...new Map(results.map((row) => [`${row.id}:${row.outputHash}`, row])).values()];
  writeFileSync(path.join(output, 'review-template.json'), JSON.stringify({ corpusHash, providerHash,
    model: modelLabel, reviewer: null, method: null,
    reviews: unique.map((row) => ({ id: row.id, outputHash: row.outputHash, adequacy: null, completeness: null, fluency: null, critical: null, notes: null })),
  }, null, 2) + '\n');
});

describe('真实模型翻译质量：固定语料的硬性检查', () => {
  for (let repetition = 1; repetition <= repetitions; repetition++) {
    describe(`第 ${repetition} 轮`, () => {
      test.each(corpus.cases)('$id · $title', async (testCase) => {
        let requests = 0; let firstMs: number | undefined; let translations: string[] = []; let error: string | undefined;
        const provider = new OpenAICompatibleProvider(settings, (input, init) => { requests++; return fetch(input, { ...init, body: JSON.stringify({ ...JSON.parse(init!.body as string), ...requestOptions }) }); });
        const start = performance.now();
        try {
          translations = await provider.translate(testCase.texts, new AbortController().signal,
            (_index, text) => { if (text) firstMs ??= performance.now() - start; });
        } catch (caught) { error = caught instanceof Error ? caught.message : '模型调用失败'; }
        const assessment = assess(testCase, translations);
        if (error) { assessment.errors.unshift(error); assessment.automaticPassed = false; }
        results.push({ id: testCase.id, title: testCase.title, repetition, translations,
          outputHash: sha(JSON.stringify({ translations, error: error ?? null })), elapsedMs: performance.now() - start, firstMs, requests, assessment, error });
        flush();
        expect(assessment.errors, '仅硬性检查；语义、完整性和自然度仍须逐例审阅').toEqual([]);
      });
    });
  }
});
