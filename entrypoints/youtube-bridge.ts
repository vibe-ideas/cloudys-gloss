import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { captionUrl, MAX_CAPTION_BYTES, videoId } from '../src/video/protocol';

/** Page-world adapter: reads only the active video's player-provided captions.
 * No model credentials, extension APIs, or arbitrary URL fetches live here. */
export default defineUnlistedScript(() => {
  const key = '__cloudysGlossCaptionBridge';
  const scope = window as unknown as Record<string, unknown>;
  if (typeof scope[key] === 'function') (scope[key] as () => void)();
  let session: { channel: string; id: string; abort: AbortController; observer: PerformanceObserver; seen: Set<string>; revision: number } | undefined;
  const stop = () => { session?.abort.abort(); session?.observer.disconnect(); session = undefined; };
  const listener = (event: MessageEvent) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== 'cloudys-gloss:captions:request') return;
    const { channel, id, action } = event.data;
    if (typeof channel !== 'string' || channel.length > 100 || typeof id !== 'string') return;
    if (action === 'stop') { if (session?.channel === channel) stop(); return; }
    if (action !== 'start' || id !== videoId(location.href)) return;
    stop();
    const abort = new AbortController();
    const send = (type: string, body = '') => {
      if (session?.channel === channel && !abort.signal.aborted && videoId(location.href) === id) window.postMessage({ source: 'cloudys-gloss:captions:response', channel, id, type, body }, location.origin);
    };
    const load = async (value: string) => {
      const url = captionUrl(value, id); const current = session;
      if (!url || !current || current.seen.has(url.href) || current.seen.size >= 64) return;
      current.seen.add(url.href);
      const revision = ++current.revision;
      send('loading');
      try {
        const response = await fetch(url.href, { credentials: 'same-origin', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]) });
        if (!response.ok || Number(response.headers.get('content-length')) > MAX_CAPTION_BYTES || !response.body) throw new Error('caption response unavailable');
        const reader = response.body.getReader(); const decoder = new TextDecoder(); let body = ''; let bytes = 0;
        try {
          while (true) {
            const chunk = await reader.read(); if (chunk.done) break;
            bytes += chunk.value.byteLength;
            if (bytes > MAX_CAPTION_BYTES) { await reader.cancel(); throw new Error('caption limit'); }
            body += decoder.decode(chunk.value, { stream: true });
          }
          body += decoder.decode();
        } finally { reader.releaseLock(); }
        if (current.revision === revision) send(body.trim() ? 'track' : 'unavailable', body);
      } catch { if (current.revision === revision) send('unavailable'); }
    };
    const observer = new PerformanceObserver(list => {
      // Our own fetch is ignored by seen before it can trigger another fetch.
      for (const entry of list.getEntries()) void load(entry.name);
    });
    session = { channel, id, abort, observer, seen: new Set(), revision: 0 };
    observer.observe({ type: 'resource' });
    const recent = performance.getEntriesByType('resource').reverse().find(entry => captionUrl(entry.name, id));
    if (recent) void load(recent.name);
    else {
      type Player = HTMLElement & { getPlayerResponse?: () => { videoDetails?: { videoId?: string }; captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: { baseUrl: string; languageCode: string; kind?: string }[] } } } };
      try {
        const data = (document.getElementById('movie_player') as Player | null)?.getPlayerResponse?.();
        const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (data?.videoDetails?.videoId === id && Array.isArray(tracks)) {
          const track = tracks.find(track => track.languageCode === 'en' && track.kind !== 'asr') ?? tracks.find(track => track.languageCode.startsWith('en')) ?? tracks[0];
          const url = track && captionUrl(track.baseUrl, id);
          if (url) { url.searchParams.set('fmt', 'json3'); void load(url.href); } else send('unavailable');
        } else send('unavailable');
      } catch { send('unavailable'); }
    }
  };
  window.addEventListener('message', listener);
  scope[key] = () => { stop(); window.removeEventListener('message', listener); delete scope[key]; };
});
