import { chromium, firefox } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { componentPerformanceFixture } from '../e2e/performance-fixture.ts';

// Diagnostic control for performance.spec.ts: same card markup and viewport,
// with no extension or model requests. Run independently of other test jobs.
const results = [];
for (const name of ['chromium', 'firefox'] as const) {
  for (let sample = 1; sample <= 3; sample++) {
    const browser = name === 'chromium'
      ? await chromium.launch({ channel: 'chromium', headless: true })
      : await firefox.launch({ channel: 'moz-firefox', headless: true,
        executablePath: process.env.FIREFOX_BINARY ?? (existsSync('/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox') ? '/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox' : firefox.executablePath()) });
    try {
      const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
      await page.setContent(componentPerformanceFixture);
      const timing = await page.evaluate(() => new Promise<{ maxFrameGapMs: number; frames: number }>(resolve => {
        const started = performance.now(); let previous = started; let maximum = 0; let frames = 0;
        const frame = (now: number) => {
          maximum = Math.max(maximum, now - previous); previous = now; frames++;
          if (now - started < 2500) requestAnimationFrame(frame);
          else resolve({ maxFrameGapMs: maximum, frames });
        };
        requestAnimationFrame(frame);
        setTimeout(() => document.querySelector('#perf-copy-1999')?.scrollIntoView(), 600);
      }));
      results.push({ browser: name, browserVersion: browser.version(), sample, cards: 2000, extension: false, ...timing });
    } finally { await browser.close(); }
  }
}
await mkdir('artifacts/components-frame-control', { recursive: true });
await writeFile('artifacts/components-frame-control/results.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
