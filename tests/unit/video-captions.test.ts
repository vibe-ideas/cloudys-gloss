import { describe, expect, it } from 'vitest';
import { captionIndex, captionPhrases, parseCaptions } from '../../src/video/captions';

import { captionUrl, videoId } from '../../src/video/protocol';

describe('YouTube 字幕轨道', () => {
  it('自动字幕按显示片段还原文字，并截断滚动字幕的时间重叠', () => {
    expect(parseCaptions(JSON.stringify({ events: [
      { tStartMs: 0, dDurationMs: 5000, segs: [{ utf8: 'Hello ' }, { utf8: 'world.' }] },
      { tStartMs: 3000, dDurationMs: 2000, segs: [{ utf8: 'Next sentence.' }] },
    ] }))).toEqual([{ start: 0, end: 3, text: 'Hello world.' }, { start: 3, end: 5, text: 'Next sentence.' }]);
  });
  it('追加式自动字幕在同一时间窗口内合并，避免每个单词单独翻译', () => {
    expect(parseCaptions(JSON.stringify({ events: [
      { tStartMs: 0, dDurationMs: 5000, segs: [{ utf8: 'Hello' }] },
      { tStartMs: 1000, dDurationMs: 3000, aAppend: 1, segs: [{ utf8: ' world.' }] },
    ] }))).toEqual([{ start: 0, end: 5, text: 'Hello world.' }]);
  });
  it('旧版 XML 和 srv3 字幕保留实体文字，不作为网页 HTML 执行', () => {
    expect(parseCaptions('<transcript><text start="1" dur="2">Use &lt;script&gt; &amp; APIs.</text></transcript>')).toEqual([{ start: 1, end: 3, text: 'Use <script> & APIs.' }]);
    expect(parseCaptions('<timedtext><body><p t="1000" d="2000"><s>Use </s><s>APIs.</s></p></body></timedtext>')[0]?.text).toBe('Use APIs.');
  });
  it.each(['', '<html>Error</html>', '{"events":[{"tStartMs":-1}]}', '{"events":"bad"}', '<timedtext><p>broken'])('空响应或损坏字幕 %s 不会产生可翻译内容', raw => {
    expect(parseCaptions(raw)).toEqual([]);
  });
  it('相邻未完句合并，但停顿、句号和过长片段保持分开', () => {
    expect(captionPhrases([
      { start: 0, end: 2, text: 'We build' }, { start: 2, end: 4, text: 'a local model.' },
      { start: 4, end: 6, text: 'Then we test it.' }, { start: 7, end: 9, text: 'Another' },
      { start: 10, end: 12, text: 'thought' }, { start: 12, end: 24, text: 'continues' },
    ])).toEqual([
      { start: 0, end: 4, text: 'We build a local model.' }, { start: 4, end: 6, text: 'Then we test it.' },
      { start: 7, end: 9, text: 'Another' }, { start: 10, end: 12, text: 'thought' }, { start: 12, end: 24, text: 'continues' },
    ]);
  });
  it('长视频定位当前句时正确处理开头、间隙和结束边界', () => {
    const cues = Array.from({ length: 10000 }, (_, i) => ({ start: i * 3, end: i * 3 + 2, text: String(i) }));
    expect(captionIndex(cues, 0)).toBe(0); expect(captionIndex(cues, 2)).toBe(-1);
    expect(captionIndex(cues, 29997.5)).toBe(9999); expect(captionIndex(cues, 30000)).toBe(-1);
  });
  it('只读取当前视频的 YouTube 原文字幕地址，拒绝其他站点和自动翻译轨道', () => {
    expect(captionUrl('https://www.youtube.com/api/timedtext?v=example&lang=en&pot=player-token', 'example')).not.toBeNull();
    for (const url of ['https://evil.com/api/timedtext?v=example', 'http://www.youtube.com/api/timedtext?v=example', 'https://www.youtube.com/api/timedtext?v=other', 'https://www.youtube.com/api/timedtext?v=example&tlang=zh', 'https://www.youtube.com/watch?v=example']) expect(captionUrl(url, 'example')).toBeNull();
  });
  it('普通播放页和嵌入播放器识别视频，首页不启动字幕会话', () => {
    expect(videoId('https://www.youtube.com/watch?v=example')).toBe('example');
    expect(videoId('https://www.youtube.com/embed/example')).toBe('example');
    expect(videoId('https://www.youtube.com/')).toBe('');
  });
});
