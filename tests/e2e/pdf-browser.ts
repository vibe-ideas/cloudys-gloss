import { test as base, chromium, firefox, type BrowserContext, type Page } from '@playwright/test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { defaults } from '../../src/schema';
import { startServer } from './server';

/** Executed only in the isolated test copy. Firefox BiDi excludes extension
 * realms, so this controls real PDF DOM from inside that realm, like the existing
 * settings bridge. It never replaces PDF.js, provider or runtime messages. */
async function pdfOperation({ operation, args }: { operation: string; args: string[] }) {
  const visible = (element: Element | null) => !!element && element.getClientRects().length > 0
    && getComputedStyle(element).visibility !== 'hidden';
  const rect = (element: Element | null) => { const box = element?.getBoundingClientRect(); return box ? { x: box.x, y: box.y, width: box.width, height: box.height } : { x: 0, y: 0, width: 0, height: 0 }; };
  const onScreen = (element: Element, within?: Element | null) => {
    if (!visible(element)) return false;
    const box = element.getBoundingClientRect(); const clip = within?.getBoundingClientRect();
    return box.right > Math.max(0, clip?.left ?? 0) && box.left < Math.min(innerWidth, clip?.right ?? innerWidth)
      && box.bottom > Math.max(0, clip?.top ?? 0) && box.top < Math.min(innerHeight, clip?.bottom ?? innerHeight);
  };
  if (operation === 'ready') return !!document.querySelector('#pdf-url');
  if (operation === 'fill') {
    const input = document.querySelector<HTMLInputElement>(args[0]!); if (!input) throw new Error('Missing input');
    input.focus(); input.value = args[1]!; input.dispatchEvent(new Event('input', { bubbles: true })); return null;
  }
  if (operation === 'button-enabled') {
    const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(element => (element.getAttribute('aria-label') || element.textContent) === args[0]);
    return !!button && !button.disabled;
  }
  if (operation === 'click') {
    const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find((element) => (element.getAttribute('aria-label') || element.textContent) === args[0]);
    if (!button || button.disabled) throw new Error(`Unavailable button: ${args[0]}`);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    button.click(); return null;
  }
  if (operation === 'submit') { document.querySelector<HTMLInputElement>(args[0]!)?.form?.requestSubmit(); return null; }
  if (operation === 'file') {
    const data = Uint8Array.from(atob(args[0]!), (value) => value.charCodeAt(0));
    const transfer = new DataTransfer(); transfer.items.add(new File([data], args[1]!, { type: 'application/pdf' }));
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true })); return null;
  }
  if (operation === 'scroll') {
    const reader = document.querySelector<HTMLElement>('.spread-scroll'); if (!reader) throw new Error('Missing PDF reading region');
    reader.scrollTo({ top: Number(args[0]), left: Number(args[1] ?? reader.scrollLeft) }); return null;
  }
  if (operation === 'open-block') {
    const block = document.querySelector<HTMLElement>(`.pdf-block[data-block="${Number(args[0])}"]`);
    if (!block || !visible(block)) throw new Error('Unavailable visible PDF block');
    block.scrollIntoView({ block: 'center', inline: 'center' }); block.focus();
    const box = block.getBoundingClientRect(); const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    if (hit !== block && !block.contains(hit)) throw new Error('PDF block is obscured');
    if (args[1] === 'Enter') block.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); else block.click();
    return null;
  }
  if (operation === 'dialog-scroll') { document.querySelector('.detail-body')!.scrollTop = Number(args[0]); return null; }
  if (operation === 'escape') {
    // The extension realm is inaccessible to Firefox BiDi; cancel is the
    // native dialog event Escape produces, including the app's own handler.
    const dialog = document.querySelector<HTMLDialogElement>('dialog[open]');
    if (dialog && dialog.dispatchEvent(new Event('cancel', { cancelable: true }))) dialog.close(); return null;
  }
  if (operation === 'capture') {
    const api = (globalThis as unknown as { browser: typeof import('wxt/browser').browser }).browser;
    const current = await api.windows.getCurrent(); if (current.id === undefined) throw new Error('Missing PDF window');
    if (typeof api.tabs.captureVisibleTab !== 'function') return null;
    try { return await api.tabs.captureVisibleTab(current.id, { format: 'png' }); } catch { return null; }
  }
  if (operation === 'frame') { await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))); return null; }
  if (operation === 'viewport') {
    const api = (globalThis as unknown as { browser: typeof import('wxt/browser').browser }).browser;
    const current = await api.windows.getCurrent();
    await api.windows.update(current.id!, { state: 'normal', width: (current.width ?? window.outerWidth) + Number(args[0]) - window.innerWidth, height: (current.height ?? window.outerHeight) + Number(args[1]) - window.innerHeight });
    return null;
  }
  if (operation === 'snapshot') {
    const reader = document.querySelector<HTMLElement>('.spread-scroll');
    const canvases = [...document.querySelectorAll<HTMLCanvasElement>('canvas')];
    const canvas = canvases.find(node => onScreen(node, reader));
    const original = document.querySelector<HTMLCanvasElement>('.original-sheet canvas');
    let canvasVariation = false;
    if (original?.width) {
      const pixels = original.getContext('2d')!.getImageData(0, 0, original.width, original.height).data;
      const step = Math.max(4, Math.floor(pixels.length / 8192 / 4) * 4);
      for (let offset = step; offset < pixels.length; offset += step) {
        if (pixels[offset] !== pixels[0] || pixels[offset + 1] !== pixels[1] || pixels[offset + 2] !== pixels[2] || pixels[offset + 3] !== pixels[3]) { canvasVariation = true; break; }
      }
    }
    const source = [...document.querySelectorAll('.pdf-paragraph .source')].map((node) => node.textContent);
    const sheet = document.querySelector('.translated-sheet'); const sheetRect = sheet?.getBoundingClientRect();
    const overlays = [...document.querySelectorAll<HTMLElement>('.pdf-block')].filter(visible).map(node => {
      const box = node.getBoundingClientRect(); const lines = [...node.querySelectorAll<HTMLElement>('.fitted-line')];
      return { index: Number(node.dataset.block), text: lines.map(line => line.textContent).join(''), translated: node.classList.contains('has-translation'),
        overflow: node.dataset.overflow === 'true', visible: onScreen(node, reader), box: rect(node),
        inside: !!sheetRect && box.left >= sheetRect.left - 1 && box.top >= sheetRect.top - 1 && box.right <= sheetRect.right + 1 && box.bottom <= sheetRect.bottom + 1,
        fitted: lines.every(line => { const bounds = line.getBoundingClientRect(); return bounds.bottom <= box.bottom + 1 && bounds.right <= box.right + 1 && line.scrollWidth <= line.clientWidth + 1; }),
        color: getComputedStyle(node).color };
    });
    const errors = [...document.querySelectorAll('.pdf-failures li p')].map(node => node.textContent ?? '');
    const reading = visible(document.querySelector('.reading-flow'));
    const translations = reading ? [...document.querySelectorAll('.pdf-paragraph .translation.done')].filter(visible).map(node => node.textContent ?? '')
      : overlays.filter(node => node.visible && node.translated).map(node => node.text);
    const dialog = document.querySelector<HTMLDialogElement>('dialog');
    const detailBody = dialog?.querySelector<HTMLElement>('.detail-body');
    const close = dialog?.querySelector('button[aria-label="关闭段落详情"]'); const closeBounds = close?.getBoundingClientRect();
    const closeHit = closeBounds && document.elementFromPoint(closeBounds.x + closeBounds.width / 2, closeBounds.y + closeBounds.height / 2);
    return { status: [...document.querySelectorAll('[role="status"]')].map((node) => node.textContent).join(' '),
      error: document.querySelector('[role="alert"]')?.textContent ?? '', errors, source, translations,
      page: document.querySelector<HTMLInputElement>('#page-number')?.value ?? '',
      canvases: canvases.length, pixels: canvases.reduce((sum, canvas) => sum + canvas.width * canvas.height, 0), canvasVisible: !!canvas?.width && canvasVariation, canvasVariation,
      canvasDetails: canvases.map(node => ({ width: node.width, height: node.height, visible: onScreen(node, reader), box: rect(node) })),
      canvasAspect: canvas ? canvas.getBoundingClientRect().width / canvas.getBoundingClientRect().height : 0,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, width: window.innerWidth, height: window.innerHeight,
      name: document.querySelector('.document-name')?.textContent ?? '', mode: document.querySelector<HTMLElement>('.pdf-page')?.dataset.mode ?? '', reading,
      notice: document.querySelector('.layout-notice')?.textContent ?? '', overlays, zoom: Number(document.querySelector('.zoom-controls output')?.textContent?.replace('%', '') ?? 0),
      reader: { ...rect(reader), scrollTop: reader?.scrollTop ?? 0, scrollLeft: reader?.scrollLeft ?? 0, scrollWidth: reader?.scrollWidth ?? 0, clientWidth: reader?.clientWidth ?? 0,
        scrollHeight: reader?.scrollHeight ?? 0, clientHeight: reader?.clientHeight ?? 0 },
      focusedBlock: document.activeElement instanceof HTMLElement ? document.activeElement.dataset.block ?? '' : '',
      dialog: { open: !!dialog?.open, box: rect(dialog), source: dialog?.querySelector('.detail-source')?.textContent ?? '', translation: dialog?.querySelector('.detail-translation')?.textContent ?? '', error: dialog?.querySelector('.paragraph-error')?.textContent ?? '',
        scrollTop: detailBody?.scrollTop ?? 0, scrollHeight: detailBody?.scrollHeight ?? 0, clientHeight: detailBody?.clientHeight ?? 0,
        closeVisible: !!close && onScreen(close, dialog), closeHit: !!close && (closeHit === close || !!closeHit && close.contains(closeHit)) },
    };
  }
  if (operation === 'pixels') {
    const original = document.querySelector<HTMLCanvasElement>('.original-sheet canvas')!;
    const translated = document.querySelector<HTMLCanvasElement>('.translated-sheet canvas')!;
    const background = document.querySelector<HTMLCanvasElement>('.pdf-page > canvas')!;
    if (!original?.width || !translated?.width || !background?.width) throw new Error('PDF canvases are not ready');
    if (original.width !== translated.width || original.height !== translated.height) throw new Error('Comparison canvases have different dimensions');
    const width = original.width, height = original.height;
    const page = document.querySelector<HTMLElement>('.original-sheet')!;
    const sx = width / parseFloat(page.style.width), sy = height / parseFloat(page.style.height);
    const a = original.getContext('2d')!.getImageData(0, 0, width, height).data;
    const b = translated.getContext('2d')!.getImageData(0, 0, width, height).data;
    const c = background.getContext('2d')!.getImageData(0, 0, width, height).data;
    const allowed = new Uint8Array(width * height);
    const toPixels = (box: { x: number; y: number; width: number; height: number }) => {
      const x = Math.max(0, Math.floor(box.x * sx)), y = Math.max(0, Math.floor(box.y * sy));
      return { x, y, right: Math.min(width, Math.ceil((box.x + box.width) * sx)), bottom: Math.min(height, Math.ceil((box.y + box.height) * sy)) };
    };
    for (const node of document.querySelectorAll<HTMLElement>('.pdf-block.has-translation')) {
      const box = toPixels({ x: parseFloat(node.style.left), y: parseFloat(node.style.top), width: parseFloat(node.style.width), height: parseFloat(node.style.height) });
      for (let y = box.y; y < box.bottom; y++) allowed.fill(1, y * width + box.x, y * width + box.right);
    }
    const sample = (box: { x: number; y: number; right: number; bottom: number }) => {
      let changed = 0, nonWhite = 0, outsideOverlays = 0, backgroundDifference = 0;
      let originalHash = 2166136261, translatedHash = 2166136261;
      for (let y = box.y; y < box.bottom; y++) for (let x = box.x; x < box.right; x++) {
        const pixel = y * width + x, offset = pixel * 4;
        let different = false, backgroundDifferent = false;
        for (let channel = 0; channel < 4; channel++) {
          originalHash = Math.imul(originalHash ^ a[offset + channel]!, 16777619);
          translatedHash = Math.imul(translatedHash ^ b[offset + channel]!, 16777619);
          different ||= a[offset + channel] !== b[offset + channel]; backgroundDifferent ||= b[offset + channel] !== c[offset + channel];
        }
        if (different) { changed++; if (!allowed[pixel]) outsideOverlays++; }
        if (backgroundDifferent) backgroundDifference++;
        if (a[offset + 3] && (a[offset]! < 245 || a[offset + 1]! < 245 || a[offset + 2]! < 245)) nonWhite++;
      }
      return { changed, outsideOverlays, nonWhite, backgroundDifference, originalHash: originalHash >>> 0, translatedHash: translatedHash >>> 0 };
    };
    const probes = JSON.parse(args[0] ?? '[]') as { name: string; x: number; y: number; width: number; height: number }[];
    return { ...sample({ x: 0, y: 0, right: width, bottom: height }), width, height,
      probes: probes.map(probe => ({ name: probe.name, ...sample(toPixels(probe)) })) };
  }
  throw new Error(`Unknown PDF test action: ${operation}`);
}

type Rectangle = { x: number; y: number; width: number; height: number };
type PixelSample = { changed: number; outsideOverlays: number; nonWhite: number; backgroundDifference: number; originalHash: number; translatedHash: number };
export type PdfPixels = PixelSample & { width: number; height: number; probes: (PixelSample & { name: string })[] };
export type PdfSnapshot = { status: string; error: string; errors: string[]; source: string[]; translations: string[]; page: string; canvases: number; pixels: number;
  canvasVisible: boolean; canvasVariation: boolean; canvasAspect: number; canvasDetails: { width: number; height: number; visible: boolean; box: Rectangle }[];
  overflow: boolean; width: number; height: number; name: string; mode: string; reading: boolean; notice: string; zoom: number;
  overlays: { index: number; text: string; translated: boolean; overflow: boolean; visible: boolean; box: Rectangle; inside: boolean; fitted: boolean; color: string }[];
  reader: Rectangle & { scrollTop: number; scrollLeft: number; scrollWidth: number; clientWidth: number; scrollHeight: number; clientHeight: number };
  focusedBlock: string;
  dialog: { open: boolean; box: Rectangle; source: string; translation: string; error: string; scrollTop: number; scrollHeight: number; clientHeight: number; closeVisible: boolean; closeHit: boolean };
};
class PdfDriver {
  constructor(readonly context: BrowserContext, private page?: Page, private control?: Awaited<ReturnType<typeof startServer>>['control']) {}
  async command<T = unknown>(operation: string, args: string[] = []): Promise<T> {
    if (this.page) {
      // Playwright serializes functions without their module bindings.
      if (operation === 'fill') { await this.page.locator(args[0]!).fill(args[1]!); return null as T; }
      if (operation === 'click') { await this.page.getByRole('button', { name: args[0]!, exact: true }).click(); return null as T; }
      if (operation === 'submit') { await this.page.locator(args[0]!).press('Enter'); return null as T; }
      if (operation === 'file') { await this.page.locator('input[type="file"]').setInputFiles({ name: args[1]!, mimeType: 'application/pdf', buffer: Buffer.from(args[0]!, 'base64') }); return null as T; }
      if (operation === 'open-block') {
        const block = this.page.locator(`.pdf-block[data-block="${Number(args[0])}"]`);
        if (args[1] === 'Enter') { await block.scrollIntoViewIfNeeded(); await block.focus(); await block.press('Enter'); } else await block.click();
        return null as T;
      }
      if (operation === 'escape') { await this.page.keyboard.press('Escape'); return null as T; }
      return this.page.evaluate(pdfOperation, { operation, args }) as Promise<T>;
    }
    return this.control!(operation, args);
  }
  snapshot() { return this.command<PdfSnapshot>('snapshot'); }
  pixels(probes: { name: string; x: number; y: number; width: number; height: number }[] = []) { return this.command<PdfPixels>('pixels', [JSON.stringify(probes)]); }
  async screenshot(file: string) {
    if (this.page) { await this.page.screenshot({ path: file, fullPage: true, animations: 'disabled', caret: 'initial' }); return true; }
    const data = await this.command<string | null>('capture');
    if (data) { await writeFile(file, Buffer.from(data.slice(data.indexOf(',') + 1), 'base64')); return true; }
    // This Firefox test realm lacks captureVisibleTab. Preserve the evidence
    // boundary explicitly; DOM/geometry/canvas-pixel assertions still run.
    await writeFile(`${file}.unavailable.txt`, 'Firefox extension screenshot API unavailable in this test realm. This is not a screenshot. DOM, geometry and canvas-pixel assertions run separately.\n');
    return false;
  }
  async viewport(width: number, height: number) { if (this.control) await this.control('viewport', [String(width), String(height)]); else await this.page!.setViewportSize({ width, height }); }
}

type Fixtures = { pdf: { driver: PdfDriver; server: Awaited<ReturnType<typeof startServer>> } };
export const test = base.extend<Fixtures>({
  pdf: async ({ browserName }, use, testInfo) => {
    void browserName;
    const server = await startServer(); const profile = await mkdtemp(path.join(tmpdir(), 'cloudys-pdf-'));
    let context: BrowserContext | undefined;
    const settings = { ...defaults, baseUrl: `${server.url}/v1`, model: 'pdf-test-model', timeout: 30000, autoStartLocalModel: false };
    try {
      let driver: PdfDriver;
      if (testInfo.project.name === 'chromium') {
        const extensionPath = path.resolve('.output/chrome-mv3');
        context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, viewport: { width: 1280, height: 900 }, args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`] });
        const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
        await worker.evaluate(async (settings) => { const api = (globalThis as unknown as { chrome: typeof import('wxt/browser').browser }).chrome; while ((await api.storage.local.get('modelPresetVersion')).modelPresetVersion !== 2) await new Promise((resolve) => setTimeout(resolve, 30)); await api.storage.local.set({ settings, modelPresetVersion: 2 }); }, settings);
        const page = await context.newPage(); await page.goto(`chrome-extension://${new URL(worker.url()).host}/pdf.html`);
        driver = new PdfDriver(context, page);
      } else {
        const require = createRequire(import.meta.url);
        const remote = await import(pathToFileURL(path.join(path.dirname(require.resolve('web-ext')), 'lib/firefox/remote.js')).href) as { findFreeTcpPort(): Promise<number>; connectWithMaxRetries(options: { port: number }): Promise<{ installTemporaryAddon(path: string, openDevTools: boolean): Promise<unknown>; disconnect(): void }> };
        const port = await remote.findFreeTcpPort(); const addon = path.join(profile, 'pdf-addon'); await cp('.output/firefox-mv2', addon, { recursive: true });
        const manifest = JSON.parse(await readFile(path.join(addon, 'manifest.json'), 'utf8')); manifest.background.scripts.push('test-pdf-open.js');
        await writeFile(path.join(addon, 'manifest.json'), JSON.stringify(manifest));
        await writeFile(path.join(addon, 'test-pdf-open.js'), `(async()=>{while((await browser.storage.local.get('modelPresetVersion')).modelPresetVersion!==2)await new Promise(r=>setTimeout(r,30));await browser.storage.local.set(${JSON.stringify({ settings, modelPresetVersion: 2 })});await browser.windows.create({url:browser.runtime.getURL('pdf.html'),type:'popup',width:1280,height:1000});})();`);
        const bridge = `const operationHandler=${pdfOperation.toString()};(async()=>{while(true){try{const command=await(await fetch(${JSON.stringify(`${server.url}/bridge/${server.token}`)})).json();if(!command){await new Promise(r=>setTimeout(r,40));continue;}let value,error;try{value=await operationHandler({operation:command.operation,args:command.args});}catch(reason){error=reason.message;}await fetch(${JSON.stringify(`${server.url}/reply/${server.token}`)},{method:'POST',body:JSON.stringify({id:command.id,value,error})});}catch{break;}}})();`;
        await writeFile(path.join(addon, 'test-pdf-bridge.js'), bridge);
        const html = await readFile(path.join(addon, 'pdf.html'), 'utf8'); await writeFile(path.join(addon, 'pdf.html'), html.replace('</body>', '<script src="test-pdf-bridge.js"></script></body>'));
        context = await firefox.launchPersistentContext(profile, { channel: 'moz-firefox', executablePath: process.env.FIREFOX_BINARY ?? (existsSync('/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox') ? '/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox' : firefox.executablePath()), headless: true, ignoreDefaultArgs: true,
          args: ['--remote-debugging-port=0', '-headless', '-profile', profile, '-start-debugger-server', String(port)], viewport: null,
          firefoxUserPrefs: { 'devtools.chrome.enabled': true, 'devtools.debugger.remote-enabled': true, 'devtools.debugger.prompt-connection': false } });
        const client = await remote.connectWithMaxRetries({ port }); try { await client.installTemporaryAddon(addon, false); } finally { client.disconnect(); }
        driver = new PdfDriver(context, undefined, server.control);
      }
      await base.expect.poll(() => driver.command<boolean>('ready')).toBe(true);
      await use({ driver, server });
    } finally { await context?.close(); await server.close(); await rm(profile, { recursive: true, force: true }); }
  },
});
export { expect } from '@playwright/test';
