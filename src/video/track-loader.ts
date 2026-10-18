import { parseCaptions } from './captions';
import { captionUrl, MAX_CAPTION_BYTES } from './protocol';

export type CaptionTrack = { baseUrl: string; languageCode: string; kind?: string };
export type CaptionResource = { name: string; startTime: number };
export type TrackMessage = { type: 'loading' | 'track' | 'unavailable' | 'selection'; body?: string; identity?: string };
type Candidate = { url: string; attempts: number; queued: boolean };
type Selection = { identity: string; candidates: Map<string, Candidate>; abort: AbortController; ready: boolean; metadataStarted: boolean };
const RETRY_DELAYS = [500, 1500];

/** Only stable player track labels belong in identity; signatures and output
 * formats can change while the selected subtitle track stays the same. */
function trackIdentity(url: URL) {
  if (!url.searchParams.get('lang')) return '';
  return JSON.stringify(['lang', 'kind', 'name', 'vssId'].map(key => url.searchParams.get(key) ?? ''));
}

/** Bounded recovery of player-provided tracks. No URL or caption body is logged. */
export function createCaptionTrackLoader(options: {
  id: string;
  send: (message: TrackMessage) => void;
  readMetadata: () => CaptionTrack[] | undefined;
  fetch?: typeof fetch;
}) {
  const request = options.fetch ?? fetch;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const active = new Set<AbortController>();
  // Resource Timing timestamps identify our fetches without suppressing a later
  // player request for the same URL (for example switching back to English).
  const ownRequests = new Map<string, { start: number; end: number }[]>();
  let stopped = false; let candidateCount = 0; let metadataReads = 0;
  let selection: Selection = makeSelection('');
  function makeSelection(identity: string): Selection {
    return { identity, candidates: new Map(), abort: new AbortController(), ready: false, metadataStarted: false };
  }
  function current(selected: Selection) { return !stopped && selection === selected && !selected.abort.signal.aborted; }
  function later(callback: () => void, delay: number) {
    const timer = setTimeout(() => { timers.delete(timer); if (!stopped) callback(); }, delay);
    timers.add(timer);
    return timer;
  }
  function clearTimer(timer: ReturnType<typeof setTimeout>) { clearTimeout(timer); timers.delete(timer); }

  async function load(candidate: Candidate, selected: Selection) {
    const abort = new AbortController(); active.add(abort); candidate.attempts++;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const cancel = () => { abort.abort(); void reader?.cancel().catch(() => {}); };
    selected.abort.signal.addEventListener('abort', cancel, { once: true });
    const timeout = later(cancel, 10000);
    options.send({ type: 'loading' });
    try {
      const own = { start: performance.now(), end: 0 };
      const entries = ownRequests.get(candidate.url) ?? [];
      entries.push(own); ownRequests.set(candidate.url, entries);
      let pending: Promise<Response>;
      try { pending = request(candidate.url, { credentials: 'same-origin', signal: abort.signal }); }
      finally { own.end = performance.now(); }
      const response = await pending;
      if (!current(selected)) { await response.body?.cancel(); return; }
      if (abort.signal.aborted) { await response.body?.cancel(); throw new Error('caption timeout'); }
      if (!response.ok || Number(response.headers.get('content-length')) > MAX_CAPTION_BYTES || !response.body) {
        await response.body?.cancel(); throw new Error('caption response unavailable');
      }
      reader = response.body.getReader();
      const decoder = new TextDecoder(); let body = ''; let bytes = 0;
      while (true) {
        const chunk = await reader.read();
        if (!current(selected)) { await reader.cancel(); return; }
        if (abort.signal.aborted) { await reader.cancel(); throw new Error('caption timeout'); }
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > MAX_CAPTION_BYTES) { await reader.cancel(); throw new Error('caption limit'); }
        body += decoder.decode(chunk.value, { stream: true });
      }
      body += decoder.decode();
      // DOMParser is available in the page world for XML/srv3 captions.
      if (!parseCaptions(body).length) throw new Error('invalid captions');
      if (current(selected) && !selected.ready) {
        selected.ready = true;
        options.send({ type: 'track', body, identity: selected.identity });
      }
    } catch {
      if (current(selected) && !selected.ready) {
        // A failed recent request must not prevent metadata discovery.
        discover(selected);
        const delay = RETRY_DELAYS[candidate.attempts - 1];
        if (delay !== undefined) later(() => {
          if (current(selected) && !selected.ready) { candidate.queued = true; pump(); }
        }, delay);
        options.send({ type: 'unavailable' });
      }
    } finally {
      reader?.releaseLock(); clearTimer(timeout);
      selected.abort.signal.removeEventListener('abort', cancel);
      active.delete(abort); pump();
    }
  }
  function pump() {
    if (!current(selection) || selection.ready) return;
    for (const candidate of selection.candidates.values()) {
      if (active.size >= 2) break;
      if (candidate.queued) { candidate.queued = false; void load(candidate, selection); }
    }
  }
  function add(value: string, fromPlayer: boolean) {
    const url = captionUrl(value, options.id);
    if (!url || stopped) return;
    const identity = trackIdentity(url);
    if (identity && identity !== selection.identity && (fromPlayer || !selection.identity)) {
      selection.abort.abort(); selection = makeSelection(identity);
      options.send({ type: 'selection', identity });
    }
    if (selection.identity && identity !== selection.identity) return;
    if (selection.ready || selection.candidates.has(url.href) || candidateCount >= 8) return;
    candidateCount++;
    selection.candidates.set(url.href, { url: url.href, attempts: 0, queued: true });
    pump();
  }
  function discover(selected: Selection) {
    if (!current(selected) || selected.ready || selected.metadataStarted) return;
    selected.metadataStarted = true;
    function check() {
      if (!current(selected) || selected.ready || metadataReads >= 3) return;
      metadataReads++;
      let tracks: CaptionTrack[] | undefined;
      try { tracks = options.readMetadata(); } catch { /* Player metadata may not be ready yet. */ }
      const eligible = Array.isArray(tracks) ? tracks.filter(track => track && typeof track.languageCode === 'string' && captionUrl(track.baseUrl, options.id)) : undefined;
      // Metadata cannot undo an observed manual/ASR or named-track selection,
      // even when the replacement track uses the same language.
      const matching = selected.identity ? eligible?.filter(track => trackIdentity(captionUrl(track.baseUrl, options.id)!) === selected.identity) : eligible;
      const track = matching?.find(track => track.languageCode === 'en' && track.kind !== 'asr')
        ?? matching?.find(track => track.languageCode.startsWith('en')) ?? matching?.[0];
      if (track) {
        const url = captionUrl(track.baseUrl, options.id)!;
        url.searchParams.set('fmt', 'json3'); add(url.href, false);
      } else {
        const delay = RETRY_DELAYS[metadataReads - 1];
        if (delay !== undefined) later(check, delay);
        options.send({ type: 'unavailable' });
      }
    }
    check();
  }
  return {
    start(recent?: CaptionResource) {
      if (stopped) return;
      if (recent && captionUrl(recent.name, options.id)) add(recent.name, true);
      else discover(selection);
    },
    observe(entry: CaptionResource) {
      const url = captionUrl(entry.name, options.id);
      if (!url || stopped) return;
      // Allow one millisecond for browsers that coarsen performance timestamps.
      if (ownRequests.get(url.href)?.some(own => entry.startTime >= own.start - 1 && entry.startTime <= own.end + 1)) return;
      add(url.href, true);
    },
    stop() {
      stopped = true; selection.abort.abort();
      for (const abort of active) abort.abort();
      for (const timer of timers) clearTimeout(timer);
      timers.clear(); ownRequests.clear();
    },
  };
}
