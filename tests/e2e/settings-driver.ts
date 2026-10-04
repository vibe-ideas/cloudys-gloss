import type { Page } from '@playwright/test';
type Control = <T>(operation: string, args?: unknown[]) => Promise<T>;
export class SettingsDriver {
  constructor(private page?: Page, private control?: Control) {}
  async fill(name: string, value: string) {
    if (this.page) await this.page.locator(`[name="${name}"]`).fill(value);
    else await this.control!('fill', [name, value]);
  }
  async click(name: string) {
    if (this.page) await this.page.getByRole('button', { name, exact: true }).click();
    else await this.control!('click', [name]);
  }
  async status(): Promise<string> { return this.page ? (await this.page.getByRole('status').textContent()) ?? '' : this.control!('status'); }
  async ready(): Promise<boolean> { return this.page ? await this.page.getByRole('button', { name: '保存设置', exact: true }).isEnabled() : this.control!('ready'); }
  async screenshot(path: string) { if (this.page) await this.page.screenshot({ path, fullPage: true }); }
  async toggle(url: string) {
    if (this.page) return this.page.evaluate(async (url) => {
      const api = (globalThis as unknown as { chrome: typeof import('wxt/browser').browser }).chrome;
      const tab = (await api.tabs.query({})).find((tab) => tab.url?.startsWith(url));
      return api.tabs.sendMessage(tab!.id!, { type: 'page:toggle' });
    }, url);
    return this.control!('toggle', [url]);
  }
}
