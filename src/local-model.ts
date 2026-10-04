import { z } from 'zod';
import type { Settings } from './schema';

export const NATIVE_HOST = 'com.cloudys_gloss.mlx';
export const LocalModelStatusSchema = z.object({
  installed: z.boolean(), running: z.boolean(), autostart: z.boolean(), model: z.string(), baseUrl: z.string(),
  runtime: z.string().default('MLX'),
});
export type LocalModelStatus = z.infer<typeof LocalModelStatusSchema>;
export type ModelAction = 'status' | 'start' | 'stop' | 'restart' | 'autostart';
type NativeSend = (message: { action: ModelAction; enabled?: boolean }) => Promise<unknown>;

export function isManagedModel(settings: Settings) {
  const url = new URL(settings.baseUrl);
  return url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === '8080'
    && ['/v1', '/v1/', '/v1/chat/completions'].includes(url.pathname)
    && settings.model === 'mlx-community/Qwen2.5-3B-Instruct-4bit';
}

export class LocalModelManager {
  private starting?: Promise<void>;
  constructor(private native: NativeSend) {}
  async control(action: ModelAction, enabled?: boolean): Promise<LocalModelStatus> {
    let raw: unknown;
    try { raw = await this.native({ action, ...(enabled === undefined ? {} : { enabled }) }); }
    catch { throw new Error('无法连接本地助手。请先在项目中运行 pnpm model:bridge，再重试。'); }
    const response = z.discriminatedUnion('ok', [
      z.object({ ok: z.literal(true), data: LocalModelStatusSchema }),
      z.object({ ok: z.literal(false), error: z.string() }),
    ]).parse(raw);
    if (!response.ok) throw new Error(response.error);
    return response.data;
  }
  async ensure(settings: Settings, signal: AbortSignal) {
    signal.throwIfAborted();
    if (!settings.autoStartLocalModel || !isManagedModel(settings)) return;
    if (!this.starting) {
      this.starting = (async () => {
        try {
          // Any HTTP response means a server owns this address; let the provider
          // report its API errors instead of starting a competing process.
          await fetch(`${settings.baseUrl.replace(/\/chat\/completions\/?$/, '').replace(/\/$/, '')}/models`, { signal: AbortSignal.timeout(1500) });
          return;
        } catch { /* A stopped local server can be started by the installed host. */ }
        await this.control('start');
      })().finally(() => { this.starting = undefined; });
    }
    const starting = this.starting;
    // Cancel this caller immediately without cancelling another tab's startup.
    await new Promise<void>((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      starting.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
      if (signal.aborted) abort();
    });
    signal.throwIfAborted();
  }
}
