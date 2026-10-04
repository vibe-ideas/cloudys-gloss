import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { OfflinePronunciationDictionary, type PronunciationDialect } from '../../src/pronunciation';

const signal = () => new AbortController().signal;
const fixture = {
  us: 'bank\t/bæŋk/\ncharge\t/tʃɑɹdʒ/\nread\t/ɹɛd/, /ɹid/\nunique\t/juːˈniːk/\n',
  uk: 'bank\t/bæŋk/\ncharge\t/tʃɑːdʒ/\nread\t/ɹiːd/, /ɹɛd/\n',
};

describe('离线词典提供独立的美式和英式音标', () => {
  it('首次查询时才读取词典，大小写和外围空格不影响查词', async () => {
    const loader = vi.fn(async (dialect: PronunciationDialect) => fixture[dialect]);
    const dictionary = new OfflinePronunciationDictionary(loader);
    expect(loader).not.toHaveBeenCalled();
    expect(await dictionary.lookup('  CHARGE  ', signal())).toEqual({ us: '/tʃɑɹdʒ/', uk: '/tʃɑːdʒ/' });
    expect(await dictionary.lookup('bank', signal())).toEqual({ us: '/bæŋk/', uk: '/bæŋk/' });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('同一单词有多个读音时保留全部读音，不猜测上下文对应哪一个', async () => {
    const dictionary = new OfflinePronunciationDictionary(async (dialect) => fixture[dialect]);
    expect(await dictionary.lookup('read', signal())).toEqual({ us: '/ɹɛd/, /ɹid/', uk: '/ɹiːd/, /ɹɛd/' });
  });

  it('英国词典缺词时只返回美国音标，不把美式音标复制到英式字段', async () => {
    const dictionary = new OfflinePronunciationDictionary(async (dialect) => fixture[dialect]);
    expect(await dictionary.lookup('unique', signal())).toEqual({ us: '/juːˈniːk/', uk: '' });
    expect(await dictionary.lookup('unknown', signal())).toEqual({ us: '', uk: '' });
  });

  it('短语只使用词典完整条目，不拼接单词后冒充短语标准发音', async () => {
    const dictionary = new OfflinePronunciationDictionary(async () => 'give\t/ɡɪv/\ntake off\t/teɪk ɒf/\nup\t/ʌp/\n');
    expect(await dictionary.lookup('give up', signal())).toEqual({ us: '', uk: '' });
    expect(await dictionary.lookup('take off', signal())).toEqual({ us: '/teɪk ɒf/', uk: '/teɪk ɒf/' });
  });

  it('查询文本首尾条目和未命中间隙时均返回对应结果', async () => {
    const dictionary = new OfflinePronunciationDictionary(async () => 'a\t/ə/\nhello\t/həˈləʊ/\nzoo\t/zuː/');
    for (const [word, value] of [['a', '/ə/'], ['hello', '/həˈləʊ/'], ['zoo', '/zuː/'], ['aardvark', ''], ['zzzz', '']]) {
      expect(await dictionary.lookup(word!, signal())).toEqual({ us: value, uk: value });
    }
  });

  it('一个查询取消时立即结束等待，其他查询仍共享同一轮词典加载', async () => {
    let finish!: (text: string) => void;
    const pending = new Promise<string>((resolve) => { finish = resolve; });
    const loader = vi.fn(async () => pending);
    const dictionary = new OfflinePronunciationDictionary(loader);
    const controller = new AbortController();
    const cancelled = dictionary.lookup('bank', controller.signal);
    const remaining = dictionary.lookup('bank', signal());
    const rejection = expect(cancelled).rejects.toThrow('selection changed');
    controller.abort(new Error('selection changed'));
    await rejection;
    finish('bank\t/bæŋk/\n');
    expect(await remaining).toEqual({ us: '/bæŋk/', uk: '/bæŋk/' });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('调用前已经取消的查询不触发词典加载', async () => {
    const loader = vi.fn(async () => fixture.us);
    const controller = new AbortController(); controller.abort(new Error('cancelled'));
    await expect(new OfflinePronunciationDictionary(loader).lookup('bank', controller.signal)).rejects.toThrow('cancelled');
    expect(loader).not.toHaveBeenCalled();
  });

  it('一个口音加载失败不影响另一个，下次查词会重试失败的数据源', async () => {
    let failed = false;
    const loader = vi.fn(async (dialect: PronunciationDialect) => {
      if (dialect === 'us' && !failed) { failed = true; throw new Error('asset temporarily unavailable'); }
      return fixture[dialect];
    });
    const dictionary = new OfflinePronunciationDictionary(loader);
    expect(await dictionary.lookup('charge', signal())).toEqual({ us: '', uk: '/tʃɑːdʒ/' });
    expect(await dictionary.lookup('charge', signal())).toEqual({ us: '/tʃɑɹdʒ/', uk: '/tʃɑːdʒ/' });
    expect(loader.mock.calls.map(([dialect]) => dialect)).toEqual(['us', 'uk', 'us']);
  });

  it('音标长度超过卡片容量时返回缺失，不截断或擅自丢弃变体', async () => {
    const dictionary = new OfflinePronunciationDictionary(async () => `word\t/${'a'.repeat(201)}/\n`);
    expect(await dictionary.lookup('word', signal())).toEqual({ us: '', uk: '' });
  });
});

describe('随扩展分发的真实音标资产', () => {
  const assets = { us: readFileSync('public/dictionaries/us.tsv', 'utf8'), uk: readFileSync('public/dictionaries/uk.tsv', 'utf8') };
  const dictionary = new OfflinePronunciationDictionary(async (dialect) => assets[dialect]);

  it('cloudy 和 charge 保留正确主元音与塞擦音，并区分英美卷舌差异', async () => {
    const cloudy = await dictionary.lookup('cloudy', signal());
    expect(cloudy.us).toContain('aʊ'); expect(cloudy.uk).toContain('aʊ');
    const charge = await dictionary.lookup('charge', signal());
    expect(charge.us).toContain('ɹdʒ'); expect(charge.uk).toContain('ɑːdʒ');
    expect(charge.uk).not.toContain('ɹ');
  });

  it('已提交资产与来源清单哈希一致，且两个口音压缩后合计小于 1.1 MiB', () => {
    const manifest = JSON.parse(readFileSync('public/dictionaries/sources.json', 'utf8')) as { assets: Record<PronunciationDialect, { sha256: string }> };
    let compressed = 0;
    for (const dialect of ['us', 'uk'] as const) {
      expect(createHash('sha256').update(assets[dialect]).digest('hex')).toBe(manifest.assets[dialect].sha256);
      compressed += gzipSync(assets[dialect]).length;
    }
    expect(compressed).toBeLessThan(1.1 * 1024 * 1024);
  });
});
