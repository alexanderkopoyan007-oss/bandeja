// Browser soak (Phase 7): the built game in Chrome, AI-vs-AI autoplay for a long run, sampled every 30 s for
// memory leaks (JS heap after a forced GC, DOM nodes, listeners, three's live geometries and textures), frame drops
// (frame-time percentiles and frames over 20 / 50 ms per window) and errors. Takes the one-Chrome lock itself.
//   npm run build && bash tools/one-chrome.sh node tools/soak.mjs [minutes 20] [query]
// e.g. `node tools/soak.mjs 30 '&doubles=0'`. Writes tools/out/soak.json and prints a table and a verdict.
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const minutes = Number(process.argv[2] ?? 20);
const query = process.argv[3] ?? '';
const PORT = 4192;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SAMPLE_S = 30;

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('preview server did not start')), 20000);
  server.stdout.on('data', (d) => { if (String(d).includes(String(PORT))) { clearTimeout(t); resolve(); } });
});

function pct(a, p) {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0;
}

/** Least-squares slope of y against x. */
function slope(xs, ys) {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den > 0 ? num / den : 0;
}

const samples = [];
const errors = [];
let browser;
try {
  browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--autoplay-policy=no-user-gesture-required', '--js-flags=--expose-gc'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push({ t: Date.now(), msg: e.message }));
  page.on('console', (m) => { if (m.type() === 'error') errors.push({ t: Date.now(), msg: m.text() }); });
  page.on('error', (e) => errors.push({ t: Date.now(), msg: `crash: ${e.message}` }));
  const cdp = await page.createCDPSession();
  await cdp.send('Performance.enable');
  const t0 = Date.now();
  await page.goto(`http://localhost:${PORT}/?autoplay=1&seed=23${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__bandeja?.running, { timeout: 60000 });
  const loadS = (Date.now() - t0) / 1000;
  await page.evaluate(() => window.__bandeja.audio?.unlock());
  const start = Date.now();
  const end = start + minutes * 60000;
  while (Date.now() < end) {
    await page.evaluate(() => { const p = window.__bandeja.probe; p.frames.length = 0; p.sims.length = 0; p.works.length = 0; });
    await new Promise((r) => setTimeout(r, SAMPLE_S * 1000));
    const d = await page.evaluate(() => {
      const g = window.__bandeja;
      const p = g.probe;
      const mem = g.renderer?.info?.memory ?? {};
      return {
        frames: p.frames.slice(1), works: p.works.slice(1),
        geometries: mem.geometries ?? -1, textures: mem.textures ?? -1,
        phase: g.sim?.phase ?? -1, points: g.sim ? g.sim.score.sets.reduce((a, b) => a + b, 0) * 1000 + g.sim.score.games.reduce((a, b) => a + b, 0) : -1,
        tick: g.sim?.tick ?? -1,
      };
    });
    // Heap after a full collection: what is really held.
    await page.evaluate(() => { if (typeof gc === 'function') gc(); });
    const { metrics } = await cdp.send('Performance.getMetrics');
    const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
    const f = d.frames;
    const s = {
      min: (Date.now() - start) / 60000,
      heapMB: m.JSHeapUsedSize / 1e6, nodes: m.Nodes, listeners: m.JSEventListeners,
      geometries: d.geometries, textures: d.textures,
      frames: f.length, p50: pct(f, 0.5), p99: pct(f, 0.99), max: f.length ? Math.max(...f) : 0,
      over20: f.filter((x) => x > 20).length, over50: f.filter((x) => x > 50).length,
      work99: pct(d.works, 0.99), phase: d.phase, tick: d.tick, games: d.points,
    };
    samples.push(s);
    console.log(`${s.min.toFixed(1).padStart(5)} min  heap ${s.heapMB.toFixed(1)} MB  nodes ${s.nodes}  listeners ${s.listeners}  geo ${s.geometries} tex ${s.textures}  frames ${s.frames}  p50 ${s.p50.toFixed(1)} p99 ${s.p99.toFixed(1)} max ${s.max.toFixed(0)} ms  >20 ${s.over20} >50 ${s.over50}  tick ${s.tick}`);
  }
  // Verdict: after the first two windows (warm-up, caches filling), nothing may keep growing.
  const tail = samples.slice(2);
  const xs = tail.map((s) => s.min);
  const heapSlope = slope(xs, tail.map((s) => s.heapMB));
  const nodeSlope = slope(xs, tail.map((s) => s.nodes));
  const geoGrowth = tail.length ? tail[tail.length - 1].geometries - tail[0].geometries : 0;
  const texGrowth = tail.length ? tail[tail.length - 1].textures - tail[0].textures : 0;
  const frames = samples.reduce((a, s) => a + s.frames, 0);
  const over20 = samples.reduce((a, s) => a + s.over20, 0), over50 = samples.reduce((a, s) => a + s.over50, 0);
  const verdict = {
    minutes, query, loadS, frames, over20, over50,
    over20Share: frames ? over20 / frames : 0,
    heapFirstMB: samples[0]?.heapMB, heapLastMB: samples[samples.length - 1]?.heapMB,
    heapSlopeMBperMin: heapSlope, nodeSlopePerMin: nodeSlope, geoGrowth, texGrowth,
    sim: { ticks: samples[samples.length - 1]?.tick },
    errors: errors.length, firstErrors: errors.slice(0, 5).map((e) => e.msg),
    leak: heapSlope > 0.2 || nodeSlope > 5 || geoGrowth > 20 || texGrowth > 5,
  };
  console.log(`\nload to running ${loadS.toFixed(1)} s; ${frames} frames, over 20 ms ${over20} (${(100 * verdict.over20Share).toFixed(2)}%), over 50 ms ${over50}`);
  console.log(`heap ${verdict.heapFirstMB?.toFixed(1)} -> ${verdict.heapLastMB?.toFixed(1)} MB, slope ${heapSlope.toFixed(3)} MB/min after warm-up; nodes ${nodeSlope.toFixed(2)}/min; geometries +${geoGrowth}, textures +${texGrowth}`);
  console.log(`errors ${errors.length}${errors.length ? ': ' + verdict.firstErrors.join(' | ') : ''}`);
  console.log(verdict.leak ? 'VERDICT: something keeps growing' : 'VERDICT: no growth');
  mkdirSync('tools/out', { recursive: true });
  writeFileSync('tools/out/soak.json', JSON.stringify({ verdict, samples, errors }, null, 1));
} finally {
  await browser?.close();
  server.kill();
}
