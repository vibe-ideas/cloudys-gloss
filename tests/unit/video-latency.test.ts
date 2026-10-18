import { afterEach, expect, it, vi } from 'vitest';
import { SubtitleScheduler, type SubtitleClient } from '../../src/video/scheduler';

afterEach(() => { vi.useRealTimers(); });

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
