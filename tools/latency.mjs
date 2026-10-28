// Input latency: presses and releases a shot key at random moments in a real Chrome (real key events through
// CDP, so event.timeStamp is the browser's) and reads the game's latency probe (Game.latency): key event ->
// handed to the sim -> first frame drawn at or past the event's moment -> GPU done with that frame.
// Usage: npm run build && bash tools/one-chrome.sh node tools/latency.mjs [presses]
// Runs the frame-rate limit off (headless Chrome otherwise paces frames at 30 Hz), so the numbers are the game's
// own share; the display adds about half a refresh waiting for the next frame plus the compositor's frame.
// Both loop modes are measured: run-ahead (default) and ?runahead=0 (one tick behind).
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';

const presses = Number(process.argv[2] ?? 80);
const PORT = 4191;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// OUTDIR=<dir> serves another build than dist/ (e.g. while a perf run is waiting on dist/).
const out = process.env.OUTDIR ? ['--outDir', process.env.OUTDIR] : [];
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', ...out], { stdio: 'pipe' });
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('preview server did not start')), 20000);
  server.stdout.on('data', (d) => { if (String(d).includes(String(PORT))) { clearTimeout(t); resolve(); } });
});

const pct = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? NaN;
};
const line = (name, a) => `${name.padEnd(28)} p50 ${pct(a, 0.5).toFixed(2)}  p95 ${pct(a, 0.95).toFixed(2)}  max ${Math.max(...a).toFixed(2)} ms`;

async function run(label, query) {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--disable-frame-rate-limit', '--disable-gpu-vsync'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://localhost:${PORT}/?seed=11${query}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__bandeja?.running, { timeout: 30000 });
    await new Promise((r) => setTimeout(r, 2500));
    await page.evaluate(() => { window.__bandeja.latency.length = 0; });
    for (let i = 0; i < presses; i++) {
      await new Promise((r) => setTimeout(r, 40 + Math.random() * 90));
      await page.keyboard.down('j');
      await new Promise((r) => setTimeout(r, 30 + Math.random() * 120));
      await page.keyboard.up('j');
    }
    await new Promise((r) => setTimeout(r, 500));
    const d = await page.evaluate(() => ({
      lat: window.__bandeja.latency.map((l) => ({ ...l })),
      frames: window.__bandeja.probe.frames.slice(-600),
      backend: window.__bandeja.probe.backend,
    }));
    const ok = d.lat.filter((l) => l.shown > 0);
    const used = ok.map((l) => l.used - l.ts);
    const shown = ok.map((l) => l.shown - l.ts);
    const gpu = ok.filter((l) => l.gpu > 0).map((l) => l.gpu - l.ts);
    const fr = d.frames.filter((x) => x > 0);
    console.log(`\n[${label}] ${d.backend}, ${ok.length}/${d.lat.length} events, frame p50 ${pct(fr, 0.5).toFixed(2)} ms`);
    console.log('  ' + line('key -> frame that uses it', used));
    console.log('  ' + line('key -> drawn (render submit)', shown));
    if (gpu.length) console.log('  ' + line('key -> GPU done', gpu));
    // Presses and releases apart: a release ends a held swing, which is drawn a tick behind (see Game.tick).
    for (const [name, sel] of [['presses', true], ['releases', false]]) {
      const s = ok.filter((l) => l.press === sel).map((l) => l.shown - l.ts);
      if (s.length) console.log('  ' + line(`  ${name}: key -> drawn`, s));
    }
    if (errors.length) console.log('  errors:', errors.slice(0, 3));
    return { shown: pct(shown, 0.5), gpu: pct(gpu, 0.5) };
  } finally {
    await browser.close();
  }
}

try {
  // LAT_REVERSE=1 measures the tick-behind loop first (to tell a pass's order from its loop mode).
  const rev = process.env.LAT_REVERSE === '1';
  const b0 = rev ? await run('one tick behind (?runahead=0)', '&runahead=0') : null;
  const a = await run('run-ahead (default)', '');
  const b = b0 ?? await run('one tick behind (?runahead=0)', '&runahead=0');
  console.log(`\nrun-ahead saves ${(b.shown - a.shown).toFixed(2)} ms at the median (key -> drawn).`);
  console.log('Add the display: on average half a refresh before the next frame starts, plus one compositor frame '
    + '(60 Hz: ~8 + 17 ms; 120 Hz: ~4 + 8 ms).');
} finally {
  server.kill();
}
