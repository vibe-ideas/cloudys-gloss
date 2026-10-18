import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { captionUrl, videoId } from '../src/video/protocol';
import { createCaptionTrackLoader, type CaptionTrack } from '../src/video/track-loader';

/** Page-world adapter: reads only the active video's player-provided captions.
 * No model credentials, extension APIs, or arbitrary URL fetches live here. */
export default defineUnlistedScript(() => {
  const key = '__cloudysGlossCaptionBridge';
  const scope = window as unknown as Record<string, unknown>;
  if (typeof scope[key] === 'function') (scope[key] as () => void)();
  let session: { channel: string; observer: PerformanceObserver; loader: ReturnType<typeof createCaptionTrackLoader> } | undefined;
  const stop = () => { session?.loader.stop(); session?.observer.disconnect(); session = undefined; };
  const listener = (event: MessageEvent) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== 'cloudys-gloss:captions:request') return;
    const { channel, id, action } = event.data;
    if (typeof channel !== 'string' || channel.length > 100 || typeof id !== 'string') return;
    if (action === 'stop') { if (session?.channel === channel) stop(); return; }
    if (action !== 'start' || id !== videoId(location.href)) return;
    stop();
    type Player = HTMLElement & { getPlayerResponse?: () => { videoDetails?: { videoId?: string }; captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } } } };
    const loader = createCaptionTrackLoader({
      id,
      send: ({ type, body = '', identity }) => {
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
    session = { channel, observer, loader };
    observer.observe({ type: 'resource' });
    const recent = performance.getEntriesByType('resource').reverse().find(entry => captionUrl(entry.name, id));
    loader.start(recent);
  };
  window.addEventListener('message', listener);
  scope[key] = () => { stop(); window.removeEventListener('message', listener); delete scope[key]; };
});
