import { readFile } from 'node:fs/promises';
import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../support/fixtures';
import { subtitleTrack, youtubeFixture } from './youtube-fixture';

async function openPlayer(extension: { context: BrowserContext; page: Page }, track = subtitleTrack) {
  const video = await readFile('tests/e2e/video/timeline.webm');
  await extension.context.route('https://www.youtube.com/**', route => {
    if (route.request().url().endsWith('/timeline.webm')) {
      const range = route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);
      const start = range ? Number(range[1]) : 0; const end = range?.[2] ? Math.min(Number(range[2]), video.length - 1) : video.length - 1;
      return route.fulfill({ status: range ? 206 : 200, contentType: 'video/webm', headers: { 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${video.length}` } : {}) }, body: video.subarray(start, end + 1) });
    }
    return route.fulfill({ status: 200, contentType: route.request().url().includes('/api/timedtext') ? 'application/json' : 'text/html', body: route.request().url().includes('/api/timedtext') ? track : youtubeFixture });
  });
  await extension.page.goto('https://www.youtube.com/watch?v=owned-video');
  await expect.poll(() => extension.page.locator('video').evaluate(video => (video as HTMLVideoElement).readyState)).toBeGreaterThan(0);
  await expect(extension.page.getByRole('button', { name: '开启双语字幕', exact: true })).toBeVisible();
}

test('YouTube 双语字幕逐句返回，拖动定位新字幕，全屏显示且关闭恢复 CC', async ({ extension }, testInfo) => {
  const { page, server } = extension;
  server.setTranslation('Welcome to the video.', '欢迎观看这个视频。');
  server.setTranslation('Sentence 40.', '拖动之后的句子。');
  await openPlayer(extension);
  expect(server.calls).toHaveLength(0);
  server.holdStreams();
  await page.getByRole('button', { name: '开启双语字幕', exact: true }).click();
  const subtitles = page.locator('[data-cloudys-gloss="video-subtitles"]');
  await expect(subtitles.locator('.translation')).toHaveText('欢迎观看这个视频。');
  expect(server.finishedStreams).toBe(0);
  expect(server.calls.flatMap(call => call.texts ?? []).length).toBeLessThanOrEqual(16);
  await expect(page.locator('.ytp-caption-window-container')).toHaveCSS('visibility', 'hidden');
  await page.screenshot({ path: testInfo.outputPath('bilingual-subtitles.png') });
  server.releaseStreams();
  await page.evaluate(() => (window as unknown as { setClock: (time: number) => void }).setClock(201));
  await expect(page.locator('video')).toHaveJSProperty('currentTime', 201);
  await expect(subtitles.locator('.original')).toHaveText('Sentence 40.');
  await expect(subtitles.locator('.translation')).toHaveText('拖动之后的句子。');
  await page.getByRole('button', { name: '全屏', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.id)).toBe('movie_player');
  await expect(subtitles.locator('.translation')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('fullscreen-subtitles.png') });
  await page.evaluate(() => document.exitFullscreen());
  await page.getByRole('button', { name: '关闭双语字幕', exact: true }).click();
  await expect(subtitles.locator('.original')).toHaveCount(0);
  await expect(page.locator('.ytp-caption-window-container')).toHaveCSS('visibility', 'visible');
  await expect(page.locator('.ytp-subtitles-button')).toHaveAttribute('aria-pressed', 'false');
});

test('字幕轨道读取失败时翻译当前 CC，显示错误原因并允许仅重试这句', async ({ extension }) => {
  const { page, server } = extension; await openPlayer(extension, '');
  server.setTranslationFailure(503);
  await page.getByRole('button', { name: '开启双语字幕', exact: true }).click();
  const subtitles = page.locator('[data-cloudys-gloss="video-subtitles"]');
  await expect(subtitles.locator('.original')).toHaveText('Welcome to the video.');
  await expect(subtitles.getByRole('button', { name: '重试这句', exact: true })).toBeVisible();
  await subtitles.getByRole('button', { name: '错误原因', exact: true }).click();
  await expect(subtitles.locator('.error')).not.toBeEmpty();
  server.setTranslationFailure(0); server.setTranslation('Welcome to the video.', '这句重试成功。');
  await subtitles.getByRole('button', { name: '重试这句', exact: true }).click();
  await expect(subtitles.locator('.translation')).toHaveText('这句重试成功。');
  await page.locator('.ytp-caption-segment').evaluate(node => { node.textContent = '这是中文字幕，保留 API 名称。'; });
  await expect(subtitles.locator('.original')).toHaveText('这是中文字幕，保留 API 名称。');
  await expect(subtitles.locator('.translation')).toHaveCount(0);
  expect(server.calls.flatMap(call => call.texts ?? [])).not.toContain('这是中文字幕，保留 API 名称。');
});

test('YouTube SPA 换视频只保留一个字幕开关，广告期间隐藏译文，关闭后保留原先开启的 CC', async ({ extension }) => {
  const { page, server } = extension; await openPlayer(extension);
  await page.locator('.ytp-subtitles-button').click();
  await page.getByRole('button', { name: '开启双语字幕', exact: true }).click();
  const subtitles = page.locator('[data-cloudys-gloss="video-subtitles"]');
  await expect(subtitles.locator('.translation')).toBeVisible();
  await page.locator('#movie_player').evaluate(player => player.classList.add('ad-showing'));
  await expect(subtitles.locator('.translation')).toHaveCount(0);
  await page.locator('#movie_player').evaluate(player => player.classList.remove('ad-showing'));
  await expect(subtitles.locator('.translation')).toBeVisible();
  await page.evaluate(() => {
    document.dispatchEvent(new Event('yt-navigate-start')); history.pushState({}, '', '/watch?v=second-video');
    document.querySelector('.ytp-caption-segment')!.textContent = '';
    document.dispatchEvent(new Event('yt-navigate-finish'));
  });
  await expect(page.locator('[data-cloudys-gloss="video-toggle"]')).toHaveCount(1);
  await expect(subtitles).toHaveCount(1);
  await expect(subtitles.locator('.translation')).toBeVisible();
  await page.getByRole('button', { name: '关闭双语字幕', exact: true }).click();
  await expect(page.locator('.ytp-subtitles-button')).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => (window as unknown as { setClock: (time: number) => void }).setClock(301));
  await expect(subtitles.locator('.original')).toHaveCount(0);
  expect(server.calls.flatMap(call => call.texts ?? [])).not.toContain('Sentence 60.');
});


test('暂停时持续预翻译两分钟，随后连续播放使用缓冲译文而非逐句等待请求', async ({ extension }) => {
  const { page, server } = extension; await openPlayer(extension);
  server.setDelay(120);
  await page.getByRole('button', { name: '开启双语字幕', exact: true }).click();
  await expect.poll(() => server.calls.flatMap(call => call.texts ?? [])).toContain('Sentence 24.');
  await expect.poll(() => server.finishedStreams).toBeGreaterThanOrEqual(4);
  expect(server.calls.flatMap(call => call.texts ?? [])).not.toContain('Sentence 25.');
  const calls = server.calls.length;
  await page.evaluate(() => (window as unknown as { setClock: (time: number) => void }).setClock(61));
  await expect(page.locator('[data-cloudys-gloss="video-subtitles"] .translation')).toContainText('Sentence 12.');
  // Only future refill is requested; revisiting an already buffered cue is free.
  expect(server.calls.slice(calls).flatMap(call => call.texts ?? [])).not.toContain('Sentence 12.');
});

for (const failure of ['服务暂时不可用', '模型输出不合格'] as const) {
  test(`字幕遇到${failure}后自动重试成功，全程无需点击重试按钮`, async ({ extension }) => {
    const { page, server } = extension; await openPlayer(extension, '');
    if (failure === '服务暂时不可用') server.setTranslationFailure(503); else server.setInvalid(true);
    await page.getByRole('button', { name: '开启双语字幕', exact: true }).click();
    const subtitles = page.locator('[data-cloudys-gloss="video-subtitles"]');
    // Invalid structured output also goes through the provider's plain-text repair.
    await expect.poll(() => server.calls.length).toBeGreaterThanOrEqual(failure === '服务暂时不可用' ? 1 : 2);
    await expect(subtitles.getByRole('button', { name: '重试这句', exact: true })).toHaveCount(0);
    server.setTranslationFailure(0); server.setInvalid(false);
    server.setTranslation('Welcome to the video.', '自动恢复的中文字幕。');
    await expect(subtitles.locator('.translation')).toHaveText('自动恢复的中文字幕。');
    await expect(subtitles.getByRole('button', { name: '重试这句', exact: true })).toHaveCount(0);
    expect(server.calls.every(call => call.texts?.length === 1 && call.texts[0] === 'Welcome to the video.')).toBe(true);
  });
}
