// Performance run: builds nothing itself; serves dist/ with `vite preview`, plays AI-vs-AI autoplay in Chrome
// and reports frame-time percentiles. Usage: npm run build && node tools/perf.mjs [seconds]
//   medium-4x: 1080p at 1x pixel ratio, CPU throttled 4x (stand-in for a mid-range laptop), vsync on.
//   high-max:  1080p at 2x pixel ratio, frame-rate limit off (how fast it can go on this machine).
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';

const secs = Number(process.argv[2] ?? 30);
const PORT = 4190;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// OUTDIR=<dir> serves another build than dist/ (to measure one commit while dist/ is in use).
const outDir = process.env.OUTDIR ? ['--outDir', process.env.OUTDIR] : [];
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', ...outDir], { stdio: 'pipe' });
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('preview server did not start')), 20000);
  server.stdout.on('data', (d) => { if (String(d).includes(String(PORT))) { clearTimeout(t); resolve(); } });
});

function pct(a, p) {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0;
}

async function run(name, { dpr, throttle, unlimited }) {
  // Audio on (Phase 6): no gesture in a headless run, so let the page start it; its main-thread cost is measured.
  const args = ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--autoplay-policy=no-user-gesture-required'];
  if (unlimited) args.push('--disable-frame-rate-limit', '--disable-gpu-vsync');
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: dpr });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  if (throttle > 1) {
    const cdp = await page.createCDPSession();
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  }
  await page.goto(`http://localhost:${PORT}/?autoplay=1&seed=11&dpr=${dpr}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__bandeja?.running, { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 3000)); // settle after warm-up
  await page.evaluate(() => window.__bandeja.audio.unlock());
  await page.evaluate(() => { const p = window.__bandeja.probe; p.frames.length = 0; p.sims.length = 0; p.works.length = 0; });
  await new Promise((r) => setTimeout(r, secs * 1000));
  const d = await page.evaluate(() => {
    const p = window.__bandeja.probe;
    return { frames: p.frames.slice(1), sims: p.sims.slice(1), works: p.works.slice(1), draws: p.drawCalls, tris: p.triangles, backend: p.backend, audio: window.__bandeja.audio.live };
  });
  await browser.close();
  const f = d.frames;
  const avg = f.reduce((a, b) => a + b, 0) / f.length;
  const long = f.filter((x) => x > 20).length;
  console.log(`\n[${name}] ${d.backend}, ${f.length} frames in ${secs}s`);
  console.log(`  fps ${(1000 / avg).toFixed(1)}   frame ms p50 ${pct(f, 0.5).toFixed(2)}  p95 ${pct(f, 0.95).toFixed(2)}  p99 ${pct(f, 0.99).toFixed(2)}  max ${Math.max(...f).toFixed(2)}`);
  console.log(`  frames > 20 ms: ${long} (${(100 * long / f.length).toFixed(2)}%)`);
  console.log(`  CPU work/frame ms p50 ${pct(d.works, 0.5).toFixed(2)}  p99 ${pct(d.works, 0.99).toFixed(2)}  max ${Math.max(...d.works).toFixed(2)}`);
  console.log(`  sim ms/frame p50 ${pct(d.sims, 0.5).toFixed(3)}  p99 ${pct(d.sims, 0.99).toFixed(3)}  max ${Math.max(...d.sims).toFixed(3)}`);
  console.log(`  draw calls ${d.draws}  triangles ${d.tris}  audio ${d.audio ? 'on' : 'off'}`);
  if (errors.length) console.log('  errors:', errors.slice(0, 5));
  return { avg, long, p99: pct(f, 0.99) };
}

const which = process.argv[3] ?? 'standard';
try {
  if (which === 'explore') {
    await run('medium-vsync', { dpr: 1, throttle: 1, unlimited: false });
    await run('medium-2x', { dpr: 1, throttle: 2, unlimited: false });
    await run('high-vsync', { dpr: 2, throttle: 1, unlimited: false });
    await run('medium-max', { dpr: 1, throttle: 1, unlimited: true });
  } else {
    // Headless Chrome paces vsync'd frames at 30 Hz regardless of load, so measure frame cost with the limit off
    // and judge 60/120 Hz from the 99th percentile.
    const verdict = (r) => `  holds 60 Hz: ${r.p99 < 16.7 ? 'yes' : 'NO'}   holds 120 Hz: ${r.p99 < 8.33 ? 'yes' : 'NO'}`;
    console.log(verdict(await run('medium-4x (laptop proxy)', { dpr: 1, throttle: 4, unlimited: true })));
    console.log(verdict(await run('high (2x pixel ratio)', { dpr: 2, throttle: 1, unlimited: true })));
  }
} finally {
  server.kill();
}
