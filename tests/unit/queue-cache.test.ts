import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { ConcurrencyQueue } from '../../src/queue';
import { ResultCache } from '../../src/cache';
describe('后台并发与本地缓存', () => {
  it('并发限制为 1 时等待中的请求不会提前执行且可以取消', async () => {
    const queue = new ConcurrencyQueue(1); const controller = new AbortController();
    let finish!: () => void;
    const first = queue.run(() => new Promise<void>((resolve) => { finish = resolve; }), new AbortController().signal);
    const task = vi.fn(async () => 2); const second = queue.run(task, controller.signal);
    const rejected = expect(second).rejects.toThrow('cancelled');
    await Promise.resolve(); controller.abort(new Error('cancelled')); await rejected;
    expect(task).not.toHaveBeenCalled(); finish(); await first;
  });
  it('缓存超过容量时淘汰旧结果，并能一键清空', async () => {
    const cache = new ResultCache(crypto.randomUUID(), 2);
    await cache.set('a', '甲'); await cache.set('b', '乙'); await cache.set('c', '丙');
    expect(await cache.get('a')).toBeUndefined(); expect(await cache.get('c')).toBe('丙');
    await cache.clear(); expect(await cache.get('c')).toBeUndefined();
  });
  it('缓存过期后不会返回旧译文', async () => {
    const cache = new ResultCache(crypto.randomUUID(), 2, -1);
    await cache.set('a', '甲'); expect(await cache.get('a')).toBeUndefined();
  });
});
