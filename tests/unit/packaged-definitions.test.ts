import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { PackagedDefinitions } from '../../src/dictionaries/packaged-definitions';

const signal = () => new AbortController().signal;
const read = (path: string) => readFile(`public/dictionaries/definitions/${path}`, 'utf8');
describe('内置英汉词典的即时查词', () => {
  it('首次查询 Delightful 读取一个分片即可显示中文词性释义，再查相同词不重新读文件', async () => {
    const loader = vi.fn(read); const dictionary = new PackagedDefinitions(loader);
    const entries = await dictionary.lookup('Delightful', signal());
    expect(entries[0]).toMatchObject({ headword: 'delightful', dictionary: 'ECDICT · 通用英汉' });
    expect(entries[0]!.text).toContain('a. 令人愉快的');
    expect(loader).toHaveBeenCalledTimes(2);
    expect(await dictionary.lookup(' delightful ', signal())).toEqual(entries);
    expect(loader).toHaveBeenCalledTimes(2);
  });
  it('词典没有收录的句子与非英文输入不伪造释义', async () => {
    const dictionary = new PackagedDefinitions(read);
    expect(await dictionary.lookup('This sentence has no dictionary entry', signal())).toEqual([]);
    expect(await dictionary.lookup('你好', signal())).toEqual([]);
  });
  it('两张词卡同时查同一词共享分片，关闭其中一张不取消另一张查询', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const loader = vi.fn(async (path: string) => { if (path !== 'index.json') await gate; return read(path); });
    const dictionary = new PackagedDefinitions(loader);
    const controller = new AbortController();
    const first = dictionary.lookup('delightful', controller.signal);
    const second = dictionary.lookup('delightful', signal());
    const rejected = expect(first).rejects.toThrow('关闭');
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
    controller.abort(new Error('关闭')); await rejected; release();
    expect((await second)[0]!.text).toContain('令人愉快');
    expect(loader).toHaveBeenCalledTimes(2);
  });
  it('连续查询不同首字母的词时缓存不超预算，加载失败后再次查询能够恢复', async () => {
    const loader = vi.fn(read).mockRejectedValueOnce(new Error('临时加载失败'));
    const dictionary = new PackagedDefinitions(loader, 50000);
    await expect(dictionary.lookup('delightful', signal())).rejects.toThrow('临时加载失败');
    for (const word of ['apple', 'delightful', 'latency', 'window', 'cloudy']) {
      expect((await dictionary.lookup(word, signal())).length).toBe(1);
      expect(dictionary.cacheStats.textBytes).toBeLessThanOrEqual(50000);
      expect(dictionary.cacheStats.pending).toBe(0);
    }
  });
});
