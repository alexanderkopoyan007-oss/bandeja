// The first load, taken apart (M8 phase C): a cold load of a build to the title's menu on the perf tool's broadband
// (25 Mbit/s, 40 ms) with the CPU throttled 4x, printing the loading screen's stages, every download over 20 KB with
// when it started and ended, and a CPU profile by source file and by function (mapped through the build's source maps).
// What `npm run perf -- 0 load` times, this says where the time goes.
//   OUTDIR=<a build with source maps> bash tools/one-chrome.sh node tools/boot-profile.mjs
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
const OUT = process.env.OUTDIR;
if (!OUT) throw new Error('OUTDIR=<a build> please');
const server = spawn('npx', ['vite', 'preview', '--port', '4191', '--strictPort', '--outDir', OUT], { stdio: 'pipe', cwd: new URL('..', import.meta.url).pathname });
await new Promise((res) => server.stdout.on('data', (d) => { if (String(d).includes('4191')) res(); }));
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--disable-audio-output'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: 25 * 125000, uploadThroughput: 5 * 125000 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
  await cdp.send('Profiler.start');
  await page.goto('http://localhost:4191/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__app?.menu?.isOpen, { timeout: 180000, polling: 100 });
  const { profile } = await cdp.send('Profiler.stop');
  const res = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => ({ n: e.name.replace(/^.*\/assets\//, ''), s: e.startTime, e: e.responseEnd, kb: e.encodedBodySize / 1024 })));
  const log = await page.evaluate(() => window.__loadLog.map((e) => `${e.name} ${(e.t / 1000).toFixed(2)}`).join(' | '));
  console.log('stages:', log);
  console.log('resources (start-end s, KB):');
  for (const r of res.sort((a, b) => a.s - b.s)) if (r.kb > 20) console.log(`  ${(r.s / 1000).toFixed(2)}-${(r.e / 1000).toFixed(2)}  ${r.kb.toFixed(0).padStart(6)}  ${r.n.slice(0, 70)}`);
  // Self time by original function (the source map), from the samples.
  const { SourceMapConsumer } = (await import('source-map-js')).default ?? (await import('source-map-js'));
  const fs = await import('node:fs');
  const maps = new Map();
  const orig = (cf) => {
    const f = cf.url.replace(/^.*\/assets\//, '');
    if (!f.endsWith('.js')) return null;
    if (!maps.has(f)) { try { maps.set(f, new SourceMapConsumer(JSON.parse(fs.readFileSync(`${OUT}/assets/${f}.map`, 'utf8')))); } catch { maps.set(f, null); } }
    const m = maps.get(f);
    if (!m) return null;
    const p = m.originalPositionFor({ line: cf.lineNumber + 1, column: cf.columnNumber });
    return p.source ? `${p.name ?? cf.functionName} ${p.source.replace(/^.*?(src|node_modules)\//, '$1/')}:${p.line}` : null;
  };
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  const dt = profile.timeDeltas;
  for (let i = 0; i < profile.samples.length; i++) {
    const n = byId.get(profile.samples[i]);
    const cf = n.callFrame;
    const k = orig(cf) ?? `${cf.functionName || '(anon)'} ${cf.url.replace(/^.*\/assets\//, '')}:${cf.lineNumber}`;
    self.set(k, (self.get(k) ?? 0) + (dt[i] ?? 0));
  }
  const total = [...self.values()].reduce((a, b) => a + b, 0);
  const byFile = new Map();
  for (const [k, us] of self) { const f = (k.split(' ')[1] ?? '').replace(/:\d+$/, '').replace(/^(node_modules\/three)\/.*$/, '$1'); byFile.set(f, (byFile.get(f) ?? 0) + us); }
  console.log('by file:');
  for (const [f, us] of [...byFile].sort((a, b) => b[1] - a[1]).slice(0, 16)) console.log(`  ${(us / 1e3).toFixed(0).padStart(7)} ms  ${f}`);
  console.log(`CPU profile: ${(total / 1e6).toFixed(1)} s sampled`);
  for (const [k, us] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 45)) console.log(`  ${(us / 1e3).toFixed(0).padStart(7)} ms  ${k.slice(0, 110)}`);
  // Inclusive time: each of our own functions with everything it called (a sample counts once per function on its stack).
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const keyOf = new Map();
  const nameOf = (id) => {
    if (!keyOf.has(id)) { const cf = byId.get(id).callFrame; keyOf.set(id, orig(cf) ?? `${cf.functionName || '(anon)'} ${cf.url.replace(/^.*\/assets\//, '')}:${cf.lineNumber}`); }
    return keyOf.get(id);
  };
  const incl = new Map();
  for (let i = 0; i < profile.samples.length; i++) {
    const seen = new Set();
    for (let id = profile.samples[i]; id !== undefined; id = parent.get(id)) {
      const k = nameOf(id);
      if (!k.includes(' src/') || seen.has(k)) continue;
      seen.add(k);
      incl.set(k, (incl.get(k) ?? 0) + (dt[i] ?? 0));
    }
  }
  console.log('inclusive (our functions, with what they call):');
  for (const [k, us] of [...incl].sort((a, b) => b[1] - a[1]).slice(0, 50)) console.log(`  ${(us / 1e3).toFixed(0).padStart(7)} ms  ${k.slice(0, 110)}`);
} finally { await browser.close(); server.kill(); }
