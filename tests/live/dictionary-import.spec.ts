import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { test, expect } from '../e2e/support/fixtures';

// Download/hash-check the public snapshot with prepare-goldendict-research.py first.
// The live suite is deliberately excluded from normal CI and never requires user dictionaries.
test('真实 FreeDict 的 26660 条 StarDict 记录完成导入，重开设置仍能查到中文释义', async ({ extension }, testInfo) => {
  const root = 'artifacts/goldendict-research-2026-10-07';
  const archive = await readFile(`${root}/freedict-eng-zho.stardict.tar.xz`);
  expect(createHash('sha512').update(archive).digest('hex')).toBe('059f9aca26fdc3a5a2c0c0e8fc92e111a34bf8fd438f70d267cccf35f5e47a2d45c46650999a1b3a48c3bffc3e16e0db897232128fe822d1bc59cf34f40b395c');
  const extracted = JSON.parse(execFileSync('python3', ['-c',
    'import tarfile,json,base64,sys; t=tarfile.open(sys.argv[1]); print(json.dumps([{ "name": n, "base64": base64.b64encode(t.extractfile("eng-zho/"+n).read()).decode() } for n in ["eng-zho.ifo","eng-zho.idx.gz","eng-zho.dict"]]))',
    `${root}/freedict-eng-zho.stardict.tar.xz`], { maxBuffer: 20 * 1024 * 1024, encoding: 'utf8' })) as { name: string; base64: string }[];
  const files = extracted.map(file => ({ name: file.name, buffer: Buffer.from(file.base64, 'base64') }));
  const corpus = JSON.parse(await readFile('tests/performance/dictionary-tech-corpus.json', 'utf8')) as Record<string, string[]>;
  const { options } = extension;
  const start = Date.now(); await options.dictionaryFiles(files); await options.click('导入词库');
  await expect.poll(() => options.dictionaryText('status')).toContain('已导入');
  const importObservedMs = Date.now() - start;
  expect(await options.dictionaryText('status')).toContain('26,660');
  await options.reload(); await expect.poll(() => options.dictionaryText('list')).toContain('FreeDict');
  await options.fill('dictionaryQuery', 'algorithm'); await options.click('查询本地词库');
  await expect.poll(() => options.dictionaryText('results')).toContain('算法');
  const rounds = [];
  for (let i = 0; i < 3; i++) rounds.push(await options.dictionaryBenchmark(Object.values(corpus).flat()));
  for (const rows of rounds) expect(rows.filter(row => row.hits).length).toBe(34);
  const output = testInfo.outputPath('real-dictionary-performance.json');
  await writeFile(output, JSON.stringify({ browser: testInfo.project.name, records: 26660, importObservedMs, rounds,
    method: 'Real extension; synthetic isolated browser profile. Import includes test file injection, staging, parsing, IndexedDB writes and polling observation. Firefox injection includes base64 test bridge overhead. Three fixed 101-word rounds: runtime messaging + indexed lookup, excludes rendering; browser caches not cleared. Not desktop GoldenDict or heap/RSS.' }, null, 2) + '\n');
  await testInfo.attach('real-dictionary-performance.json', { path: output, contentType: 'application/json' });
});
