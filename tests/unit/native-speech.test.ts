import { describe, expect, it, vi } from 'vitest';
import { NativeSpeech } from '../../src/speech/native-speech';

const result = { ok: true, data: { audio: btoa('RIFF0000WAVE' + '\0'.repeat(40)), voice: 'Samantha' } };
function player() {
  return { src: '', onended: null as null | (() => void), onerror: null as null | (() => void),
    play: vi.fn(async () => {}), pause: vi.fn(), load: vi.fn(), removeAttribute: vi.fn() };
}
describe('Firefox macOS 系统发音', () => {
  it('同一词同一口音重复播放复用音频，切换口音重新生成', async () => {
    const native = vi.fn(async () => result); const audio = player();
    const speech = new NativeSpeech(native, () => audio as unknown as HTMLAudioElement);
    for (const locale of ['en-US', 'en-US', 'en-GB'] as const) {
      const playing = speech.play('cloudy', locale, new AbortController().signal);
      await vi.waitFor(() => expect(audio.onended).not.toBeNull());
      expect(audio.src).toMatch(/^data:audio\/wav;base64,/);
      audio.onended!(); await expect(playing).resolves.toEqual({ backend: 'native' });
    }
    expect(native).toHaveBeenCalledTimes(2);
    expect(native.mock.calls[1]).toEqual([{ action: 'speech', word: 'cloudy', locale: 'en-GB' }]);
    expect(audio.pause).toHaveBeenCalledTimes(3);
  });
  it('生成期间关闭词卡，即使音频随后返回也不播放', async () => {
    let resolve!: (value: typeof result) => void;
    const native = vi.fn(() => new Promise<typeof result>(done => { resolve = done; }));
    const audio = player(); const controller = new AbortController();
    const speech = new NativeSpeech(native, () => audio as unknown as HTMLAudioElement);
    const playing = speech.play('cloudy', 'en-US', controller.signal);
    const rejected = expect(playing).rejects.toThrow();
    await vi.waitFor(() => expect(native).toHaveBeenCalledOnce());
    controller.abort(); resolve(result); await rejected;
    expect(audio.play).not.toHaveBeenCalled();
  });
  it('正在播放时切换口音，旧音频停止且新音频独立播放', async () => {
    const players = [player(), player()] as const; let index = 0;
    const speech = new NativeSpeech(async () => result, () => players[index++] as unknown as HTMLAudioElement);
    const first = speech.play('cloudy', 'en-US', new AbortController().signal);
    const rejected = expect(first).rejects.toThrow('取消');
    await vi.waitFor(() => expect(players[0].play).toHaveBeenCalledOnce());
    const second = speech.play('cloudy', 'en-GB', new AbortController().signal);
    await rejected;
    await vi.waitFor(() => expect(players[1].play).toHaveBeenCalledOnce());
    expect(players[0].pause).toHaveBeenCalledOnce(); players[1].onended!(); await second;
  });
  it('助手缺失或返回错误时给出修复提示，不创建音频播放器', async () => {
    const audio = vi.fn();
    const native = vi.fn().mockRejectedValueOnce(new Error('missing')).mockResolvedValueOnce({ ok: false, error: '不支持的服务操作' });
    const speech = new NativeSpeech(native, audio);
    for (let i = 0; i < 2; i++) await expect(speech.play('cloudy', 'en-US', new AbortController().signal)).rejects.toThrow('pnpm model:bridge');
    expect(audio).not.toHaveBeenCalled();
  });
});
