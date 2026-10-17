import { performance } from 'node:perf_hooks';
import { needsChineseTranslation } from '../../src/core/source-language.ts';
const cases = [
  ['中文技术段落', '使用Kubernetes部署PostgreSQL服务，并通过API查看运行状态。'.repeat(20)],
  ['英文段落', 'The quick brown fox jumps over the lazy dog. '.repeat(20)],
];
const results = cases.map(([name, text]) => {
  for (let i = 0; i < 100; i++) needsChineseTranslation(text);
  const samples = [];
  for (let i = 0; i < 1000; i++) {
    const start = performance.now(); needsChineseTranslation(text); samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return { name, characters: text.length, translate: needsChineseTranslation(text), iterations: samples.length,
    meanMs: samples.reduce((a, b) => a + b, 0) / samples.length, p95Ms: samples[950] };
});
process.stdout.write(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
  note: '仅测段落语言启发式，不含 DOM 扫描、网络或模型推理。', results }, null, 2) + '\n');
