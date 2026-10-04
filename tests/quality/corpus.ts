import { z } from 'zod';
import data from './cases.json';

export const CaseSchema = z.object({
  id: z.string(), title: z.string(), tags: z.array(z.string()),
  texts: z.array(z.string()).min(1), referenceZh: z.array(z.string()).min(1),
  requirements: z.array(z.string()).min(1),
  checks: z.array(z.object({
    id: z.string(), block: z.number().int().nonnegative(), description: z.string(),
    pattern: z.string(), kind: z.enum(['required', 'forbidden']), severity: z.enum(['error', 'review']),
  })),
}).superRefine((value, ctx) => {
  if (value.texts.length !== value.referenceZh.length) ctx.addIssue({ code: 'custom', message: '参考译文数量必须与原文一致' });
  for (const check of value.checks) {
    if (check.block >= value.texts.length) ctx.addIssue({ code: 'custom', message: '检查引用了不存在的语义块' });
    try { new RegExp(check.pattern, 'iu'); } catch { ctx.addIssue({ code: 'custom', message: '无效的检查表达式' }); }
  }
});
export function parseCorpus(data: unknown) {
  const parsed = z.object({ version: z.string(), cases: z.array(CaseSchema).min(1) }).parse(data);
  if (new Set(parsed.cases.map((item) => item.id)).size !== parsed.cases.length) throw new Error('质量用例 ID 必须唯一');
  return parsed;
}
export const corpus = parseCorpus(data);
export type QualityCase = z.infer<typeof CaseSchema>;

export function assess(testCase: QualityCase, translations: string[]) {
  const errors: string[] = []; const review: string[] = [];
  if (translations.length !== testCase.texts.length) errors.push('译文块数与原文不符');
  testCase.texts.forEach((_, index) => {
    if (!translations[index]?.trim()) errors.push(`第 ${index + 1} 块为空或缺失`);
    else if (!/[\u4e00-\u9fff]/u.test(translations[index]!)) errors.push(`第 ${index + 1} 块未包含中文`);
  });
  for (const check of testCase.checks) {
    const matches = new RegExp(check.pattern, 'iu').test(translations[check.block]?.normalize('NFKC') ?? '');
    if (matches !== (check.kind === 'required')) (check.severity === 'error' ? errors : review).push(`${check.id}: ${check.description}`);
  }
  return { errors, review, automaticPassed: errors.length === 0 };
}
