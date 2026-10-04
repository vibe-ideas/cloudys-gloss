import { defineConfig } from '@playwright/test';
if (!process.env.MODEL_BASE_URL || !process.env.MODEL_NAME) throw new Error('请设置 MODEL_BASE_URL 和 MODEL_NAME；可选 MODEL_API_KEY。此测试会调用真实模型。');
export default defineConfig({
  testDir: './scripts', testMatch: 'live.spec.ts', timeout: 180000, expect: { timeout: 125000 }, workers: 1,
  reporter: 'list', outputDir: 'artifacts/live', projects: [{ name: 'chromium' }, { name: 'firefox' }],
});
