import { defineConfig } from 'vitest/config';
export default defineConfig({ test: {
  include: ['tests/quality/live.test.ts'], environment: 'node',
  fileParallelism: false, maxWorkers: 1, testTimeout: 125000, hookTimeout: 30000,
} });
