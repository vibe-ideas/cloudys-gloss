import { readFile } from 'node:fs/promises';
import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../support/fixtures';
import { subtitleTrack, youtubeColumnFixture, youtubeFixture } from './youtube-fixture';

async function openPlayer(extension: { context: BrowserContext; page: Page }, track: string | ((url: string) => string) = subtitleTrack, fixture = youtubeFixture) {
  const video = await readFile('tests/e2e/video/timeline.webm');
  await extension.context.route('https://www.youtube.com/**', route => {
    if (route.request().url().endsWith('/timeline.webm')) {
      const range = route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);
      const start = range ? Number(range[1]) : 0; const end = range?.[2] ? Math.min(Number(range[2]), video.length - 1) : video.length - 1;
      return route.fulfill({ status: range ? 206 : 200, contentType: 'video/webm', headers: { 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${video.length}` } : {}) }, body: video.subarray(start, end + 1) });
    }
    return route.fulfill({ status: 200, contentType: route.request().url().includes('/api/timedtext') ? 'application/json' : 'text/html', body: route.request().url().includes('/api/timedtext') ? (typeof track === 'function' ? track(route.request().url()) : track) : fixture });
  });
  await extension.page.goto('https://www.youtube.com/watch?v=owned-video');
  await expect.poll(() => extension.page.locator('video').evaluate(video => (video as HTMLVideoElement).readyState)).toBeGreaterThan(0);
  await expect(extension.page.getByRole('button', { name: '开启双语字幕', exact: true })).toBeVisible();
}

for (const format of ['JSON3', 'XML'] as const) {
  test(`YouTube 强制 Trusted Types 时，${format} 完整字幕正常预译且不触发安全策略错误`, async ({ extension }) => {
    const { page } = extension;
    const errors: string[] = [];
    page.on('console', message => { if (message.type() === 'error' && /Trusted|Content Security Policy|EvalError/i.test(message.text())) errors.push(message.text()); });
    page.on('pageerror', error => errors.push(error.message));
    const fixture = youtubeColumnFixture.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="require-trusted-types-for 'script'">`)
      .replace('const player =', `document.addEventListener('securitypolicyviolation', event => {
        document.documentElement.dataset.policyViolations = (document.documentElement.dataset.policyViolations || '') + event.effectiveDirective + ';';
      }); const player =`);
    const track = format === 'JSON3' ? subtitleTrack : '<transcript><text start="0" dur="5">Welcome to the video.</text><text start="5" dur="5">Next sentence.</text></transcript>';
    await openPlayer(extension, track, fixture);
    await page.getByRole('button', { name: '打开字幕记录', exact: true }).click();
    await expect(page.getByLabel('字幕准备状态')).toContainText('完整字幕已就绪');
    await expect(page.locator('[data-cloudys-gloss="video-subtitles"] .translation')).toBeVisible();
    expect(await page.locator('html').getAttribute('data-policy-violations')).toBeNull();
    expect(errors).toEqual([]);
  });
}

test('播放器原生胶囊样式不污染双语控件，窄屏悬停提示完整且开关不挤动 CC', async ({ extension }, testInfo) => {
  const { page } = extension;
  const fixture = youtubeColumnFixture.replace('</style>', `
.ytp-right-controls{display:flex;height:40px;line-height:56px;gap:0}
.ytp-button{position:relative;width:48px;height:40px;padding:0;border-radius:40px}
.ytp-button:before{content:"";position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:48px;height:32px;border-radius:40px}
.ytp-button:hover:before{background:#ffffff30}
.ytp-button[aria-pressed=true]:after{content:"";position:absolute;bottom:2px;left:12px;width:24px;height:3px;background:red}
.ytp-right-controls button{font-size:20px;letter-spacing:3px}
</style>`);
  await openPlayer(extension, subtitleTrack, fixture);
  const toggle = page.locator('[data-cloudys-gloss="video-toggle"]');
  const history = page.locator('[data-cloudys-gloss="video-history-toggle"]');
  const group = page.locator('[data-cloudys-gloss="video-controls"]');
  for (const width of [1440, 420]) {
    await page.setViewportSize({ width, height: 900 });
    const before = (await page.locator('.ytp-subtitles-button').boundingBox())!;
    await toggle.hover();
    await expect(toggle.locator('.tip')).toBeVisible();
    const button = (await toggle.boundingBox())!;
    expect(button.width).toBe(44); expect(button.height).toBe(40);
    await expect(toggle).toHaveCSS('font-size', '13px');
    expect(await toggle.evaluate(node => getComputedStyle(node, '::before').content)).toBe('none');
    const tooltip = (await toggle.locator('.tip').boundingBox())!;
    const player = (await page.locator('#movie_player').boundingBox())!;
    expect(tooltip.x).toBeGreaterThanOrEqual(player.x);
    expect(tooltip.x + tooltip.width).toBeLessThanOrEqual(player.x + player.width);
    expect(tooltip.y + tooltip.height).toBeLessThan(button.y);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle.locator('.tip')).toHaveText('关闭双语字幕');
    await expect(toggle.locator('.tip')).toHaveCSS('opacity', '1');
    await expect(toggle.locator('.face')).toHaveCSS('color', 'rgb(223, 255, 114)');
    await expect(history.locator('svg')).toBeVisible();
    expect((await page.locator('.ytp-subtitles-button').boundingBox())!.x).toBe(before.x);
    const controls = (await group.boundingBox())!;
    expect(controls.x + controls.width).toBeLessThanOrEqual(before.x);
    await page.screenshot({ path: testInfo.outputPath(`player-controls-${width}.png`) });
    await toggle.click();
  }
  await page.locator('.ytp-right-controls').evaluate(node => { (node as HTMLElement).style.visibility = 'hidden'; });
  await expect(toggle).toBeHidden();
  await expect(history).toBeHidden();
  await expect(toggle.locator('.tip')).toBeHidden();
  await page.locator('.ytp-right-controls').evaluate(node => { (node as HTMLElement).style.visibility = ''; (node as HTMLElement).style.pointerEvents = 'none'; });
  await expect(toggle).toHaveCSS('pointer-events', 'none');
  await page.locator('.ytp-right-controls').evaluate(node => { (node as HTMLElement).style.pointerEvents = ''; });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveCSS('pointer-events', 'auto');
});

test('键盘切换双语和记录只激活一次、不暂停视频，关闭侧栏后焦点回到入口', async ({ extension }) => {
  const { page } = extension;
  const fixture = youtubeColumnFixture.replace('const cc =', `
    for (const type of ['keydown','keyup']) player.addEventListener(type, event => {
      if (event.key === ' ' || event.key === 'Enter') { player.dataset.shortcut = 'leaked'; video.pause(); }
      if (event.key === 'ArrowRight') player.dataset.seekShortcut = 'received';
    });
    const cc =`);
  await openPlayer(extension, subtitleTrack, fixture);
  await page.locator('video').evaluate(video => (video as HTMLVideoElement).play());
  const toggle = page.locator('[data-cloudys-gloss="video-toggle"]');
  const history = page.locator('[data-cloudys-gloss="video-history-toggle"]');
  await toggle.focus();
  await toggle.press('Space');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.press('Enter');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Tab');
  await expect(history).toBeFocused();
  await history.press('Enter');
  await expect(history).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  const sidebar = page.locator('[data-cloudys-gloss="video-history"]');
  await sidebar.getByRole('button', { name: '关闭字幕记录', exact: true }).press('Enter');
  await expect(history).toBeFocused();
  await expect(history).toHaveAttribute('aria-expanded', 'false');
  await expect(history.locator('.tip')).toBeVisible();
  await history.press('Escape');
  await expect(history.locator('.tip')).toBeHidden();
  await expect(page.locator('video')).toHaveJSProperty('paused', false);
  await expect(page.locator('#movie_player')).not.toHaveAttribute('data-shortcut');
  await history.press('ArrowRight');
  await expect(page.locator('#movie_player')).toHaveAttribute('data-seek-shortcut', 'received');
});

test('侧栏打开时关闭双语，再点击记录一次即可恢复字幕和侧栏', async ({ extension }) => {
  const { page } = extension;
  await openPlayer(extension, subtitleTrack, youtubeColumnFixture);
  const history = page.locator('[data-cloudys-gloss="video-history"]');
  await page.getByRole('button', { name: '打开字幕记录', exact: true }).click();
  await expect(history).toBeVisible();
  await page.getByRole('button', { name: '关闭双语字幕', exact: true }).click();
  await expect(history).toBeHidden();
  await page.getByRole('button', { name: '打开字幕记录', exact: true }).click();
  await expect(history).toBeVisible();
  await expect(page.getByRole('button', { name: '关闭双语字幕', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('长句双语字幕在桌面和窄播放器中完整换行，不遮挡播放控制栏', async ({ extension }, testInfo) => {
  const { page, server } = extension;
  const source = 'Instead of putting every tool into the system prompt, the agent can search for the tools it needs, load them when they become relevant, and keep the context window focused on the current task.';
  const translated = '无需将所有工具都放进系统提示，智能体可以搜索所需的工具，在需要时再加载，让上下文窗口始终聚焦当前任务。';
  server.setTranslation(source, translated);
  await openPlayer(extension, JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 10000, segs: [{ utf8: source }] }] }), youtubeColumnFixture);
  await page.getByRole('button', { name: '开启双语字幕', exact: true }).click();
  const captions = page.locator('[data-cloudys-gloss="video-subtitles"] .captions');
  await expect(captions.locator('.translation')).toHaveText(translated);
  for (const width of [1440, 600]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(async () => {
      const box = (await captions.boundingBox())!;
      const player = (await page.locator('#movie_player').boundingBox())!;
      const controls = (await page.locator('.ytp-right-controls').boundingBox())!;
      return box.x >= player.x && box.x + box.width <= player.x + player.width + 1 && box.y >= player.y && box.y + box.height <= controls.y;
    }).toBe(true);
    expect(await captions.evaluate(node => node.scrollHeight <= node.clientHeight + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`subtitles-long-${width}.png`) });
  }
});

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
    document.dispatchEvent(new Event('yt-navigate-start')); window.history.pushState({}, '', '/watch?v=second-video');
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


test('右侧字幕记录保留大视频尺寸，回看双语历史和点击时间跳转均复用译文', async ({ extension }, testInfo) => {
  const { page, server } = extension; await openPlayer(extension, subtitleTrack, youtubeColumnFixture);
  server.setTranslation('Welcome to the video.', '欢迎观看这个视频。');
  const player = page.locator('#movie_player'); const before = await player.boundingBox();
  await page.getByRole('button', { name: '打开字幕记录', exact: true }).click();
  const history = page.locator('[data-cloudys-gloss="video-history"]');
  await expect(history).toHaveAttribute('data-mode', 'column');
  await expect(history.locator('.zh').first()).toHaveText('欢迎观看这个视频。');
  const after = await player.boundingBox(); const side = await history.boundingBox();
  expect(after!.width).toBeCloseTo(before!.width, 0); expect(after!.height).toBeCloseTo(before!.height, 0);
  expect(side!.x).toBeGreaterThanOrEqual(after!.x + after!.width); expect(after!.width).toBeGreaterThan(side!.width * 2);
  await expect.poll(() => server.finishedStreams).toBeGreaterThanOrEqual(4);
  await page.evaluate(() => (window as unknown as { setClock: (time: number) => void }).setClock(5));
  await expect(history.locator('[aria-current="true"] .en')).toHaveText('Sentence 1.');
  await expect(history.locator('.row')).toHaveCount(2);
  const cachedRequests = () => server.calls.flatMap(call => call.texts ?? []).filter(text => ['Welcome to the video.', 'Sentence 1.'].includes(text));
  const calls = cachedRequests();
  await history.getByRole('button', { name: '跳转到 00:00', exact: true }).click();
  await expect(page.locator('video')).toHaveJSProperty('currentTime', 0);
  await expect(history.locator('[aria-current="true"] .zh')).toHaveText('欢迎观看这个视频。');
  expect(cachedRequests()).toEqual(calls);
  await page.screenshot({ path: testInfo.outputPath('history-right-column.png') });
  await page.evaluate(() => document.documentElement.removeAttribute('dark'));
  await expect(history).toHaveAttribute('data-theme', 'light');
  await expect(history.locator('.panel')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.screenshot({ path: testInfo.outputPath('history-right-column-light.png') });
  await history.getByRole('button', { name: '关闭字幕记录', exact: true }).click();
  await expect(history).toBeHidden(); await expect(player).not.toHaveAttribute('data-cloudys-history');
  await page.getByRole('button', { name: '打开字幕记录', exact: true }).click();
  await expect(history.locator('.zh').first()).toHaveText('欢迎观看这个视频。'); expect(cachedRequests()).toEqual(calls);
});

for (const mode of ['普通页面', '全屏'] as const) {
  test(`${mode}拖动字幕记录边缘实时调宽，关闭重开保留宽度且双击恢复默认`, async ({ extension }, testInfo) => {
    const { page } = extension;
    await page.setViewportSize({ width: 1440, height: 900 });
    await openPlayer(extension, subtitleTrack, youtubeColumnFixture);
    if (mode === '全屏') {
      await page.getByRole('button', { name: '全屏', exact: true }).click();
      await expect.poll(() => page.evaluate(() => document.fullscreenElement?.id)).toBe('movie_player');
    }
    await page.getByRole('button', { name: '打开字幕记录', exact: true }).click();
    const history = page.locator('[data-cloudys-gloss="video-history"]');
    const grip = history.getByRole('separator', { name: '调整字幕记录宽度' });
    await expect(grip).toBeVisible();
    const original = (await history.boundingBox())!.width;
    const handle = (await grip.boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 - 100, handle.y + handle.height / 2, { steps: 12 });
    await expect.poll(async () => Math.round((await history.boundingBox())!.width)).toBe(Math.round(original + 100));
    await page.mouse.up();
    const video = (await page.locator('video').boundingBox())!;
    const pane = (await history.boundingBox())!;
    const overlay = (await page.locator('[data-cloudys-gloss="video-subtitles"]').boundingBox())!;
    expect(video.x + video.width).toBeLessThanOrEqual(pane.x + 1);
    expect(overlay.x + overlay.width).toBeLessThanOrEqual(pane.x + 1);
    await page.screenshot({ path: testInfo.outputPath('history-resized.png') });
    await history.getByRole('button', { name: '关闭字幕记录', exact: true }).click();
    await expect(page.locator('ytd-watch-flexy')).not.toHaveAttribute('data-cloudys-history-column');
    await page.getByRole('button', { name: '打开字幕记录', exact: true }).click();
    await expect(history).toBeVisible();
    await expect.poll(async () => Math.round((await history.boundingBox())!.width)).toBe(Math.round(original + 100));
    // Stock Firefox's BiDi driver ignores clickCount and emits two click:1
    // events for dblclick(). Exercise its DOM handler explicitly; Chromium
    // exercises native double-click input. Both also exercise real key input.
    if (testInfo.project.name === 'firefox') await grip.dispatchEvent('dblclick', { detail: 2 });
    else await grip.dblclick();
    await expect.poll(async () => Math.round((await history.boundingBox())!.width)).toBe(Math.round(original));
  });
}

test('键盘调宽字幕记录遵守宽度边界，取消拖动还原，窄窗口自动停用调整柄', async ({ extension }) => {
  const { page } = extension;
  await openPlayer(extension, subtitleTrack, youtubeColumnFixture);
  await page.getByRole('button', { name: '打开字幕记录', exact: true }).click();
  const history = page.locator('[data-cloudys-gloss="video-history"]');
  const grip = history.getByRole('separator', { name: '调整字幕记录宽度' });
  await expect(grip).toBeVisible();
  const initial = Number(await grip.getAttribute('aria-valuenow'));
  await grip.press('ArrowLeft');
  await expect(grip).toHaveAttribute('aria-valuenow', String(initial + 20));
  await grip.press('End');
  await expect.poll(async () => await grip.getAttribute('aria-valuenow')).toBe(await grip.getAttribute('aria-valuemax'));
  const handle = (await grip.boundingBox())!;
  await page.mouse.move(handle.x + 6, handle.y + 80); await page.mouse.down();
  await page.mouse.move(handle.x + 106, handle.y + 80, { steps: 5 });
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect.poll(async () => await grip.getAttribute('aria-valuenow')).toBe(await grip.getAttribute('aria-valuemax'));
  await grip.press('Home');
  await expect.poll(async () => await grip.getAttribute('aria-valuenow')).toBe(await grip.getAttribute('aria-valuemin'));
  await grip.press('Enter');
  await expect(grip).toHaveAttribute('aria-valuenow', String(initial));
  await page.setViewportSize({ width: 700, height: 900 });
  await expect(history).toHaveAttribute('data-mode', 'below'); await expect(grip).toBeHidden();
  await expect(page.locator('ytd-watch-flexy')).not.toHaveAttribute('data-cloudys-history-column');
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(history).toHaveAttribute('data-mode', 'column'); await expect(grip).toBeVisible();
  await page.evaluate(() => {
    document.dispatchEvent(new Event('yt-navigate-start')); window.history.pushState({}, '', '/watch?v=resized-next-video');
    document.dispatchEvent(new Event('yt-navigate-finish'));
  });
  await expect(history).toHaveCount(1); await expect(grip).toBeVisible();
  await expect(grip).toHaveAttribute('aria-valuenow', String(initial));
  await expect(page.locator('ytd-watch-flexy')).not.toHaveAttribute('data-cloudys-history-column');
});

test('影院及全屏字幕侧栏留在视频右侧，关闭后恢复完整画面和字幕区域', async ({ extension }, testInfo) => {
  const { page } = extension; await openPlayer(extension, subtitleTrack, youtubeColumnFixture);
  await page.locator('ytd-watch-flexy').evaluate(node => node.setAttribute('theater', ''));
  await page.getByRole('button', { name: '打开字幕记录', exact: true }).click();
  const history = page.locator('[data-cloudys-gloss="video-history"]'); const player = page.locator('#movie_player');
  await expect(history).toHaveAttribute('data-mode', 'docked');
  const assertNoOverlap = async () => {
    const pane = (await history.boundingBox())!; const video = (await page.locator('video').boundingBox())!;
    const overlay = (await page.locator('[data-cloudys-gloss="video-subtitles"]').boundingBox())!;
    expect(video.x + video.width).toBeLessThanOrEqual(pane.x + 1); expect(overlay.x + overlay.width).toBeLessThanOrEqual(pane.x + 1);
    expect(video.width).toBeGreaterThan(pane.width * 2);
  };
  await expect(history.locator('.zh')).toBeVisible(); await assertNoOverlap();
  await page.getByRole('button', { name: '全屏', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.id)).toBe('movie_player');
  await expect(history).toBeVisible(); await assertNoOverlap();
  await page.screenshot({ path: testInfo.outputPath('history-fullscreen.png') });
  await page.evaluate(() => document.exitFullscreen());
  await history.getByRole('button', { name: '关闭字幕记录', exact: true }).click();
  await expect(player).not.toHaveAttribute('data-cloudys-history');
  expect((await page.locator('video').boundingBox())!.width).toBeCloseTo((await player.boundingBox())!.width, 0);
});

test('字幕记录连续换句自动滚动，调宽或窗口变矮后仍定位当前句', async ({ extension }) => {
  const { page } = extension;
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPlayer(extension, subtitleTrack, youtubeColumnFixture);
  await page.getByRole('button', { name: '打开字幕记录', exact: true }).click();
  const history = page.locator('[data-cloudys-gloss="video-history"]');
  const scroll = history.getByLabel('历史双语字幕');
  const assertCurrentVisible = async () => {
    await expect.poll(async () => {
      const viewport = await scroll.boundingBox(); const row = await history.locator('[aria-current="true"]').boundingBox();
      if (!viewport || !row) return false;
      return row.y >= viewport.y - 1 && (row.height > viewport.height - 20 ? row.y <= viewport.y + 12 : row.y + row.height <= viewport.y + viewport.height + 1);
    }).toBe(true);
  };
  for (let i = 1; i <= 12; i++) {
    await page.evaluate(time => (window as unknown as { setClock: (time: number) => void }).setClock(time), i * 5);
    await expect(history.locator('[aria-current="true"] .en')).toHaveText(`Sentence ${i}.`);
    await assertCurrentVisible();
  }
  await expect.poll(() => scroll.evaluate(node => node.scrollTop)).toBeGreaterThan(100);
  await history.getByRole('separator', { name: '调整字幕记录宽度' }).press('End');
  await page.setViewportSize({ width: 1440, height: 500 });
  await assertCurrentVisible();
  await expect(history.getByRole('button', { name: '定位当前句', exact: true })).toBeVisible();
  // Simulate an external layout/scroll restoration without a manual reading
  // gesture: the visible follow control must also recover while already on.
  await scroll.evaluate(node => { node.scrollTop = 0; });
  await history.getByRole('button', { name: '定位当前句', exact: true }).click();
  await assertCurrentVisible();
});

test('点击字幕区空白和底部向下滚动不会误停跟随，手动向上回看后可恢复', async ({ extension }) => {
  const { page } = extension;
  await openPlayer(extension, subtitleTrack, youtubeColumnFixture);
  await page.getByRole('button', { name: '打开字幕记录', exact: true }).click();
  const history = page.locator('[data-cloudys-gloss="video-history"]');
  const scroll = history.getByLabel('历史双语字幕');
  await scroll.click({ position: { x: 20, y: 3 } });
  await expect(history.getByRole('button', { name: '定位当前句', exact: true })).toBeVisible();
  for (let i = 1; i <= 10; i++) {
    await page.evaluate(time => (window as unknown as { setClock: (time: number) => void }).setClock(time), i * 5);
    await expect(history.locator('[aria-current="true"] .en')).toHaveText(`Sentence ${i}.`);
  }
  await expect.poll(() => scroll.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThan(3);
  await scroll.hover(); await page.mouse.wheel(0, 300);
  await expect(history.getByRole('button', { name: '定位当前句', exact: true })).toBeVisible();
  await page.mouse.wheel(0, -300);
  await expect(history.getByRole('button', { name: '回到当前句', exact: true })).toBeVisible();
  await page.evaluate(() => (window as unknown as { setClock: (time: number) => void }).setClock(60));
  await expect(history.locator('[aria-current="true"]')).toHaveCount(0);
  await history.getByRole('button', { name: '回到当前句', exact: true }).click();
  await expect(history.locator('[aria-current="true"] .en')).toHaveText('Sentence 12.');
  await expect.poll(() => scroll.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThan(3);
});

test('翻阅历史时不被播放抢走滚动位置，回到当前句后恢复跟随且换视频清空旧记录', async ({ extension }) => {
  const { page } = extension; await openPlayer(extension, subtitleTrack, youtubeColumnFixture);
  await page.getByRole('button', { name: '打开字幕记录', exact: true }).click();
  const history = page.locator('[data-cloudys-gloss="video-history"]');
  for (let i = 1; i <= 12; i++) {
    await page.evaluate(time => (window as unknown as { setClock: (time: number) => void }).setClock(time), i * 5);
    await expect(history.locator('[aria-current="true"] .en')).toHaveText(`Sentence ${i}.`);
  }
  const scroll = history.getByLabel('历史双语字幕'); await scroll.focus(); await scroll.press('Home');
  await expect(history.getByRole('button', { name: '回到当前句', exact: true })).toBeVisible();
  await expect.poll(() => scroll.evaluate(node => node.scrollTop)).toBeLessThan(5);
  await page.evaluate(() => (window as unknown as { setClock: (time: number) => void }).setClock(70));
  await expect(page.locator('[data-cloudys-gloss="video-subtitles"] .original')).toHaveText('Sentence 14.');
  expect(await scroll.evaluate(node => node.scrollTop)).toBeLessThan(5);
  await history.getByRole('button', { name: '回到当前句', exact: true }).click();
  await expect(history.locator('[aria-current="true"] .en')).toHaveText('Sentence 14.');
  await expect.poll(() => scroll.evaluate(node => node.scrollTop)).toBeGreaterThan(100);
  await page.evaluate(() => {
    document.dispatchEvent(new Event('yt-navigate-start')); window.history.pushState({}, '', '/watch?v=another-video');
    (document.querySelector('video') as HTMLVideoElement).currentTime = 0;
    document.dispatchEvent(new Event('yt-navigate-finish'));
  });
  await expect(history).toHaveCount(1); await expect(history.locator('.row')).toHaveCount(1);
  await expect(history.locator('.en')).toHaveText('Welcome to the video.');
});

test('窄窗口将字幕记录放到播放器下方，关闭双语字幕后恢复页面且不遮挡视频', async ({ extension }, testInfo) => {
  const { page } = extension; await page.setViewportSize({ width: 700, height: 900 });
  await openPlayer(extension, subtitleTrack, youtubeColumnFixture);
  await page.getByRole('button', { name: '打开字幕记录', exact: true }).click();
  const history = page.locator('[data-cloudys-gloss="video-history"]');
  await expect(history).toHaveAttribute('data-mode', 'below');
  const video = (await page.locator('#movie_player').boundingBox())!; const side = (await history.boundingBox())!;
  expect(side.y).toBeGreaterThanOrEqual(video.y + video.height);
  await page.screenshot({ path: testInfo.outputPath('history-narrow.png') });
  await page.getByRole('button', { name: '关闭双语字幕', exact: true }).click();
  await expect(history).toBeHidden(); await expect(page.locator('#movie_player')).not.toHaveAttribute('data-cloudys-history');
});

test('完整字幕首次为空后自动恢复轨道并提前翻译，不需要重新开关字幕', async ({ extension }) => {
  const { page, context, server } = extension; await openPlayer(extension, '');
  let reads = 0;
  await context.route('https://www.youtube.com/api/timedtext**', route => route.fulfill({ contentType: 'application/json', body: ++reads <= 2 ? '' : subtitleTrack }));
  await page.getByRole('button', { name: '开启双语字幕', exact: true }).click();
  await expect(page.getByRole('button', { name: '关闭双语字幕', exact: true })).toHaveAttribute('aria-description', /字幕轨道 · 提前翻译/);
  await expect.poll(() => server.calls.flatMap(call => call.texts ?? [])).toContain('Sentence 24.');
  expect(reads).toBeLessThanOrEqual(6);
});

test('实时 CC 连续换句时慢请求完成后补入右侧历史，当前句优先且不漏掉近期字幕', async ({ extension }) => {
  const { page, server } = extension; await openPlayer(extension, '', youtubeColumnFixture);
  server.setDelay(1400);
  await page.locator('video').evaluate(video => (video as HTMLVideoElement).play());
  await page.getByRole('button', { name: '打开字幕记录', exact: true }).click();
  const overlay = page.locator('[data-cloudys-gloss="video-subtitles"]');
  const history = page.locator('[data-cloudys-gloss="video-history"]');
  await expect.poll(() => server.calls.length).toBe(1);
  for (const text of ['The second sentence.', 'The third sentence.', 'The final sentence.']) {
    await page.locator('.ytp-caption-segment').evaluate((node, text) => { node.textContent = text; }, text);
    await expect(overlay.locator('.original')).toHaveText(text);
  }
  await expect(history.locator('.row').filter({ hasText: 'Welcome to the video.' }).locator('.zh')).not.toBeEmpty();
  await expect(overlay.locator('.translation')).toContainText('The final sentence.');
  await expect(history.locator('.zh')).toHaveCount(4);
  expect(server.calls[1]?.texts?.[0]).toBe('The final sentence.');
  expect(server.calls.every(call => (call.texts?.length ?? 0) <= 3)).toBe(true);
  expect(server.calls.flatMap(call => call.texts ?? []).filter(text => text === 'Welcome to the video.')).toHaveLength(1);
});

test('实时历史字幕发生鉴权错误后点击跳转并重试，等对应 CC 重现再重新请求', async ({ extension }) => {
  const { page, server } = extension; await openPlayer(extension, '', youtubeColumnFixture);
  server.setTranslationFailure(401);
  await page.getByRole('button', { name: '打开字幕记录', exact: true }).click();
  const history = page.locator('[data-cloudys-gloss="video-history"]');
  await expect(history.getByRole('button', { name: '跳转并重试', exact: true })).toBeVisible();
  server.setTranslationFailure(0);
  await page.evaluate(() => (window as unknown as { setClock: (time: number) => void }).setClock(10));
  await page.locator('.ytp-caption-segment').evaluate(node => { node.textContent = 'Another sentence.'; });
  await expect(page.locator('[data-cloudys-gloss="video-subtitles"] .translation')).toContainText('Another sentence.');
  await history.getByRole('button', { name: '跳转并重试', exact: true }).click();
  await expect(page.locator('video')).toHaveJSProperty('currentTime', 0);
  await page.locator('.ytp-caption-segment').evaluate(node => { node.textContent = 'Welcome to the video.'; });
  await expect(page.locator('[data-cloudys-gloss="video-subtitles"] .translation')).toContainText('Welcome to the video.');
  expect(server.calls.flatMap(call => call.texts ?? []).filter(text => text === 'Welcome to the video.')).toHaveLength(2);
});

test('切回标签页复用完整轨道，随后换语言失败时退回新 CC 而不继续显示旧英语', async ({ extension }) => {
  const { page, context } = extension; await openPlayer(extension);
  const toggle = page.getByRole('button', { name: '关闭双语字幕', exact: true });
  const overlay = page.locator('[data-cloudys-gloss="video-subtitles"]');
  await page.getByRole('button', { name: '开启双语字幕', exact: true }).click();
  await expect(toggle).toHaveAttribute('aria-description', /字幕轨道 · 提前翻译/);
  await context.route('https://www.youtube.com/api/timedtext**', route => route.fulfill({ body: '' }));
  // Deterministic lifecycle events in the owned fixture, independent of headless
  // browser tab-focus policy. The production visibility handler is exercised.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(toggle).toHaveAttribute('aria-description', /字幕轨道 · 提前翻译/);
  await page.evaluate(async () => {
    document.querySelector('.ytp-caption-segment')!.textContent = 'Bonjour le monde.';
    await fetch('/api/timedtext?v=owned-video&lang=fr&fmt=json3');
  });
  await expect(toggle).toHaveAttribute('aria-description', /当前 CC · 实时翻译/);
  await expect(overlay.locator('.original')).toHaveText('Bonjour le monde.');
  await expect(overlay.locator('.translation')).toContainText('Bonjour le monde.');
});

for (const transport of ['fetch', 'XHR'] as const) {
  test(`播放器通过 ${transport} 首次获得字幕但重复下载为空时，仍提前备好两分钟且关闭后恢复请求方法`, async ({ extension }) => {
    const { page, context, server } = extension;
    const fixture = youtubeColumnFixture.replace('const cc =', `
      window.nativeFetch = null; window.nativeOpen = null; window.nativeSend = null;
      window.playerCaptionRequest = url => {
        ${transport === 'fetch' ? "return fetch(url).then(response => response.text()).then(text => { player.dataset.captionBytes = String(text.length); });" : "const xhr = new XMLHttpRequest(); xhr.open('GET', url); xhr.onload = () => { player.dataset.captionBytes = String(xhr.responseText.length); }; xhr.send();"}
      };
      const cc =`).replace('if (on) fetch(', 'if (on) window.playerCaptionRequest(');
    await openPlayer(extension, '', fixture);
    let nativeReads = 0;
    await context.route('https://www.youtube.com/api/timedtext**', route => {
      const isPlayer = new URL(route.request().url()).searchParams.get('pot') === 'fixture';
      return route.fulfill({ contentType: 'application/json', body: isPlayer && ++nativeReads === 1 ? subtitleTrack : '' });
    });
    // Stop the optional startup observer before recording the baseline methods.
    await page.evaluate(() => {
      const scope = window as unknown as { __cloudysGlossEarlyCaptions?: { take: (id: string) => unknown }; nativeFetch: typeof fetch; nativeOpen: typeof XMLHttpRequest.prototype.open; nativeSend: typeof XMLHttpRequest.prototype.send };
      scope.__cloudysGlossEarlyCaptions?.take('owned-video');
      scope.nativeFetch = fetch; scope.nativeOpen = XMLHttpRequest.prototype.open; scope.nativeSend = XMLHttpRequest.prototype.send;
    });
    await page.getByRole('button', { name: '打开字幕记录', exact: true }).click();
    await expect(page.getByLabel('字幕准备状态')).toHaveText('完整字幕已就绪 · 已备好后续 120 秒');
    await expect(page.locator('#movie_player')).toHaveAttribute('data-caption-bytes', String(subtitleTrack.length));
    await expect.poll(() => server.calls.flatMap(call => call.texts ?? [])).toContain('Sentence 24.');
    await page.getByRole('button', { name: '关闭双语字幕', exact: true }).click();
    await expect.poll(() => page.evaluate(() => {
      const scope = window as unknown as { nativeFetch: typeof fetch; nativeOpen: typeof XMLHttpRequest.prototype.open; nativeSend: typeof XMLHttpRequest.prototype.send };
      return fetch === scope.nativeFetch && XMLHttpRequest.prototype.open === scope.nativeOpen && XMLHttpRequest.prototype.send === scope.nativeSend;
    })).toBe(true);
  });
}

test('用户点双语前 CC 已经下载且后续请求为空，仍复用启动字幕并在再次开启时保留轨道', async ({ extension }) => {
  const { page, server } = extension; let nativeReads = 0;
  const fixture = youtubeColumnFixture.replace('</script>', 'cc.click();</script>');
  await openPlayer(extension, url => new URL(url).searchParams.get('pot') === 'fixture' && ++nativeReads === 1 ? subtitleTrack : '', fixture);
  expect(server.calls).toHaveLength(0);
  await page.getByRole('button', { name: '打开字幕记录', exact: true }).click();
  await expect(page.getByLabel('字幕准备状态')).toHaveText('完整字幕已就绪 · 已备好后续 120 秒');
  await page.getByRole('button', { name: '关闭双语字幕', exact: true }).click();
  await expect(page.locator('.ytp-subtitles-button')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '开启双语字幕', exact: true }).click();
  await expect(page.getByLabel('字幕准备状态')).toHaveText('完整字幕已就绪 · 已备好后续 120 秒');
  expect(nativeReads).toBe(1);
});
