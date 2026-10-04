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
  if (operation === 'ready') return !!document.querySelector('#pdf-url');
  if (operation === 'fill') {
    const input = document.querySelector<HTMLInputElement>(args[0]!); if (!input) throw new Error('Missing input');
    input.focus(); input.value = args[1]!; input.dispatchEvent(new Event('input', { bubbles: true })); return null;
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
  if (operation === 'scroll') { window.scrollTo(0, Number(args[0])); return null; }
  if (operation === 'frame') { await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))); return null; }
  if (operation === 'viewport') {
    const api = (globalThis as unknown as { browser: typeof import('wxt/browser').browser }).browser;
    const current = await api.windows.getCurrent();
    await api.windows.update(current.id!, { state: 'normal', width: (current.width ?? window.outerWidth) + Number(args[0]) - window.innerWidth, height: (current.height ?? window.outerHeight) + Number(args[1]) - window.innerHeight });
    return null;
  }
  if (operation === 'snapshot') {
    const canvas = document.querySelector('canvas');
    const source = [...document.querySelectorAll('.pdf-paragraph .source')].map((node) => node.textContent);
    const translations = [...document.querySelectorAll('.pdf-paragraph .translation.done')].map((node) => node.textContent);
    let canvasVisible = false;
    if (canvas?.width) { const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data; for (let index = 0; index < pixels.length; index += 400) if (pixels[index] !== 255 && pixels[index + 3]) { canvasVisible = true; break; } }
    return { status: [...document.querySelectorAll('[role="status"]')].map((node) => node.textContent).join(' '),
      error: document.querySelector('[role="alert"]')?.textContent ?? '', source, translations,
      page: document.querySelector<HTMLInputElement>('#page-number')?.value ?? '',
      canvases: document.querySelectorAll('canvas').length, pixels: canvas ? canvas.width * canvas.height : 0, canvasVisible,
      canvasAspect: canvas ? canvas.getBoundingClientRect().width / canvas.getBoundingClientRect().height : 0,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, width: window.innerWidth, height: window.innerHeight,
      name: document.querySelector('.document-name')?.textContent ?? '' };
  }
  throw new Error(`Unknown PDF test action: ${operation}`);
}

export type PdfSnapshot = { status: string; error: string; source: string[]; translations: string[]; page: string; canvases: number; pixels: number; canvasVisible: boolean; canvasAspect: number; overflow: boolean; width: number; height: number; name: string };
class PdfDriver {
  constructor(readonly context: BrowserContext, private page?: Page, private control?: Awaited<ReturnType<typeof startServer>>['control']) {}
  async command<T = unknown>(operation: string, args: string[] = []): Promise<T> {
    if (this.page) {
      // Playwright serializes functions without their module bindings.
      if (operation === 'fill') { await this.page.locator(args[0]!).fill(args[1]!); return null as T; }
      if (operation === 'click') { await this.page.getByRole('button', { name: args[0]!, exact: true }).click(); return null as T; }
      if (operation === 'submit') { await this.page.locator(args[0]!).press('Enter'); return null as T; }
      if (operation === 'file') { await this.page.locator('input[type="file"]').setInputFiles({ name: args[1]!, mimeType: 'application/pdf', buffer: Buffer.from(args[0]!, 'base64') }); return null as T; }
      if (operation === 'scroll') { await this.page.evaluate((top) => window.scrollTo(0, top), Number(args[0])); return null as T; }
      return this.page.evaluate(pdfOperation, { operation, args }) as Promise<T>;
    }
    return this.control!(operation, args);
  }
  snapshot() { return this.command<PdfSnapshot>('snapshot'); }
  // Firefox extension realms use the DOM bridge; the native app is reviewed
  // separately. Do not silently label a normal-tab screenshot as the PDF page.
  async screenshot(file: string) { if (this.page) await this.page.screenshot({ path: file, fullPage: true, animations: 'disabled' }); }
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
