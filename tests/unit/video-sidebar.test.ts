import { afterEach, describe, expect, it, vi } from 'vitest';
import { SubtitleHistory } from '../../src/video/history';
import { SubtitleSidebar } from '../../src/video/sidebar';

let sidebar: SubtitleSidebar | undefined;
afterEach(() => { sidebar?.destroy(); sidebar = undefined; document.body.replaceChildren(); });
describe('字幕侧栏长视频阅读', () => {
  it('一千条历史每次只渲染四十条，翻到更早页后新字幕不抢走阅读位置', async () => {
    const history = new SubtitleHistory();
    for (let i = 0; i < 1000; i++) history.observe({ start: i, original: `Sentence ${i}.`, translated: `第 ${i} 句。`, pending: false, error: '' });
    const player = document.createElement('div'); document.body.append(player);
    sidebar = new SubtitleSidebar(player, history, vi.fn(), vi.fn()); sidebar.update(true);
    await vi.waitFor(() => expect(document.querySelector('[data-cloudys-gloss="video-history"]')).not.toBeNull());
    const shadow = document.querySelector('[data-cloudys-gloss="video-history"]')!.shadowRoot!;
    expect(shadow.querySelectorAll('.row')).toHaveLength(40); expect(shadow.querySelector('.en')?.textContent).toBe('Sentence 960.');
    shadow.querySelector<HTMLButtonElement>('.page')!.click();
    await vi.waitFor(() => expect(shadow.querySelector('.en')?.textContent).toBe('Sentence 920.'));
    history.observe({ start: 1000, original: 'Newest sentence.', translated: '最新一句。', pending: false, error: '' }); sidebar.update(true);
    expect(shadow.querySelector('.en')?.textContent).toBe('Sentence 920.'); expect(shadow.querySelectorAll('.row')).toHaveLength(40);
    shadow.querySelector<HTMLButtonElement>('.follow')!.click();
    await vi.waitFor(() => expect(shadow.querySelector('[aria-current="true"] .en')?.textContent).toBe('Newest sentence.'));
    sidebar.update(false); expect(shadow.querySelectorAll('.row')).toHaveLength(0);
  });
});
