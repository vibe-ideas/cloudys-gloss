import { afterEach, describe, expect, it, vi } from 'vitest';
import { createId } from '../../src/core/id';

afterEach(() => vi.unstubAllGlobals());

describe('网页翻译请求标识', () => {
  it('HTTPS 页面使用浏览器原生 UUID，每个请求有独立标识', () => {
    const ids = new Set(Array.from({ length: 100 }, createId));
    expect(ids.size).toBe(100);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('普通 HTTP 页面没有 randomUUID 时，仍能为并发翻译和词卡生成独立有效标识', () => {
    const getRandomValues = crypto.getRandomValues.bind(crypto);
    vi.stubGlobal('crypto', { getRandomValues });
    const ids = new Set(Array.from({ length: 100 }, createId));
    expect(ids.size).toBe(100);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
