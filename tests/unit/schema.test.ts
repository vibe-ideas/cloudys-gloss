import { describe, expect, it } from 'vitest';
import { defaults, SettingsSchema } from '../../src/schema';
describe('模型设置', () => {
  it('新安装默认连接本地 MLX，使用单并发和 120 秒超时', () => {
    expect(SettingsSchema.parse(defaults)).toEqual({
      baseUrl: 'http://127.0.0.1:8080/v1',
      model: 'Qwen/Qwen3-1.7B-MLX-4bit',
      apiKey: '', temperature: 0, concurrency: 1, timeout: 120000, theme: 'system', autoStartLocalModel: true,
    });
  });
  it('用户输入非 HTTP 地址或过高并发时拒绝保存', () => {
    expect(SettingsSchema.safeParse({ ...defaults, baseUrl: 'file:///tmp/model' }).success).toBe(false);
    expect(SettingsSchema.safeParse({ ...defaults, concurrency: 99 }).success).toBe(false);
  });
});
