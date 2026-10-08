import { expect, type Page } from '@playwright/test';
type Control = <T>(operation: string, args?: unknown[]) => Promise<T>;
export class SettingsDriver {
  constructor(private page?: Page, private control?: Control) {}
  async fill(name: string, value: string) {
    if (this.page) await this.page.locator(`[name="${name}"]`).fill(value);
    else await this.control!('fill', [name, value]);
  }
  async select(name: string, value: string) {
    if (this.page) await this.page.locator(`[name="${name}"]`).selectOption(value);
    else await this.control!('select', [name, value]);
  }
  async click(name: string) {
    if (this.page) await this.page.getByRole('button', { name, exact: true }).click();
    else await this.control!('click', [name]);
  }
  async status(): Promise<string> { return this.page ? (await this.page.getByRole('status').textContent()) ?? '' : this.control!('status'); }
  async modelStatus(): Promise<string> { return this.page ? (await this.page.getByTestId('model-status').textContent()) ?? '' : this.control!('model-status'); }
  async dictionaryFiles(files: { name: string; buffer: Buffer }[]) {
    if (this.page) await this.page.locator('[name="dictionaryFiles"]').setInputFiles(files.map(file => ({ ...file, mimeType: 'application/octet-stream' })));
    else await this.control!('dictionary-files', [files.map(file => ({ name: file.name, base64: file.buffer.toString('base64') }))]);
  }
  async dictionaryText(part: 'status' | 'list' | 'results'): Promise<string> {
    return this.page ? (await this.page.getByTestId(`dictionary-${part}`).textContent()) ?? '' : this.control!('dictionary-text', [part]);
  }
  async dictionaryBenchmark(words: string[]): Promise<{ word: string; ms: number; hits: number }[]> {
    if (!this.page) return this.control!('dictionary-benchmark', [words]);
    return this.page.evaluate(async words => {
      const api = (globalThis as unknown as { chrome: typeof import('wxt/browser').browser }).chrome;
      const rows = [];
      for (const word of words) {
        const start = performance.now(); const response = await api.runtime.sendMessage({ type: 'lexicon:lookup', id: crypto.randomUUID(), word });
        if (!response.ok) throw new Error(response.error);
        rows.push({ word, ms: performance.now() - start, hits: response.data.length });
      }
      return rows;
    }, words);
  }
  async reload() {
    if (this.page) await this.page.reload(); else {
      const before = await this.control!('document-generation'); await this.control!('reload');
      await expect.poll(() => this.control!('document-generation')).not.toBe(before);
    }
  }
  async ready(): Promise<boolean> { return this.page ? await this.page.getByRole('button', { name: '保存设置', exact: true }).isEnabled() : this.control!('ready'); }
  async isActive(): Promise<boolean> {
    if (!this.page) return this.control!('active');
    // Chrome can open options inside chrome://extensions instead of activating
    // our direct test tab. That privileged URL is not exposed by tabs.query
    // without extra production permissions; observe the isolated test browser.
    const extensionId = new URL(this.page.url()).host;
    const embedded = this.page.context().pages().find(tab => tab.url().startsWith('chrome://extensions/') && new URL(tab.url()).searchParams.get('options') === extensionId);
    if (embedded) return embedded.evaluate(() => document.visibilityState === 'visible');
    return this.page.evaluate(async () => {
      const api = (globalThis as unknown as { chrome: typeof import('wxt/browser').browser }).chrome;
      return (await api.tabs.query({ active: true, currentWindow: true })).some(tab => tab.url === location.href);
    });
  }
  async screenshot(path: string) { if (this.page) await this.page.screenshot({ path, fullPage: true }); }
  async toggle(url: string) {
    if (this.page) return this.page.evaluate(async (url) => {
      const api = (globalThis as unknown as { chrome: typeof import('wxt/browser').browser }).chrome;
      const tab = (await api.tabs.query({})).find((tab) => tab.url?.startsWith(url));
      return api.tabs.sendMessage(tab!.id!, { type: 'page:toggle' });
    }, url);
    return this.control!('toggle', [url]);
  }
  async switchReadingTab(url: string, active: boolean) {
    if (!this.page) return this.control!('reading-tab', [url, active]);
    return this.page.evaluate(async ({ url, active }) => {
      const api = (globalThis as unknown as { chrome: typeof import('wxt/browser').browser }).chrome;
      const tab = (await api.tabs.query({})).find(tab => tab.url?.startsWith(url));
      if (!tab?.id || tab.windowId === undefined) throw new Error('Reading tab unavailable');
      if (active) await api.tabs.update(tab.id, { active: true });
      else await api.tabs.create({ windowId: tab.windowId, url: 'about:blank', active: true });
    }, { url, active });
  }
  async reinject(url: string) {
    if (!this.page) return this.control!('reinject', [url]);
    return this.page.evaluate(async (url) => {
      const api = (globalThis as unknown as { chrome: typeof import('wxt/browser').browser }).chrome;
      const tab = (await api.tabs.query({})).find(tab => tab.url?.startsWith(url));
      await api.scripting.executeScript({ target: { tabId: tab!.id! }, files: ['/content-scripts/content.js'] });
    }, url);
  }
}
