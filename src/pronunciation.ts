export type PronunciationDialect = 'us' | 'uk';
export type PronunciationLoader = (dialect: PronunciationDialect) => Promise<string>;

/** Binary-search sorted TSV without splitting 140k entries into a second in-memory index. */
function findPronunciation(text: string, word: string): string {
  let low = 0; let high = text.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const start = text.lastIndexOf('\n', middle - 1) + 1;
    const newline = text.indexOf('\n', start);
    const end = newline === -1 ? text.length : newline;
    const tab = text.indexOf('\t', start);
    const key = text.slice(start, tab === -1 || tab > end ? end : tab);
    if (key === word) {
      const value = tab !== -1 && tab < end ? text.slice(tab + 1, end).trim() : '';
      // Preserve all variants; do not silently choose a sense or truncate an IPA string.
      return value.length <= 200 ? value : '';
    }
    if (key < word) low = end + 1;
    else high = start;
  }
  return '';
}

/** Cancellation belongs to a caller, not the asset load shared with other lookups. */
function waitFor<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal.reason); };
    const cleanup = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    pending.then((value) => { cleanup(); resolve(value); }, (error: unknown) => { cleanup(); reject(error); });
  });
}

/** Local pronunciation assets are optional; unknown dialects stay empty rather than being invented. */
export class OfflinePronunciationDictionary {
  private loads: Partial<Record<PronunciationDialect, Promise<string>>> = {};
  constructor(private loader: PronunciationLoader) {}

  private load(dialect: PronunciationDialect): Promise<string> {
    return this.loads[dialect] ??= Promise.resolve().then(() => this.loader(dialect)).catch(() => {
      delete this.loads[dialect];
      // A temporarily unavailable dictionary must not prevent the other dialect from working.
      return '';
    });
  }

  async lookup(word: string, signal: AbortSignal): Promise<{ us: string; uk: string }> {
    signal.throwIfAborted();
    const key = word.normalize('NFC').trim().toLowerCase().replace(/\s+/gu, ' ');
    if (!key || key.length > 200 || /[\t\n\r]/u.test(word)) return { us: '', uk: '' };
    const [us, uk] = await waitFor(Promise.all([this.load('us'), this.load('uk')]), signal);
    signal.throwIfAborted();
    // Only exact dictionary entries: composing word IPAs would hide phrase stress and linking.
    return { us: findPronunciation(us, key), uk: findPronunciation(uk, key) };
  }
}
