import { afterEach, describe, expect, it, vi } from 'vitest';
import { WordSpeaker } from '../../src/speech';

afterEach(() => vi.unstubAllGlobals());
describe('单词卡发音', () => {
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
