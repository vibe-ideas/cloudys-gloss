import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { captionUrl, videoId, MAX_CAPTION_BYTES } from '../src/video/protocol';
import { createCaptionTrackLoader, type CaptionTrack } from '../src/video/track-loader';
import { capturePlayerCaptions } from '../src/video/capture';
import { EARLY_CAPTIONS, type EarlyCaptionStore } from '../src/video/warmup';

/** Page-world adapter: reads only the active video's player-provided captions.
 * No model credentials, extension APIs, or arbitrary URL fetches live here. */
export default defineUnlistedScript(() => {
  const key = '__cloudysGlossCaptionBridge';
  const scope = window as unknown as Record<string, unknown>;
  if (typeof scope[key] === 'function') (scope[key] as () => void)();
  let retained: { id: string; url: string; body: string } | undefined;
  let session: { channel: string; observer: PerformanceObserver; loader: ReturnType<typeof createCaptionTrackLoader>; capture: ReturnType<typeof capturePlayerCaptions> } | undefined;
  const stop = () => { session?.loader.stop(); session?.capture.stop(); session?.observer.disconnect(); session = undefined; };
  const clear = () => { stop(); retained = undefined; };
  const listener = (event: MessageEvent) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== 'cloudys-gloss:captions:request') return;
    const { channel, id, action } = event.data;
    if (typeof channel !== 'string' || channel.length > 100 || typeof id !== 'string') return;
    if (action === 'stop') { if (session?.channel === channel) stop(); return; }
    if (action !== 'start' || id !== videoId(location.href)) return;
    stop();
    if (retained?.id !== id || event.data.refresh === true) retained = undefined;
    type Player = HTMLElement & { getPlayerResponse?: () => { videoDetails?: { videoId?: string }; captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } } } };
    const early = scope[EARLY_CAPTIONS] as EarlyCaptionStore | undefined;
    let snapshot: ReturnType<EarlyCaptionStore['take']>;
    try { snapshot = typeof early?.take === 'function' ? early.take(id) : undefined; } catch { /* Optional early capture must not block normal loading. */ }
    snapshot ??= retained;
    if (event.data.refresh === true) snapshot = undefined;
    const capture = capturePlayerCaptions(id, (url, startedAt) => loader.capture(url, startedAt));
    const loader = createCaptionTrackLoader({
      id,
      fetch: capture.fetch,
      send: ({ type, body = '', identity }) => {
        if (type === 'selection' && retained) retained = undefined;
        if (type === 'track' && identity) {
          const labels = JSON.parse(identity) as string[];
          const url = new URL('/api/timedtext', location.origin); url.searchParams.set('v', id);
          ['lang', 'kind', 'name', 'vssId'].forEach((key, index) => { if (labels[index]) url.searchParams.set(key, labels[index]); });
          retained = { id, url: url.href, body };
        }
        if (session?.loader === loader && session.channel === channel && videoId(location.href) === id) window.postMessage({ source: 'cloudys-gloss:captions:response', channel, id, type, body, identity }, location.origin);
      },
      readMetadata: () => {
        const data = (document.getElementById('movie_player') as Player | null)?.getPlayerResponse?.();
        return data?.videoDetails?.videoId === id ? data.captions?.playerCaptionsTracklistRenderer?.captionTracks : undefined;
      },
    });
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) loader.observe(entry);
    });
    session = { channel, observer, loader, capture };
    observer.observe({ type: 'resource' });
    const recent = performance.getEntriesByType('resource').reverse().find(entry => captionUrl(entry.name, id));
    const savedUrl = snapshot && typeof snapshot.url === 'string' ? captionUrl(snapshot.url, id) : null;
    if (savedUrl && typeof snapshot?.body === 'string' && snapshot.body.length <= MAX_CAPTION_BYTES && (!recent || ['lang', 'kind', 'name', 'vssId'].every(key => savedUrl.searchParams.get(key) === new URL(recent.name).searchParams.get(key)))) loader.capture(savedUrl.href)?.(snapshot.body);
    loader.start(recent);
    window.postMessage({ source: 'cloudys-gloss:captions:response', channel, id, type: 'ready' }, location.origin);
  };
  window.addEventListener('message', listener);
  document.addEventListener('yt-navigate-start', clear);
  window.addEventListener('pagehide', clear);
  scope[key] = () => { clear(); window.removeEventListener('message', listener); document.removeEventListener('yt-navigate-start', clear); window.removeEventListener('pagehide', clear); delete scope[key]; };
});
