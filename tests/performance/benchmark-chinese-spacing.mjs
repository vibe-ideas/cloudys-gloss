import { performance } from 'node:perf_hooks';
import { chineseSpacing } from '../../src/core/chinese-spacing.ts';

const cases = [
  ['800 字符技术段落', '使用React构建API，支持3种模式。'.repeat(40)],
  ['8000 字符含中文路径的地址', '访问https://example.com/中文API?q=版本2，使用API。'.repeat(200)],
  ['接近消息上限的连续反引号', '`'.repeat(19990) + '中A'],
];
const iterations = 1000;
const results = cases.map(([name, input]) => {
  for (let i = 0; i < 100; i++) chineseSpacing(input);
  const samples = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now(); chineseSpacing(input); samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return { name, characters: input.length, iterations,
    meanMs: samples.reduce((a, b) => a + b, 0) / iterations,
    p95Ms: samples[Math.floor(iterations * 0.95)] };
});
process.stdout.write(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
  note: '本地纯文本格式处理耗时，不包含网络、模型推理或 DOM 排版；不是 CI 性能门槛。', results }, null, 2) + '\n');
