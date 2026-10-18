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
  it('批量预翻译失败后保留已确认字幕，未确认句到播放时单独补译', async () => {
    const { scheduler, jobs, line } = setup();
    scheduler.setTrack(Array.from({ length: 4 }, (_, i) => ({ start: i * 5, end: (i + 1) * 5, text: `Sentence ${i}.` })));
    scheduler.tick(0); jobs[0]!.resolve(['首句。']); await flush();
    expect(jobs[1]!.texts).toEqual(['Sentence 1.', 'Sentence 2.', 'Sentence 3.']);
    jobs[1]!.item(0, '已确认。', true); jobs[1]!.item(1, '未确认。', false);
    jobs[1]!.reject(new Error('模型输出校验失败')); await flush();
    scheduler.tick(5); expect(line()?.translated).toBe('已确认。'); expect(line()?.error).toBe('');
    scheduler.tick(10); expect(jobs[2]!.texts).toEqual(['Sentence 2.']);
    expect(line()?.translated).toBe(''); expect(line()?.pending).toBe(true); expect(line()?.error).toBe('');
    jobs[2]!.resolve(['独立补译。']); await flush(); expect(line()?.translated).toBe('独立补译。');
    scheduler.destroy();
  });
  it('批量失败后的单句补译仍失败时显示原因，重复播放时不自动重试', async () => {
    const { scheduler, jobs, line } = setup();
    scheduler.setTrack(Array.from({ length: 3 }, (_, i) => ({ start: i * 5, end: (i + 1) * 5, text: `Sentence ${i}.` })));
    scheduler.tick(0); jobs[0]!.resolve(['首句。']); await flush();
    jobs[1]!.reject(new Error('批量失败')); await flush();
    scheduler.tick(5); expect(jobs[2]!.texts).toEqual(['Sentence 1.']);
    jobs[2]!.reject(new Error('单句仍失败')); await flush(); scheduler.tick(6); scheduler.tick(7);
    expect(line()?.error).toBe('单句仍失败'); expect(jobs).toHaveLength(3);
    scheduler.retry(); expect(jobs[3]!.texts).toEqual(['Sentence 1.']); scheduler.destroy();
  });
  it('模型撤回不合格的流式译文后恢复等待状态，不把空译文当作缓存命中', () => {
    const { scheduler, jobs, line } = setup(); scheduler.setLive('Read this sentence.');
    jobs[0]!.item(0, '临时译文。', false); expect(line()?.pending).toBe(false);
    jobs[0]!.item(0, '', false); expect(line()?.translated).toBe(''); expect(line()?.pending).toBe(true);
    scheduler.destroy();
  });
  it('当前句失败时点击重试会取消后续预翻译，立即单独请求当前句', async () => {
    const { scheduler, jobs, client, line } = setup();
    scheduler.setTrack(Array.from({ length: 4 }, (_, i) => ({ start: i * 5, end: (i + 1) * 5, text: `Sentence ${i}.` })));
    scheduler.tick(0); jobs[0]!.reject(new Error('当前句失败')); await flush();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31000);
    try { scheduler.tick(1); } finally { clock.mockRestore(); }
    expect(jobs[1]!.texts).toEqual(['Sentence 1.', 'Sentence 2.', 'Sentence 3.']);
    scheduler.retry(); expect(client.cancel).toHaveBeenCalledWith(jobs[1]!.id);
    expect(jobs[2]!.texts).toEqual(['Sentence 0.']); expect(line()?.error).toBe('');
    jobs[1]!.item(0, '过期响应。', true); jobs[2]!.resolve(['重试成功。']); await flush();
    expect(line()?.translated).toBe('重试成功。'); scheduler.destroy();
  });

});
