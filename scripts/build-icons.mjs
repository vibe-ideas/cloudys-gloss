/** Export the vector brand mark at native browser icon sizes. No runtime cost. */
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const directory = fileURLToPath(new URL('../public/icon/', import.meta.url));
const source = await readFile(`${directory}/source.svg`, 'utf8');
const sizes = [16, 19, 24, 32, 38, 48, 64, 96, 128];
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const size of sizes) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${source}`);
    await page.screenshot({ path: `${directory}/${size}.png`, omitBackground: true });
  }
  const preview = fileURLToPath(new URL('../docs/design/brand/toolbar-icons.png', import.meta.url));
  await mkdir(fileURLToPath(new URL('../docs/design/brand/', import.meta.url)), { recursive: true });
  await page.setViewportSize({ width: 720, height: 280 });
  await page.setContent(`<style>
    *{box-sizing:border-box}body{margin:0;font:14px system-ui}
    section{height:140px;display:flex;align-items:center;gap:34px;padding:28px;background:#f7f7fa;color:#40394d}
    section+section{background:#252229;color:#eeeaf6}figure{margin:0;text-align:center;min-width:42px}
    svg{display:block;margin:0 auto 12px}span{font-size:12px;opacity:.75}
  </style>${['Light', 'Dark'].map(theme => `<section><strong>${theme}</strong>${[16, 24, 32, 48, 64].map(size => `<figure>${source.replace('width="32" height="32"', `width="${size}" height="${size}"`)}<span>${size} px</span></figure>`).join('')}</section>`).join('')}`);
  await page.screenshot({ path: preview });
  console.log(`Exported ${sizes.length} PNG icons and light/dark preview.`);
} finally {
  await browser.close();
}
