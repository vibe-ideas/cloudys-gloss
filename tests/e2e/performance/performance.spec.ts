import { test, expect } from '../support/fixtures';
import { writeFile } from 'node:fs/promises';

type Timing = {
  started: number; firstBodyMs: number; jumpStartedMs: number; maxFrameGapMs: number; frames: number; running: boolean;
  frameGaps: { atMs: number; durationMs: number }[];
  longTasks?: { atMs: number; durationMs: number }[];
  taskObserver?: PerformanceObserver;
};
type TimingWindow = Window & { uxTiming: Timing };

test('密集导航与 2000 张正文卡片共存时，首屏正文及时出现，滚到末尾仍增量翻译且关闭完全恢复', async ({ extension }, testInfo) => {
  const { page, server, toggle } = extension;
  await page.goto(`${server.url}/component-performance`);
  const original = await page.locator('body').evaluate(node => [...node.children].filter(child => !child.hasAttribute('data-cloudys-gloss')).map(child => child.outerHTML).join(''));
  server.setDelay(25);
  const trace = process.env.PERF_TRACE === '1' && testInfo.project.name === 'chromium' ? await page.context().newCDPSession(page) : undefined;
  if (trace) {
    await trace.send('Tracing.start', { categories: 'devtools.timeline,v8,disabled-by-default-devtools.timeline', transferMode: 'ReturnAsStream' });
    await trace.send('Profiler.enable'); await trace.send('Profiler.start');
  }
  await page.evaluate(() => {
    const state: Timing = { started: performance.now(), firstBodyMs: 0, jumpStartedMs: 0, maxFrameGapMs: 0, frames: 0, running: true, frameGaps: [] };
    (window as unknown as TimingWindow).uxTiming = state;
    // Long Tasks is not available in every browser. Keep rAF samples for both,
    // and distinguish browser rendering stalls from reported JS long tasks.
    if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
      state.longTasks = [];
      state.taskObserver = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) state.longTasks!.push({ atMs: entry.startTime - state.started, durationMs: entry.duration });
      });
      state.taskObserver.observe({ type: 'longtask' });
    }
    let previous = state.started;
    const frame = (now: number) => {
      if (now - previous >= 50) state.frameGaps.push({ atMs: previous - state.started, durationMs: now - previous });
      state.maxFrameGapMs = Math.max(state.maxFrameGapMs, now - previous); previous = now; state.frames++;
      if (state.running) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    const observer = new MutationObserver(() => {
      if (document.querySelector('#perf-copy-0 [data-state="done"],#perf-copy-0 [data-state="partial"]')) {
        state.firstBodyMs = performance.now() - state.started; observer.disconnect();
      }
    });
    observer.observe(document.querySelector('#perf-copy-0')!, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-state'] });
  });
  await toggle();
  // Locator assertions collect a full-page ARIA failure snapshot while waiting
  // (Playwright 1.63), which overwhelms the timing on a 6,000-block document.
  // Wait for the exact same content in-page; keep all behavioral assertions.
  await page.waitForFunction(() => document.querySelector('#perf-copy-0 [data-state="done"]')?.textContent?.includes('Reading 0.'));
  const firstCalls = server.calls.flatMap(call => call.texts ?? []);
  const firstBody = firstCalls.findIndex(text => text.startsWith('Reading 0.'));
  expect(firstBody).toBeGreaterThanOrEqual(0);
  expect(firstBody).toBeLessThan(12);
  expect(await page.locator('#perf-copy-1999 [data-cloudys-gloss]').count()).toBe(0);
  const beforeJump = await page.locator('[data-cloudys-gloss="pending"]').count();
  expect(beforeJump).toBeLessThan(100);
  await page.evaluate(() => { const state = (window as unknown as TimingWindow).uxTiming; state.jumpStartedMs = performance.now() - state.started; });
  await page.locator('#perf-copy-1999').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector('#perf-copy-1999 [data-state="done"]')?.textContent?.includes('Reading 1999.'));
  // Work should stay bounded by the two visited viewports, not 6,000+ labels.
  expect(server.calls.flatMap(call => call.texts ?? []).length).toBeLessThan(120);
  const timing = await page.evaluate(() => {
    const value = (window as unknown as TimingWindow).uxTiming;
    value.running = false;
    value.taskObserver?.disconnect();
    return { firstBodyMs: value.firstBodyMs, jumpStartedMs: value.jumpStartedMs, maxFrameGapMs: value.maxFrameGapMs, frames: value.frames, frameGaps: value.frameGaps, longTasks: value.longTasks };
  });
  expect(timing.firstBodyMs).toBeGreaterThan(0);
  const report = testInfo.outputPath('component-performance.json');
  await writeFile(report, JSON.stringify({ ...timing, browser: testInfo.project.name, browserVersion: page.context().browser()?.version(), model: 'deterministic local fixture', responseDelayMs: 25, cards: 2000, requests: server.calls.length, requestedBlocks: server.calls.flatMap(call => call.texts ?? []).length }, null, 2));
  await testInfo.attach('component-performance.json', { contentType: 'application/json', path: report });
  if (trace) {
    const cpu = await trace.send('Profiler.stop');
    await writeFile(testInfo.outputPath('browser-cpu.json'), JSON.stringify(cpu.profile));
    const finished = new Promise<string>(resolve => trace.once('Tracing.tracingComplete', event => resolve(event.stream!)));
    await trace.send('Tracing.end');
    const stream = await finished; let contents = '';
    while (true) {
      const chunk = await trace.send('IO.read', { handle: stream });
      contents += chunk.base64Encoded ? Buffer.from(chunk.data, 'base64').toString('utf8') : chunk.data;
      if (chunk.eof) break;
    }
    await trace.send('IO.close', { handle: stream });
    await writeFile(testInfo.outputPath('browser-timeline.json'), contents);
    await trace.detach();
  }
  await toggle();
  await expect(page.locator('main [data-cloudys-gloss],header [data-cloudys-gloss]')).toHaveCount(0);
  expect(await page.locator('body').evaluate(node => [...node.children].filter(child => !child.hasAttribute('data-cloudys-gloss')).map(child => child.outerHTML).join(''))).toBe(original);
});
