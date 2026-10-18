import { captionUrl, MAX_CAPTION_BYTES } from './protocol';

/** Observe only player-initiated caption responses. The original request,
 * response object and promise are returned unchanged; no credentials are read. */
export function capturePlayerCaptions(id: string, begin: (url: string, startedAt: number) => ((body?: string) => void) | undefined) {
  const originalFetch = window.fetch;
  const proto = XMLHttpRequest.prototype;
  const originalOpen = proto.open; const originalSend = proto.send;
  const requests = new WeakMap<XMLHttpRequest, string>();
  const cleanup = new Set<() => void>();
  let stopped = false;
  const address = (value: string) => { try { return captionUrl(new URL(value, location.href).href, id)?.href; } catch { return undefined; } };
  function start(url: string, startedAt = performance.now()) {
    if (stopped || cleanup.size >= 2) return;
    const publish = begin(url, startedAt); if (!publish) return;
    let cancelRead = () => {}; let ended = false;
    const finish = (body?: string) => {
      if (ended) return; ended = true; clearTimeout(timer); cleanup.delete(cancel);
      cancelRead(); publish(body);
    };
    const cancel = () => finish();
    const timer = setTimeout(cancel, 10000); cleanup.add(cancel);
    return { finish, onCancel(callback: () => void) { cancelRead = callback; if (ended) cancelRead(); }, alive: () => !ended };
  }
  const wrappedFetch: typeof fetch = function (this: Window, ...args) {
    const startedAt = performance.now();
    const result = originalFetch.apply(this, args);
    try {
      const input = args[0];
      const url = address(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (!url || (args[1]?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase() !== 'GET') return result;
      const job = start(url, startedAt); if (!job) return result;
      void result.then(async response => {
        if (!job.alive()) return;
        if (!response.ok || Number(response.headers.get('content-length')) > MAX_CAPTION_BYTES) { job.finish(); return; }
        const reader = response.clone().body?.getReader(); if (!reader) { job.finish(); return; }
        job.onCancel(() => { void reader.cancel().catch(() => {}); });
        const decoder = new TextDecoder(); let body = ''; let bytes = 0;
        try {
          while (job.alive()) {
            const chunk = await reader.read(); if (!job.alive()) return;
            if (chunk.done) { job.finish(body + decoder.decode()); return; }
            bytes += chunk.value.byteLength;
            if (bytes > MAX_CAPTION_BYTES) { job.finish(); return; }
            body += decoder.decode(chunk.value, { stream: true });
          }
        } finally { reader.releaseLock(); }
      }).catch(() => job.finish());
    } catch { /* Observation must never change the player's request behavior. */ }
    return result;
  };
  const wrappedOpen: typeof originalOpen = function (this: XMLHttpRequest, ...args: [string, string | URL, boolean?, (string | null)?, (string | null)?]) {
    const [method, url] = args;
    const result = Reflect.apply(originalOpen, this, args);
    requests.delete(this);
    try { const parsed = method.toUpperCase() === 'GET' ? address(String(url)) : undefined; if (parsed) requests.set(this, parsed); } catch { /* Ignore unsupported URLs. */ }
    return result;
  };
  const wrappedSend: typeof originalSend = function (this: XMLHttpRequest, ...args) {
    const url = requests.get(this);
    if (url) {
      const job = start(url);
      if (job) {
        const complete = () => {
          try {
            if (this.status < 200 || this.status >= 300) { job.finish(); return; }
            const text = this.responseType === '' || this.responseType === 'text' ? this.responseText
              : this.responseType === 'json' ? JSON.stringify(this.response) : '';
            job.finish(typeof text === 'string' && text.length <= MAX_CAPTION_BYTES && new TextEncoder().encode(text).byteLength <= MAX_CAPTION_BYTES ? text : undefined);
          } catch { job.finish(); }
        };
        this.addEventListener('loadend', complete, { once: true });
        job.onCancel(() => this.removeEventListener('loadend', complete));
        try { return originalSend.apply(this, args); } catch (error) { job.finish(); throw error; }
      }
    }
    return originalSend.apply(this, args);
  };
  window.fetch = wrappedFetch; proto.open = wrappedOpen; proto.send = wrappedSend;
  return {
    // Loader's own retries bypass this observer, preventing recursion.
    fetch: originalFetch.bind(window),
    stop() {
      stopped = true;
      if (window.fetch === wrappedFetch) window.fetch = originalFetch;
      if (proto.open === wrappedOpen) proto.open = originalOpen;
      if (proto.send === wrappedSend) proto.send = originalSend;
      for (const cancel of [...cleanup]) cancel();
    },
  };
}
