import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/performance', testMatch: 'image-benchmark.spec.ts', timeout: 240000,
  expect: { timeout: 10000 }, workers: 1, reporter: [['list']],
  projects: [{ name: 'chromium' }, { name: 'firefox' }],
});
