// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { openDB } from 'idb';
import { gzipSync } from 'node:zlib';
import { stageDictionary, ImportedDictionaryStore } from '../../src/dictionaries/store';
import { parseStarDict, readDictionaryFile, type DictionaryArticle } from '../../src/dictionaries/stardict';
import { starDictFixture } from '../helpers/stardict-fixture';

const instances: ImportedDictionaryStore[] = [];
afterEach(async () => { await Promise.all(instances.splice(0).map(store => store.close())); });
const files = (options?: Parameters<typeof starDictFixture>[0]) => starDictFixture(options).map(file => new File([new Uint8Array(file.buffer)], file.name));
const input = (items: File[]) => items.map(file => ({ name: file.name, blob: file }));
const signal = () => new AbortController().signal;
function store(name = crypto.randomUUID()) { const value = new ImportedDictionaryStore(name); instances.push(value); return { value, name }; }

describe('导入后的本地词库', () => {
  it('导入压缩正文与别名后重建查询服务，仍能按原始大小写和别名查到词条', async () => {
    const first = store(); const id = await stageDictionary(files({ gzip: true, aliases: [['graphics processor', 0]] }), first.name);
    const result = await first.value.import(id, signal(), () => {});
    expect(result).toMatchObject({ entries: 4, aliases: 1, ready: true, enabled: true });
    await first.value.close();
    const second = store(first.name).value;
    expect((await second.lookup('RAG'))[0]?.text).toBe('检索增强生成。');
    expect((await second.lookup('rag'))[0]?.text).toBe('碎布。');
    expect((await second.lookup('graphics processor'))[0]).toMatchObject({ headword: 'GPU', matchedAs: 'graphics processor' });
    expect(await second.lookup('missing')).toEqual([]);
  });
  it('停用词库后不再返回本地释义，重新启用可查询，删除后正文与索引一起移除', async () => {
    const { value, name } = store(); const id = await stageDictionary(files(), name); await value.import(id, signal(), () => {});
    await value.enable(id, false); expect(await value.lookup('cloudy')).toEqual([]);
    await value.enable(id, true); expect(await value.lookup('cloudy')).toHaveLength(1);
    await value.remove(id); expect(await value.list()).toEqual([]); expect(await value.lookup('cloudy')).toEqual([]);
    const db = await openDB(name); expect(await db.count('articles')).toBe(0); expect(await db.count('words')).toBe(0); db.close();
  });
  it('第二个词库导入到一半被取消，旧词库仍可查且新词库的暂存与索引全部清理', async () => {
    const { value, name } = store(); const original = await stageDictionary(files(), name); await value.import(original, signal(), () => {});
    const batch = files({ entries: Array.from({ length: 1500 }, (_, i) => [`word${i}`, '测试释义']) });
    const id = await stageDictionary(batch, name); const controller = new AbortController();
    await expect(value.import(id, controller.signal, progress => { if (progress.completed >= 500) controller.abort(new Error('用户取消')); })).rejects.toThrow('用户取消');
    expect(await value.list()).toHaveLength(1); expect(await value.lookup('cloudy')).toHaveLength(1); expect(await value.lookup('word1')).toEqual([]);
    const db = await openDB(name); expect(await db.count('articles')).toBe(4); expect(await db.count('staging')).toBe(0); db.close();
  });
  it('后台重启遇到未完成导入时清理半成品，不把半本词库启用', async () => {
    const { value, name } = store(); await value.list(); const db = await openDB(name);
    await db.put('dictionaries', { id: 'unfinished', ready: false });
    await db.put('articles', { dictionaryId: 'unfinished', ordinal: 0, text: '不应显示' });
    db.close(); await value.close(); const recovered = store(name).value;
    expect(await recovered.list()).toEqual([]);
    const check = await openDB(name); expect(await check.count('articles')).toBe(0); check.close();
  });
  it('新词库声明的词条数错误时导入失败，既不发布空词库也不删除已有词库', async () => {
    const { value, name } = store(); const id = await stageDictionary(files(), name); await value.import(id, signal(), () => {});
    const invalid = files(); invalid[0] = new File([(await invalid[0]!.text()).replace('wordcount=4', 'wordcount=5')], 'test.ifo');
    await expect(value.import(await stageDictionary(invalid, name), signal(), () => {})).rejects.toThrow('wordcount');
    expect(await value.list()).toHaveLength(1); expect(await value.lookup('GPU')).toHaveLength(1);
  });
});

describe('StarDict 文件校验与安全读取', () => {
  it('HTML 词条去掉脚本和外部资源，保留中文、段落及解码后的实体；音标不冒充 US 或 UK', async () => {
    const articles: DictionaryArticle[] = [];
    await parseStarDict(input(files({ sequence: 'th', entries: [['sample', '/ˈsæmpəl/\0<div>样例 &amp; 数据</div><script>fetch("https://bad")</script><img src="https://bad"><div>&#x4E2D;文</div>']] })), signal(), () => {}, async rows => { articles.push(...rows); });
    expect(articles[0]).toMatchObject({ text: '样例 & 数据\n\n中文', phonetic: '/ˈsæmpəl/' });
    expect(JSON.stringify(articles)).not.toContain('https://bad');
  });
  it('没有 sametypesequence 的逐字段文本词库，也可读取音标和释义', async () => {
    const articles: DictionaryArticle[] = [];
    await parseStarDict(input(files({ sequence: '', entries: [['test', 't/tɛst/\0m测试\0']] })), signal(), () => {}, async rows => { articles.push(...rows); });
    expect(articles[0]).toMatchObject({ text: '测试', phonetic: '/tɛst/' });
  });
  it('固定字段序列的最后一个释义字段为空时，仍保留该词条已有的读音', async () => {
    const articles: DictionaryArticle[] = [];
    await parseStarDict(input(files({ sequence: 'tm', entries: [['test', '/tɛst/\0']] })), signal(), () => {}, async rows => { articles.push(...rows); });
    expect(articles[0]).toMatchObject({ text: '', phonetic: '/tɛst/' });
  });
  it('索引指向正文之外时明确报错，不产生错误词义', async () => {
    const sample = files(); const index = new Uint8Array(await sample[1]!.arrayBuffer()); new DataView(index.buffer).setUint32(4, 99999999);
    sample[1] = new File([index], 'test.idx');
    await expect(parseStarDict(input(sample), signal(), () => {}, async () => {})).rejects.toThrow('正文偏移');
  });
  it('别名引用不存在的正文时拒绝导入', async () => {
    await expect(parseStarDict(input(files({ aliases: [['broken', 999]] })), signal(), () => {}, async () => {})).rejects.toThrow('别名指向');
  });
  it('解压后超过预算时停止读取，避免小压缩文件无限膨胀', async () => {
    const blob = new Blob([new Uint8Array(gzipSync('x'.repeat(10000)))]);
    await expect(readDictionaryFile({ name: 'bomb.dict.dz', blob }, 1024, signal())).rejects.toThrow('解压后超过');
  });
  it('小词库通过重复正文偏移放大存储量时拒绝导入，不无限复制相同大词条', async () => {
    const sample = files({ entries: Array.from({ length: 2000 }, (_, i) => [`word${i}`, 'short']) });
    const data = new Uint8Array(await sample[1]!.arrayBuffer()); const view = new DataView(data.buffer);
    for (let cursor = 0; cursor < data.length;) {
      const end = data.indexOf(0, cursor); view.setUint32(end + 1, 0); view.setUint32(end + 5, 65536); cursor = end + 9;
    }
    sample[1] = new File([data], 'test.idx'); sample[2] = new File(['x'.repeat(65536)], 'test.dict');
    await expect(parseStarDict(input(sample), signal(), () => {}, async () => {})).rejects.toThrow('正文总量超过');
  });
  it('文件组来自不同词库或包含重复正文时给出可纠正的错误', async () => {
    const sample = files(); sample[1] = new File([sample[1]!], 'other.idx');
    await expect(parseStarDict(input(sample), signal(), () => {}, async () => {})).rejects.toThrow('缺少或重复文件');
    const duplicate = files(); duplicate.push(new File(['invalid'], 'test.dict.gz'));
    await expect(parseStarDict(input(duplicate), signal(), () => {}, async () => {})).rejects.toThrow('缺少或重复文件');
  });
  it('64 位大词库和音视频字段不会被当成文本静默导入', async () => {
    const sample = files(); sample[0] = new File([await sample[0]!.text(), 'idxoffsetbits=64\n'], 'test.ifo');
    await expect(parseStarDict(input(sample), signal(), () => {}, async () => {})).rejects.toThrow('64 位');
    await expect(parseStarDict(input(files({ sequence: 'W' })), signal(), () => {}, async () => {})).rejects.toThrow('仅支持文本');
  });
});
