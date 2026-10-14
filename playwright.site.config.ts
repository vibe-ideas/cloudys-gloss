import { existsSync } from 'node:fs';
import { defineConfig, firefox } from '@playwright/test';

const firefoxBinary = process.env.FIREFOX_BINARY ?? (existsSync('/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox')
  ? '/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox'
  : firefox.executablePath());

export default defineConfig({
  testDir: './tests/site',
  outputDir: './test-results/site',
  timeout: 30000,
  expect: { timeout: 10000 },
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4319' },
  webServer: {
    command: 'python3 -m http.server 4319 --bind 127.0.0.1 --directory site',
    url: 'http://127.0.0.1:4319',
    reuseExistingServer: false,
  },
  projects: [
    { name: 'chromium', testIgnore: '**/reduced-motion.spec.ts', use: { browserName: 'chromium', reducedMotion: 'no-preference' } },
    {
      name: 'firefox', testIgnore: '**/reduced-motion.spec.ts',
      use: { browserName: 'firefox', channel: 'moz-firefox', launchOptions: { executablePath: firefoxBinary, firefoxUserPrefs: { 'ui.prefersReducedMotion': 0 } } },
    },
    { name: 'chromium-reduced-motion', testMatch: '**/reduced-motion.spec.ts', use: { browserName: 'chromium', reducedMotion: 'reduce' } },
    {
      name: 'firefox-reduced-motion', testMatch: '**/reduced-motion.spec.ts',
      // Native Firefox BiDi does not apply Playwright's reduced-motion emulation;
      // use the real Firefox preference in the isolated test profile instead.
      use: { browserName: 'firefox', channel: 'moz-firefox', launchOptions: { executablePath: firefoxBinary, firefoxUserPrefs: { 'ui.prefersReducedMotion': 1 } } },
    },
  ],
});
