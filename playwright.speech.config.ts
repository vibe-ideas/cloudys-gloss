import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/live', testMatch: 'native-speech.spec.ts', timeout: 60000,
  expect: { timeout: 15000 }, workers: 1, reporter: 'list',
  outputDir: 'artifacts/speech', projects: [{ name: 'firefox' }],
});
