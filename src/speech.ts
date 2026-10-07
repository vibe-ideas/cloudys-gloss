import { createId } from './id';
import type { SpeechLocale, SpeechRoute } from './native-speech';

export interface SpeechTransport {
  play(id: string, word: string, locale: SpeechLocale): Promise<SpeechRoute>;
  cancel(id: string): void;
}
export interface WordSpeech { play(word: string, locale: SpeechLocale): Promise<void>; stop(): void }

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
        const voices = speechSynthesis.getVoices();
        utterance.voice = voices.find(voice => voice.lang === locale && voice.localService) ?? voices.find(voice => voice.lang === locale) ?? null;
        const finish = (error?: Error) => {
          utterance.onend = null; utterance.onerror = null; this.browserStop = undefined;
          if (error) reject(error); else resolve();
        };
        this.browserStop = () => { finish(); speechSynthesis.cancel(); };
        utterance.onend = () => finish();
        utterance.onerror = () => finish(new Error('发音不可用，请安装系统英语语音'));
        speechSynthesis.speak(utterance);
      });
    } finally { if (this.id === id) this.id = undefined; }
  }
  stop() {
    const id = this.id; this.id = undefined;
    if (id) this.transport.cancel(id);
    this.browserStop?.();
  }
}
