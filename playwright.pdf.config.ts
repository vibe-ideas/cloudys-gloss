import { defineConfig } from '@playwright/test';
// Explicit online smoke: CI uses the generated, deterministic PDF fixtures.
export default defineConfig({
  testDir: './tests/online', timeout: 60000, expect: { timeout: 30000 }, workers: 1,
  reporter: 'list', outputDir: 'artifacts/public-pdf-review',
  projects: [{ name: 'chromium' }, { name: 'firefox' }],
});
