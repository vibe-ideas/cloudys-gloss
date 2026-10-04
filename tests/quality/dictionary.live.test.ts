import { afterAll, describe, expect, test } from 'vitest';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { cpus } from 'node:os';
import { OfflinePronunciationDictionary } from '../../src/pronunciation';
import { OpenAICompatibleProvider } from '../../src/provider';
import { SettingsSchema, WordCardSchema, type WordCard } from '../../src/schema';

const corpusText = readFileSync('tests/quality/dictionary-cases.json', 'utf8');
const corpus = z.object({ version: z.string(), cases: z.array(z.object({
  id: z.string(), title: z.string(), word: z.string().min(1), context: z.string(),
  expectedPartOfSpeech: z.enum(['noun', 'verb', 'adjective']), meaningPattern: z.string(),
  requirements: z.array(z.string()).min(1),
})).min(1) }).parse(JSON.parse(corpusText));
if (new Set(corpus.cases.map((item) => item.id)).size !== corpus.cases.length) throw new Error('词卡用例 ID 必须唯一');
for (const item of corpus.cases) new RegExp(item.meaningPattern, 'u');
if (!process.env.MODEL_BASE_URL || !process.env.MODEL_NAME || !process.env.QUALITY_OUTPUT) {
  throw new Error('真实词卡评测需要 MODEL_BASE_URL、MODEL_NAME、QUALITY_OUTPUT；普通 pnpm test 不调用模型。');
}
const settings = SettingsSchema.parse({ baseUrl: process.env.MODEL_BASE_URL, model: process.env.MODEL_NAME,
  apiKey: process.env.MODEL_API_KEY ?? '', temperature: 0, timeout: 120000, concurrency: 1 });
const repetitions = Number(process.env.QUALITY_REPEATS ?? 2);
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 10) throw new Error('QUALITY_REPEATS 必须为 1–10');
// A separate namespace prevents mixing dictionary and translation review scores.
const output = path.resolve(process.env.QUALITY_OUTPUT, 'dictionary');
if (existsSync(path.join(output, 'metadata.json'))) throw new Error('词卡输出目录已存在，请使用新的 QUALITY_OUTPUT');
mkdirSync(output, { recursive: true });
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const corpusHash = sha(corpusText);
const providerHash = sha(['provider', 'schema', 'stream', 'pronunciation', 'dictionary-context'].map((name) => readFileSync(`src/${name}.ts`, 'utf8')).join('\n'));
writeFileSync(path.join(output, 'pipeline.json'), JSON.stringify({ sources: Object.fromEntries(
  ['provider', 'schema', 'stream', 'pronunciation', 'dictionary-context'].map((name) => [`src/${name}.ts`, readFileSync(`src/${name}.ts`, 'utf8')])),
}, null, 2) + '\n');
const modelLabel = process.env.MODEL_LABEL ?? settings.model;
writeFileSync(path.join(output, 'cases.json'), corpusText);
writeFileSync(path.join(output, 'metadata.json'), JSON.stringify({ date: new Date().toISOString(), kind: 'dictionary',
  model: modelLabel, modelRevision: process.env.MODEL_REVISION ?? 'unrecorded', corpusVersion: corpus.version,
  corpusHash, providerHash, repetitions, temperature: 0, concurrency: 1, chip: cpus()[0]?.model,
  route: 'OpenAICompatibleProvider.lookup with original Zod validation, bounded repair and offline US/UK pronunciation',
  pronunciationData: JSON.parse(readFileSync('public/dictionaries/sources.json', 'utf8')),
  runtime: process.env.QUALITY_RUNTIME ?? 'unrecorded', promptCache: process.env.QUALITY_PROMPT_CACHE ?? 'unrecorded',
  cache: 'no extension result cache',
  reviewPolicy: 'JSON/Zod and coarse lexical guards do not establish semantic or IPA accuracy. Review each unique output; empty IPA is missing pronunciation.',
}, null, 2) + '\n');

type Attempt = { status?: number; content?: string; finishReason?: string | null; jsonParsed: boolean;
  zodPassed: boolean; issues: string[]; error?: string };
type Result = { id: string; title: string; repetition: number; card?: WordCard; outputHash: string;
  elapsedMs: number; requests: number; attempts: Attempt[]; assessment: { zodPassed: boolean;
    automaticPassed: boolean; errors: string[]; review: string[] }; error?: string };
const pronunciation = new OfflinePronunciationDictionary(async (dialect) => readFileSync(`public/dictionaries/${dialect}.tsv`, 'utf8'));
const results: Result[] = [];
const flush = () => writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2) + '\n');
const posPatterns = {
  noun: /(?:^|[^a-z])(?:noun|n\.)(?:$|[^a-z])|名词/iu,
  verb: /(?:^|[^a-z])(?:verb|v\.|vt\.|vi\.)(?:$|[^a-z])|动词/iu,
  adjective: /(?:^|[^a-z])(?:adjective|adj\.?)(?:$|[^a-z])|形容词/iu,
};
const summarizeResponse = async (response: Response): Promise<Attempt> => {
  const attempt: Attempt = { status: response.status, jsonParsed: false, zodPassed: false, issues: [] };
  try {
    const envelope: unknown = await response.json();
    const parsed = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string() }), finish_reason: z.string().nullish() })).min(1) }).parse(envelope);
    attempt.content = parsed.choices[0]!.message.content;
    attempt.finishReason = parsed.choices[0]!.finish_reason;
    const content = attempt.content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const data: unknown = JSON.parse(content); attempt.jsonParsed = true;
    const validated = WordCardSchema.safeParse(data); attempt.zodPassed = validated.success;
    if (!validated.success) attempt.issues = validated.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  } catch (caught) { attempt.error = caught instanceof Error ? caught.message : '响应无法解析'; }
  return attempt;
};
afterAll(() => {
  flush();
  const unique = [...new Map(results.map((row) => [`${row.id}:${row.outputHash}`, row])).values()];
  writeFileSync(path.join(output, 'review-template.json'), JSON.stringify({ kind: 'dictionary', corpusHash, providerHash,
    model: modelLabel, reviewer: null, method: null,
    rubric: { adequacy: '0–4: contextual sense and part of speech', completeness: '0–4: required card content including pronunciation',
      fluency: '0–4: natural Chinese and bilingual example', ipa: 'correct / incorrect / missing / uncertain; expert review, never inferred from Zod' },
    reviews: unique.map((row) => ({ id: row.id, outputHash: row.outputHash, adequacy: null, completeness: null,
      fluency: null, critical: null, ipaUs: null, ipaUk: null, notes: null })),
  }, null, 2) + '\n');
});

describe('真实模型词卡质量：按句中用法校验结构、词性和基本释义', () => {
  for (let repetition = 1; repetition <= repetitions; repetition++) {
    describe(`第 ${repetition} 轮`, () => {
      test.each(corpus.cases)('$id · $title', async (testCase) => {
        let requests = 0; let card: WordCard | undefined; let error: string | undefined;
        const attempts: Attempt[] = [];
        const provider = new OpenAICompatibleProvider(settings, async (input, init) => {
          requests++;
          try {
            const response = await fetch(input, init);
            attempts.push(await summarizeResponse(response.clone()));
            return response;
          } catch (caught) {
            attempts.push({ jsonParsed: false, zodPassed: false, issues: [], error: caught instanceof Error ? caught.message : '请求失败' });
            throw caught;
          }
        }, pronunciation);
        const start = performance.now();
        try { card = await provider.lookup(testCase.word, testCase.context, new AbortController().signal); }
        catch (caught) { error = caught instanceof Error ? caught.message : '词卡调用失败'; }
        const errors: string[] = [];
        const review = ['US / UK IPA 的正确性、例句义项和翻译完整性仍须人工或专家逐项审阅'];
        if (error) errors.push(error);
        const zodPassed = WordCardSchema.safeParse(card).success;
        if (!zodPassed) errors.push('最终词卡未通过原有 WordCardSchema');
        if (card) {
          if (card.word.trim().toLowerCase() !== testCase.word.trim().toLowerCase()) errors.push('词卡单词与划词不一致');
          if (!card.senses.some((sense) => posPatterns[testCase.expectedPartOfSpeech].test(sense.partOfSpeech))) errors.push('未给出符合当前句子的词性');
          if (!new RegExp(testCase.meaningPattern, 'u').test(card.senses.map((sense) => sense.meaning).join(' '))) errors.push('释义未包含该语境义项的基本含义');
          if (!card.ipa.us.trim() || !card.ipa.uk.trim()) review.push('存在空音标：结构合法但发音内容不完整');
        }
        const assessment = { zodPassed, automaticPassed: errors.length === 0, errors, review };
        results.push({ id: testCase.id, title: testCase.title, repetition, card, attempts,
          outputHash: sha(JSON.stringify({ card: card ?? null, error: error ?? null })), elapsedMs: performance.now() - start,
          requests, assessment, error });
        flush();
        expect(errors, '仅结构与保守硬性规则；通过不代表 IPA、例句和完整语义准确').toEqual([]);
      });
    });
  }
});
