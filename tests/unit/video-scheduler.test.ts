import { describe, expect, it, vi } from 'vitest';
import { SubtitleScheduler, type SubtitleClient, type SubtitleLine } from '../../src/video/scheduler';

function setup() {
  const jobs: { id: string; texts: string[]; item: Parameters<SubtitleClient['translate']>[2]; resolve: (values: string[]) => void; reject: (error: Error) => void }[] = [];
  const client: SubtitleClient = { cancel: vi.fn(), translate: vi.fn((id, texts, item) => new Promise<string[]>((resolve, reject) => { jobs.push({ id, texts, item, resolve, reject }); })) };
  let line: SubtitleLine | undefined;
  const scheduler = new SubtitleScheduler(client, value => { line = value; });
  return { scheduler, client, jobs, line: () => line };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
describe('双语字幕随播放位置调度', () => {
  it('当前句优先，小批预取而非一次翻完整视频，首句流式到达立即显示', async () => {
    const { scheduler, jobs, line } = setup();
    scheduler.setTrack(Array.from({ length: 10000 }, (_, i) => ({ start: i * 5, end: (i + 1) * 5, text: `Sentence ${i}.` })));
    scheduler.tick(30);
    expect(jobs).toHaveLength(1); expect(jobs[0]!.texts[0]).toBe('Sentence 6.'); expect(jobs[0]!.texts).toHaveLength(1);
    jobs[0]!.item(0, '第六句。', false); expect(line()?.translated).toBe('第六句。');
    scheduler.tick(31); expect(jobs).toHaveLength(1);
    jobs[0]!.resolve(jobs[0]!.texts.map(() => '译文。')); await flush();
    expect(line()?.translated).toBe('译文。'); expect(jobs[1]!.texts).toHaveLength(8); scheduler.destroy();
  });
  it('当前句返回后连续分批填充两分钟缓冲，暂停时也预翻译后文', async () => {
    const { scheduler, jobs } = setup();
    scheduler.setTrack(Array.from({ length: 1000 }, (_, i) => ({ start: i * 3, end: (i + 1) * 3, text: `Fast sentence ${i}.` }))); scheduler.tick(0);
    for (let i = 0; i < 7 && jobs[i]; i++) { const job = jobs[i]!; job.resolve(job.texts.map(() => '译文。')); await flush(); }
    const translated = jobs.flatMap(job => job.texts);
    expect(translated).toHaveLength(41); expect(translated).toContain('Fast sentence 40.'); expect(translated).not.toContain('Fast sentence 41.');
    scheduler.tick(1); expect(jobs).toHaveLength(6); scheduler.destroy();
  });
  it('连续倍速播放按实际观看时间扩大缓冲，但不请求整段视频', async () => {
    const { scheduler, jobs } = setup(); scheduler.setTrack(Array.from({ length: 1000 }, (_, i) => ({ start: i * 10, end: (i + 1) * 10, text: `Sentence ${i}.` }))); scheduler.tick(0, false, 2);
    for (let i = 0; i < 6 && jobs[i]; i++) { const job = jobs[i]!; job.resolve(job.texts.map(() => '译文。')); await flush(); }
    const translated = jobs.flatMap(job => job.texts); expect(translated).toHaveLength(25); expect(translated).toContain('Sentence 24.'); scheduler.destroy();
  });
  it('拖动到新位置取消旧请求，迟到的译文不会覆盖新字幕', () => {
    const { scheduler, jobs, client, line } = setup();
    scheduler.setTrack([{ start: 0, end: 5, text: 'First sentence.' }, { start: 100, end: 105, text: 'New sentence.' }]); scheduler.tick(0);
    const old = jobs[0]!; scheduler.tick(101, true);
    expect(client.cancel).toHaveBeenCalledWith(old.id); expect(jobs[1]!.texts).toEqual(['New sentence.']);
    old.item(0, '旧的译文。', true); expect(line()?.original).toBe('New sentence.'); expect(line()?.translated).toBe('');
    scheduler.destroy();
  });
  it('关闭字幕会取消请求并清空画面，迟到响应不会重新显示', () => {
    const { scheduler, jobs, line, client } = setup(); scheduler.setTrack([]); scheduler.setLive('Live captions.');
    scheduler.reset(); jobs[0]!.item(0, '字幕。', true);
    expect(client.cancel).toHaveBeenCalledOnce(); expect(line()?.original).toBe(''); expect(line()?.translated).toBe('');
  });
  it('同一句回看使用会话缓存，中文技术字幕不向模型重复请求', async () => {
    const { scheduler, jobs, line } = setup(); scheduler.setTrack([]); scheduler.setLive('Read this sentence.');
    jobs[0]!.resolve(['读这句话。']); await flush(); scheduler.setLive('这是 Kubernetes 的使用方式。');
    expect(jobs).toHaveLength(1); expect(line()?.pending).toBe(false);
    scheduler.setLive('Read this sentence.'); expect(line()?.translated).toBe('读这句话。'); expect(jobs).toHaveLength(1);
  });
  it('字幕失败展示原因且不会自动重试风暴，点击重试后只恢复当前句', async () => {
    const { scheduler, jobs, line } = setup(); scheduler.setTrack([]); scheduler.setLive('Try again.');
    jobs[0]!.reject(new Error('模型连接失败')); await flush(); scheduler.tick(0); scheduler.tick(1);
    expect(line()?.error).toBe('模型连接失败'); expect(jobs).toHaveLength(1);
    scheduler.retry(); expect(jobs).toHaveLength(2); jobs[1]!.resolve(['再试一次。']); await flush();
    expect(line()?.translated).toBe('再试一次。'); expect(line()?.error).toBe('');
  });
  it('取消的未确认流式字幕不留在缓存，重新开启后会重新请求', () => {
    const { scheduler, jobs, line } = setup(); scheduler.setTrack([]); scheduler.setLive('Read again.');
    jobs[0]!.item(0, '未校验内容', false); scheduler.reset(); scheduler.setTrack([]); scheduler.setLive('Read again.');
    expect(line()?.translated).toBe(''); expect(jobs).toHaveLength(2); scheduler.destroy();
  });
  it('切换字幕语言后不会继续显示旧轨道，同样的句子仍可复用缓存', () => {
    const { scheduler, jobs, line } = setup(); scheduler.setTrack([{ start: 0, end: 5, text: 'English track.' }]); scheduler.tick(0);
    scheduler.setTrack([{ start: 0, end: 5, text: '另一条字幕轨道。' }]); scheduler.tick(0);
    jobs[0]!.item(0, '旧轨道', true); expect(line()?.original).toBe('另一条字幕轨道。'); expect(line()?.translated).toBe('');
  });
});
