import { afterAll, describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { OpenAICompatibleProvider } from '../../src/provider';
import { SettingsSchema } from '../../src/schema';

if (!process.env.MODEL_BASE_URL || !process.env.MODEL_NAME || !process.env.QUALITY_OUTPUT) throw new Error('输入框真实评测需要 MODEL_BASE_URL、MODEL_NAME、QUALITY_OUTPUT');
const source = readFileSync('tests/quality/input-translation-cases.json', 'utf8');
const cases = z.array(z.object({ id: z.string(), title: z.string(), text: z.string(), patterns: z.array(z.string()) })).parse(JSON.parse(source));
const settings = SettingsSchema.parse({ baseUrl: process.env.MODEL_BASE_URL, model: process.env.MODEL_NAME, apiKey: process.env.MODEL_API_KEY ?? '', temperature: 0, timeout: 120000 });
const output = path.join(process.env.QUALITY_OUTPUT, 'input-translation.json');
if (existsSync(output)) throw new Error('结果已存在，请使用新 QUALITY_OUTPUT');
mkdirSync(path.dirname(output), { recursive: true });
const rows: { id: string; title: string; source: string; translation?: string; elapsedMs: number; error?: string }[] = [];
afterAll(() => writeFileSync(output, JSON.stringify({ date: new Date().toISOString(), model: settings.model, temperature: 0,
  corpusHash: createHash('sha256').update(source).digest('hex'), providerHash: createHash('sha256').update(readFileSync('src/provider.ts')).digest('hex'),
  method: 'OpenAICompatibleProvider.translateInput; no persistent result cache; lexical guards are not a semantic accuracy score.', rows }, null, 2) + '\n'));
describe('真实模型将输入草稿翻译为英文', () => {
  test.each(cases)('$title', async item => {
    const start = performance.now();
    let translation: string | undefined; let error: string | undefined;
    try { translation = await new OpenAICompatibleProvider(settings).translateInput(item.text, new AbortController().signal); }
    catch (caught) { error = caught instanceof Error ? caught.message : '调用失败'; }
    rows.push({ id: item.id, title: item.title, source: item.text, translation, elapsedMs: performance.now() - start, error });
    expect(error).toBeUndefined();
    for (const pattern of item.patterns) expect(translation).toMatch(new RegExp(pattern, 'i'));
  });
});
