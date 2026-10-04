import { browser } from 'wxt/browser';
import type { Request, Response } from './schema';
const streams = new Map<string, () => void>();
export function translateStream(id: string, texts: string[], onItem: (index: number, text: string, confirmed: boolean) => void): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const port = browser.runtime.connect({ name: 'translation-stream' });
    let settled = false;
    const finish = (error?: Error, translations?: string[]) => {
      if (settled) return; settled = true; streams.delete(id); clearTimeout(timer);
      port.disconnect();
      if (error) reject(error); else resolve(translations!);
    };
    // Includes the maximum configured timeout and time spent in the shared queue.
    const timer = setTimeout(() => finish(new Error('翻译等待超时，请重试')), 600000);
    streams.set(id, () => finish(new Error('请求已取消')));
    port.onDisconnect.addListener(() => finish(new Error('扩展连接已断开，请刷新页面后重试')));
    port.onMessage.addListener((raw: unknown) => {
      if (settled) return;
      if (!raw || typeof raw !== 'object') { finish(new Error('翻译进度消息无效')); return; }
      const event = raw as Record<string, unknown>;
      if (event.type === 'item' && typeof event.index === 'number' && Number.isInteger(event.index) && event.index >= 0 && event.index < texts.length
        && typeof event.text === 'string' && event.text.length <= 20000 && typeof event.confirmed === 'boolean') onItem(event.index, event.text, event.confirmed);
      else if (event.type === 'done' && Array.isArray(event.translations) && event.translations.length === texts.length
        && event.translations.every((text) => typeof text === 'string' && text.length > 0 && text.length <= 20000)) finish(undefined, event.translations);
      else if (event.type === 'error' && typeof event.error === 'string') finish(new Error(event.error));
      else finish(new Error('翻译进度消息无效'));
    });
    port.postMessage({ type: 'translate', id, texts });
  });
}
export async function send<T>(request: Request): Promise<T> {
  const response = await browser.runtime.sendMessage(request) as Response<T> | undefined;
  if (!response) throw new Error('扩展连接已失效，请刷新页面后重试');
  if (!response.ok) throw new Error(response.error);
  return response.data;
}
export function cancel(id: string) {
  const stream = streams.get(id);
  if (stream) stream(); else void send({ type: 'cancel', id }).catch(() => {});
}
