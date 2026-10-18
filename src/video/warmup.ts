import { capturePlayerCaptions } from './capture';
import { videoId } from './protocol';

export const EARLY_CAPTIONS = '__cloudysGlossEarlyCaptions';
type Snapshot = { url: string; body: string };
export type EarlyCaptionStore = { take: (id: string) => Snapshot | undefined; dispose: () => void };

/** Catch native CC loaded before the translation button exists. No requests or
 * model calls: retain just the latest native track, only for this video. */
export function installCaptionWarmup(): EarlyCaptionStore {
  let id = ''; let snapshot: Snapshot | undefined; let sequence = 0;
  let capture: ReturnType<typeof capturePlayerCaptions> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const lifetime = new AbortController();
  const stop = () => { sequence++; clearTimeout(timer); capture?.stop(); capture = undefined; };
  const reset = () => { stop(); id = ''; snapshot = undefined; };
  const start = () => {
    const next = videoId(location.href); if (id && id === next) return;
    reset(); id = next; if (!id) return;
    capture = capturePlayerCaptions(id, url => {
      const current = ++sequence; snapshot = undefined;
      const source = new URL(url); const labels = new URLSearchParams();
      for (const key of ['v', 'lang', 'kind', 'name', 'vssId']) { const value = source.searchParams.get(key); if (value !== null) labels.set(key, value); }
      source.search = labels.toString();
      return body => { if (current === sequence && body?.trim()) snapshot = { url: source.href, body }; };
    });
    // Limit startup observation, even when translation is never enabled.
    timer = setTimeout(stop, 30000);
  };
  document.addEventListener('yt-navigate-start', reset, { signal: lifetime.signal });
  document.addEventListener('yt-navigate-finish', start, { signal: lifetime.signal });
  window.addEventListener('pagehide', reset, { signal: lifetime.signal });
  window.addEventListener('pageshow', start, { signal: lifetime.signal });
  start();
  return {
    take(requestedId) { stop(); const result = requestedId === id && id === videoId(location.href) ? snapshot : undefined; snapshot = undefined; return result; },
    dispose() { reset(); lifetime.abort(); },
  };
}
