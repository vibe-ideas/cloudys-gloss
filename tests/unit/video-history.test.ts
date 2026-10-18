import { describe, expect, it } from 'vitest';
import { SubtitleHistory, subtitleTime } from '../../src/video/history';
const line = (start: number, original = `Sentence ${start}.`, translated = '') => ({ start, original, translated, pending: !translated, error: '' });

describe('视频字幕观看记录', () => {
  it('重复播放同一句只更新译文，向前跳转后记录仍按时间排列', () => {
    const history = new SubtitleHistory();
    history.observe(line(10)); history.observe(line(20)); history.observe(line(5)); history.observe(line(10, 'Sentence 10.', '第十秒。'));
    expect(history.entries.map(row => row.start)).toEqual([5, 10, 20]);
    expect(history.entries[1]?.translated).toBe('第十秒。'); expect(history.currentStart).toBe(10);
  });
  it('播放位置更新但字幕内容未变时不重复刷新侧栏', () => {
    const history = new SubtitleHistory(); history.observe(line(0)); const revision = history.revision;
    history.observe(line(0)); expect(history.revision).toBe(revision);
    history.update('尚未播放的字幕', '译文。'); expect(history.revision).toBe(revision);
  });
  it('迟到的译文补入历史记录，校验撤回时清除不合格内容', () => {
    const history = new SubtitleHistory(); history.observe(line(0, 'Repeated.')); history.observe(line(5, 'Repeated.'));
    history.update('Repeated.', '重复出现。'); expect(history.entries.every(row => row.translated === '重复出现。')).toBe(true);
    history.update('Repeated.', '', '校验失败'); expect(history.entries.every(row => !row.translated && row.error === '校验失败')).toBe(true);
  });
  it('实时字幕逐词增长时更新同一时间的句子，不堆叠重复记录', () => {
    const history = new SubtitleHistory(); history.observe(line(1, 'Hello')); history.observe(line(1, 'Hello world.'));
    history.update('Hello', '你好'); expect(history.entries).toHaveLength(1); expect(history.entries[0]?.translated).toBe('');
    history.update('Hello world.', '你好，世界。'); expect(history.entries[0]?.translated).toBe('你好，世界。');
  });
  it('长视频只保留最近一千条观看记录，清空后不混入上一个视频', () => {
    const history = new SubtitleHistory(); for (let i = 0; i < 1200; i++) history.observe(line(i));
    expect(history.entries).toHaveLength(1000); expect(history.entries[0]?.start).toBe(200);
    expect(history.indexAt(199)).toBe(-1); expect(history.indexAt(500)).toBe(300);
    history.observe(line(5)); expect(history.entries).toHaveLength(1000); expect(history.entries[0]?.start).toBe(5); expect(history.currentStart).toBe(5);
    history.clear(); history.update('Sentence 500.', '旧视频。'); expect(history.entries).toEqual([]); expect(history.currentStart).toBeUndefined();
  });
  it('字幕时间戳超过一小时后显示时分秒，跳转保留原始小数精度', () => {
    expect(subtitleTime(65.9)).toBe('01:05'); expect(subtitleTime(3665.9)).toBe('1:01:05');
    const history = new SubtitleHistory(); history.observe(line(65.9)); expect(history.entries[0]?.start).toBe(65.9);
  });
});
