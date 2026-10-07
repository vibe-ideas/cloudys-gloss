import { browser } from 'wxt/browser';
import { stageDictionary, discardStagedDictionary, type ImportedDictionary } from './store';
import type { ImportProgress } from './stardict';

export async function importDictionary(files: File[], signal: AbortSignal, progress: (value: ImportProgress) => void): Promise<ImportedDictionary> {
  signal.throwIfAborted(); progress({ phase: '准备本地文件', completed: 0, total: 1 });
  const id = await stageDictionary(files);
  try {
    signal.throwIfAborted();
    return await new Promise<ImportedDictionary>((resolve, reject) => {
      const port = browser.runtime.connect({ name: 'dictionary-import' }); let settled = false;
      const finish = (error?: Error, data?: ImportedDictionary) => {
        if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort); port.disconnect();
        if (error) reject(error); else resolve(data!);
      };
      // Cancel asks the worker to roll back and waits for acknowledgement before allowing another import.
      const abort = () => { port.postMessage({ type: 'cancel' }); };
      const timer = setTimeout(() => finish(new Error('导入连接超时，请重试')), 600000);
      signal.addEventListener('abort', abort, { once: true });
      port.onDisconnect.addListener(() => finish(new Error('导入连接已断开，请重新选择文件')));
      port.onMessage.addListener(message => {
        if (message.type === 'progress') progress(message.data as ImportProgress);
        if (message.type === 'done') finish(undefined, message.data as ImportedDictionary);
        if (message.type === 'error') finish(new Error(String(message.error)));
      });
      port.postMessage({ type: 'import', id });
    });
  } finally { await discardStagedDictionary(id).catch(() => {}); }
}
