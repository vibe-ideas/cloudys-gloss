import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { PackagedPronunciationDictionary } from '../../src/speech/packaged-pronunciation';
import { OfflinePronunciationDictionary } from '../../src/speech/pronunciation';
import { generateDictionaryAssets } from '../../scripts/dictionary-assets';

const signal = () => new AbortController().signal;
const fixture: Record<string, string> = {
  'ranges/index.json': JSON.stringify({ version: 1, dialects: {
    us: [{ first: 'a', file: 'us-0.tsv' }, { first: 'k', file: 'us-1.tsv' }],
    uk: [{ first: 'a', file: 'uk-0.tsv' }, { first: 'k', file: 'uk-1.tsv' }],
  } }),
  'ranges/us-0.tsv': 'a\t/ə/\nbank\t/bæŋk/\n', 'ranges/uk-0.tsv': 'a\t/ə/\nbank\t/bæŋk/\n',
  'ranges/us-1.tsv': 'kite\t/kaɪt/\nzoo\t/zuː/\n', 'ranges/uk-1.tsv': 'kite\t/kaɪt/\nzoo\t/zuː/\n',
  'technology.json': JSON.stringify({ version: 1, entries: [{ word: 'newword', ipa: { us: '', uk: '/ˈnjuːwɜːd/' } },
    { word: 'unknownaccent', ipa: { us: '', uk: '', general: '/ˈɪpa/' } },
    { word: 'bank', ipa: { us: '/do-not-replace/', uk: '/do-not-replace/' } }] }),
};

describe('按需离线音标：词典补缺与请求隔离', () => {
  it('首次查词只加载对应区间，重复查词共享加载且基础音标不被补充库替换', async () => {
    const loader = vi.fn(async (path: string) => fixture[path]!);
    const dictionary = new PackagedPronunciationDictionary(loader);
    expect(loader).not.toHaveBeenCalled();
    const results = await Promise.all([dictionary.lookup('bank', signal()), dictionary.lookup(' BANK ', signal())]);
    expect(results).toEqual([{ us: '/bæŋk/', uk: '/bæŋk/' }, { us: '/bæŋk/', uk: '/bæŋk/' }]);
    expect(loader.mock.calls.map(([path]) => path).sort()).toEqual(['ranges/index.json', 'ranges/uk-0.tsv', 'ranges/us-0.tsv', 'technology.json']);
  });

  it('没有口音标签的补充音标单独返回，不能填入美式或英式字段', async () => {
    const dictionary = new PackagedPronunciationDictionary(async path => fixture[path]!);
    expect(await dictionary.lookup('unknownaccent', signal())).toEqual({ us: '', uk: '', general: '/ˈɪpa/' });
    expect(await dictionary.lookup('newword', signal())).toEqual({ us: '', uk: '/ˈnjuːwɜːd/' });
  });

  it('换词取消一个等待者时立即结束，共享词典读取仍服务另一个等待者', async () => {
    let finish!: () => void;
    const held = new Promise<void>(resolve => { finish = resolve; });
    const loader = vi.fn(async (path: string) => { await held; return fixture[path]!; });
    const dictionary = new PackagedPronunciationDictionary(loader);
    const controller = new AbortController();
    const cancelled = dictionary.lookup('bank', controller.signal);
    const remaining = dictionary.lookup('bank', signal());
    const rejected = expect(cancelled).rejects.toThrow('换词');
    controller.abort(new Error('换词')); await rejected;
    finish();
    expect(await remaining).toEqual({ us: '/bæŋk/', uk: '/bæŋk/' });
    expect(loader).toHaveBeenCalledTimes(4);
  });

  it('一个口音的分片暂时失败时保留另一口音，下次查询重试失败分片', async () => {
    let failed = false;
    const dictionary = new PackagedPronunciationDictionary(async path => {
      if (path === 'ranges/uk-1.tsv' && !failed) { failed = true; throw new Error('暂时不可读'); }
      return fixture[path]!;
    });
    expect(await dictionary.lookup('kite', signal())).toEqual({ us: '/kaɪt/', uk: '' });
    expect(await dictionary.lookup('kite', signal())).toEqual({ us: '/kaɪt/', uk: '/kaɪt/' });
  });

  it('补充库损坏时基础词仍可查询，之后能重新加载已恢复的补充库', async () => {
    let broken = true;
    const dictionary = new PackagedPronunciationDictionary(async path => path === 'technology.json' && broken ? '{}' : fixture[path]!);
    expect(await dictionary.lookup('bank', signal())).toEqual({ us: '/bæŋk/', uk: '/bæŋk/' });
    broken = false;
    expect((await dictionary.lookup('newword', signal())).uk).toBe('/ˈnjuːwɜːd/');
  });

  it('连续跨区间查词仍遵守缓存字节上限，被淘汰的数据可以重新读取', async () => {
    const loader = vi.fn(async (path: string) => fixture[path]!);
    const dictionary = new PackagedPronunciationDictionary(loader, 100);
    for (const word of ['bank', 'zoo', 'bank']) {
      expect((await dictionary.lookup(word, signal())).us).toBeTruthy();
      expect(dictionary.cacheStats.textBytes).toBeLessThanOrEqual(100);
    }
    expect(loader.mock.calls.filter(([path]) => path === 'ranges/us-0.tsv')).toHaveLength(2);
  });

  it('已经取消或无效的选区不会读取任何词典资产', async () => {
    const loader = vi.fn(async (path: string) => fixture[path]!);
    const dictionary = new PackagedPronunciationDictionary(loader);
    const controller = new AbortController(); controller.abort();
    await expect(dictionary.lookup('bank', controller.signal)).rejects.toThrow();
    for (const word of ['', 'a\tb', 'x'.repeat(201)]) expect(await dictionary.lookup(word, signal())).toEqual({ us: '', uk: '' });
    expect(loader).not.toHaveBeenCalled();
  });
});

describe('生产构建的词典分片与科技补充资产', () => {
  let output: string;
  let dictionary: PackagedPronunciationDictionary;
  beforeAll(async () => {
    output = await mkdtemp(resolve(tmpdir(), 'cloudys-dictionary-test-'));
    await generateDictionaryAssets(process.cwd(), output);
    dictionary = new PackagedPronunciationDictionary(path => readFile(path.startsWith('ranges/')
      ? resolve(output, path.slice(7)) : resolve('public/dictionaries', path), 'utf8'));
  });
  afterAll(async () => { if (output) await rm(output, { recursive: true, force: true }); });

  it('全部分片拼接后逐字保留原库，每个区间首尾词的既有音标没有退步', async () => {
    const original = new OfflinePronunciationDictionary(dialect => readFile(`public/dictionaries/${dialect}.tsv`, 'utf8'));
    const index = JSON.parse(await readFile(resolve(output, 'index.json'), 'utf8')) as { dialects: Record<'us' | 'uk', { first: string; file: string }[]> };
    let gzipBytes = 0;
    for (const dialect of ['us', 'uk'] as const) {
      let combined = '';
      for (const range of index.dialects[dialect]) {
        const text = await readFile(resolve(output, range.file), 'utf8');
        combined += text; gzipBytes += gzipSync(text).length;
        const last = text.trimEnd().split('\n').at(-1)!.split('\t')[0]!;
        for (const word of [range.first, last]) expect((await dictionary.lookup(word, signal()))[dialect]).toBe((await original.lookup(word, signal()))[dialect]);
      }
      expect(combined).toBe(await readFile(`public/dictionaries/${dialect}.tsv`, 'utf8'));
    }
    expect(gzipBytes).toBeLessThan(1.1 * 1024 * 1024);
    expect(dictionary.cacheStats.textBytes).toBeLessThanOrEqual(768 * 1024);
  });

  it('科技词条保留原始重音和独立口音，未知口音及未收录缩写不会被伪造', async () => {
    expect((await dictionary.lookup('latency', signal())).uk).toBe('/ˈleɪ.tən.si/');
    expect((await dictionary.lookup('JSON', signal())).uk).toBe('/ˈd͡ʒeɪsən/');
    expect((await dictionary.lookup('CPU', signal())).uk).toBe('/(ˌ)siː(ˌ)piːˈjuː/');
    expect(await dictionary.lookup('Kubernetes', signal())).toEqual({ us: '', uk: '', general: '/k(j)uːbəˈnɛtɪs/, /k(j)uːbəˈneɪtɪs/, /k(j)uːbəˈneɪtiːz/' });
    expect(await dictionary.lookup('LLM', signal())).toEqual({ us: '', uk: '' });
  });

  it('发布的补充数据与归档来源哈希一致，且新增词条每个音标都能追溯到来源', () => {
    const raw = readFileSync('public/dictionaries/technology.json', 'utf8');
    const attribution = JSON.parse(readFileSync('public/dictionaries/technology-sources.json', 'utf8'));
    expect(createHash('sha256').update(raw).digest('hex')).toBe(attribution.assetSha256);
    expect(createHash('sha256').update(readFileSync('data/pronunciation/technology-sources.json')).digest('hex')).toBe(attribution.sourceManifestSha256);
    const entries = JSON.parse(raw).entries as { word: string; ipa: { us: string; uk: string; general?: string } }[];
    for (const entry of entries) {
      const source = attribution.entries.find((row: { word: string }) => row.word.toLowerCase() === entry.word);
      expect(source?.url).toMatch(/^https:\/\/kaikki.org\//);
      for (const [dialect, value] of Object.entries(entry.ipa).filter(([, value]) => value)) {
        for (const variant of value.split(', ')) expect(source.sounds.some((sound: { ipa: string; tags?: string[]; note?: string }) =>
          sound.ipa === variant && !sound.note && (dialect === 'general' ? !sound.tags?.length
            : sound.tags?.some(tag => (dialect === 'us' ? ['US', 'General-American'] : ['UK', 'Received-Pronunciation']).includes(tag))))).toBe(true);
      }
    }
    expect(entries.some(entry => entry.word === 'parsing' || entry.word === 'recursion')).toBe(false);
    expect(gzipSync(raw).length).toBeLessThan(10 * 1024);
  });
});
