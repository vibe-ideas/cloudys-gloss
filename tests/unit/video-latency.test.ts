import { afterEach, expect, it, vi } from 'vitest';
import { SubtitleScheduler, type SubtitleClient, type SubtitleLine } from '../../src/video/scheduler';

afterEach(() => { vi.useRealTimers(); });

for (const rate of [1, 2]) {
  it(`完整字幕预译 5 秒后以 ${rate} 倍速连续播放十分钟，每句开始时已有确认译文`, async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const timers = new Map<string, ReturnType<typeof setTimeout>[]>();
    const confirmed = new Set<string>();
    let line: SubtitleLine | undefined; let requests = 0; let misses = 0;
    const scheduler = new SubtitleScheduler({
      translate: (id, texts, item) => new Promise(resolve => {
        requests++;
        timers.set(id, texts.map((text, index) => setTimeout(() => {
          confirmed.add(text); item(index, `译文：${text}`, true);
          if (index === texts.length - 1) { timers.delete(id); resolve(texts.map(text => `译文：${text}`)); }
        }, 500 + 700 * (index + 1))));
      }),
      cancel: id => { timers.get(id)?.forEach(clearTimeout); timers.delete(id); },
    }, value => { line = value; });
    scheduler.setTrack(Array.from({ length: 200 }, (_, index) => ({ start: index * 3, end: (index + 1) * 3, text: `Sentence ${index}.` })));
    scheduler.tick(0, false, rate);
    await vi.advanceTimersByTimeAsync(5000);
    for (let index = 0; index < 200; index++) {
      scheduler.tick(index * 3, false, rate);
      if (!confirmed.has(`Sentence ${index}.`) || line?.translated !== `译文：Sentence ${index}.`) misses++;
      await vi.advanceTimersByTimeAsync(3000 / rate);
    }
    if (process.env.REPORT_VIDEO_LATENCY) console.info(JSON.stringify({ rate, startupMs: 5000, cues: 200, readyAtCueStart: 200 - misses, requests }));
    expect(misses).toBe(0);
    expect(requests).toBeLessThan(50);
    scheduler.destroy(); expect(timers.size).toBe(0);
  });
}

/** Fixed virtual clock: complete translations arrive after 500 ms + 700 ms/item.
 * This measures scheduler waste under overload, not a model's token speed. */
it('实时字幕每 700 毫秒换句且模型较慢时，保留正常请求并持续补齐历史而不反复取消', async () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const active = new Map<string, ReturnType<typeof setTimeout>[]>();
  const completed = new Set<string>();
  const calls: string[][] = [];
  let cancelled = 0;
  const client: SubtitleClient = {
    translate: (id, texts, item) => new Promise(resolve => {
      calls.push(texts);
      const timers = texts.map((text, index) => setTimeout(() => {
        completed.add(text); item(index, `译文：${text}`, true);
        if (index === texts.length - 1) { active.delete(id); resolve(texts.map(text => `译文：${text}`)); }
      }, 500 + 700 * (index + 1)));
      active.set(id, timers);
    }),
    cancel: id => { if (active.has(id)) { cancelled++; for (const timer of active.get(id)!) clearTimeout(timer); active.delete(id); } },
  };
  const scheduler = new SubtitleScheduler(client, () => {});
  for (let i = 0; i < 30; i++) {
    scheduler.setLive(`Sentence ${i}.`, i * .7);
    await vi.advanceTimersByTimeAsync(700);
  }
  const atPlaybackEnd = completed.size;
  await vi.advanceTimersByTimeAsync(5000);
  const metrics = { atPlaybackEnd, afterDrain: completed.size, requests: calls.length, cancelled, maxBatch: Math.max(...calls.map(call => call.length)) };
  if (process.env.REPORT_VIDEO_LATENCY) console.info(JSON.stringify(metrics));
  expect(atPlaybackEnd).toBeGreaterThanOrEqual(20);
  expect(completed.size).toBeGreaterThanOrEqual(25);
  expect(completed.has('Sentence 29.')).toBe(true);
  expect(cancelled).toBe(0);
  expect(metrics.maxBatch).toBeLessThanOrEqual(3);
  expect(calls.length).toBeLessThan(15);
  scheduler.destroy(); expect(active.size).toBe(0);
});
