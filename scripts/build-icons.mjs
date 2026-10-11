/** Export the vector brand mark at native browser icon sizes. No runtime cost. */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const directory = fileURLToPath(new URL('../public/icon/', import.meta.url));
const brand = JSON.parse(await readFile(new URL('../data/brand-mark.json', import.meta.url), 'utf8'));
const source = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="${brand.viewBox}">
  <title>${brand.name}</title>
  <rect width="32" height="32" rx="${brand.badge.radius}" fill="${brand.badge.fill}"/>
${brand.parts.map(part => `  <path fill="${part.fill}" d="${part.d}"/>`).join('\n')}
</svg>\n`;
await writeFile(`${directory}/source.svg`, source);
await writeFile(new URL('../site/assets/logo.svg', import.meta.url), source);
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
  await page.setViewportSize({ width: 1120, height: 640 });
  await page.setContent(`<style>
    *{box-sizing:border-box}body{margin:0;background:#f7f5ee;color:#25261f;font:14px -apple-system,BlinkMacSystemFont,sans-serif;padding:44px 56px}
    header{display:flex;justify-content:space-between;border-bottom:1px solid #ddddd2;padding-bottom:20px;font-size:11px;letter-spacing:2px;color:#696b60}
    main{display:flex;gap:48px;align-items:center;padding:44px 0}h1{font-size:64px;letter-spacing:-3px;margin:0 0 14px;font-weight:650}p{font-size:17px;color:#696b60;line-height:1.8;margin:0}
    section{display:flex;gap:20px}article{border:1px solid #ddddd2;border-radius:16px;padding:23px 26px;flex:1;display:flex;align-items:center;gap:20px}article.dark{background:#25261f;color:#f7f5ee;border-color:#25261f}article.dark p{color:#c4c7b5}
    article b{display:block;margin-bottom:6px;font-size:14px}article p{font-size:11px}svg{flex-shrink:0;display:block}footer{display:flex;justify-content:space-between;margin-top:28px;color:#696b60;font-size:11px}i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px}
  </style><header><span>CLOUDY’S GLOSS / IDENTITY 02</span><span>双语阅读 · AI 单词卡</span></header>
  <main>${source.replace('width="32" height="32"', 'width="196" height="196"')}<div><h1>Cloudy’s Gloss</h1><p>一个 G，一处折角。<br>让理解，留在阅读里。</p></div></main>
  <section><article>${source.replace('width="32" height="32"', 'width="48" height="48"')}<div><b>书页折角 × Gloss</b><p>荧光绿字形 · 紫色注解</p></div></article><article class="dark">${source.replace('width="32" height="32"', 'width="48" height="48"')}<div><b>Light & Dark</b><p>同一标记，自然融入。</p></div></article><article>${source.replace('width="32" height="32"', 'width="16" height="16"')}${source.replace('width="32" height="32"', 'width="24" height="24"')}${source}<div><b>16 / 24 / 32</b><p>工具栏原尺寸</p></div></article></section>
  <footer><span><i style="background:#25261f"></i>INK &nbsp;&nbsp; <i style="background:#dfff72"></i>LIME &nbsp;&nbsp; <i style="background:#b6a0ff"></i>FOLD</span><span>SVG · 本地静态资源</span></footer>`);
  await page.screenshot({ path: fileURLToPath(new URL('../docs/design/brand/brand-v2-preview.png', import.meta.url)) });
  console.log(`Exported ${sizes.length} PNG icons, shared SVGs, and light/dark previews.`);
} finally {
  await browser.close();
}
