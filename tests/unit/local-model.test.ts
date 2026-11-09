import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalModelManager, migrateManagedPreset, migrateModelParallelism } from '../../src/model/local-model';
import { defaults } from '../../src/core/schema';

const state = { installed: true, running: true, autostart: false, model: defaults.model, baseUrl: defaults.baseUrl };
afterEach(() => vi.unstubAllGlobals());
describe('浏览器按需启动本地 MLX', () => {
  it('本机模型持续返回 HTTP 响应时不重复探测 models，网络失败或手动停止后重新检查', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}')); vi.stubGlobal('fetch', fetcher);
    const native = vi.fn().mockResolvedValue({ ok: true, data: state }); const manager = new LocalModelManager(native);
    await manager.ensure(defaults, new AbortController().signal); expect(fetcher).toHaveBeenCalledOnce();
    for (let i = 0; i < 8; i++) { manager.connection(defaults, true); await manager.ensure(defaults, new AbortController().signal); }
    expect(fetcher).toHaveBeenCalledOnce(); expect(native).not.toHaveBeenCalled();
    manager.connection(defaults, false); await manager.ensure(defaults, new AbortController().signal); expect(fetcher).toHaveBeenCalledTimes(2);
    await manager.control('stop'); await manager.ensure(defaults, new AbortController().signal); expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('升级本机默认预设的单并发到八并发，远端接口、自定义模型及其他并发均保留', () => {
    const old = { ...defaults, concurrency: 1 };
    expect(migrateModelParallelism(old).concurrency).toBe(8);
    for (const custom of [{ ...old, baseUrl: 'https://api.example.com/v1' }, { ...old, model: 'my-model' }, { ...old, concurrency: 2 }]) expect(migrateModelParallelism(custom)).toEqual(custom);
  });
  it('升级默认模型时只迁移旧本机预设，保留主题、并发和用户自定义接口', () => {
    const old = { ...defaults, model: 'mlx-community/Qwen2.5-3B-Instruct-4bit', concurrency: 2, theme: 'dark' as const };
    expect(migrateManagedPreset(old)).toEqual({ ...old, model: defaults.model });
    for (const custom of [{ ...old, baseUrl: 'https://api.example.com/v1' }, { ...old, baseUrl: 'http://127.0.0.1:9090/v1' }, { ...old, model: 'my-model' }]) expect(migrateManagedPreset(custom)).toEqual(custom);
  });
  it('两个页面同时遇到服务停止时只启动一次，随后都能继续翻译', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    let complete!: (value: unknown) => void;
    const native = vi.fn(() => new Promise((resolve) => { complete = resolve; }));
    const manager = new LocalModelManager(native);
    const a = manager.ensure(defaults, new AbortController().signal);
    const b = manager.ensure(defaults, new AbortController().signal);
    await vi.waitFor(() => expect(native).toHaveBeenCalledTimes(1));
    complete({ ok: true, data: state });
    await Promise.all([a, b]);
    expect(native).toHaveBeenCalledWith({ action: 'start' });
  });
  it('一个页面取消等待时立即退出，另一个页面仍能等到模型启动', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    let complete!: (value: unknown) => void;
    const manager = new LocalModelManager(() => new Promise((resolve) => { complete = resolve; }));
    const controller = new AbortController();
    const cancelled = manager.ensure(defaults, controller.signal);
    const other = manager.ensure(defaults, new AbortController().signal);
    controller.abort(new Error('用户取消'));
    await expect(cancelled).rejects.toThrow('用户取消');
    await vi.waitFor(() => expect(complete).toBeDefined());
    complete({ ok: true, data: state });
    await other;
  });
  it('用户关闭按需启动或连接其他地址、端口、模型时，不探测也不启动 MLX', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const native = vi.fn(); const manager = new LocalModelManager(native);
    for (const settings of [
      { ...defaults, autoStartLocalModel: false }, { ...defaults, baseUrl: 'http://localhost:11434/v1' },
      { ...defaults, baseUrl: 'http://example.com:8080/v1' }, { ...defaults, model: 'another-model' },
    ]) await manager.ensure(settings, new AbortController().signal);
    expect(fetcher).not.toHaveBeenCalled(); expect(native).not.toHaveBeenCalled();
  });
  it('本地端口已有 HTTP 服务时不再启动进程，即使服务返回 API 错误', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })));
    const native = vi.fn(); const manager = new LocalModelManager(native);
    await manager.ensure(defaults, new AbortController().signal);
    expect(native).not.toHaveBeenCalled();
  });
  it('模型与助手都未运行时给出安装命令，助手返回的启动错误原样反馈', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    const native = vi.fn().mockRejectedValueOnce(new Error('No native host')).mockResolvedValueOnce({ ok: false, error: '8080 端口已被其他服务占用' });
    const manager = new LocalModelManager(native);
    await expect(manager.ensure(defaults, new AbortController().signal)).rejects.toThrow('pnpm model:bridge');
    await expect(manager.ensure(defaults, new AbortController().signal)).rejects.toThrow('8080 端口已被其他服务占用');
  });
});
