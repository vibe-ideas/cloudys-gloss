import { test as base, chromium, firefox, type BrowserContext, type Page } from '@playwright/test';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { startServer } from './server';
import { firefoxBridge } from './firefox-bridge';
import { SettingsDriver } from './settings-driver';

type Fixture = { headed: boolean; motion: 'reduce' | 'no-preference'; extension: { context: BrowserContext; options: SettingsDriver; page: Page; server: Awaited<ReturnType<typeof startServer>>; toggle: () => Promise<unknown> } };
export const test = base.extend<Fixture>({
  motion: ['no-preference', { option: true }],
  headed: [false, { option: true }],
  extension: async ({ browserName, motion, headed }, use, testInfo) => {
    void browserName;
    const server = await startServer();
    const profile = await mkdtemp(path.join(tmpdir(), 'cloudys-gloss-e2e-'));
    let context: BrowserContext | undefined;
    let chromeProcess: ChildProcess | undefined;
    try {
      let options: SettingsDriver;
      if (testInfo.project.name === 'chromium') {
        if (testInfo.config.metadata.nativeHost) {
          // Chrome resolves user-level hosts under its custom --user-data-dir.
          // Register the installed real helper in this isolated test profile.
          const name = 'com.cloudys_gloss.mlx.json';
          await mkdir(path.join(profile, 'NativeMessagingHosts'), { recursive: true });
          await cp(path.join(homedir(), 'Library/Application Support/Google/ChromeForTesting/NativeMessagingHosts', name), path.join(profile, 'NativeMessagingHosts', name));
        }
        const extensionPath = path.join(profile, 'test-addon');
        await cp('.output/chrome-mv3', extensionPath, { recursive: true });
        // Reinjection regression tests need scripting only in this disposable
        // test copy. Production permissions remain unchanged.
        const manifestPath = path.join(extensionPath, 'manifest.json');
        const chromeManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
        chromeManifest.permissions.push('scripting');
        await writeFile(manifestPath, JSON.stringify(chromeManifest));
        const extensionArgs = [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`];
        if (headed) {
          // Playwright normally forces every Chromium page to remain focused.
          // Connect without those overrides to test genuine tab visibility.
          chromeProcess = spawn(chromium.executablePath(), [`--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--disable-component-extensions-with-background-pages', '--no-sandbox', '--window-size=1100,800', ...extensionArgs, 'about:blank'], { stdio: 'ignore' });
          let startupError: Error | undefined;
          chromeProcess.once('error', error => { startupError = error; });
          let endpoint = '';
          for (let attempt = 0; attempt < 100; attempt++) {
            if (startupError) throw startupError;
            if (chromeProcess.exitCode !== null) throw new Error('Test Chromium exited before CDP was ready');
            try {
              const [port, websocket] = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).trim().split('\n');
              if (port && websocket) { endpoint = `ws://127.0.0.1:${port}${websocket}`; break; }
            } catch { /* The isolated browser is still starting. */ }
            await delay(100);
          }
          if (!endpoint) throw new Error('Test Chromium CDP endpoint did not become ready');
          const browser = await chromium.connectOverCDP(endpoint, { noDefaults: true });
          context = browser.contexts()[0]!;
        } else context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, reducedMotion: motion, viewport: { width: 1100, height: 800 }, args: extensionArgs });
        const isExtensionWorker = (worker: { url(): string }) => new URL(worker.url()).pathname === `/${chromeManifest.background.service_worker}`;
        const worker = context.serviceWorkers().find(isExtensionWorker) ?? await context.waitForEvent('serviceworker', isExtensionWorker);
        const optionsPage = await context.newPage(); await optionsPage.goto(`chrome-extension://${new URL(worker.url()).host}/options.html`);
        options = new SettingsDriver(optionsPage);
      } else {
        const require = createRequire(import.meta.url);
        const remote = await import(pathToFileURL(path.join(path.dirname(require.resolve('web-ext')), 'lib/firefox/remote.js')).href) as {
          findFreeTcpPort(): Promise<number>;
          connectWithMaxRetries(options: { port: number }): Promise<{ installTemporaryAddon(path: string, openDevTools: boolean): Promise<unknown>; disconnect(): void }>;
        };
        const port = await remote.findFreeTcpPort();
        const addon = path.join(profile, 'test-addon');
        await mkdir(path.dirname(addon), { recursive: true }); await cp('.output/firefox-mv2', addon, { recursive: true });
        // BiDi cannot navigate to extension URLs. Only the test copy opens its own settings tab.
        const manifest = JSON.parse(await readFile(path.join(addon, 'manifest.json'), 'utf8'));
        manifest.background.scripts.push('test-open.js');
        await writeFile(path.join(addon, 'manifest.json'), JSON.stringify(manifest));
        await writeFile(path.join(addon, 'test-open.js'), "browser.tabs.create({url:browser.runtime.getURL('options.html')});");
        await writeFile(path.join(addon, 'test-options.js'), firefoxBridge(server.url, server.token));
        const html = await readFile(path.join(addon, 'options.html'), 'utf8');
        await writeFile(path.join(addon, 'options.html'), html.replace('</body>', '<script src="test-options.js"></script></body>'));
        context = await firefox.launchPersistentContext(profile, {
          channel: 'moz-firefox', executablePath: process.env.FIREFOX_BINARY ?? (existsSync('/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox') ? '/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox' : firefox.executablePath()), headless: !headed,
          ignoreDefaultArgs: true,
          args: ['--remote-debugging-port=0', ...(headed ? [] : ['-headless']), '-profile', profile, '-start-debugger-server', String(port)],
          viewport: { width: 1100, height: 800 },
          firefoxUserPrefs: {
            'ui.prefersReducedMotion': motion === 'reduce' ? 1 : 0,
            'devtools.chrome.enabled': true, 'devtools.debugger.remote-enabled': true, 'devtools.debugger.prompt-connection': false,
            // BiDi defaults keep top-level documents active even in background
            // tabs. Visibility tests need the browser's real activation state.
            ...(headed ? { 'layout.testing.top-level-always-active': false } : {}),
          },
        });
        const client = await remote.connectWithMaxRetries({ port });
        try { await client.installTemporaryAddon(addon, false); } finally { client.disconnect(); }
        options = new SettingsDriver(undefined, server.control);
      }
      await base.expect.poll(() => options.ready()).toBe(true);
      await options.fill('baseUrl', `${server.url}/v1`);
      await options.fill('model', 'test-model');
      await options.click('保存设置');
      await base.expect.poll(() => options.status()).toContain('设置已保存');
      const page = await context.newPage(); await page.goto(server.url);
      const toggle = async () => {
        // document_idle injection may run after navigation's load event in Firefox.
        await base.expect(page.locator('[data-cloudys-gloss="floating-control"]')).toHaveCount(1);
        return options.toggle(server.url);
      };
      await use({ context, options, page, server, toggle });
    } finally {
      await context?.close();
      if (chromeProcess?.pid && chromeProcess.exitCode === null && chromeProcess.signalCode === null) {
        const exited = new Promise<void>(resolve => chromeProcess!.once('exit', () => resolve()));
        chromeProcess.kill('SIGTERM');
        await Promise.race([exited, delay(3000, undefined, { ref: false })]);
        if (chromeProcess.exitCode === null && chromeProcess.signalCode === null) { chromeProcess.kill('SIGKILL'); await exited; }
      }
      await server.close(); await rm(profile, { recursive: true, force: true });
    }
  },
});
export { expect } from '@playwright/test';
