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
function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'gloss-quality-')); directories.push(directory);
  mkdirSync(path.join(directory, 'tests/quality'), { recursive: true });
  const cases = JSON.stringify({ version: 'test', cases: [{ id: 'T01', title: '翻译问候', texts: ['Hello'], referenceZh: ['你好'], requirements: ['表达问候'] }] });
  writeFileSync(path.join(directory, 'tests/quality/cases.json'), cases);
  const metadata = { model: 'candidate', providerHash: 'provider-version', corpusHash: hash(cases), repetitions: 1 };
  const result = { id: 'T01', repetition: 1, translations: ['你好'], elapsedMs: 100,
    outputHash: hash(JSON.stringify({ translations: ['你好'], error: null })), assessment: { automaticPassed: true, errors: [], review: [] } };
  function save(name: string, reviewed: boolean, critical = false) {
    const run = path.join(directory, name); mkdirSync(run);
    writeFileSync(path.join(run, 'metadata.json'), JSON.stringify(metadata));
    writeFileSync(path.join(run, 'results.json'), JSON.stringify([result]));
    if (reviewed) writeFileSync(path.join(run, 'reviews.json'), JSON.stringify({ ...metadata, reviewer: 'test reviewer', method: 'fixture',
      reviews: [{ id: result.id, outputHash: result.outputHash, adequacy: 4, completeness: 4, fluency: 4, critical, notes: '测试审阅记录' }] }));
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
