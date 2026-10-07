import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/live', testMatch: 'dictionary-import.spec.ts', timeout: 120000,
  expect: { timeout: 60000 }, workers: 1, reporter: [['list'], ['html', { open: 'never' }]],
  projects: [{ name: 'chromium' }, { name: 'firefox' }],
});
