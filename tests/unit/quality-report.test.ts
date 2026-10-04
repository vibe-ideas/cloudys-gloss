import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const report = path.resolve('tests/quality/report.py');
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const directories: string[] = [];
afterEach(() => { directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })); });
function fixture(caseCount = 1, repetitions = 1) {
  const directory = mkdtempSync(path.join(tmpdir(), 'gloss-quality-')); directories.push(directory);
  mkdirSync(path.join(directory, 'tests/quality'), { recursive: true });
  const caseItems = Array.from({ length: caseCount }, (_, index) => ({ id: `T${String(index + 1).padStart(2, '0')}`,
    title: '翻译问候', texts: ['Hello'], referenceZh: ['你好'], requirements: ['表达问候'] }));
  const cases = JSON.stringify({ version: 'test', cases: caseItems });
  writeFileSync(path.join(directory, 'tests/quality/cases.json'), cases);
  const metadata = { model: 'candidate', providerHash: 'provider-version', corpusHash: hash(cases), repetitions };
  function save(name: string, reviewed: boolean, critical = false, options: { providerHash?: string; failedCases?: string[]; unreviewedCases?: string[]; criticalCases?: string[] } = {}) {
    const run = path.join(directory, name); mkdirSync(run);
    const runMetadata = { ...metadata, providerHash: options.providerHash ?? metadata.providerHash };
    const rows = caseItems.flatMap((item) => Array.from({ length: repetitions }, (_, index) => {
      const failed = options.failedCases?.includes(item.id) && index === repetitions - 1;
      const translations = [failed ? '再见' : '你好'];
      return { id: item.id, repetition: index + 1, translations, elapsedMs: 100,
        outputHash: hash(JSON.stringify({ translations, error: null })), assessment: { automaticPassed: true, errors: [], review: [] } };
    }));
    const unique = [...new Map(rows.map((row) => [`${row.id}:${row.outputHash}`, row])).values()];
    writeFileSync(path.join(run, 'metadata.json'), JSON.stringify(runMetadata));
    writeFileSync(path.join(run, 'results.json'), JSON.stringify(rows));
    if (reviewed) writeFileSync(path.join(run, 'reviews.json'), JSON.stringify({ ...runMetadata, reviewer: 'test reviewer', method: 'fixture',
      reviews: unique.filter((row) => !options.unreviewedCases?.includes(row.id)).map((row) => ({ id: row.id, outputHash: row.outputHash,
        adequacy: row.translations[0] === '再见' ? 2 : 4, completeness: 4, fluency: 4, critical: critical || options.criticalCases?.includes(row.id) === true, notes: '测试审阅记录' })) }));
    return run;
  }
  const run = (...args: string[]) => spawnSync('python3', [report, ...args, '--output', path.join(directory, 'comparison.md')], { cwd: directory, encoding: 'utf8' });
  return { directory, save, run };
}
describe('模型切换质量门槛', () => {
  it('候选仅通过自动检查但尚未审阅时，不允许标记为质量合格', () => {
    const f = fixture(); const result = f.run(f.save('candidate', false));
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).summary[0].acceptedCases).toBe(0);
  });
  it('候选全部完成审阅且没有质量问题时通过发布门槛', () => {
    const f = fixture(); expect(f.run(f.save('candidate', true), '--gate').status).toBe(0);
  });
  it('修改已经评分的译文后，旧审阅记录不能继续生效', () => {
    const f = fixture(); const directory = f.save('candidate', true);
    const filename = path.join(directory, 'results.json');
    const rows = JSON.parse(readFileSync(filename, 'utf8')); rows[0].translations = ['再见']; writeFileSync(filename, JSON.stringify(rows));
    const result = f.run(directory);
    expect(result.status).not.toBe(0); expect(result.stderr).toContain('hash mismatch');
  });
  it('候选在旧模型已通过的用例出现严重错误时报告回归并失败', () => {
    const f = fixture(); const baseline = f.save('baseline', true); const candidate = f.save('candidate', true, true);
    const result = f.run(candidate, '--baseline', baseline);
    expect(result.status).toBe(1); expect(JSON.parse(result.stdout).regressions).toEqual(['candidate: T01']);
  });
  it('模型只跑完部分轮次时拒绝生成完整比较结论', () => {
    const f = fixture(); const directory = f.save('candidate', true);
    writeFileSync(path.join(directory, 'results.json'), '[]');
    const result = f.run(directory);
    expect(result.status).not.toBe(0); expect(result.stderr).toContain('incomplete or duplicate');
  });
});


describe('提示词调优的比较与比例门槛', () => {
  it('比较不同翻译管线时，默认拒绝将变化呈现为单纯模型差异', () => {
    const f = fixture(); const original = f.save('original', true);
    const candidate = f.save('candidate', true, false, { providerHash: 'new-prompt' });
    const result = f.run(original, candidate);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('--allow-provider-change');
    expect(f.run(candidate, '--baseline', original).status).not.toBe(0);
  });
  it('显式允许比较不同管线时，报告标明提示词变化并保留各版本哈希', () => {
    const f = fixture(); const original = f.save('original', true);
    const candidate = f.save('candidate', true, false, { providerHash: 'new-prompt' });
    const result = f.run(original, candidate, '--allow-provider-change');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).pipelineChanged).toBe(true);
    const reportText = readFileSync(path.join(f.directory, 'comparison.md'), 'utf8');
    expect(reportText).toContain('翻译管线/提示词变化');
    expect(reportText).toContain('不能归因为模型本身');
    expect(reportText).toContain('provider-version');
    expect(reportText).toContain('new-prompt');
    expect(f.run(candidate, '--baseline', original, '--allow-provider-change', '--gate').status).toBe(0);
  });
  it('十个用例中九个在所有轮次合格时，通过 90% 门槛但不能通过全量门槛', () => {
    const f = fixture(10, 2); const candidate = f.save('candidate', true, false, { failedCases: ['T10'] });
    const result = f.run(candidate, '--min-pass-rate', '0.9');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).summary[0]).toMatchObject({ acceptedCases: 9, cases: 10, acceptedRate: 0.9, samples: 20 });
    expect(f.run(candidate, '--min-pass-rate', '0.9', '--gate').status).toBe(1);
  });
  it('请求通过率达到 90% 但仅八成用例每轮均合格时，仍不通过 90% 门槛', () => {
    const f = fixture(10, 2); const candidate = f.save('candidate', true, false, { failedCases: ['T09', 'T10'] });
    const result = f.run(candidate, '--min-pass-rate', '0.9');
    expect(result.status).toBe(1);
    const output = JSON.parse(result.stdout);
    expect(output.summary[0]).toMatchObject({ acceptedCases: 8, cases: 10, acceptedRate: 0.8, reviewed: 20 });
    expect(output.gateFailures[0]).toContain('80.0%');
  });
  it('启用零严重错误要求后，即使比例门槛允许失败也必须阻断严重错译', () => {
    const f = fixture(10); const candidate = f.save('candidate', true, false, { criticalCases: ['T10'] });
    expect(f.run(candidate, '--min-pass-rate', '0.9').status).toBe(0);
    const result = f.run(candidate, '--min-pass-rate', '0.9', '--no-critical');
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).gateFailures[0]).toContain('critical errors');
  });
  it('九成用例已合格但剩余用例尚未审阅时，不能通过 90% 门槛', () => {
    const f = fixture(10); const candidate = f.save('candidate', true, false, { unreviewedCases: ['T10'] });
    const result = f.run(candidate, '--min-pass-rate', '0.9');
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).summary[0]).toMatchObject({ acceptedRate: 0.9, reviewed: 9 });
  });
  it.each(['-0.1', '1.1', 'NaN', 'Infinity', 'ninety'])('比例门槛为无效值 %s 时拒绝运行', (rate) => {
    const f = fixture(); const result = f.run(f.save('candidate', true), '--min-pass-rate', rate);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('between 0 and 1');
  });
});


describe('正式验收的最少重复轮次', () => {
  it('历史单轮结果默认可比较，但显式要求两轮时即使全部合格也不能通过', () => {
    const f = fixture(); const candidate = f.save('candidate', true);
    expect(f.run(candidate, '--min-pass-rate', '0.9', '--no-critical').status).toBe(0);
    const result = f.run(candidate, '--min-pass-rate', '0.9', '--no-critical', '--min-repetitions', '2');
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).summary[0]).toMatchObject({ repetitions: 1, acceptedRate: 1 });
    expect(JSON.parse(result.stdout).gateFailures).toEqual(['candidate: 1 repetitions is below required minimum 2']);
  });
  it('候选每个用例均完成两轮且均合格时，可以通过两轮、九成和无严重错误的联合门槛', () => {
    const f = fixture(2, 2); const result = f.run(f.save('candidate', true), '--min-repetitions', '2', '--min-pass-rate', '0.9', '--no-critical');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).summary[0]).toMatchObject({ repetitions: 2, samples: 4, acceptedCases: 2 });
  });
  it('候选声明两轮但缺少某用例的第二轮时，不得靠元数据满足轮次门槛', () => {
    const f = fixture(2, 2); const candidate = f.save('candidate', true);
    const filename = path.join(candidate, 'results.json');
    const rows = JSON.parse(readFileSync(filename, 'utf8')); rows.pop(); writeFileSync(filename, JSON.stringify(rows));
    const result = f.run(candidate, '--min-repetitions', '2');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('incomplete or duplicate');
  });
  it('两轮候选对照单轮历史基线时，最少轮次只约束候选且仍检查基线回归', () => {
    const historical = fixture(); const baseline = historical.save('baseline', true);
    const f = fixture(1, 2); const candidate = f.save('candidate', true);
    expect(f.run(candidate, '--baseline', baseline, '--min-repetitions', '2', '--gate').status).toBe(0);
    const regressed = f.save('regressed', true, false, { failedCases: ['T01'] });
    const result = f.run(regressed, '--baseline', baseline, '--min-repetitions', '2');
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).regressions).toEqual(['candidate: T01']);
  });
  it.each(['0', '-1', '1.5', 'two'])('最少轮次设为无效值 %s 时拒绝执行', (minimum) => {
    const f = fixture(); const result = f.run(f.save('candidate', true), '--min-repetitions', minimum);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('positive integer');
  });
  it('元数据把轮次写为布尔值时，不能将 true 当作一轮结果接受', () => {
    const f = fixture(); const candidate = f.save('candidate', true);
    const filename = path.join(candidate, 'metadata.json');
    const metadata = JSON.parse(readFileSync(filename, 'utf8')); metadata.repetitions = true; writeFileSync(filename, JSON.stringify(metadata));
    const result = f.run(candidate);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('repetitions must be a positive integer');
  });
});
