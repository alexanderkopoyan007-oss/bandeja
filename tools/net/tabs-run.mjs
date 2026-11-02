// The two-tab proof: the built game in two pages of one Chrome, a fake link between them.
//   bash tools/one-chrome.sh node tools/net/tabs-run.mjs <dist dir> [secs]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { writeFileSync, mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import puppeteer from 'puppeteer-core';

const dist = process.argv[2], secs = Number(process.argv[3] ?? 60);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm', '.ktx2': 'image/ktx2' };
const server = createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = join(dist, u.pathname.replace(/^\/bandeja\//, '/').replace(/\/$/, '/index.html'));
  try {
    await stat(p);
    res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' });
    res.end(await readFile(p));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(4192, '127.0.0.1', r));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, defaultViewport: { width: 960, height: 540 },
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--autoplay-policy=no-user-gesture-required', '--disable-audio-output',
    '--disable-frame-rate-limit', '--disable-gpu-vsync', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const q = (a, f) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * f))] : 0; };
const fix = (x, n = 2) => Number(x).toFixed(n);
mkdirSync('tools/out/net', { recursive: true });
const all = [];
for (const [ms, delay] of JSON.parse(process.env.LINKS ?? '[[40,3],[80,6],[150,9]]')) {
  const seed = 900 + ms;
  const url = (s) => `http://127.0.0.1:4192/bandeja/?net=${s}&ms=${ms}&delay=${delay}&secs=${secs}&seed=${seed}&replays=0&quality=medium&dpr=1&fpscap=60`;
  // (each in a window of its own: a tab behind another gets no animation frames, and its warm-up never ends)
  const cdp = await browser.target().createCDPSession();
  const pages = [];
  for (let i = 0; i < 2; i++) {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', newWindow: true, width: 960, height: 540 });
    const t = await browser.waitForTarget((x) => x._targetId === targetId || x.targetId?.() === targetId);
    pages.push(await t.page());
  }
  const logs = [[], []];
  pages.forEach((p, i) => { p.on('pageerror', (e) => logs[i].push(`pageerror ${e.message}`)); p.on('console', (m) => { if (m.type() === 'error') logs[i].push(m.text().slice(0, 200)); }); });
  await Promise.all(pages.map((p, i) => p.goto(url(i), { waitUntil: 'domcontentloaded' })));
  const watch = setInterval(async () => { for (const p of pages) if (await p.evaluate('document.visibilityState') !== 'visible') console.error('a page went hidden'); }, 10000);
  if (process.env.SHOT) setTimeout(() => pages.forEach((p, i) => p.screenshot({ path: `tools/out/net/tab${i}.jpg`, type: 'jpeg', quality: 70 }).catch((e) => console.error(e.message))), 30000);
  const r = await Promise.all(pages.map((p) => p.waitForFunction('window.__net', { timeout: (secs + 120) * 1000, polling: 500 }).then(() => p.evaluate('window.__net'))));
  clearInterval(watch);
  const [a, b] = r, B = new Map(b.hashes);
  let agree = 0, differ = 0;
  for (const [t, h] of a.hashes) { if (!B.has(t)) continue; if (B.get(t) === h) agree++; else differ++; }
  console.log(`\n${ms} ms one way, delay ${delay} ticks: hashes agree ${agree}, differ ${differ}; ticks ${a.tick}/${b.tick}`);
  for (const x of r) {
    const f = x.frames.slice(30), s = x.simMs.slice(30);
    console.log(` seat ${x.seat}: frames ${f.length}, p50 ${fix(q(f, .5))} p99 ${fix(q(f, .99))} max ${fix(q(f, 1))} ms, over 20 ms ${fix(f.filter((v) => v > 20).length / f.length * 100, 1)}%; step+rewind p50 ${fix(q(s, .5))} p99 ${fix(q(s, .99))} max ${fix(q(s, 1))} ms`);
    console.log(`   rewinds ${x.rollbacks} (${fix(x.rollbacks / secs, 1)}/s), depth p50 ${q(x.depths, .5)} p95 ${q(x.depths, .95)} max ${q(x.depths, 1)}; replay ms p50 ${fix(q(x.replayMs, .5))} p99 ${fix(q(x.replayMs, .99))} max ${fix(q(x.replayMs, 1))}; packets ${x.sent} sent, ${x.lost} lost; stalled ${x.stalled}, 12-tick frames ${x.hitches}`);
    console.log(`   ball hop p50 ${fix(q(x.hops, .5))} p95 ${fix(q(x.hops, .95))} max ${fix(q(x.hops, 1))} m (${x.hops.filter((v) => v > .25).length} over .25 m, ${x.hops.filter((v) => v > .5).length} over .5 m, ${x.hops.filter((v) => v > 1).length} over 1 m); body hop max ${fix(q(x.bodyHops, 1))} m`);
    console.log(`   events shown ${JSON.stringify(x.shown)}\n   final        ${JSON.stringify(x.truth)}\n   ghost ${JSON.stringify(x.ghost)} missed ${JSON.stringify(x.miss)}; score went back ${x.scoreBack}; rewinds across events ${x.seqBack}; draw calls ${x.calls}; errors ${x.errors.length ? x.errors.slice(0, 3).join(' | ') : 'none'}`);
  }
  for (const l of logs) if (l.length) console.log(` console: ${l.slice(0, 4).join(' | ')}`);
  all.push(r.map(({ frames, simMs, hashes, ...x }) => x));
  await Promise.all(pages.map((p) => p.close()));
}
writeFileSync('tools/out/net/tabs.json', JSON.stringify(all));
await browser.close();
server.close();
