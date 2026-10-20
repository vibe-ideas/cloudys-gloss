import { createId } from '../core/id';
import type { SpeechLocale, SpeechRoute } from './native-speech';

export interface SpeechTransport {
  play(id: string, word: string, locale: SpeechLocale): Promise<SpeechRoute>;
  cancel(id: string): void;
}
export interface WordSpeech { play(word: string, locale: SpeechLocale): Promise<void>; stop(): void }

/** Web Speech has no gender field: prefer known female voice names in the requested accent. */
export function femaleVoice(voices: SpeechSynthesisVoice[], locale: SpeechLocale) {
  const matching = voices.filter(voice => voice.lang.replace('_', '-').toLowerCase() === locale.toLowerCase());
  const names = locale === 'en-US' ? ['Samantha', 'Ava', 'Allison', 'Susan', 'Zira', 'Jenny', 'Aria', 'Flo', 'Shelley', 'Sandy']
    : ['Serena', 'Kate', 'Martha', 'Hazel', 'Sonia', 'Libby', 'Susan', 'Flo', 'Shelley', 'Sandy'];
  const rank = (voice: SpeechSynthesisVoice) => names.findIndex(name => new RegExp(`\\b${name}\\b`, 'i').test(voice.name ?? ''));
  const female = matching.filter(voice => rank(voice) >= 0 || /\bfemale\b/i.test(voice.name ?? ''));
  female.sort((a, b) => Number(b.localService) - Number(a.localService)
    || (rank(a) < 0 ? names.length : rank(a)) - (rank(b) < 0 ? names.length : rank(b)));
  return female[0] ?? matching.find(voice => voice.localService) ?? matching[0] ?? null;
}

/** The background chooses the route before any browser speech API is touched. */
export class WordSpeaker implements WordSpeech {
  private id?: string;
  private browserStop?: () => void;
  constructor(private transport: SpeechTransport) {}
  async play(word: string, locale: SpeechLocale) {
    this.stop();
    const id = createId(); this.id = id;
    try {
      const route = await this.transport.play(id, word, locale);
      if (this.id !== id || route.backend === 'native') return;
      if (!('speechSynthesis' in window)) throw new Error('此浏览器暂不支持发音');
      await new Promise<void>((resolve, reject) => {
        const utterance = new SpeechSynthesisUtterance(word);
        utterance.lang = locale; utterance.rate = 0.85;
        let started = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const start = () => {
          if (started) return;
          started = true; clearTimeout(timer);
          speechSynthesis.removeEventListener?.('voiceschanged', available);
          utterance.voice = femaleVoice(speechSynthesis.getVoices(), locale);
          speechSynthesis.speak(utterance);
        };
        const available = () => { if (speechSynthesis.getVoices().length) start(); };
        const finish = (error?: Error) => {
          started = true; clearTimeout(timer);
          speechSynthesis.removeEventListener?.('voiceschanged', available);
          utterance.onend = null; utterance.onerror = null; this.browserStop = undefined;
          if (error) reject(error); else resolve();
        };
        this.browserStop = () => { finish(); speechSynthesis.cancel(); };
        utterance.onend = () => finish();
        utterance.onerror = () => finish(new Error('发音不可用，请安装系统英语语音'));
        if (speechSynthesis.getVoices().length) start();
        else {
          speechSynthesis.addEventListener?.('voiceschanged', available);
          timer = setTimeout(start, 500);
        }
      });
    } finally { if (this.id === id) this.id = undefined; }
  }
  stop() {
    const id = this.id; this.id = undefined;
    if (id) this.transport.cancel(id);
    this.browserStop?.();
  }
}
