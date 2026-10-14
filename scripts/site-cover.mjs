/** Render the social preview from the real product page. No production runtime work. */
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';

const files = new Set(['index.html', 'style.css', 'app.js', 'assets/logo.svg', 'assets/demo-poster.jpg', 'assets/demo.vtt']);
const types = { html: 'text/html; charset=utf-8', css: 'text/css', js: 'text/javascript', svg: 'image/svg+xml', jpg: 'image/jpeg', vtt: 'text/vtt' };
const root = new URL('../site/', import.meta.url);
const server = createServer(async (request, response) => {
  const name = new URL(request.url, 'http://localhost').pathname.slice(1) || 'index.html';
  if (!files.has(name)) { response.writeHead(404); response.end(); return; }
  try {
    response.setHeader('Content-Type', types[name.split('.').pop()]);
    response.end(await readFile(new URL(name, root)));
  } catch { response.writeHead(500); response.end(); }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  await page.route('https://api.github.com/**', route => route.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.addStyleTag({ content: '.nav{height:80px}.hero{min-height:550px}.hero-content{padding-top:45px;padding-bottom:60px}.hero h1{font-size:82px}.hero-bottom,.hero-actions{display:none}.hero-description{font-size:17px}.aperture{width:440px;height:440px;top:30px}.light-ray{top:300px}.hero-art{opacity:1}' });
  await page.screenshot({ path: new URL('assets/social-cover.png', root).pathname });
  process.stdout.write('Rendered site/assets/social-cover.png (1200 × 630)\n');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
