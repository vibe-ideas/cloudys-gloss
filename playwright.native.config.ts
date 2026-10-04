import { defineConfig } from '@playwright/test';
export default defineConfig({
  metadata: { nativeHost: true },
  testDir: './tests/live', testMatch: 'native-service.spec.ts', timeout: 240000, expect: { timeout: 125000 }, workers: 1,
  reporter: 'list', outputDir: 'artifacts/native', projects: [{ name: 'chromium' }, { name: 'firefox' }],
});
