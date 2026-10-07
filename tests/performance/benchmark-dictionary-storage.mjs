/** Research only: real Chromium/Firefox, full TSV versus hash/range shards with four-shard LRU.
 * Run prepare-dictionary-research.py first. Never changes production assets/settings.
 * HTTP loopback measures parsing/querying and asset reads, not extension messaging/UI.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import os from 'node:os';
import ts from 'typescript';
import { chromium, firefox } from '@playwright/test';

const root = resolve('artifacts/dictionary-research-2026-10-07');
const destination = 'docs/performance/data/2026-10-07-dictionaries/browser-storage.json';
const corpus = JSON.parse(await readFile('tests/performance/dictionary-tech-corpus.json', 'utf8'));
const words = Object.values(corpus).flat().map(word => word.toLowerCase());
const productionSource = await readFile('src/pronunciation.ts', 'utf8');
// Use the actual production binary search, not a faster research-only substitute.
const lookupScript = ts.transpileModule(productionSource.replace(/^export /gm, '') + '\nwindow.dictionarySearch = findPronunciation;',
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const server = createServer(async (request, response) => {
  try {
    response.setHeader('Cache-Control', 'no-store');
    if (request.url === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Dictionary research</title>'); return; }
    const file = resolve(root, '.' + new URL(request.url, 'http://localhost').pathname);
    if (relative(root, file).startsWith('..')) { response.writeHead(403).end(); return; }
    const body = await readFile(file);
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.end(body);
  } catch { response.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}`;
const results = [];
try {
  for (const [browserName, browserType] of Object.entries({ chromium, firefox })) {
    const profile = await mkdtemp(resolve(os.tmpdir(), 'cloudys-dictionary-research-'));
    const browser = await browserType.launch(browserName === 'firefox' ? {
      channel: 'moz-firefox',
      executablePath: process.env.FIREFOX_BINARY ?? (existsSync('/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox')
        ? '/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox' : firefox.executablePath()),
      ignoreDefaultArgs: true, args: ['--remote-debugging-port=0', '-headless', '-profile', profile],
    } : {});
    try {
      for (const dataset of ['current-us', 'wikipron-uk', 'ecdict-phonetic']) {
        const expectedMap = new Map((await readFile(`${root}/${dataset}.normalized.tsv`, 'utf8')).trimEnd().split('\n').map(line => {
          const tab = line.indexOf('\t'); return [line.slice(0, tab), line.slice(tab + 1)];
        }));
        const expected = words.map(word => { const value = expectedMap.get(word)?.trim() || ''; return value.length <= 200 ? value : ''; });
        for (let round = 0; round < 5; round++) {
          const strategies = ['full', 'sharded', 'range'];
          for (const strategy of [...strategies.slice(round % 3), ...strategies.slice(0, round % 3)]) {
            const context = await browser.newContext();
            try {
              const page = await context.newPage();
              await page.goto(url);
              await page.addScriptTag({ content: lookupScript });
              const row = await page.evaluate(async ({ dataset, strategy, words, round }) => {
                function bucket(word) {
                  let value = 2166136261;
                  for (let i = 0; i < word.length; i++) value = Math.imul(value ^ word.charCodeAt(i), 16777619) >>> 0;
                  return value % 64;
                }
                const cache = new Map();
                let requests = 0, loadedUtf8Bytes = 0, peakRetainedUtf16Bytes = 0;
                let ranges;
                async function loadRanges() {
                  if (strategy !== 'range' || ranges) return;
                  const response = await fetch(`/${dataset}-ranges/index.json`);
                  if (!response.ok) throw new Error('Range index unavailable');
                  const text = await response.text();
                  ranges = JSON.parse(text); requests++;
                  loadedUtf8Bytes += new TextEncoder().encode(text).length;
                }
                const indexTextBytes = () => ranges?.reduce((sum, word) => sum + word.length * 2, 0) || 0;
                function keyFor(word) {
                  if (strategy === 'full') return 'full';
                  if (strategy === 'sharded') return bucket(word);
                  let low = 0, high = ranges.length;
                  while (low < high) {
                    const mid = Math.floor((low + high) / 2);
                    if (ranges[mid] <= word) low = mid + 1; else high = mid;
                  }
                  return Math.max(0, low - 1);
                }
                const pathFor = (key) => strategy === 'full' ? `${dataset}.normalized.tsv` : `${dataset}-${strategy === 'range' ? 'ranges' : 'shards'}/${key}.tsv`;
                const retained = () => [...cache.values()].reduce((sum, text) => sum + text.length * 2, 0);
                async function lookup(word) {
                  await loadRanges();
                  const key = keyFor(word);
                  let text = cache.get(key);
                  if (text === undefined) {
                    const path = pathFor(key);
                    const response = await fetch('/' + path);
                    if (!response.ok) throw new Error(`Asset failed: ${path}`);
                    text = await response.text(); requests++;
                    loadedUtf8Bytes += new TextEncoder().encode(text).length;
                  } else cache.delete(key);
                  cache.set(key, text);
                  if (strategy !== 'full' && cache.size > 4) cache.delete(cache.keys().next().value);
                  peakRetainedUtf16Bytes = Math.max(peakRetainedUtf16Bytes, retained());
                  return window.dictionarySearch(text, word);
                }
                const firstWord = ['inference', 'quantization', 'kubernetes', 'algorithm', 'latency'][round];
                let start = performance.now();
                await lookup(firstWord);
                const firstLookupMs = performance.now() - start;
                const firstRetainedUtf16Bytes = retained();
                start = performance.now();
                const matches = [];
                for (const word of words) matches.push(await lookup(word));
                const sequenceMs = performance.now() - start;
                // Pure warm search: all 101 terms (hits and misses) against their resident shard.
                const searchTexts = new Map();
                for (const word of words) {
                  const key = keyFor(word);
                  if (!searchTexts.has(key)) searchTexts.set(key, await (await fetch('/' + pathFor(key))).text());
                }
                let checksum = 0;
                start = performance.now();
                for (let repeat = 0; repeat < 100; repeat++) {
                  for (const word of words) checksum += window.dictionarySearch(searchTexts.get(keyFor(word)), word).length;
                }
                const warmSearchMicroseconds = (performance.now() - start) * 1000 / (100 * words.length);
                return { firstLookupMs, firstRetainedUtf16Bytes, sequenceMs, requests, loadedUtf8Bytes,
                  peakRetainedUtf16Bytes, indexTextBytes: indexTextBytes(), warmSearchMicroseconds, checksum, matches };
              }, { dataset, strategy, words, round });
              assert.deepEqual(row.matches, expected, `${browserName}/${dataset}/${strategy}: 所有科技词查询结果应与原始数据一致`);
              assert.ok(row.checksum > 0, '命中词必须实际返回音标');
              delete row.matches;
              results.push({ browser: browserName, version: browser.version(), dataset, strategy, round, ...row });
            } finally { await context.close(); }
          }
        }
        console.log(`${browserName}: ${dataset} — 15 cold runs, all 101 answers match`);
      }
    } finally { await browser.close(); await rm(profile, { recursive: true, force: true }); }
  }
} finally { await new Promise(done => server.close(done)); }
await writeFile(destination, JSON.stringify({ date: new Date().toISOString(), platform: os.platform(), cpu: os.cpus()[0]?.model,
  productionLookupSha256: createHash('sha256').update(productionSource).digest('hex'),
  method: '5 fresh browser contexts per strategy/dataset; rotating strategy order; HTTP loopback no-store, OS file cache uncontrolled. First lookup includes fetch/decode/search (and index read for range). Sequence: 101 distinct terms with bounded 4-shard LRU. Warm CPU phase preloads all relevant shards separately; excludes IO and LRU, 101 terms x 100. UTF-16 byte counts describe cached text payload only, NOT JS heap or process RSS; excludes transient buffers and warm CPU phase; indexTextBytes separate. Firefox uses Developer Edition with isolated disposable profile.',
  results }, null, 2) + '\n');
console.log(destination);
