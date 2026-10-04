import { z } from 'zod';

export const SettingsSchema = z.object({
  baseUrl: z.string().url().refine((value) => {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
  }, '请输入不含凭据、查询参数的 HTTP(S) Base URL'),
  apiKey: z.string().max(4096).default(''),
  model: z.string().trim().min(1).max(200),
  temperature: z.number().min(0).max(2).default(0.2),
  timeout: z.number().int().min(1000).max(300000).default(60000),
  concurrency: z.number().int().min(1).max(8).default(2),
  theme: z.enum(['system', 'light', 'dark']).default('system'),
});
export type Settings = z.infer<typeof SettingsSchema>;
export const defaults: Settings = SettingsSchema.parse({
  baseUrl: 'http://127.0.0.1:8080/v1',
  model: 'mlx-community/Qwen2.5-3B-Instruct-4bit',
  temperature: 0,
  timeout: 120000,
  concurrency: 1,
});

export const WordCardSchema = z.object({
  word: z.string().min(1).max(200),
  ipa: z.object({ us: z.string().max(200), uk: z.string().max(200) }),
  senses: z.array(z.object({ partOfSpeech: z.string().min(1).max(80), meaning: z.string().min(1).max(1000) })).min(1).max(12),
  contextMeaning: z.string().min(1).max(2000),
  examples: z.array(z.object({ en: z.string().min(1).max(2000), zh: z.string().min(1).max(2000) })).min(1).max(4),
});
export type WordCard = z.infer<typeof WordCardSchema>;
export const TranslationSchema = z.object({ translations: z.array(z.string().min(1).max(20000)).min(1).max(16) });

const requestId = z.string().min(1).max(100);
export const RequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('translate'), id: requestId, texts: z.array(z.string().min(1).max(12000)).min(1).max(16) }),
  z.object({ type: z.literal('dictionary'), id: requestId, word: z.string().min(1).max(200), context: z.string().max(3000) }),
  z.object({ type: z.literal('cancel'), id: requestId }),
  z.object({ type: z.literal('preferences') }),
  z.object({ type: z.literal('settings:get') }),
  z.object({ type: z.literal('settings:open') }),
  z.object({ type: z.literal('settings:save'), settings: SettingsSchema }),
  z.object({ type: z.literal('connection:test'), id: requestId, settings: SettingsSchema }),
  z.object({ type: z.literal('cache:clear') }),
]);
export type Request = z.infer<typeof RequestSchema>;
export type Response<T> = { ok: true; data: T } | { ok: false; error: string };
