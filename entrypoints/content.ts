import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
import { send, cancel, translateStream } from '../src/core/messaging';
import { PageTranslator } from '../src/page/translator';
import { WordSpeaker } from '../src/speech/speech';
import { SelectionPopover } from '../src/ui/popover';
import { FloatingControl } from '../src/ui/floating-control';
import { InputTranslation } from '../src/page/input-translation';
import { defaults, type Settings } from '../src/core/schema';
import { ImageTranslationLauncher } from '../src/image/launcher';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'], runAt: 'document_idle',
  main(ctx) {
    const transport = { translate: translateStream, cancel };
    const translator = new PageTranslator(transport, () => floating?.update(translator.status));
    translator.setConcurrency(defaults.concurrency);
    const toggle = () => { if (translator.status.enabled) translator.stop(); else translator.start(); };
    const floating: FloatingControl = new FloatingControl(toggle, () => { void send({ type: 'settings:open' }).catch(() => {}); }, () => ctx.notifyInvalidated());
    const speaker = new WordSpeaker({ play: (id, word, locale) => send({ type: 'speech:play', id, word, locale }), cancel });
    const popover = new SelectionPopover({ lookup: (id, word, context) => send({ type: 'dictionary', id, word, context }), local: (id, word) => send({ type: 'lexicon:lookup', id, word }), definitions: (id, word) => send({ type: 'definition:lookup', id, word }), pronunciation: (id, word) => send({ type: 'pronunciation', id, word }), cancel }, 'system', speaker);
    const inputTranslation = new InputTranslation({ translate: (id, text) => send<string>({ type: 'input:translate', id, text }), cancel });
    const images = new ImageTranslationLauncher(url => send({ type: 'image:open', url }));
    inputTranslation.setEnabled(false);
    void send<Pick<Settings, 'theme' | 'inputTranslation' | 'concurrency'>>({ type: 'preferences' }).then(({ theme, inputTranslation: enabled, concurrency }) => {
      if (!ctx.isValid) return;
      floating?.setTheme(theme);
      popover.setTheme(theme);
      inputTranslation.setEnabled(enabled);
      translator.setConcurrency(concurrency);
    }).catch(() => {});
    const preferencesChanged: Parameters<typeof browser.storage.onChanged.addListener>[0] = (changes, area) => {
      const value = changes.settings?.newValue;
      if (area === 'local' && value && typeof value === 'object' && 'inputTranslation' in value) inputTranslation.setEnabled(value.inputTranslation !== false);
      if (area === 'local' && value && typeof value === 'object' && 'concurrency' in value && typeof value.concurrency === 'number') translator.setConcurrency(value.concurrency);
    };
    browser.storage.onChanged.addListener(preferencesChanged);
    const listener = (message: unknown) => {
      if (typeof message !== 'object' || !message) return;
      const type = (message as { type?: string }).type;
      if (type === 'image:context' && 'url' in message && typeof message.url === 'string') return Promise.resolve(images.translateFromContext(message.url));
      if (type === 'page:toggle') toggle();
      if (type === 'page:toggle' || type === 'page:status') return Promise.resolve(translator.status);
    };
    browser.runtime.onMessage.addListener(listener);
    // WXT handles history.pushState / replaceState navigation in both browsers.
    ctx.addEventListener(window, 'wxt:locationchange', () => {
      popover.close();
      inputTranslation.resetPage();
      images.reset();
      // MutationObserver handles changed content; retained blocks keep their translations.
    });
    ctx.addEventListener(window, 'pagehide', () => { translator.stop(); popover.close(); inputTranslation.resetPage(); images.reset(); });
    ctx.onInvalidated(() => { translator.stop(); popover.destroy(); inputTranslation.destroy(); images.destroy(); floating?.destroy(); browser.runtime.onMessage.removeListener(listener); browser.storage.onChanged.removeListener(preferencesChanged); });
  },
});
