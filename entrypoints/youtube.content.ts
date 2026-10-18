import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
import { cancel, translateStream } from '../src/core/messaging';
import { YouTubeSubtitles } from '../src/video/youtube';

export default defineContentScript({
  matches: ['https://www.youtube.com/*', 'https://m.youtube.com/*', 'https://youtube.com/*'],
  runAt: 'document_idle', allFrames: true,
  main(ctx) {
    const replace = 'cloudys-gloss:replace-subtitles';
    window.dispatchEvent(new Event(replace));
    const subtitles = new YouTubeSubtitles({ translate: translateStream, cancel });
    ctx.addEventListener(window, replace, () => ctx.notifyInvalidated());
    ctx.addEventListener(window, 'wxt:locationchange', () => subtitles.navigate());
    ctx.addEventListener(window, 'pagehide', event => { if (!event.persisted) subtitles.destroy(); });
    ctx.addEventListener(window, 'pageshow', event => { if (event.persisted) { subtitles.navigate(); subtitles.settingsChanged(); } });
    const changed: Parameters<typeof browser.storage.onChanged.addListener>[0] = (changes, area) => {
      if (area === 'local' && changes.settings) subtitles.settingsChanged();
    };
    browser.storage.onChanged.addListener(changed);
    ctx.onInvalidated(() => { subtitles.destroy(); browser.storage.onChanged.removeListener(changed); });
  },
});
