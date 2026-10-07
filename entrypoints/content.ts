import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
import { send, cancel, translateStream } from '../src/messaging';
import { PageTranslator } from '../src/translator';
import { WordSpeaker } from '../src/speech';
import { SelectionPopover } from '../src/popover';
import { FloatingControl } from '../src/floating-control';
import type { Settings } from '../src/schema';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'], runAt: 'document_idle',
  main(ctx) {
    const translator = new PageTranslator({ translate: translateStream, cancel }, () => floating?.update(translator.status));
    const toggle = () => { if (translator.status.enabled) translator.stop(); else translator.start(); };
    const floating: FloatingControl = new FloatingControl(toggle, () => { void send({ type: 'settings:open' }).catch(() => {}); }, () => ctx.notifyInvalidated());
    const speaker = new WordSpeaker({ play: (id, word, locale) => send({ type: 'speech:play', id, word, locale }), cancel });
    const popover = new SelectionPopover({ lookup: (id, word, context) => send({ type: 'dictionary', id, word, context }), local: (id, word) => send({ type: 'lexicon:lookup', id, word }), pronunciation: (id, word) => send({ type: 'pronunciation', id, word }), cancel }, 'system', speaker);
    void send<Pick<Settings, 'theme'>>({ type: 'preferences' }).then(({ theme }) => {
      if (!ctx.isValid) return;
      floating?.setTheme(theme);
      popover.setTheme(theme);
    }).catch(() => {});
    const listener = (message: unknown) => {
      if (typeof message !== 'object' || !message) return;
      const type = (message as { type?: string }).type;
      if (type === 'page:toggle') toggle();
      if (type === 'page:toggle' || type === 'page:status') return Promise.resolve(translator.status);
    };
    browser.runtime.onMessage.addListener(listener);
    // WXT handles history.pushState / replaceState navigation in both browsers.
    ctx.addEventListener(window, 'wxt:locationchange', () => {
      popover.close();
      // MutationObserver handles changed content; retained blocks keep their translations.
    });
    ctx.addEventListener(window, 'pagehide', () => { translator.stop(); popover.close(); });
    ctx.onInvalidated(() => { translator.stop(); popover.destroy(); floating?.destroy(); browser.runtime.onMessage.removeListener(listener); });
  },
});
