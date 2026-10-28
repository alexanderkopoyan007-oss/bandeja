// Performance run: builds nothing itself; serves dist/ with `vite preview`, plays AI-vs-AI autoplay in Chrome
// and reports frame-time percentiles, the 1% and 0.1% lows, CPU work, sim time and GPU time (timestamp queries).
// Usage: npm run build && node tools/perf.mjs [seconds] [standard|presets|trace|load|explore]
//   standard   medium-4x: 1080p, the Medium preset, CPU throttled 4x (stand-in for a mid-range laptop);
//              high: 1080p at 2x pixel ratio, the High preset; both with the frame-rate limit off.
//   presets    every preset (low, medium, high, ultra) at 1080p, CPU 4x, limit off.
//   trace      standard's two runs with a Chrome trace (GCs, long tasks) and the page's top allocation sites.
//   load       cold-cache loads through the menus (title screen, then a match) on throttled networks and CPU.
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

/** The p-low: frames per second over the slowest share p of frames (1% low = p 0.01), as benchmarks report it. */
function low(a, p) {
  const s = [...a].sort((x, y) => y - x);
  const k = Math.max(1, Math.round(s.length * p));
  let sum = 0;
  for (let i = 0; i < k; i++) sum += s[i];
  return 1000 / (sum / k);
}

/** Summarise a Chrome trace: garbage collections (count, total and longest) and long main-thread tasks. */
function traceStats(events, secs) {
  const gc = { minor: [], major: [] };
  const tasks = [];
  for (const e of events) {
    if (e.ph !== 'X' || !e.dur) continue;
    const ms = e.dur / 1000;
    if (e.name === 'MinorGC' || e.name === 'V8.GC_SCAVENGER' || e.name === 'Scavenge') gc.minor.push(ms);
    else if (e.name === 'MajorGC' || e.name === 'V8.GC_MARK_COMPACTOR') gc.major.push(ms);
    else if (e.name === 'RunTask' && e.cat?.includes('devtools.timeline')) tasks.push(ms);
  }
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const line = (k) => `${gc[k].length} (${(gc[k].length / secs * 60).toFixed(1)}/min, total ${sum(gc[k]).toFixed(1)} ms, longest ${Math.max(0, ...gc[k]).toFixed(2)} ms)`;
  console.log(`  trace ${secs}s: minor GC ${line('minor')}   major GC ${line('major')}`);
  console.log(`  main-thread tasks > 16 ms: ${tasks.filter((t) => t > 16).length}, > 8 ms: ${tasks.filter((t) => t > 8).length}, longest ${Math.max(0, ...tasks).toFixed(1)} ms`);
}

/** Top allocating functions in the page over a stretch (sampling heap profiler; garbage included). */
function heapTop(profile, secs, n = 14) {
  const self = new Map();
  const walk = (node) => {
    const f = node.callFrame;
    const key = `${f.functionName || '(anon)'} ${f.url.replace(/^.*\/(assets|src)\//, '')}:${f.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + node.selfSize);
    for (const c of node.children) walk(c);
  };
  walk(profile.head);
  const total = [...self.values()].reduce((a, b) => a + b, 0);
  console.log(`  allocated ${(total / 1e6 / secs).toFixed(2)} MB/s; top sites:`);
  for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, n)) console.log(`    ${(v / 1e3 / secs).toFixed(1).padStart(7)} KB/s  ${k}`);
}

async function run(name, { dpr, throttle, unlimited, quality = 'high', trace = false }) {
  // Audio on (Phase 6): no gesture in a headless run, so let the page start it; its main-thread cost is measured.
  // Developer features give the GPU timestamps full precision (Chrome rounds them to 100 µs otherwise).
  const args = ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--autoplay-policy=no-user-gesture-required',
    '--enable-webgpu-developer-features'];
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
  await page.goto(`http://localhost:${PORT}/?autoplay=1&seed=11&dpr=${dpr}&quality=${quality}&gputime=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__bandeja?.running, { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 3000)); // settle after warm-up
  await page.evaluate(() => window.__bandeja.audio.unlock());
  await page.evaluate(() => { const p = window.__bandeja.probe; p.frames.length = 0; p.sims.length = 0; p.works.length = 0; if (p.gpus) p.gpus.length = 0; });
  if (trace) {
    // A trace and a heap sample over the first part of the measured stretch (they cost a little themselves).
    const cdp = await page.createCDPSession();
    const tsecs = Math.min(15, secs);
    const events = [];
    cdp.on('Tracing.dataCollected', (e) => events.push(...e.value));
    const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
    await cdp.send('HeapProfiler.enable');
    await cdp.send('HeapProfiler.startSampling', { samplingInterval: 4096, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    await cdp.send('Tracing.start', { categories: 'devtools.timeline,v8,disabled-by-default-v8.gc', transferMode: 'ReportEvents' });
    await new Promise((r) => setTimeout(r, tsecs * 1000));
    await cdp.send('Tracing.end');
    await done;
    const { profile } = await cdp.send('HeapProfiler.stopSampling');
    traceStats(events, tsecs);
    heapTop(profile, tsecs);
    await new Promise((r) => setTimeout(r, Math.max(0, secs - tsecs) * 1000));
  } else await new Promise((r) => setTimeout(r, secs * 1000));
  const d = await page.evaluate(() => {
    const p = window.__bandeja.probe;
    return { frames: p.frames.slice(1), sims: p.sims.slice(1), works: p.works.slice(1), gpus: p.gpus ? p.gpus.slice(1) : [], draws: p.drawCalls, tris: p.triangles, backend: p.backend,
      audio: window.__bandeja.audio.live, ratio: window.__bandeja.renderer.getPixelRatio() };
  });
  await browser.close();
  const f = d.frames;
  const avg = f.reduce((a, b) => a + b, 0) / f.length;
  const long = f.filter((x) => x > 20).length;
  console.log(`\n[${name}] ${d.backend}, quality ${quality}, pixel ratio ${d.ratio}, ${f.length} frames in ${secs}s`);
  console.log(`  fps ${(1000 / avg).toFixed(1)}   1% low ${low(f, 0.01).toFixed(1)}   0.1% low ${low(f, 0.001).toFixed(1)}`);
  console.log(`  frame ms p50 ${pct(f, 0.5).toFixed(2)}  p95 ${pct(f, 0.95).toFixed(2)}  p99 ${pct(f, 0.99).toFixed(2)}  max ${Math.max(...f).toFixed(2)}`);
  console.log(`  frames > 20 ms: ${long} (${(100 * long / f.length).toFixed(2)}%)`);
  console.log(`  CPU work/frame ms p50 ${pct(d.works, 0.5).toFixed(2)}  p99 ${pct(d.works, 0.99).toFixed(2)}  max ${Math.max(...d.works).toFixed(2)}`);
  console.log(`  sim ms/frame p50 ${pct(d.sims, 0.5).toFixed(3)}  p99 ${pct(d.sims, 0.99).toFixed(3)}  max ${Math.max(...d.sims).toFixed(3)}`);
  if (d.gpus.length) console.log(`  GPU ms/frame p50 ${pct(d.gpus, 0.5).toFixed(2)}  p99 ${pct(d.gpus, 0.99).toFixed(2)}  max ${Math.max(...d.gpus).toFixed(2)}  (${d.gpus.length} samples)`);
  else console.log('  GPU ms/frame: no timestamp queries on this backend');
  console.log(`  draw calls ${d.draws}  triangles ${d.tris}  audio ${d.audio ? 'on' : 'off'}`);
  if (errors.length) console.log('  errors:', errors.slice(0, 5));
  return { avg, long, p99: pct(f, 0.99) };
}

/**
 * A cold load through the menus, the way a player arrives: a fresh profile (nothing cached), the network and the CPU
 * throttled. Times from navigation: first paint, the loading screen gone and the title's menu up (Play can be
 * pressed), then Quick match to the match's first frame.
 */
async function load(name, { down, up, rtt, throttle }) {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
    args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: rtt, downloadThroughput: down * 125000, uploadThroughput: up * 125000 });
  if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__app?.menu?.isOpen, { timeout: 120000, polling: 50 });
  const r = await page.evaluate(async () => {
    const title = performance.now();
    const paint = performance.getEntriesByType('paint').find((e) => e.name === 'first-contentful-paint')?.startTime ?? -1;
    const bytes = performance.getEntriesByType('resource').reduce((a, e) => a + (e.encodedBodySize || 0), 0)
      + (performance.getEntriesByType('navigation')[0]?.encodedBodySize ?? 0);
    const t = performance.now();
    await window.__app.startMatch();
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    return { paint, title, match: performance.now() - t, bytes };
  });
  await browser.close();
  const s = (ms) => `${(ms / 1000).toFixed(2)} s`;
  console.log(`\n[load: ${name}] ${down} Mbit/s down, ${rtt} ms RTT, CPU ${throttle}x`);
  console.log(`  first paint ${s(r.paint)}   title playable ${s(r.title)}   Quick match to its first frame ${s(r.match)}   total ${s(r.title + r.match)}`);
  console.log(`  downloaded ${(r.bytes / 1e6).toFixed(2)} MB (compressed)`);
  if (errors.length) console.log('  errors:', errors.slice(0, 5));
  return r;
}

const which = process.argv[3] ?? 'standard';
try {
  if (which === 'explore') {
    await run('medium-vsync', { dpr: 1, throttle: 1, unlimited: false });
    await run('medium-2x', { dpr: 1, throttle: 2, unlimited: false });
    await run('high-vsync', { dpr: 2, throttle: 1, unlimited: false });
    await run('medium-max', { dpr: 1, throttle: 1, unlimited: true });
  } else if (which === 'trace') {
    await run('medium-4x traced', { dpr: 1, throttle: 4, unlimited: true, quality: 'medium', trace: true });
    await run('high traced', { dpr: 2, throttle: 1, unlimited: true, quality: 'high', trace: true });
  } else if (which === 'load') {
    // Typical home broadband, then a slow connection (a phone's 4G hotspot), both on the laptop proxy's CPU.
    await load('broadband', { down: 25, up: 5, rtt: 40, throttle: 4 });
    await load('slow 4G', { down: 9, up: 2, rtt: 150, throttle: 4 });
  } else {
    // Headless Chrome paces vsync'd frames at 30 Hz regardless of load, so measure frame cost with the limit off
    // and judge 60/120 Hz from the 99th percentile.
    const verdict = (r) => `  holds 60 Hz: ${r.p99 < 16.7 ? 'yes' : 'NO'}   holds 120 Hz: ${r.p99 < 8.33 ? 'yes' : 'NO'}`;
    if (which === 'presets') {
      for (const q of ['low', 'medium', 'high', 'ultra']) {
        console.log(verdict(await run(`${q}-4x`, { dpr: q === 'high' || q === 'ultra' ? 2 : 1, throttle: 4, unlimited: true, quality: q })));
      }
    } else {
      console.log(verdict(await run('medium-4x (laptop proxy)', { dpr: 1, throttle: 4, unlimited: true, quality: 'medium' })));
      console.log(verdict(await run('high (2x pixel ratio)', { dpr: 2, throttle: 1, unlimited: true, quality: 'high' })));
    }
  }
} finally {
  server.kill();
}
