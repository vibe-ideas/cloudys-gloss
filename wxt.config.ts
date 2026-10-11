import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import nativeKey from './scripts/native-key.json';
import firefoxUpdate from './data/firefox-update.json';
import { generateDictionaryAssets } from './scripts/dictionary-assets';

const firefoxBinary = process.env.FIREFOX_BINARY ?? (existsSync('/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox') ? '/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox' : undefined);

export default defineConfig({
  hooks: {
    'build:publicAssets': async (wxt, files) => {
      for (let i = files.length - 1; i >= 0; i--) {
        if (/^dictionaries\/(us|uk)\.tsv$/.test(files[i]!.relativeDest)) files.splice(i, 1);
      }
      files.push(...await generateDictionaryAssets(wxt.config.root, resolve(wxt.config.root, 'artifacts/dictionary-build')));
      // PDF fonts and character maps are local assets, loaded only by the PDF
      // reader. They must not be bundled into every website's content script.
      const library = resolve(wxt.config.root, 'node_modules/pdfjs-dist');
      for (const directory of ['cmaps', 'standard_fonts']) {
        for (const name of await readdir(resolve(library, directory))) files.push({
          absoluteSrc: resolve(library, directory, name),
          relativeDest: `pdf-resources/${directory}/${name}`,
        });
      }
      files.push({ absoluteSrc: resolve(library, 'LICENSE'), relativeDest: 'pdf-resources/LICENSE' });
      // Keep JPX/JBIG2 image decoding local without requiring WASM execution
      // or broadening the extension's CSP. PDF.js imports these lazily.
      for (const name of ['openjpeg_nowasm_fallback.js', 'jbig2_nowasm_fallback.js', 'LICENSE_OPENJPEG', 'LICENSE_PDFJS_OPENJPEG', 'LICENSE_JBIG2', 'LICENSE_PDFJS_JBIG2']) files.push({
        absoluteSrc: resolve(library, 'wasm', name), relativeDest: `pdf-resources/decoders/${name}`,
      });
    },
    'prepare:publicPaths': (_wxt, paths) => {
      paths.push({ type: 'templateLiteral', path: '/pdf-resources/${string}' });
      paths.push({ type: 'templateLiteral', path: '/dictionaries/${string}' });
    },
  },
  zip: {
    includeSources: ['entrypoints/**', 'src/**', 'public/**', 'scripts/native-key.json', 'scripts/dictionary-assets.ts', 'scripts/build-tech-pronunciation.py', 'scripts/build-icons.mjs', 'data/pronunciation/**', 'data/firefox-update.json', 'wxt.config.ts', 'tsconfig.json', 'package.json', 'pnpm-lock.yaml', 'README.md'],
  },
  vite: () => ({ plugins: [preact()] }),
  webExt: {
    binaries: firefoxBinary ? { firefox: firefoxBinary } : undefined,
    firefoxPref: { 'devtools.chrome.enabled': true },
  },
  manifest: ({ browser }) => ({
    ...(browser === 'firefox' ? {} : { key: nativeKey.key }),
    name: 'Cloudy’s Gloss · 双语阅读',
    description: '本地模型驱动的双语阅读与 AI 单词卡',
    permissions: ['storage', 'nativeMessaging'],
    host_permissions: ['http://*/*', 'https://*/*'],
    browser_specific_settings: { gecko: { id: firefoxUpdate.addonId, ...(browser === 'firefox' ? { update_url: firefoxUpdate.updateUrl } : {}), strict_min_version: '140.0', data_collection_permissions: { required: ['websiteContent'] } } },
  }),
});
