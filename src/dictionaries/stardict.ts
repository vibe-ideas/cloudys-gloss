import { decodeHTML } from 'entities';

export const IMPORT_LIMITS = { filesBytes: 80 * 1024 * 1024, bodyBytes: 64 * 1024 * 1024, indexBytes: 16 * 1024 * 1024, entries: 200000, articleBytes: 65536 };
export interface DictionaryFile { name: string; blob: Blob }
export interface ImportProgress { phase: string; completed: number; total: number }
export interface DictionaryArticle { headword: string; text: string; phonetic?: string }
export interface IndexWord { word: string; ordinal: number }
const decoder = new TextDecoder('utf-8', { fatal: true });
export const normalizeHeadword = (word: string) => word.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase();
const yieldTask = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** Text extraction only. Results always render as escaped text, never HTML or URLs. */
export function dictionaryText(value: string) {
  return decodeHTML(value.replace(/<!--[^]*?-->/g, '').replace(/<(script|style|iframe|object)\b[^>]*>[^]*?<\/\1\s*>/gi, '')
    .replace(/<\/?(?:br|p|div|li|tr|blockquote|hr)\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, ''))
    // Remove control characters from external dictionary text.
    // eslint-disable-next-line no-control-regex
    .replace(/\r/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function selectStarDictFiles(files: DictionaryFile[]) {
  if (files.length < 3 || files.length > 4) throw new Error('请选择同一词库的 .ifo、.idx 和 .dict 文件，可附带 .syn；压缩包请先解压');
  if (files.reduce((sum, file) => sum + file.blob.size, 0) > IMPORT_LIMITS.filesBytes) throw new Error('所选文件合计不能超过 80 MiB');
  const ifos = files.filter(file => file.name.endsWith('.ifo'));
  if (ifos.length !== 1) throw new Error('每次请选择一个词库的 .ifo 文件');
  const info = ifos[0]!; const base = info.name.slice(0, -4);
  const pick = (suffixes: string[], required = true) => {
    const matches = files.filter(file => suffixes.some(suffix => file.name === base + suffix));
    if (matches.length > 1 || (required && matches.length !== 1)) throw new Error(`缺少或重复文件：${base}${suffixes[0]}`);
    return matches[0];
  };
  const index = pick(['.idx', '.idx.gz'])!;
  const body = pick(['.dict', '.dict.dz', '.dict.gz'])!;
  const synonyms = pick(['.syn', '.syn.gz'], false);
  if (files.length !== 3 + Number(!!synonyms)) throw new Error('文件名不匹配，请选择同一词库的文件组');
  return { info, index, body, synonyms };
}

export async function readDictionaryFile(file: DictionaryFile, limit: number, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  signal.throwIfAborted();
  const stream = /\.(gz|dz)$/.test(file.name) ? file.blob.stream().pipeThrough(new DecompressionStream('gzip')) : file.blob.stream();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      const next = await reader.read(); signal.throwIfAborted();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) throw new Error(`${file.name} 解压后超过 ${Math.round(limit / 1024 / 1024)} MiB 限制`);
      chunks.push(next.value);
    }
    const data = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
    return data;
  } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

function fields(data: Uint8Array, sequence: string) {
  let cursor = 0, field = 0;
  const texts: string[] = []; const phonetics: string[] = [];
  while (cursor < data.length || (!!sequence && field < sequence.length)) {
    const type = sequence ? sequence[field] : String.fromCharCode(data[cursor++]!);
    if (!type || !'mthgx'.includes(type)) throw new Error(`暂不支持 StarDict 字段 ${type ?? '未知'}，请转换为 UTF-8 文本或 HTML 词库`);
    const last = !!sequence && field === sequence.length - 1;
    const end = last ? data.length : data.indexOf(0, cursor);
    if (end < cursor) throw new Error('词条字段缺少结束标记');
    const raw = decoder.decode(data.subarray(cursor, end));
    const text = 'hgx'.includes(type) ? dictionaryText(raw) : raw.replace(/\0/g, '').trim();
    if (type === 't') phonetics.push(text); else if (text) texts.push(text);
    cursor = last ? end : end + 1; field++;
  }
  if (sequence && field !== sequence.length) throw new Error('词条字段与 sametypesequence 不一致');
  return { text: texts.join('\n\n'), phonetic: phonetics.join(' / ') || undefined };
}

export async function parseStarDict(files: DictionaryFile[], signal: AbortSignal, progress: (value: ImportProgress) => void,
  write: (articles: Array<DictionaryArticle & { ordinal: number }>, words: IndexWord[]) => Promise<void>) {
  const selected = selectStarDictFiles(files);
  progress({ phase: '读取词库信息', completed: 0, total: 1 });
  const lines = decoder.decode(await readDictionaryFile(selected.info, 65536, signal)).replace(/^\uFEFF/, '').split(/\r\n?|\n/);
  if (lines.shift() !== "StarDict's dict ifo file") throw new Error('不是有效的 StarDict .ifo 文件');
  const info = new Map<string, string>();
  for (const line of lines) { const equal = line.indexOf('='); if (equal > 0) info.set(line.slice(0, equal).trim(), line.slice(equal + 1).trim()); }
  if (!['2.4.2', '3.0.0'].includes(info.get('version') ?? '')) throw new Error('仅支持 StarDict 2.4.2 / 3.0.0');
  if ((info.get('idxoffsetbits') ?? '32') !== '32') throw new Error('暂不支持 64 位偏移的大型词库');
  const count = Number(info.get('wordcount')); const indexSize = Number(info.get('idxfilesize')); const synonymCount = Number(info.get('synwordcount') ?? 0);
  if (!Number.isInteger(count) || count < 1 || count > IMPORT_LIMITS.entries || !Number.isInteger(indexSize) || indexSize < 1 || indexSize > IMPORT_LIMITS.indexBytes
    || !Number.isInteger(synonymCount) || synonymCount < 0 || synonymCount > IMPORT_LIMITS.entries) throw new Error('词库条目数或索引大小无效；最多支持 20 万条正文及 20 万条别名');
  if ((!selected.synonyms && synonymCount > 0) || (selected.synonyms && !info.has('synwordcount'))) throw new Error('.syn 文件与 synwordcount 不一致，请补齐文件');
  const sequence = info.get('sametypesequence') ?? '';
  if (sequence.length > 16 || (sequence && !/^[mthgx]+$/.test(sequence))) throw new Error('仅支持文本、音标、HTML、Pango、XDXF 字段（m/t/h/g/x）');
  const name = dictionaryText(info.get('bookname') ?? '').slice(0, 160);
  if (!name) throw new Error('词库缺少 bookname');
  progress({ phase: '解压并校验文件', completed: 0, total: count });
  const index = await readDictionaryFile(selected.index, IMPORT_LIMITS.indexBytes, signal);
  if (index.length !== indexSize) throw new Error('索引长度与 .ifo 声明不一致');
  const body = await readDictionaryFile(selected.body, IMPORT_LIMITS.bodyBytes, signal);
  const view = new DataView(index.buffer); let cursor = 0, ordinal = 0, referencedBytes = 0;
  let batch: Array<DictionaryArticle & { ordinal: number }> = []; let words: IndexWord[] = [];
  const flush = async () => { signal.throwIfAborted(); await write(batch, words); batch = []; words = []; await yieldTask(); signal.throwIfAborted(); };
  while (cursor < index.length) {
    const end = index.indexOf(0, cursor);
    if (end <= cursor || end - cursor > 255 || end + 9 > index.length || ordinal >= count) throw new Error('索引词头或记录损坏');
    const word = decoder.decode(index.subarray(cursor, end)).normalize('NFC').trim();
    if (!normalizeHeadword(word) || word.length > 200) throw new Error('词头为空或超过 200 字符');
    const offset = view.getUint32(end + 1); const size = view.getUint32(end + 5);
    if (!size || size > IMPORT_LIMITS.articleBytes || offset + size > body.length) throw new Error(`词条 ${word} 的正文偏移无效或超过 64 KiB`);
    // Repeated offsets must not expand a small source file into unbounded stored articles.
    referencedBytes += size;
    if (referencedBytes > IMPORT_LIMITS.bodyBytes) throw new Error('词条重复引用的正文总量超过 64 MiB，请先精简词库');
    batch.push({ ordinal, headword: word, ...fields(body.subarray(offset, offset + size), sequence) }); words.push({ word, ordinal });
    cursor = end + 9; ordinal++;
    if (batch.length >= 500) { await flush(); progress({ phase: '建立本地索引', completed: ordinal, total: count + synonymCount }); }
  }
  if (ordinal !== count) throw new Error('实际词条数与 wordcount 不一致');
  await flush();
  if (selected.synonyms) {
    const data = await readDictionaryFile(selected.synonyms, IMPORT_LIMITS.indexBytes, signal);
    const view = new DataView(data.buffer); let cursor = 0, seen = 0;
    while (cursor < data.length) {
      const end = data.indexOf(0, cursor);
      if (end <= cursor || end - cursor > 255 || end + 5 > data.length) throw new Error('别名索引损坏');
      const word = decoder.decode(data.subarray(cursor, end)).normalize('NFC').trim(); const ordinal = view.getUint32(end + 1);
      if (!normalizeHeadword(word) || word.length > 200 || ordinal >= count || ++seen > synonymCount) throw new Error('别名指向不存在的词条或数量无效');
      words.push({ word, ordinal }); cursor = end + 5;
      if (words.length >= 500) { await flush(); progress({ phase: '建立别名索引', completed: count + seen, total: count + synonymCount }); }
    }
    if (seen !== synonymCount) throw new Error('别名数量与 synwordcount 不一致');
    await flush();
  }
  return { name, entries: count, aliases: synonymCount, bytes: body.length + index.length,
    description: dictionaryText(info.get('description') ?? '').slice(0, 4000) };
}
