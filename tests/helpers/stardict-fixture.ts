import { gzipSync } from 'node:zlib';

/** Synthetic public fixture. Binary offsets and alias order follow the StarDict specification. */
export function starDictFixture(options: { entries?: [string, string][]; sequence?: string; aliases?: [string, number][]; gzip?: boolean; name?: string } = {}) {
  const entries = options.entries ?? [['GPU', '图形处理器：适合并行计算。'], ['RAG', '检索增强生成。'], ['cloudy', '本地释义：多云的；不清晰的。'], ['rag', '碎布。']];
  const index: Buffer[] = [], articles: Buffer[] = []; let offset = 0;
  for (const [word, body] of entries) {
    const data = Buffer.from(body); const record = Buffer.alloc(8); record.writeUInt32BE(offset); record.writeUInt32BE(data.length, 4);
    index.push(Buffer.from(word + '\0'), record); articles.push(data); offset += data.length;
  }
  const synonyms = (options.aliases ?? []).flatMap(([word, ordinal]) => { const record = Buffer.alloc(4); record.writeUInt32BE(ordinal); return [Buffer.from(word + '\0'), record]; });
  const idx = Buffer.concat(index), dict = Buffer.concat(articles);
  const info = `StarDict's dict ifo file\nversion=3.0.0\nbookname=${options.name ?? '科技测试词库'}\nwordcount=${entries.length}\nidxfilesize=${idx.length}\nsynwordcount=${options.aliases?.length ?? 0}\nsametypesequence=${options.sequence ?? 'm'}\ndescription=合成测试词库，可自由使用。\n`;
  const files = [{ name: 'test.ifo', buffer: Buffer.from(info) },
    { name: options.gzip ? 'test.idx.gz' : 'test.idx', buffer: options.gzip ? gzipSync(idx) : idx },
    { name: options.gzip ? 'test.dict.dz' : 'test.dict', buffer: options.gzip ? gzipSync(dict) : dict }];
  if (synonyms.length) files.push({ name: 'test.syn', buffer: Buffer.concat(synonyms) });
  return files;
}
