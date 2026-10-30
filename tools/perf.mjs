// Performance run: builds nothing itself; serves dist/ with `vite preview`, plays AI-vs-AI autoplay in Chrome
// and reports frame-time percentiles, the 1% and 0.1% lows, CPU work, sim time and GPU time (timestamp queries).
// Usage: npm run build && node tools/perf.mjs [seconds] [standard|presets|igpu|igpu60|audio|autocap|trace|deopt|tris|load|explore]
//   standard   medium-4x: 1080p, the Medium preset, CPU throttled 4x (stand-in for a mid-range laptop);
//              high: 1080p at 2x pixel ratio, the High preset; both with the frame-rate limit off; and high paced
//              at 120 Hz.
//   presets    every preset (low, medium, high, ultra) at 1080p, CPU 4x, limit off.
//   igpu       the presets and Auto on an integrated-graphics stand-in: CPU 4x, five times the pixels; Low and
//              Medium at pixel ratio 1, High, Ultra and Auto at 1.5 (a 14-15" laptop's usual 125-150%).
//   igpu60     igpu's Medium, High, Ultra and Auto paced at 60 Hz (?fpscap=60), as a 60 Hz laptop screen paces them.
//   audio      medium-4x with the sound on and off, alternating (on, off, on, off), for the audio's cost.
//   autocap    Auto quality paced at a steady 30 and 50 Hz (?fpscap: a browser's cap or a 50 Hz screen): the render
//              scale must stay at or come back to full, since no frame there is slow for that display.
//   trace      standard's two runs with a Chrome trace (GCs, long tasks) and the page's top allocation sites.
//   deopt      V8's deoptimisations through the app as a player meets it: the title's AI match plays first (the
//              warm-up), then counted over later play there and over the player's match after Quick match; by
//              function, reason and source line (the build's source map), no cap. DEOPT_WARM=s (default 30).
//   tris       what the triangles are, by mesh, on each preset.
//   load       cold-cache loads through the menus (title screen, then a match) on throttled networks and CPU.
// Every run prints the machine's load average (other sessions share it).
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { loadavg } from 'node:os';
import { readFileSync, readdirSync } from 'node:fs';
import { SourceMap } from 'node:module';

const load3 = () => loadavg().map((x) => x.toFixed(2)).join(' ');

const secs = Number(process.argv[2] ?? 30);
// GPUTIME=1: GPU timestamp queries (?gputime=1). Off by default: the read-back costs frames of its own, and on
// Apple GPUs (this machine) passes overlap, so the begin-to-end times are no per-frame cost (27 ms "per frame" at
// 140 fps in the first Phase 8 run).
const GPUTIME = process.env.GPUTIME === '1';
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

async function run(name, { dpr, throttle, unlimited, quality = 'high', trace = false, gpuLoad = 1, cap = 0, query = '' }) {
  const loadBefore = load3();
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
  // QUERY=&sound=0 (etc.) adds URL options to every run, to measure one feature's cost against the same build.
  await page.goto(`http://localhost:${PORT}/?autoplay=1&seed=11&dpr=${dpr}&quality=${quality}&gpuload=${gpuLoad}&fpscap=${cap}${GPUTIME ? '&gputime=1' : ''}${query}${process.env.QUERY ?? ''}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__bandeja?.running, { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 3000)); // settle after warm-up
  await page.evaluate(() => window.__bandeja.audio.unlock());
  await page.evaluate(() => { const p = window.__bandeja.probe; p.frames.length = 0; p.sims.length = 0; p.works.length = 0; if (p.gpus) p.gpus.length = 0; });
  // Auto quality: the render scale every half second.
  await page.evaluate(() => { window.__scales = []; setInterval(() => window.__scales.push(window.__bandeja.renderScale), 500); });
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
      audio: window.__bandeja.audio.live, ratio: window.__bandeja.renderer.getPixelRatio(), scales: window.__scales };
  });
  await browser.close();
  const f = d.frames;
  const avg = f.reduce((a, b) => a + b, 0) / f.length;
  const long = f.filter((x) => x > 20).length;
  console.log(`\n[${name}] ${d.backend}, quality ${quality}, pixel ratio ${d.ratio}, ${f.length} frames in ${secs}s   load average ${loadBefore} -> ${load3()}`);
  console.log(`  fps ${(1000 / avg).toFixed(1)}   1% low ${low(f, 0.01).toFixed(1)}   0.1% low ${low(f, 0.001).toFixed(1)}`);
  console.log(`  frame ms p50 ${pct(f, 0.5).toFixed(2)}  p95 ${pct(f, 0.95).toFixed(2)}  p99 ${pct(f, 0.99).toFixed(2)}  max ${Math.max(...f).toFixed(2)}`);
  const miss = f.filter((x) => x > 9.33).length;
  console.log(`  frames > 20 ms: ${long} (${(100 * long / f.length).toFixed(2)}%)   > 9.33 ms (a 120 Hz refresh missed): ${miss} (${(100 * miss / f.length).toFixed(2)}%)`);
  console.log(`  CPU work/frame ms p50 ${pct(d.works, 0.5).toFixed(2)}  p99 ${pct(d.works, 0.99).toFixed(2)}  max ${Math.max(...d.works).toFixed(2)}`);
  console.log(`  sim ms/frame p50 ${pct(d.sims, 0.5).toFixed(3)}  p99 ${pct(d.sims, 0.99).toFixed(3)}  max ${Math.max(...d.sims).toFixed(3)}`);
  if (d.gpus.length) console.log(`  GPU pass time ms p50 ${pct(d.gpus, 0.5).toFixed(2)}  p99 ${pct(d.gpus, 0.99).toFixed(2)}  max ${Math.max(...d.gpus).toFixed(2)}  (${d.gpus.length} samples; begin-to-end of each pass summed: Apple GPUs overlap passes, so not a per-frame cost there)`);
  else if (GPUTIME) console.log('  GPU ms/frame: no timestamp queries on this backend');
  console.log(`  draw calls ${d.draws}  triangles ${d.tris}  audio ${d.audio ? 'on' : 'off'}`);
  if (quality === 'auto' && d.scales.length) {
    const hist = new Map();
    for (const v of d.scales) hist.set(v.toFixed(1), (hist.get(v.toFixed(1)) ?? 0) + 1);
    console.log(`  render scale (share of the run): ${[...hist].sort((a, b) => b[0] - a[0]).map(([k, n]) => `${k} ${(100 * n / d.scales.length).toFixed(0)}%`).join(', ')}; at the end ${d.scales.at(-1).toFixed(1)}`);
  }
  if (errors.length) console.log('  errors:', errors.slice(0, 5));
  return { avg, long, p99: pct(f, 0.99) };
}

/**
 * Which functions V8 deoptimises during play, and why (Chrome with --trace-deopt-verbose). A hot function that
 * keeps deoptimising runs in the interpreter, where every floating-point result is a new heap number: per-frame
 * garbage in code that allocates nothing when optimised. Through the app as a player meets it: the title's AI match
 * plays for `warm` seconds first, then deopts are counted over `secs` more of it, and over `secs` of the player's
 * match after Quick match (the human stands; the partner and the opponents play). Each is placed by the build's
 * source map (dist/assets/*.js.map), so a minified build gives source files and lines.
 */
async function deopt(name, { dpr, throttle, quality, warm }) {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, dumpio: false,
    args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--disable-frame-rate-limit', '--disable-gpu-vsync',
      '--autoplay-policy=no-user-gesture-required', '--js-flags=--trace-deopt-verbose'] });
  // Each bailout line, and the "deoptimize at <url:line:col>, reason" line after it.
  const events = [];
  let pending = null;
  const proc = browser.process();
  let buf = '';
  const grab = (d) => {
    buf += String(d);
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const l = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (l.includes('bailout (kind:')) {
        pending = { t: Date.now(), fn: (l.match(/<JSFunction ([^ >]*)/) ?? [])[1] ?? '?', why: ((l.match(/reason: ([^)]*)\)/) ?? [])[1] ?? '').trim(), at: '' };
        events.push(pending);
      } else if (pending && l.includes(';;; deoptimize at')) {
        pending.at = (l.match(/deoptimize at <([^>]*)>/) ?? [])[1] ?? '';
        pending = null;
      }
    }
  };
  proc.stdout.on('data', grab);
  proc.stderr.on('data', grab);
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: dpr });
  if (throttle > 1) { const cdp = await page.createCDPSession(); await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle }); }
  await page.goto(`http://localhost:${PORT}/?quality=${quality}&dpr=${dpr}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__app?.menu?.isOpen && window.__bandeja?.running, { timeout: 60000 });
  const t0 = Date.now();
  await new Promise((r) => setTimeout(r, warm * 1000));
  const fromA = Date.now();
  await new Promise((r) => setTimeout(r, secs * 1000));
  const toA = Date.now();
  await page.evaluate(() => window.__app.startMatch());
  const fromB = Date.now();
  await new Promise((r) => setTimeout(r, secs * 1000));
  const toB = Date.now();
  await browser.close();
  // Source maps of the built scripts.
  const dir = process.env.OUTDIR ?? 'dist';
  const maps = new Map();
  for (const f of readdirSync(`${dir}/assets`)) if (f.endsWith('.js.map')) maps.set(f.replace(/\.map$/, ''), new SourceMap(JSON.parse(readFileSync(`${dir}/assets/${f}`, 'utf8'))));
  const place = (at) => {
    const m = at.match(/([^/]+\.js):(\d+):(\d+)$/);
    if (!m || !maps.has(m[1])) return at || '?';
    const e = maps.get(m[1]).findEntry(Number(m[2]) - 1, Number(m[3]) - 1);
    return e?.originalSource ? `${e.originalSource.replace(/^.*?(src|node_modules)\//, '$1/')}:${e.originalLine + 1}${e.name ? ` (${e.name})` : ''}` : at;
  };
  const report = (label, from, to) => {
    const rows = new Map();
    let n = 0;
    for (const e of events) {
      if (e.t < from || e.t >= to) continue;
      n++;
      const k = `${place(e.at)} :: ${e.why}`;
      rows.set(k, (rows.get(k) ?? 0) + 1);
    }
    console.log(`  ${label}: ${n} deoptimisations`);
    for (const [k, c] of [...rows].sort((a, b) => b[1] - a[1])) console.log(`    ${String(c).padStart(4)}  ${k.slice(0, 170)}`);
  };
  const before = events.filter((e) => e.t < fromA).length;
  console.log(`\n[deopt: ${name}] through the app; load average ${load3()}`);
  console.log(`  warm-up (load + ${warm} s of the title's match): ${before} deoptimisations`);
  report(`title's match, ${warm}-${warm + secs} s`, fromA, toA);
  report(`the player's match, first ${secs} s after Quick match (its build included)`, fromB, toB);
  void t0;
}

/**
 * Triangles by mesh on a preset (what the Low budget's 300k would have to cut): the scene's visible meshes, each
 * mesh's triangles times its instances, grouped by name (or its parent's, or its geometry's type).
 */
async function tris(quality) {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--disable-frame-rate-limit', '--disable-gpu-vsync'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  await page.goto(`http://localhost:${PORT}/?autoplay=1&seed=11&dpr=1&quality=${quality}&sound=0`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__bandeja?.running, { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 3000));
  const r = await page.evaluate(() => {
    const g = window.__bandeja;
    const groups = new Map();
    let total = 0;
    const visible = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
    g.scene.traverse((o) => {
      if (!o.isMesh || !visible(o) || !o.geometry) return;
      const geo = o.geometry;
      const n = (geo.index ? geo.index.count : geo.attributes.position?.count ?? 0) / 3;
      const inst = o.isInstancedMesh ? o.count : 1;
      const t = n * inst;
      total += t;
      let key = o.name || '';
      for (let p = o.parent; !key && p; p = p.parent) key = p.name || '';
      key = `${key || '(unnamed)'} / ${geo.type}${o.isSkinnedMesh ? ' skinned' : ''}${o.isInstancedMesh ? ` x${inst}` : ''}`;
      const e = groups.get(key) ?? [0, 0];
      e[0] += t; e[1]++;
      groups.set(key, e);
    });
    return { total, drawn: g.probe.triangles, rows: [...groups].sort((a, b) => b[1][0] - a[1][0]).slice(0, 25) };
  });
  await browser.close();
  console.log(`\n[tris: ${quality}] visible meshes ${Math.round(r.total)} triangles (renderer counted ${r.drawn} drawn, shadow pass included)`);
  for (const [k, [t, n]] of r.rows) console.log(`  ${String(Math.round(t)).padStart(8)}  ${n} mesh${n > 1 ? 'es' : ''}  ${k.slice(0, 110)}`);
}

/**
 * A cold load through the menus, the way a player arrives: a fresh profile (nothing cached), the network and the CPU
 * throttled. Times from navigation: first paint, the loading screen gone and the title's menu up (Play can be
 * pressed), then Quick match to the match's first frame.
 */
async function load(name, { down, up, rtt, throttle, noYield = false }) {
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
  // A browser without scheduler.yield (Safari): three's warm-up then waits a frame per object unless the page fills it.
  if (noYield) await page.evaluateOnNewDocument(() => { Object.defineProperty(window, 'scheduler', { value: undefined, writable: true, configurable: true }); });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__app?.menu?.isOpen, { timeout: 120000, polling: 50 });
  // TITLE_WAIT=<ms>: stay on the title that long before Quick match, as a player does (the next cast fetches meanwhile).
  const r = await page.evaluate(async (wait) => {
    const title = performance.now();
    const boot = window.__loadLog.map((e) => `${e.name} ${(e.t / 1000).toFixed(2)}`).join(' | ');
    const paint = performance.getEntriesByType('paint').find((e) => e.name === 'first-contentful-paint')?.startTime ?? -1;
    const bytes = performance.getEntriesByType('resource').reduce((a, e) => a + (e.encodedBodySize || 0), 0)
      + (performance.getEntriesByType('navigation')[0]?.encodedBodySize ?? 0);
    if (wait > 0) await new Promise((res) => setTimeout(res, wait));
    const t = performance.now();
    await window.__app.startMatch();
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const build = window.__loadLog.map((e) => `${e.name} +${((e.t - t) / 1000).toFixed(2)}`).join(' | ');
    return { paint, title, match: performance.now() - t, bytes, boot, build };
  }, Number(process.env.TITLE_WAIT ?? 0));
  await browser.close();
  const s = (ms) => `${(ms / 1000).toFixed(2)} s`;
  console.log(`\n[load: ${name}] ${down} Mbit/s down, ${rtt} ms RTT, CPU ${throttle}x`);
  console.log(`  first paint ${s(r.paint)}   title playable ${s(r.title)}   Quick match to its first frame ${s(r.match)}   total ${s(r.title + r.match)}`);
  console.log(`  downloaded ${(r.bytes / 1e6).toFixed(2)} MB (compressed)`);
  console.log(`  boot stages (s): ${r.boot}`);
  console.log(`  match stages (s after Quick match): ${r.build}`);
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
  } else if (which === 'igpu') {
    // Integrated graphics, as well as this machine can stand in for it: the CPU throttled 4x and five times the
    // pixels (an M1 Max GPU has about five times the fill rate and bandwidth of a mid-range laptop's Iris Xe or
    // Radeon 680M), the frame limit off, a 1080p screen. Low and Medium cap the pixel ratio at 1, so they draw the
    // same at any ratio; High, Ultra and Auto run at 1.5, a 14-15" laptop's usual 125-150% (at 1 High is Medium).
    const verdict = (r) => `  holds 60 Hz: ${r.p99 < 16.7 ? 'yes' : 'NO'}`;
    for (const [q, dpr] of [['low', 1], ['medium', 1], ['high', 1.5], ['ultra', 1.5], ['auto', 1.5]]) {
      console.log(verdict(await run(`igpu-proxy ${q} (dpr ${dpr})`, { dpr, throttle: 4, unlimited: true, quality: q, gpuLoad: 5 })));
    }
  } else if (which === 'igpu60') {
    // The same stand-in paced as a 60 Hz laptop screen paces it (?fpscap=60): unpaced, High and Ultra fill the GPU
    // queue and stall, as the High runs at 2x do (see standard's paced run); paced, a frame is late only when it
    // really cost more than a refresh.
    const verdict = (r) => `  holds 60 Hz: ${r.p99 < 18 && r.long === 0 ? 'yes' : 'NO'}`;
    for (const [q, dpr] of [['medium', 1], ['high', 1.5], ['ultra', 1.5], ['auto', 1.5]]) {
      console.log(verdict(await run(`igpu-proxy ${q} (dpr ${dpr}) at 60 Hz`, { dpr, throttle: 4, unlimited: true, quality: q, gpuLoad: 5, cap: 60 })));
    }
  } else if (which === 'audio') {
    // The audio's cost: the same run with ?sound=0 and with sound, alternating so the machine's load falls on both.
    for (const sound of [true, false, true, false]) {
      await run(`medium-4x, sound ${sound ? 'on' : 'off'}`, { dpr: 1, throttle: 4, unlimited: true, quality: 'medium', query: sound ? '' : '&sound=0' });
    }
  } else if (which === 'autocap') {
    for (const cap of [30, 50]) await run(`auto paced at ${cap} Hz`, { dpr: 1, throttle: 1, unlimited: true, quality: 'auto', cap });
  } else if (which === 'tris') {
    for (const q of ['low', 'medium', 'high']) await tris(q);
  } else if (which === 'deopt') {
    await deopt('medium-4x', { dpr: 1, throttle: 4, quality: 'medium', warm: Number(process.env.DEOPT_WARM ?? 30) });
  } else if (which === 'load') {
    // Typical home broadband, then a slow connection (a phone's 4G hotspot), both on the laptop proxy's CPU.
    await load('broadband', { down: 25, up: 5, rtt: 40, throttle: 4 });
    await load('slow 4G', { down: 9, up: 2, rtt: 150, throttle: 4 });
    await load('broadband, no scheduler.yield (as Safari)', { down: 25, up: 5, rtt: 40, throttle: 4, noYield: true });
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
      // Paced as a 120 Hz display paces it: the unpaced run above fills the GPU queue, and its stalls are that.
      console.log(verdict(await run('high at 120 Hz (2x pixel ratio, paced)', { dpr: 2, throttle: 1, unlimited: true, quality: 'high', cap: 120 })));
    }
  }
} finally {
  server.kill();
}
