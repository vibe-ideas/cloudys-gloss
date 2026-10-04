import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';
import { existsSync } from 'node:fs';

const firefoxBinary = process.env.FIREFOX_BINARY ?? (existsSync('/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox') ? '/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox' : undefined);

export default defineConfig({
  zip: {
    includeSources: ['entrypoints/**', 'src/**', 'public/**', 'wxt.config.ts', 'tsconfig.json', 'package.json', 'pnpm-lock.yaml', 'README.md'],
  },
  vite: () => ({ plugins: [preact()] }),
  webExt: {
    binaries: firefoxBinary ? { firefox: firefoxBinary } : undefined,
    firefoxPref: { 'devtools.chrome.enabled': true },
  },
  manifest: {
    name: 'Cloudy’s Gloss · 双语阅读',
    description: '本地模型驱动的双语阅读与 AI 单词卡',
    permissions: ['storage'],
    host_permissions: ['http://*/*', 'https://*/*'],
    browser_specific_settings: { gecko: { id: 'cloudys-gloss@local.dev', strict_min_version: '140.0', data_collection_permissions: { required: ['websiteContent'] } } },
  },
});
