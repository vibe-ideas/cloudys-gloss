import { afterEach, describe, expect, it, vi } from 'vitest';
import { SubtitleScheduler, type SubtitleClient, type SubtitleLine } from '../../src/video/scheduler';

function setup() {
  const jobs: { id: string; texts: string[]; item: Parameters<SubtitleClient['translate']>[2]; resolve: (values: string[]) => void; reject: (error: Error) => void }[] = [];
  const client: SubtitleClient = { cancel: vi.fn(), translate: vi.fn((id, texts, item) => new Promise<string[]>((resolve, reject) => { jobs.push({ id, texts, item, resolve, reject }); })) };
  let line: SubtitleLine | undefined;
  const scheduler = new SubtitleScheduler(client, value => { line = value; });
  return { scheduler, client, jobs, line: () => line };
}
afterEach(() => { vi.useRealTimers(); });
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
  it('字幕等待自动重试时手动重试可立即恢复当前句', async () => {
    const { scheduler, jobs, line } = setup(); scheduler.setTrack([]); scheduler.setLive('Try again.');
    jobs[0]!.reject(new Error('模型连接失败')); await flush(); scheduler.tick(0); scheduler.tick(1);
    expect(line()?.error).toBe(''); expect(line()?.pending).toBe(true); expect(jobs).toHaveLength(1);
    scheduler.retry(); expect(jobs).toHaveLength(2); jobs[1]!.resolve(['再试一次。']); await flush();
    expect(line()?.translated).toBe('再试一次。'); expect(line()?.error).toBe(''); scheduler.destroy();
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
  it('批量失败后的单句补译遇到密钥错误时直接提示，允许修正后手动重试', async () => {
    const { scheduler, jobs, line } = setup();
    scheduler.setTrack(Array.from({ length: 3 }, (_, i) => ({ start: i * 5, end: (i + 1) * 5, text: `Sentence ${i}.` })));
    scheduler.tick(0); jobs[0]!.resolve(['首句。']); await flush();
    jobs[1]!.reject(new Error('批量失败')); await flush();
    scheduler.tick(5); expect(jobs[2]!.texts).toEqual(['Sentence 1.']);
    jobs[2]!.reject(new Error('模型服务返回 HTTP 401')); await flush(); scheduler.tick(6); scheduler.tick(7);
    expect(line()?.error).toBe('模型服务返回 HTTP 401'); expect(jobs).toHaveLength(3);
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
    scheduler.tick(0); jobs[0]!.reject(new Error('模型服务返回 HTTP 401')); await flush();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31000);
    try { scheduler.tick(1); } finally { clock.mockRestore(); }
    expect(jobs[1]!.texts).toEqual(['Sentence 1.', 'Sentence 2.', 'Sentence 3.']);
    scheduler.retry(); expect(client.cancel).toHaveBeenCalledWith(jobs[1]!.id);
    expect(jobs[2]!.texts).toEqual(['Sentence 0.']); expect(line()?.error).toBe('');
    jobs[1]!.item(0, '过期响应。', true); jobs[2]!.resolve(['重试成功。']); await flush();
    expect(line()?.translated).toBe('重试成功。'); scheduler.destroy();
  });

  it('暂停播放时字幕请求失败会自动重试，成功后直接显示中文而不弹错误按钮', async () => {
    vi.useFakeTimers(); const { scheduler, jobs, line } = setup(); scheduler.setLive('Keep watching.');
    jobs[0]!.reject(new Error('模型输出不符合翻译结构要求')); await flush();
    expect(line()?.pending).toBe(true); expect(line()?.error).toBe('');
    await vi.advanceTimersByTimeAsync(499); expect(jobs).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1); expect(jobs[1]!.texts).toEqual(['Keep watching.']);
    jobs[1]!.resolve(['继续观看。']); await flush();
    expect(line()?.translated).toBe('继续观看。'); expect(line()?.pending).toBe(false);
    await vi.advanceTimersByTimeAsync(10000); expect(jobs).toHaveLength(2); scheduler.destroy();
  });
  it('流式译文连续校验失败最多自动重试两次，耗尽后显示原因且手动重试仍可恢复', async () => {
    vi.useFakeTimers(); const { scheduler, jobs, line } = setup(); scheduler.setLive('Keep watching.');
    for (let i = 0; i < 3; i++) {
      jobs[i]!.item(0, '未确认译文。', false); jobs[i]!.reject(new Error('模型输出校验失败')); await flush();
      if (i < 2) {
        expect(line()?.error).toBe('');
        const delay = i === 0 ? 500 : 1500;
        await vi.advanceTimersByTimeAsync(delay - 1); expect(jobs).toHaveLength(i + 1);
        await vi.advanceTimersByTimeAsync(1); expect(jobs).toHaveLength(i + 2);
      }
    }
    expect(line()?.translated).toBe(''); expect(line()?.pending).toBe(false); expect(line()?.error).toBe('模型输出校验失败');
    await vi.advanceTimersByTimeAsync(60000); scheduler.tick(1); expect(jobs).toHaveLength(3);
    scheduler.retry(); jobs[3]!.resolve(['继续观看。']); await flush(); expect(line()?.error).toBe('');
    expect(line()?.translated).toBe('继续观看。'); scheduler.destroy();
  });
  it('自动重试等待期间字幕换句后只翻译新句，旧句计时器不再发起请求', async () => {
    vi.useFakeTimers(); const { scheduler, jobs, line } = setup(); scheduler.setLive('Old sentence.');
    jobs[0]!.reject(new Error('连接失败')); await flush(); scheduler.setLive('New sentence.');
    expect(jobs[1]!.texts).toEqual(['New sentence.']); jobs[1]!.resolve(['新的句子。']); await flush();
    await vi.advanceTimersByTimeAsync(10000); expect(jobs).toHaveLength(2); expect(line()?.translated).toBe('新的句子。'); scheduler.destroy();
  });
  it('自动重试等待期间关闭或切换视频会清除计时器，不再请求旧字幕', async () => {
    vi.useFakeTimers(); const { scheduler, jobs } = setup(); scheduler.setLive('Old video.');
    jobs[0]!.reject(new Error('连接失败')); await flush(); scheduler.reset();
    expect(vi.getTimerCount()).toBe(0); await vi.advanceTimersByTimeAsync(10000); expect(jobs).toHaveLength(1);
    scheduler.setTrack([{ start: 0, end: 5, text: 'New video.' }]); scheduler.tick(0);
    expect(jobs[1]!.texts).toEqual(['New video.']); scheduler.destroy(); expect(vi.getTimerCount()).toBe(0);
  });
  it('模型返回限流时等待更久再重试，播放事件不会提前或重复触发请求', async () => {
    vi.useFakeTimers(); const { scheduler, jobs } = setup(); scheduler.setLive('Keep watching.');
    jobs[0]!.reject(new Error('模型服务返回 HTTP 429')); await flush();
    await vi.advanceTimersByTimeAsync(1000); scheduler.tick(0); scheduler.tick(0);
    await vi.advanceTimersByTimeAsync(999); expect(jobs).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1); expect(jobs).toHaveLength(2);
    jobs[1]!.reject(new Error('模型服务返回 HTTP 429')); await flush();
    await vi.advanceTimersByTimeAsync(3999); expect(jobs).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1); expect(jobs).toHaveLength(3); scheduler.destroy();
  });

  it('自动重试尚未返回但视频已播放到下一句时取消旧请求，优先翻译新句', async () => {
    vi.useFakeTimers(); const { scheduler, jobs, client, line } = setup();
    scheduler.setTrack([{ start: 0, end: 3, text: 'First sentence.' }, { start: 3, end: 6, text: 'Next sentence.' }]);
    scheduler.tick(0); jobs[0]!.reject(new Error('连接失败')); await flush();
    await vi.advanceTimersByTimeAsync(500); expect(jobs).toHaveLength(2);
    scheduler.tick(3); expect(client.cancel).toHaveBeenCalledWith(jobs[1]!.id);
    expect(jobs[2]!.texts).toEqual(['Next sentence.']);
    jobs[1]!.item(0, '过期译文。', true); expect(line()?.translated).toBe('');
    jobs[2]!.resolve(['下一句。']); await flush(); expect(line()?.translated).toBe('下一句。'); scheduler.destroy();
  });

  it('字幕播放过去后迟到的译文仍补入历史，取消的未确认内容不会遗留在记录里', async () => {
    const { scheduler, jobs } = setup();
    scheduler.setTrack([{ start: 0, end: 5, text: 'First sentence.' }, { start: 5, end: 10, text: 'Second sentence.' }]);
    scheduler.tick(0); scheduler.tick(5); jobs[0]!.resolve(['第一句。']); await flush();
    expect(scheduler.history.entries[0]?.translated).toBe('第一句。');
    jobs[1]!.item(0, '未经确认。', false); scheduler.reset();
    expect(scheduler.history.entries[1]?.translated).toBe('');
    scheduler.destroy(); expect(scheduler.history.entries).toHaveLength(0);
  });

  it('实时 CC 连续换句和清屏不取消正常请求，旧句译文会补入历史且下一批优先当前句', async () => {
    const { scheduler, jobs, client } = setup();
    scheduler.setLive('First sentence.', 0); scheduler.setLive('', .2); scheduler.setLive('Second sentence.', .4); scheduler.setLive('Third sentence.', .7);
    expect(client.cancel).not.toHaveBeenCalled(); expect(jobs).toHaveLength(1);
    jobs[0]!.resolve(['第一句。']); await flush();
    expect(scheduler.history.entries[0]?.translated).toBe('第一句。');
    expect(jobs[1]!.texts).toEqual(['Third sentence.', 'Second sentence.']);
    jobs[1]!.resolve(['第三句。', '第二句。']); await flush();
    expect(scheduler.history.entries.map(row => row.translated)).toEqual(['第一句。', '第二句。', '第三句。']); scheduler.destroy();
  });
  it('实时字幕逐词增长时只补最新完整句，不把旧前缀译文显示成新句译文', async () => {
    const { scheduler, jobs, client, line } = setup();
    scheduler.setLive('Read this', 0); scheduler.setLive('Read this sentence', .2); scheduler.setLive('Read this sentence carefully.', .4);
    jobs[0]!.resolve(['阅读这个']); await flush();
    expect(client.cancel).not.toHaveBeenCalled(); expect(line()?.translated).toBe('');
    expect(jobs[1]!.texts).toEqual(['Read this sentence carefully.']);
    jobs[1]!.resolve(['仔细阅读这句话。']); await flush(); expect(line()?.translated).toBe('仔细阅读这句话。');
    expect(scheduler.history.entries).toHaveLength(1); scheduler.destroy();
  });
  it('实时字幕持续过载时仅补最近四条中的小批次，过期字幕不无限排队', async () => {
    vi.useFakeTimers(); const { scheduler, jobs, client } = setup();
    for (let i = 0; i < 30; i++) { scheduler.setLive(`Sentence ${i}.`, i * .5); await vi.advanceTimersByTimeAsync(500); }
    expect(client.cancel).not.toHaveBeenCalled(); expect(jobs).toHaveLength(1);
    jobs[0]!.resolve(['首句。']); await flush(); expect(jobs[1]!.texts).toEqual(['Sentence 29.', 'Sentence 28.', 'Sentence 27.']);
    jobs[1]!.resolve(['末句。', '上一句。', '再上一句。']); await flush(); expect(jobs[2]!.texts).toEqual(['Sentence 26.']);
    jobs[2]!.resolve(['保留的第四句。']); await flush(); expect(jobs).toHaveLength(3);
    expect(scheduler.history.entries[1]?.pending).toBe(false); scheduler.destroy();
  });
  it('限流期间实时字幕不断换句也遵守共享冷却，恢复时优先最新句', async () => {
    vi.useFakeTimers(); const { scheduler, jobs } = setup(); scheduler.setLive('First sentence.', 0);
    jobs[0]!.reject(new Error('模型服务返回 HTTP 429')); await flush();
    await vi.advanceTimersByTimeAsync(500); scheduler.setLive('Second sentence.', .5);
    await vi.advanceTimersByTimeAsync(500); scheduler.setLive('Third sentence.', 1);
    await vi.advanceTimersByTimeAsync(999); expect(jobs).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1); expect(jobs[1]!.texts[0]).toBe('Third sentence.'); scheduler.destroy();
  });
  it('实时模型等待超过十二秒后丢弃过期补译，仍优先请求当前显示的字幕', async () => {
    vi.useFakeTimers(); const { scheduler, jobs } = setup();
    scheduler.setLive('First sentence.', 0); scheduler.setLive('Old backlog.', .5); scheduler.setLive('Current sentence.', 1);
    await vi.advanceTimersByTimeAsync(12001);
    jobs[0]!.resolve(['首句。']); await flush();
    expect(jobs[1]!.texts).toEqual(['Current sentence.']);
    expect(scheduler.history.entries[1]?.pending).toBe(false);
    scheduler.destroy();
  });
  it('拖动视频会清理实时字幕待补队列，迟到结果不能重新显示旧视频内容', async () => {
    const { scheduler, jobs, client } = setup(); scheduler.setLive('Old sentence.', 0); scheduler.setLive('Old backlog.', .5);
    scheduler.tick(100, true); scheduler.setLive('New position.', 100);
    expect(client.cancel).toHaveBeenCalledWith(jobs[0]!.id);
    jobs[0]!.resolve(['旧译文。']); await flush();
    expect(scheduler.history.entries[0]?.translated).toBe(''); expect(scheduler.history.entries[0]?.pending).toBe(false);
    expect(jobs.at(-1)?.texts[0]).toBe('New position.'); scheduler.destroy();
  });

});
