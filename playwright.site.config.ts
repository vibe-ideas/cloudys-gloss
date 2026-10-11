import { existsSync } from 'node:fs';
import { defineConfig, firefox } from '@playwright/test';
export default defineConfig({
  testDir: './tests/site', timeout: 30000, expect: { timeout: 10000 }, workers: 1,
  reporter: 'list', use: { baseURL: 'http://127.0.0.1:4319' },
  webServer: { command: 'python3 -m http.server 4319 --bind 127.0.0.1 --directory site', url: 'http://127.0.0.1:4319', reuseExistingServer: false },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }, { name: 'firefox', use: { browserName: 'firefox', channel: 'moz-firefox', launchOptions: { executablePath: process.env.FIREFOX_BINARY ?? (existsSync('/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox') ? '/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox' : firefox.executablePath()) } } }],
});
