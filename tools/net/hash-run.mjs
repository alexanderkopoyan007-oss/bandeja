// Runs hash-core's matches in Node and in real browsers and compares every sample.
//   node tools/net/hash-run.mjs node chrome safari [firefox]
// Chrome goes through puppeteer (run this under tools/one-chrome.sh); Safari, which needs an admin password for
// safaridriver, is opened on a local page and posts its results back. The server lives as long as this run.
import { createServer } from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const OUT = 'tools/out/net';
mkdirSync(OUT, { recursive: true });
const want = process.argv.slice(2);
const TIMEOUT = 40 * 60 * 1000;
const results = {};
if (want.includes('node') || !existsSync(`${OUT}/node.json`)) {
  const { CASES, runCase } = await import('./hash-core.ts');
  const t0 = Date.now();
  const r = CASES.map((c) => runCase(c));
  writeFileSync(`${OUT}/node.json`, JSON.stringify(r));
  console.log(`node: ${r.length} matches, ${r.reduce((p, c) => p + c.ticks, 0)} ticks, ${(Date.now() - t0) / 1000} s`);
}
results.node = JSON.parse(readFileSync(`${OUT}/node.json`, 'utf8'));
const browsers = want.filter((b) => b !== 'node');
execFileSync('npx', ['rolldown', 'tools/net/hash-worker.ts', '--file', `${OUT}/hash.js`, '--format', 'iife', '--platform', 'browser'], { stdio: 'pipe' });
const page = '<!doctype html><meta charset=utf-8><title>hash</title><script>new Worker("hash.js"+location.search)</script>running';
let left = new Set(browsers), finish;
const allDone = new Promise((r) => { finish = r; });
const server = createServer((q, s) => {
  const u = new URL(q.url, 'http://x');
  const b = u.searchParams.get('b');
  if (q.method === 'GET') {
    const js = u.pathname === '/hash.js';
    s.writeHead(js || u.pathname === '/' ? 200 : 404, { 'content-type': js ? 'text/javascript' : 'text/html', 'cache-control': 'no-store' });
    return s.end(js ? readFileSync(`${OUT}/hash.js`) : u.pathname === '/' ? page : '');
  }
  let body = '';
  q.on('data', (d) => { body += d; });
  q.on('end', () => {
    s.writeHead(200, { 'access-control-allow-origin': '*' }); s.end('ok');
    if (u.pathname === '/result') { (results[b] ??= [])[+u.searchParams.get('i')] = JSON.parse(body); console.log(b, 'match', u.searchParams.get('i'), u.searchParams.get('ms'), 'ms'); }
    if (u.pathname === '/fail') { console.log(b, 'FAILED', body.slice(0, 600)); left.delete(b); }
    if (u.pathname === '/done') { console.log(b, 'done:', u.searchParams.get('ua')); writeFileSync(`${OUT}/${b}.json`, JSON.stringify(results[b])); left.delete(b); }
    if (left.size === 0) finish();
  });
}).listen(4191, '127.0.0.1');
let chrome;
for (const b of browsers) {
  const url = `http://127.0.0.1:4191/?b=${b}`;
  if (b === 'chrome') {
    chrome = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
    await (await chrome.newPage()).goto(url);
  } else if (b === 'safari') spawn('open', ['-g', '-a', 'Safari', url]);
  else if (b === 'firefox') spawn('open', ['-g', '-a', 'Firefox', url]);
}
if (browsers.length) await Promise.race([allDone, new Promise((r) => setTimeout(r, TIMEOUT))]);
await chrome?.close();
server.close();
server.closeAllConnections?.();
const ref = results.node;
console.log(`\n${ref.length} matches, ${ref.reduce((p, c) => p + c.samples.length, 0)} samples, ${ref.reduce((p, c) => p + c.hits, 0)} hits, ${ref.reduce((p, c) => p + c.points, 0)} points`);
for (const b of Object.keys(results)) {
  if (b === 'node') continue;
  let same = 0, firstBad = '';
  for (let i = 0; i < ref.length; i++) {
    const A = ref[i], B = results[b][i];
    if (!B) { firstBad ||= `match ${i} missing`; continue; }
    const k = A.samples.findIndex((h, j) => h !== B.samples[j]);
    if (k < 0 && A.samples.length === B.samples.length) same++;
    else firstBad ||= `match ${i} (${A.label}) sample ${k}, tick ${k * 120}`;
  }
  console.log(b, `${same} of ${ref.length} matches identical to Node`, firstBad ? `first difference ${firstBad}` : '');
}
process.exit(0);
