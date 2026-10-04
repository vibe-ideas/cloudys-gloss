import { openDB, type DBSchema } from 'idb';
interface CacheDB extends DBSchema {
  results: { key: string; value: { key: string; value: unknown; expires: number; created: number }; indexes: { created: number } };
}
export async function cacheKey(parts: unknown[]) {
  const bytes = new TextEncoder().encode(JSON.stringify(['v1', ...parts]));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export class ResultCache {
  private db;
  constructor(name = 'cloudys-gloss-cache', private maxEntries = 1500, private ttl = 30 * 86400000) {
    this.db = openDB<CacheDB>(name, 1, { upgrade(db) {
      db.createObjectStore('results', { keyPath: 'key' }).createIndex('created', 'created');
    } });
  }
  async get(key: string): Promise<unknown> {
    try {
      const db = await this.db;
      const row = await db.get('results', key);
      if (row && row.expires > Date.now()) return row.value;
      if (row) await db.delete('results', key);
    } catch { /* Cache failure must not prevent translation. */ }
    return undefined;
  }
  async set(key: string, value: unknown) {
    try {
      const db = await this.db;
      const tx = db.transaction('results', 'readwrite');
      await tx.store.put({ key, value, created: Date.now(), expires: Date.now() + this.ttl });
      let excess = (await tx.store.count()) - this.maxEntries;
      let cursor = await tx.store.index('created').openCursor();
      while (excess-- > 0 && cursor) { await cursor.delete(); cursor = await cursor.continue(); }
      await tx.done;
    } catch { /* Browsers may deny storage or exceed quota. */ }
  }
  async clear() { await (await this.db).clear('results'); }
}
