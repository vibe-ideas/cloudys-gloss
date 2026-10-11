import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const folder = dirname(fileURLToPath(import.meta.url));
const server = createServer(async (request, response) => {
  const name = request.url === '/video/film.html' ? 'film.html' : request.url === '/assets/logo.svg' ? '../assets/logo.svg' : undefined;
  if (!name) { response.writeHead(404); response.end(); return; }
  try { response.setHeader('Content-Type', name.endsWith('.svg') ? 'image/svg+xml' : 'text/html; charset=utf-8'); response.end(await readFile(resolve(folder, name))); } catch { response.writeHead(500); response.end(); }
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
await page.goto(`http://127.0.0.1:${server.address().port}/video/film.html`); await page.evaluate(() => window.ready);
const fps = 24, seconds = 30;
const encoder = spawn(process.env.FFMPEG_PATH ?? 'ffmpeg', ['-y','-loglevel','error','-f','image2pipe','-framerate',String(fps),'-i','pipe:0','-c:v','libx264','-preset','fast','-crf','21','-pix_fmt','yuv420p','-movflags','+faststart',resolve(folder,'../assets/demo.mp4')], { stdio: ['pipe','inherit','inherit'] });
const finished = once(encoder,'close');
let encoderError; encoder.stdin.on('error', error => { encoderError = error; });
try {
  for (let frame=0;frame<fps*seconds;frame++) {
    if (encoderError) throw encoderError;
    const data = await page.evaluate(t => { window.renderAt(t); return document.querySelector('canvas').toDataURL('image/png').split(',')[1]; }, frame/fps);
    if (!encoder.stdin.write(Buffer.from(data,'base64'))) await once(encoder.stdin,'drain');
    if (frame % 120 === 0) process.stdout.write(`Rendered ${frame}/${fps*seconds} frames\n`);
  }
  encoder.stdin.end(); const [code] = await finished; if (code !== 0) throw new Error(`ffmpeg exited ${code}`);
  await page.evaluate(() => window.renderAt(7)); await page.screenshot({ path:resolve(folder,'../assets/demo-poster.jpg'),type:'jpeg',quality:88 });
} finally { encoder.stdin.destroy(); if (encoder.exitCode===null) encoder.kill(); await browser.close(); await new Promise(resolve => server.close(resolve)); }
