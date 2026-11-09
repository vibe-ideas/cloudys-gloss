import { afterEach, describe, expect, it, vi } from 'vitest';
import { IMAGE_MENU, PAGE_MENU, installTranslationMenus } from '../../src/ui/context-menu';

const api = vi.hoisted(() => ({ installed: vi.fn(), startup: vi.fn(), clicked: vi.fn(), clear: vi.fn(), create: vi.fn(), send: vi.fn(), open: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: {
  runtime: { onInstalled: { addListener: api.installed }, onStartup: { addListener: api.startup }, getURL: (path: string) => 'chrome-extension://test' + path },
  contextMenus: { removeAll: api.clear, create: api.create, onClicked: { addListener: api.clicked } },
  tabs: { sendMessage: api.send, create: api.open },
} }));
afterEach(() => vi.resetAllMocks());
describe('浏览器原生翻译右键菜单', () => {
  it('安装或重启浏览器后显示网页和图片操作，并保留浏览器原有菜单', async () => {
    api.clear.mockResolvedValue(undefined); installTranslationMenus(); await api.installed.mock.calls[0]![0]();
    await vi.waitFor(() => expect(api.create).toHaveBeenCalledTimes(2));
    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ id: IMAGE_MENU, contexts: ['image'], targetUrlPatterns: ['http://*/*', 'https://*/*'] }));
    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ id: PAGE_MENU, contexts: expect.arrayContaining(['page', 'image']) }));
    expect(api.startup).toHaveBeenCalledOnce();
  });
  it('右键选择翻译网页时只切换当前标签正文，选择图片时在文章中操作当前图', async () => {
    api.send.mockResolvedValue(true); installTranslationMenus(); const click = api.clicked.mock.calls[0]![0];
    click({ menuItemId: PAGE_MENU }, { id: 7 }); expect(api.send).toHaveBeenCalledWith(7, { type: 'page:toggle' }, { frameId: 0 });
    click({ menuItemId: IMAGE_MENU, srcUrl: 'https://images.example/chart.png' }, { id: 7 });
    await vi.waitFor(() => expect(api.send).toHaveBeenCalledWith(7, { type: 'image:context', url: 'https://images.example/chart.png' }, { frameId: 0 }));
    await Promise.resolve(); expect(api.open).not.toHaveBeenCalled();
  });
  it('内嵌框架图片无法原位处理时打开阅读页，脚本或带凭据的图片地址不启动处理', async () => {
    api.send.mockResolvedValue(false); api.open.mockResolvedValue({ id: 9 }); installTranslationMenus(); const click = api.clicked.mock.calls[0]![0];
    click({ menuItemId: IMAGE_MENU, srcUrl: 'https://images.example/chart.png?size=2' }, { id: 7 });
    await vi.waitFor(() => expect(api.open).toHaveBeenCalledWith({ url: 'chrome-extension://test/image.html#url=https%3A%2F%2Fimages.example%2Fchart.png%3Fsize%3D2' }));
    for (const srcUrl of ['javascript:alert(1)', 'file:///tmp/private.png', 'https://user:pass@example.com/image.png']) click({ menuItemId: IMAGE_MENU, srcUrl }, { id: 7 });
    expect(api.send).toHaveBeenCalledTimes(1);
  });
});
