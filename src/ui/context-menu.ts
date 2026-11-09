import { browser } from 'wxt/browser';
import { imageUrl } from '../image/io';

export const PAGE_MENU = 'cloudys-gloss-page';
export const IMAGE_MENU = 'cloudys-gloss-image';
/** Native menus retain the site's existing image save/copy/link actions. */
export function installTranslationMenus() {
  const populate = async () => {
    await browser.contextMenus.removeAll();
    const documentUrlPatterns = ['http://*/*', 'https://*/*'];
    browser.contextMenus.create({ id: PAGE_MENU, title: 'Cloudy’s Gloss：翻译网页 / 恢复原文', contexts: ['page', 'selection', 'link', 'image'], documentUrlPatterns });
    browser.contextMenus.create({ id: IMAGE_MENU, title: 'Cloudy’s Gloss：翻译图片 / 切换原图', contexts: ['image'], documentUrlPatterns, targetUrlPatterns: ['http://*/*', 'https://*/*'] });
  };
  browser.runtime.onInstalled.addListener(() => { void populate().catch(() => {}); });
  browser.runtime.onStartup.addListener(() => { void populate().catch(() => {}); });
  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (tab?.id === undefined) return;
    if (info.menuItemId === PAGE_MENU) { void browser.tabs.sendMessage(tab.id, { type: 'page:toggle' }, { frameId: 0 }).catch(() => {}); return; }
    if (info.menuItemId !== IMAGE_MENU || !info.srcUrl) return;
    try { imageUrl(info.srcUrl); } catch { return; }
    const url = info.srcUrl;
    // In-place when the content script owns the image; iframe images still have a reader path.
    void browser.tabs.sendMessage(tab.id, { type: 'image:context', url }, { frameId: 0 }).catch(() => false).then(handled => {
      if (!handled) return browser.tabs.create({ url: browser.runtime.getURL('/image.html') + `#url=${encodeURIComponent(url)}` });
    }).catch(() => {});
  });
}
