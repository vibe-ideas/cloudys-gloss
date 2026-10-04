import { defineConfig } from 'vitest/config';
export default defineConfig({ test: {
  include: ['tests/unit/**/*.test.ts'], environment: 'happy-dom',
  // Several suites spawn Python. Bound parallel workers to avoid process-start
  // contention on desktop Macs without weakening individual test timeouts.
  maxWorkers: 4,
} });
