import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { ConcurrencyQueue } from '../../src/core/queue';
import { ResultCache } from '../../src/core/cache';
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
  it('已有推理不中断，随后先处理主动操作、可见正文、预取，同级操作按到达顺序执行', async () => {
    const queue = new ConcurrencyQueue(1); const signal = new AbortController().signal;
    let finish!: () => void; const order: string[] = [];
    const active = queue.run(() => new Promise<void>(resolve => { finish = resolve; }), signal, 'prefetch');
    const submit = (name: string, priority: 'interactive' | 'visible' | 'prefetch' | boolean) => queue.run(async () => { order.push(name); }, signal, priority);
    const work = [submit('预取', 'prefetch'), submit('可见正文', 'visible'), submit('重翻一', 'interactive'), submit('重翻二', true)];
    await Promise.resolve(); expect(order).toEqual([]); finish(); await Promise.all([active, ...work]);
    expect(order).toEqual(['重翻一', '重翻二', '可见正文', '预取']);
  });
  it('持续收到主动操作时，等待最久的预取最多被越过八次，仍可完成', async () => {
    const queue = new ConcurrencyQueue(1); const signal = new AbortController().signal;
    let finish!: () => void; const order: string[] = [];
    const active = queue.run(() => new Promise<void>(resolve => { finish = resolve; }), signal);
    const oldest = queue.run(async () => { order.push('预取'); }, signal, 'prefetch');
    const interactions = Array.from({ length: 12 }, (_, i) => queue.run(async () => { order.push(`操作${i}`); }, signal, 'interactive'));
    await Promise.resolve(); finish(); await Promise.all([active, oldest, ...interactions]);
    expect(order.indexOf('预取')).toBe(8);
    expect(order.filter(value => value !== '预取')).toEqual(Array.from({ length: 12 }, (_, i) => `操作${i}`));
  });
  it('等待中的高优先请求取消后不占模型名额，较低优先级请求正常继续', async () => {
    const queue = new ConcurrencyQueue(1); const signal = new AbortController().signal;
    let finish!: () => void;
    const active = queue.run(() => new Promise<void>(resolve => { finish = resolve; }), signal);
    const controller = new AbortController(); const cancelled = vi.fn(async () => {});
    const interactive = queue.run(cancelled, controller.signal, 'interactive');
    const rejection = expect(interactive).rejects.toThrow('取消操作');
    const next = vi.fn(async () => {}); const visible = queue.run(next, signal, 'visible');
    await Promise.resolve(); controller.abort(new Error('取消操作')); await rejection; finish();
    await Promise.all([active, visible]); expect(cancelled).not.toHaveBeenCalled(); expect(next).toHaveBeenCalledOnce();
  });
  it('等待中的预取被用户主动查阅时可提升优先级，后续低优先级订阅不会将它降级', async () => {
    const queue = new ConcurrencyQueue(1); const signal = new AbortController().signal;
    let finish!: () => void; const order: string[] = [];
    const active = queue.run(() => new Promise<void>(resolve => { finish = resolve; }), signal);
    const visible = queue.run(async () => { order.push('可见正文'); }, signal, 'visible');
    const shared = new AbortController();
    const prefetch = queue.run(async () => { order.push('主动查看的预取'); }, shared.signal, 'prefetch');
    queue.updatePriority(shared.signal, 'interactive'); queue.updatePriority(shared.signal, 'prefetch');
    await Promise.resolve(); finish(); await Promise.all([active, visible, prefetch]);
    expect(order).toEqual(['主动查看的预取', '可见正文']);
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
