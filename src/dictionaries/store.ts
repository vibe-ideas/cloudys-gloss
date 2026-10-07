import { openDB, type DBSchema } from 'idb';
import { normalizeHeadword, parseStarDict, selectStarDictFiles, type DictionaryArticle, type DictionaryFile, type ImportProgress } from './stardict';

export interface ImportedDictionary { id: string; name: string; entries: number; aliases: number; bytes: number; description: string; created: number; enabled: boolean; ready: boolean }
export interface LocalDefinition extends DictionaryArticle { dictionary: string; matchedAs: string; truncated: boolean }
interface DictionaryDB extends DBSchema {
  dictionaries: { key: string; value: ImportedDictionary };
  articles: { key: [string, number]; value: DictionaryArticle & { dictionaryId: string; ordinal: number } };
  words: { key: [string, string, string, number]; value: { dictionaryId: string; key: string; word: string; ordinal: number } };
  staging: { key: string; value: { id: string; files: DictionaryFile[]; created: number }; indexes: { created: number } };
}
const DB_NAME = 'cloudys-gloss-dictionaries';
function connect(name = DB_NAME) {
  return openDB<DictionaryDB>(name, 1, { upgrade(db) {
    db.createObjectStore('dictionaries', { keyPath: 'id' });
    db.createObjectStore('articles', { keyPath: ['dictionaryId', 'ordinal'] });
    db.createObjectStore('words', { keyPath: ['dictionaryId', 'key', 'word', 'ordinal'] });
    db.createObjectStore('staging', { keyPath: 'id' }).createIndex('created', 'created');
  } });
}
const prefix = (key: IDBValidKey[]) => IDBKeyRange.bound(key, [...key, []]);

/** Extension options and background share their origin's IDB. Never message large file buffers. */
export async function stageDictionary(files: File[], name = DB_NAME) {
  const input = files.map(file => ({ name: file.name, blob: file.slice() })); selectStarDictFiles(input);
  const db = await connect(name); const id = crypto.randomUUID();
  try { await db.put('staging', { id, files: input, created: Date.now() }); return id; } finally { db.close(); }
}
export async function discardStagedDictionary(id: string, name = DB_NAME) {
  const db = await connect(name); try { await db.delete('staging', id); } finally { db.close(); }
}

export class ImportedDictionaryStore {
  private db;
  private ready: Promise<void>;
  private importing = false;
  constructor(name = DB_NAME) {
    this.db = connect(name);
    // A terminated MV3 worker may leave a partial import; never publish it on restart.
    this.ready = this.recover();
  }
  private async recover() {
    const db = await this.db;
    for (const dictionary of await db.getAll('dictionaries')) if (!dictionary.ready) await this.erase(dictionary.id);
    for (const id of await db.getAllKeysFromIndex('staging', 'created', IDBKeyRange.upperBound(Date.now() - 3600000))) await db.delete('staging', id);
  }
  private async erase(id: string) {
    const db = await this.db;
    const tx = db.transaction(['dictionaries', 'articles', 'words', 'staging'], 'readwrite');
    await Promise.all([tx.objectStore('articles').delete(prefix([id])), tx.objectStore('words').delete(prefix([id])),
      tx.objectStore('dictionaries').delete(id), tx.objectStore('staging').delete(id)]);
    await tx.done;
  }
  async list() { await this.ready; return (await (await this.db).getAll('dictionaries')).filter(item => item.ready).sort((a, b) => a.created - b.created); }
  async remove(id: string) {
    await this.ready;
    if (this.importing) throw new Error('请等待导入完成或取消后再删除词库');
    await this.erase(id);
  }
  async enable(id: string, enabled: boolean) {
    await this.ready;
    const db = await this.db; const tx = db.transaction('dictionaries', 'readwrite');
    const item = await tx.store.get(id);
    if (item?.ready) await tx.store.put({ ...item, enabled });
    await tx.done;
  }
  async import(id: string, signal: AbortSignal, progress: (value: ImportProgress) => void) {
    await this.ready;
    if (this.importing) throw new Error('已有词库正在导入，请稍后再试');
    this.importing = true;
    const db = await this.db; let created = false;
    try {
      signal.throwIfAborted();
      if ((await this.list()).length >= 5) throw new Error('最多保留 5 个词库，请先删除不需要的词库');
      if (await db.get('dictionaries', id)) throw new Error('重复导入请求');
      const staged = await db.get('staging', id);
      if (!staged) throw new Error('导入文件已过期，请重新选择');
      await db.put('dictionaries', { id, name: '', entries: 0, aliases: 0, bytes: 0, description: '', created: Date.now(), enabled: false, ready: false }); created = true;
      const info = await parseStarDict(staged.files, signal, progress, async (articles, words) => {
        signal.throwIfAborted();
        const tx = db.transaction(['articles', 'words'], 'readwrite');
        try {
          await Promise.all([
            ...articles.map(article => tx.objectStore('articles').put({ ...article, dictionaryId: id })),
            ...words.map(word => tx.objectStore('words').put({ ...word, dictionaryId: id, key: normalizeHeadword(word.word) })),
          ]);
          await tx.done;
        } catch (error) { await tx.done.catch(() => {}); throw error; }
      });
      signal.throwIfAborted();
      const result: ImportedDictionary = { id, ...info, created: Date.now(), enabled: true, ready: true };
      // Publication and removal of staging files are a single atomic transaction.
      const tx = db.transaction(['dictionaries', 'staging'], 'readwrite');
      await tx.objectStore('dictionaries').put(result); await tx.objectStore('staging').delete(id); await tx.done;
      return result;
    } catch (error) {
      if (created) await this.erase(id);
      else await db.delete('staging', id);
      throw error;
    } finally { this.importing = false; }
  }
  async lookup(word: string, signal?: AbortSignal): Promise<LocalDefinition[]> {
    await this.ready; signal?.throwIfAborted();
    const normalized = normalizeHeadword(word); if (!normalized || normalized.length > 200) return [];
    const db = await this.db;
    const tx = db.transaction(['dictionaries', 'words', 'articles']);
    const sources = (await tx.objectStore('dictionaries').getAll()).filter(item => item.ready && item.enabled).sort((a, b) => a.created - b.created);
    const results: LocalDefinition[] = [];
    for (const source of sources) {
      let matches = await tx.objectStore('words').getAll(prefix([source.id, normalized, word.normalize('NFC').trim()]), 3);
      if (!matches.length) matches = await tx.objectStore('words').getAll(prefix([source.id, normalized]), 3);
      const seen = new Set<number>();
      for (const match of matches) {
        if (seen.has(match.ordinal)) continue; seen.add(match.ordinal);
        const article = await tx.objectStore('articles').get([source.id, match.ordinal]);
        if (article) results.push({ headword: article.headword, text: article.text.slice(0, 12000), phonetic: article.phonetic?.slice(0, 400), dictionary: source.name, matchedAs: match.word, truncated: article.text.length > 12000 });
        if (results.length >= 6) break;
      }
      if (results.length >= 6) break;
    }
    await tx.done; signal?.throwIfAborted(); return results;
  }
  async close() { await this.ready; (await this.db).close(); }
}
