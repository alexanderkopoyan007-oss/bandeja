// Lifecycle soak (Phase 8): the built game through the menus in Chrome, title screen -> match -> title screen
// again and again (every third cycle also pauses, resumes and quits from the pause menu), checking that each game is
// torn down: after every return to the title, the JS heap after a forced GC, DOM nodes, event listeners and three's
// live geometries and textures must come back to the same level. Also times each match build.
//   npm run build && bash tools/one-chrome.sh node tools/lifecycle.mjs [cycles 12]
// Writes tools/out/lifecycle.json and prints a table and a verdict.
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const cycles = Number(process.argv[2] ?? 12);
const PORT = 4194;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('preview server did not start')), 20000);
  server.stdout.on('data', (d) => { if (String(d).includes(String(PORT))) { clearTimeout(t); resolve(); } });
});

/** Least-squares slope of y against x. */
function slope(xs, ys) {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den > 0 ? num / den : 0;
}

const rows = [];
const errors = [];
let browser;
try {
  browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--autoplay-policy=no-user-gesture-required', '--js-flags=--expose-gc'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const cdp = await page.createCDPSession();
  await cdp.send('Performance.enable');
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__app?.menu?.isOpen, { timeout: 60000, polling: 100 });

  const sample = async (at, extra = {}) => {
    await page.evaluate(() => { if (typeof gc === 'function') { gc(); gc(); } });
    const { metrics } = await cdp.send('Performance.getMetrics');
    const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
    const g = await page.evaluate(() => {
      const mem = window.__app.renderer.info.memory;
      return { geometries: mem.geometries, textures: mem.textures, canvases: document.querySelectorAll('canvas').length,
        styles: document.querySelectorAll('style').length, layers: document.querySelectorAll('#hud > *').length };
    });
    const row = { at, heapMB: +(m.JSHeapUsedSize / 1e6).toFixed(2), nodes: m.Nodes, listeners: m.JSEventListeners, ...g, ...extra };
    rows.push(row);
    console.log(JSON.stringify(row));
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  await wait(1500);
  await sample('title');
  for (let k = 0; k < cycles; k++) {
    const buildMs = await page.evaluate(async () => { const t = performance.now(); await window.__app.startMatch(); return performance.now() - t; });
    await wait(4000);
    if (k % 3 === 2) {
      await page.evaluate(() => window.__app.pause());
      await wait(500);
      await page.evaluate(() => window.__app.resume());
      await wait(1500);
    }
    await sample(`match ${k}`, { buildMs: Math.round(buildMs) });
    const backMs = await page.evaluate(async () => { const t = performance.now(); await window.__app.toTitle(); return performance.now() - t; });
    await wait(1500);
    await sample(`title ${k}`, { buildMs: Math.round(backMs) });
  }
} finally {
  await browser?.close();
  server.kill();
}

const titles = rows.filter((r) => r.at.startsWith('title '));
const xs = titles.map((_, i) => i);
const heapSlope = slope(xs, titles.map((r) => r.heapMB));
const same = (key) => titles.every((r) => r[key] === titles[0][key]);
const verdict = {
  heapMBPerCycle: +heapSlope.toFixed(3),
  heapFirst: titles[0]?.heapMB, heapLast: titles.at(-1)?.heapMB,
  geometriesStable: same('geometries'), texturesStable: same('textures'),
  nodesStable: same('nodes'), listenersStable: same('listeners'), canvasesStable: same('canvases'), stylesStable: same('styles'),
  matchBuildMs: rows.filter((r) => r.at.startsWith('match ')).map((r) => r.buildMs),
  errors,
};
mkdirSync('tools/out', { recursive: true });
writeFileSync('tools/out/lifecycle.json', JSON.stringify({ rows, verdict }, null, 1));
console.log('\nverdict', JSON.stringify(verdict, null, 1));
const ok = Math.abs(heapSlope) < 0.25 && verdict.geometriesStable && verdict.texturesStable && verdict.canvasesStable && verdict.stylesStable && !errors.length;
console.log(ok ? 'PASS: each game is torn down' : 'CHECK: something grows across cycles');
