/** Browser storage prototype, NOT the GoldenDict desktop engine or production extension.
 * First run prepare-goldendict-research.py. Full JSONL vs sorted ranges, 768 KiB text LRU.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { chromium, firefox } from '@playwright/test';

const root = resolve('artifacts/goldendict-research-2026-10-07');
const destination = 'docs/performance/data/2026-10-07-goldendict/browser-storage.json';
const words = Object.values(JSON.parse(await readFile('tests/performance/dictionary-tech-corpus.json', 'utf8'))).flat().map(w => w.toLowerCase());
const server = createServer(async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Dictionary storage research</title>'); return; }
    const path = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (relative(root, path).startsWith('..')) { res.writeHead(403).end(); return; }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(await readFile(path));
  } catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const results = [], hashes = {};
try {
  for (const [browserName, browserType] of Object.entries({ chromium, firefox })) {
    const profile = await mkdtemp(resolve(os.tmpdir(), 'cloudys-goldendict-research-'));
    let browser;
    try {
      browser = await browserType.launch(browserName === 'firefox' ? {
        channel: 'moz-firefox',
        executablePath: process.env.FIREFOX_BINARY ?? (existsSync('/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox')
          ? '/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox' : firefox.executablePath()),
        ignoreDefaultArgs: true, args: ['--remote-debugging-port=0', '-headless', '-profile', profile],
      } : {});
      for (const dataset of ['current-us', 'freedict', 'foldoc']) {
        const source = await readFile(`${root}/${dataset}/full.jsonl`, 'utf8');
        hashes[dataset] = createHash('sha256').update(source).digest('hex');
        const expectedMap = new Map(source.trimEnd().split('\n').map(line => JSON.parse(line)));
        const firstWords = ['latency', 'algorithm', 'json', 'kubernetes', 'inference'];
        for (let round = 0; round < 5; round++) {
          for (const strategy of round % 2 ? ['range', 'full'] : ['full', 'range']) {
            const context = await browser.newContext();
            try {
              const page = await context.newPage();
              await page.goto(`http://127.0.0.1:${server.address().port}`);
              const row = await page.evaluate(async ({ dataset, strategy, words, firstWord }) => {
                // Same algorithm for every dataset: binary search JSONL without a full object index.
                function search(text, word) {
                  let low = 0, high = text.length;
                  while (low < high) {
                    const middle = Math.floor((low + high) / 2);
                    const start = text.lastIndexOf('\n', middle - 1) + 1;
                    const newline = text.indexOf('\n', start);
                    const end = newline === -1 ? text.length : newline;
                    const [key, body] = JSON.parse(text.slice(start, end));
                    if (key === word) return body;
                    if (key < word) low = end + 1; else high = start;
                  }
                  return '';
                }
                const cache = new Map();
                const budget = 768 * 1024;
                let index, requests = 0, readBytes = 0, retained = 0, peakRetained = 0;
                async function read(file) {
                  const response = await fetch(`/${dataset}/${file}`);
                  if (!response.ok) throw new Error(`Missing asset: ${file}`);
                  const text = await response.text();
                  requests++; readBytes += new TextEncoder().encode(text).length;
                  return text;
                }
                async function lookup(word) {
                  let file = 'full.jsonl';
                  if (strategy === 'range') {
                    index ??= JSON.parse(await read('index.json'));
                    let low = 0, high = index.length;
                    while (low < high) {
                      const middle = Math.floor((low + high) / 2);
                      if (index[middle].first <= word) low = middle + 1; else high = middle;
                    }
                    file = index[Math.max(0, low - 1)].file;
                  }
                  let text = cache.get(file);
                  if (text === undefined) {
                    text = await read(file);
                    const bytes = text.length * 2;
                    if (strategy === 'full' || bytes <= budget) {
                      while (strategy === 'range' && retained + bytes > budget && cache.size) {
                        const old = cache.keys().next().value;
                        retained -= cache.get(old).length * 2; cache.delete(old);
                      }
                      retained += bytes; cache.set(file, text);
                    }
                  } else { cache.delete(file); cache.set(file, text); }
                  peakRetained = Math.max(peakRetained, retained);
                  return search(text, word);
                }
                let start = performance.now();
                const firstAnswer = await lookup(firstWord);
                const firstMs = performance.now() - start;
                const firstTextBytes = retained;
                start = performance.now();
                const answers = [];
                for (const word of words) answers.push(await lookup(word));
                const sequenceMs = performance.now() - start;
                // Warm same-word lookup including LRU; do not call this a random-access p95.
                await lookup('algorithm');
                start = performance.now();
                let checksum = 0;
                for (let i = 0; i < 1000; i++) checksum += (await lookup('algorithm')).length;
                const warmSameWordUs = (performance.now() - start) * 1000 / 1000;
                return { firstMs, firstTextBytes, sequenceMs, requests, readBytes, peakRetained,
                  indexJsonUtf16Bytes: index ? JSON.stringify(index).length * 2 : 0,
                  warmSameWordUs, checksum, firstAnswer, answers };
              }, { dataset, strategy, words, firstWord: firstWords[round] });
              assert.equal(row.firstAnswer, expectedMap.get(firstWords[round]) ?? '', '首次查词应返回完整词条或明确未命中');
              assert.deepEqual(row.answers, words.map(w => expectedMap.get(w) ?? ''), '连续查询科技词应保留完整释义，包括长词条和转引');
              assert.ok(row.checksum > 0, '热查询应实际读取词条');
              if (strategy === 'range') assert.ok(row.peakRetained <= 768 * 1024, '连续跨分片查词不应突破文本缓存预算');
              delete row.firstAnswer; delete row.answers;
              results.push({ browser: browserName, version: browser.version(), dataset, strategy, round, ...row });
            } finally { await context.close(); }
          }
        }
        console.log(`${browserName}/${dataset}: 10 rounds; full definitions match source`);
      }
    } finally { await browser?.close(); await rm(profile, { recursive: true, force: true }); }
  }
} finally { await new Promise(done => server.close(done)); }
await writeFile(destination, JSON.stringify({ date: new Date().toISOString(), cpu: os.cpus()[0]?.model,
  method: 'Research JSONL reader, NOT GoldenDict engine or production extension. 5 fresh contexts per layout/dataset/browser, alternating layout order. HTTP loopback no-store; OS file cache uncontrolled. First lookup includes IO and parsing; range includes index. 101 queries fixed order. Warm is mean of 1000 repeated algorithm queries with LRU. Text bytes = UTF16 payload only, not heap/RSS; excludes transient buffers, parsed objects and index (reported separately). Dedicated temporary Firefox profile.',
  hashes, results }, null, 2) + '\n');
console.log(destination);
