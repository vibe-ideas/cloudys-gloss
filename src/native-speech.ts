import { z } from 'zod';
import { ConcurrencyQueue } from './queue';

export type SpeechLocale = 'en-US' | 'en-GB';
export type SpeechRoute = { backend: 'native' | 'browser' };
const resultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: z.object({ audio: z.string().min(60).max(800000).regex(/^[A-Za-z0-9+/]+={0,2}$/), voice: z.string() }) }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);

/** One player and one renderer across tabs; bounded memory, no model dependency. */
export class NativeSpeech {
  private queue = new ConcurrencyQueue(1);
  private active?: AbortController;
  private cache = new Map<string, string>();
  private bytes = 0;
  constructor(private native: (message: { action: 'speech'; word: string; locale: SpeechLocale }) => Promise<unknown>, private audio = () => new Audio()) {}

  async play(word: string, locale: SpeechLocale, signal: AbortSignal): Promise<SpeechRoute> {
    signal.throwIfAborted();
    this.active?.abort(new Error('发音已切换'));
    const controller = new AbortController(); this.active = controller;
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    try {
      const key = JSON.stringify([locale, word]);
      const data = await this.queue.run(async () => {
        const cached = this.cache.get(key);
        if (cached) return cached;
        let raw: unknown;
        try { raw = await this.native({ action: 'speech', word, locale }); }
        catch { throw new Error('发音助手未连接，请在项目中运行 pnpm model:bridge 后重试'); }
        controller.signal.throwIfAborted();
        const parsed = resultSchema.safeParse(raw);
        if (!parsed.success) throw new Error('发音助手响应无效，请更新本地助手（pnpm model:bridge）');
        const result = parsed.data;
        if (!result.ok) throw new Error(`${result.error}；请确认本地助手已更新（pnpm model:bridge）`);
        const decoded = atob(result.data.audio.slice(0, 16));
        if (decoded.slice(0, 4) !== 'RIFF' || decoded.slice(8, 12) !== 'WAVE') throw new Error('本地发音返回的音频格式无效');
        const value = `data:audio/wav;base64,${result.data.audio}`;
        while (this.cache.size && (this.bytes + value.length > 2_000_000 || this.cache.size >= 32)) {
          const oldest = this.cache.keys().next().value!;
          this.bytes -= this.cache.get(oldest)!.length; this.cache.delete(oldest);
        }
        this.cache.set(key, value); this.bytes += value.length;
        return value;
      }, controller.signal);
      controller.signal.throwIfAborted();
      await new Promise<void>((resolve, reject) => {
        const player = this.audio();
        let settled = false;
        const finish = (error?: Error) => {
          if (settled) return; settled = true;
          clearTimeout(timer); controller.signal.removeEventListener('abort', stop);
          player.onended = null; player.onerror = null; player.pause(); player.removeAttribute('src'); player.load();
          if (error) reject(error); else resolve();
        };
        const stop = () => finish(new Error('发音已取消'));
        const timer = setTimeout(() => finish(new Error('发音播放超时')), 20000);
        controller.signal.addEventListener('abort', stop, { once: true });
        player.onended = () => finish(); player.onerror = () => finish(new Error('本地语音音频无法播放'));
        player.src = data;
        void player.play().catch(() => finish(new Error('浏览器阻止了音频播放，请允许扩展播放声音后重试')));
      });
      return { backend: 'native' };
    } finally {
      signal.removeEventListener('abort', abort);
      if (this.active === controller) this.active = undefined;
    }
  }
}
