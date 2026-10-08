import { defineConfig } from 'vitest/config';
export default defineConfig({ test: {
  include: ['tests/unit/**/*.test.ts'], environment: 'happy-dom',
  // Several suites spawn Python. Bound parallel workers to avoid process-start
  // contention on desktop Macs without weakening individual test timeouts.
  maxWorkers: 1,
  // In-page UI derives its theme from tokens.css?raw; Vitest blanks CSS unless included.
  css: { include: [/src\/styles\/tokens\.css/] },
} });
