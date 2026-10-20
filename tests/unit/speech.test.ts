import { afterEach, describe, expect, it, vi } from 'vitest';
import { femaleVoice, WordSpeaker } from '../../src/speech/speech';

afterEach(() => vi.unstubAllGlobals());
describe('单词卡发音', () => {
  it('男声排在列表前面时仍选择对应口音的本地女声，不混用英美声音', () => {
    const voices = [
      { name: 'Daniel', lang: 'en-GB', localService: true },
      { name: 'Samantha (英语（美国）)', lang: 'en-US', localService: true },
      { name: 'Google UK English Female', lang: 'en-GB', localService: false },
      { name: 'Flo (英语（英国）)', lang: 'en-GB', localService: true },
    ] as SpeechSynthesisVoice[];
    expect(femaleVoice(voices, 'en-US')).toBe(voices[1]);
    expect(femaleVoice(voices, 'en-GB')).toBe(voices[3]);
  });
  it('浏览器稍后才加载语音列表时等待女声，等待期间关闭词卡不会迟到播放', async () => {
    const events = new EventTarget(); let voices: SpeechSynthesisVoice[] = [];
    const speak = vi.fn();
    vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
    vi.stubGlobal('speechSynthesis', { speak, cancel: vi.fn(), getVoices: () => voices,
      addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) });
    const speaker = new WordSpeaker({ play: async () => ({ backend: 'browser' }), cancel: vi.fn() });
    const pending = speaker.play('cloudy', 'en-US'); await Promise.resolve();
    expect(speak).not.toHaveBeenCalled();
    voices = [{ name: 'Samantha', lang: 'en-US', localService: true }] as SpeechSynthesisVoice[];
    events.dispatchEvent(new Event('voiceschanged'));
    expect(speak.mock.calls[0]![0].voice).toBe(voices[0]);
    speaker.stop(); await pending;
    voices = []; const cancelled = speaker.play('cloudy', 'en-US'); await Promise.resolve();
    speaker.stop(); await cancelled;
    voices = [{ name: 'Samantha', lang: 'en-US', localService: true }] as SpeechSynthesisVoice[];
    events.dispatchEvent(new Event('voiceschanged')); expect(speak).toHaveBeenCalledTimes(1);
  });
  it('系统音频播放成功或失败时都不触碰浏览器语音接口', async () => {
    const speak = vi.fn(); const cancel = vi.fn();
    vi.stubGlobal('speechSynthesis', { speak, cancel });
    const play = vi.fn().mockResolvedValueOnce({ backend: 'native' }).mockRejectedValueOnce(new Error('助手未连接'));
    const speaker = new WordSpeaker({ play, cancel: vi.fn() });
    await speaker.play('cloudy', 'en-US');
    await expect(speaker.play('cloudy', 'en-GB')).rejects.toThrow('助手未连接');
    speaker.stop();
    expect(speak).not.toHaveBeenCalled(); expect(cancel).not.toHaveBeenCalled();
  });
  it('关闭卡片后才返回的播放请求不会发出声音，并通知后台取消', async () => {
    const speak = vi.fn(); vi.stubGlobal('speechSynthesis', { speak });
    let resolve!: (route: { backend: 'browser' }) => void;
    const cancel = vi.fn();
    const speaker = new WordSpeaker({ play: () => new Promise(done => { resolve = done; }), cancel });
    const playing = speaker.play('cloudy', 'en-US'); speaker.stop();
    resolve({ backend: 'browser' }); await playing;
    expect(cancel).toHaveBeenCalledOnce(); expect(speak).not.toHaveBeenCalled();
  });
  it('其他浏览器播放所选口音，关闭卡片时停止朗读', async () => {
    const voice = { lang: 'en-GB', localService: true };
    const speak = vi.fn(); const cancel = vi.fn();
    vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
    vi.stubGlobal('speechSynthesis', { speak, cancel, getVoices: () => [voice] });
    const speaker = new WordSpeaker({ play: async () => ({ backend: 'browser' }), cancel: vi.fn() });
    const playing = speaker.play('cloudy', 'en-GB');
    await vi.waitFor(() => expect(speak).toHaveBeenCalledOnce());
    expect(speak.mock.calls[0]![0]).toMatchObject({ text: 'cloudy', lang: 'en-GB', voice });
    speaker.stop(); await playing; expect(cancel).toHaveBeenCalledOnce();
  });
});
