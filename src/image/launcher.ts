import { OWN } from '../page/blocks';
import { ArticleImageTranslator } from './article';

/**
 * Handles context-menu image translation actions for article images.
 * Keeps existing page DOM clean without injecting hovering toolbars.
 */
export class ImageTranslationLauncher {
  private translator = new ArticleImageTranslator();
  private controller = new AbortController();
  private contextImage?: HTMLImageElement;

  constructor(open?: (url: string) => Promise<unknown>) {
    void open;
    document.querySelectorAll(`[${OWN}="image-launcher"]`).forEach(node => node.remove());
    const signal = this.controller.signal;
    document.addEventListener('contextmenu', event => {
      if (!event.isTrusted) return;
      this.contextImage = event.target instanceof HTMLImageElement ? event.target : undefined;
    }, { signal, capture: true });
  }

  translateFromContext(url: string) {
    const matches = (image: HTMLImageElement | undefined) => image?.isConnected && (image.currentSrc || image.src) === url;
    const image = matches(this.contextImage) ? this.contextImage : Array.from(document.querySelectorAll<HTMLImageElement>('img')).find(image => matches(image));
    if (!image) return false;
    this.translator.toggle(image);
    return true;
  }

  hide() { this.contextImage = undefined; }
  reset() { this.translator.reset(); this.contextImage = undefined; }
  destroy() { this.controller.abort(); this.translator.destroy(); }
}
