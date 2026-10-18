import { defineContentScript } from 'wxt/utils/define-content-script';
import { EARLY_CAPTIONS, installCaptionWarmup, type EarlyCaptionStore } from '../src/video/warmup';

export default defineContentScript({
  matches: ['https://www.youtube.com/*', 'https://m.youtube.com/*', 'https://youtube.com/*'],
  world: 'MAIN', runAt: 'document_start', allFrames: true,
  main() {
    const scope = window as unknown as Record<string, EarlyCaptionStore | undefined>;
    scope[EARLY_CAPTIONS]?.dispose();
    scope[EARLY_CAPTIONS] = installCaptionWarmup();
  },
});
