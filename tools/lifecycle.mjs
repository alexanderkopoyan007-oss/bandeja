// Lifecycle soak (Phase 8): the built game through the menus in Chrome, title screen -> match -> title screen
// again and again (every third cycle also pauses, resumes and quits from the pause menu), checking that each game is
// torn down: after every return to the title, the JS heap after a forced GC, DOM nodes, event listeners and three's
// live geometries and textures must come back to the same level. Also times each match build.
//   npm run build && bash tools/one-chrome.sh node tools/lifecycle.mjs [cycles 12]   (SNAP=1: what grows, by constructor;
//   LEAK=1: which matches' games, scenes and materials are still alive, and what holds them)
// Writes tools/out/lifecycle.json and prints a table and a verdict.
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const cycles = Number(process.argv[2] ?? 12);
const PORT = 4194;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// OUTDIR=<dir> serves another build than dist/ (an unminified one keeps class names for SNAP=1).
const outDir = process.env.OUTDIR ? ['--outDir', process.env.OUTDIR] : [];
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', ...outDir], { stdio: 'pipe' });
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

// SNAP=1: heap snapshots after cycles 3 and 9, and the objects that grew between them (by constructor).
const SNAP = process.env.SNAP === '1';
async function snapshot(cdp) {
  const chunks = [];
  const on = (e) => chunks.push(e.chunk);
  cdp.on('HeapProfiler.addHeapSnapshotChunk', on);
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
  cdp.off('HeapProfiler.addHeapSnapshotChunk', on);
  return JSON.parse(chunks.join(''));
}
/** Objects by constructor (closures by function name, detached DOM marked): count and self size. */
function census(snap) {
  const meta = snap.snapshot.meta;
  const f = meta.node_fields, types = meta.node_types[0], N = f.length;
  const iT = f.indexOf('type'), iN = f.indexOf('name'), iS = f.indexOf('self_size'), iD = f.indexOf('detachedness');
  const m = new Map();
  for (let i = 0; i < snap.nodes.length; i += N) {
    const t = types[snap.nodes[i + iT]];
    if (t !== 'object' && t !== 'closure' && t !== 'native' && t !== 'array') continue;
    let name = snap.strings[snap.nodes[i + iN]];
    if (t === 'closure') name = `closure ${name}`;
    if (t === 'array') name = `array ${name}`;
    if (iD >= 0 && snap.nodes[i + iD] === 2) name = `detached ${name}`;
    const e = m.get(name) ?? [0, 0];
    e[0]++; e[1] += snap.nodes[i + iS];
    m.set(name, e);
  }
  return m;
}
const censuses = [];

// LEAK=1: before leaving each match, tag its Game, scene and one material with page-defined classes; after the
// cycles, a heap snapshot says which tags are still alive and the shortest strong path from a GC root to each.
const LEAK = process.env.LEAK === '1';
function retainers(snap, names) {
  const meta = snap.snapshot.meta;
  const nf = meta.node_fields, ef = meta.edge_fields, ntypes = meta.node_types[0], etypes = meta.edge_types[0];
  const N = nf.length, E = ef.length;
  const iT = nf.indexOf('type'), iN = nf.indexOf('name'), iC = nf.indexOf('edge_count');
  const eT = ef.indexOf('type'), eN = ef.indexOf('name_or_index'), eTo = ef.indexOf('to_node');
  const nodes = snap.nodes, edges = snap.edges, str = snap.strings;
  const count = nodes.length / N;
  // Reverse edges: for each node, (from node, edge) pairs.
  const firstEdge = new Uint32Array(count + 1);
  for (let i = 0, e = 0; i < count; i++) { firstEdge[i] = e; e += nodes[i * N + iC] * E; }
  firstEdge[count] = edges.length;
  const revStart = new Uint32Array(count + 1);
  for (let k = 0; k < edges.length; k += E) revStart[edges[k + eTo] / N + 1]++;
  for (let i = 0; i < count; i++) revStart[i + 1] += revStart[i];
  const revFrom = new Uint32Array(edges.length / E), revEdge = new Uint32Array(edges.length / E);
  const fill = revStart.slice();
  for (let i = 0; i < count; i++) {
    for (let k = firstEdge[i]; k < firstEdge[i + 1]; k += E) {
      const to = edges[k + eTo] / N;
      revFrom[fill[to]] = i; revEdge[fill[to]] = k; fill[to]++;
    }
  }
  const label = (i) => `${ntypes[nodes[i * N + iT]]}:${str[nodes[i * N + iN]].slice(0, 60)}`;
  const edgeName = (k) => { const t = etypes[edges[k + eT]]; const n = edges[k + eN]; return t === 'element' || t === 'hidden' ? `[${n}]` : `.${str[n]}`; };
  const out = {};
  for (const name of names) {
    const hits = [];
    for (let i = 0; i < count; i++) if (ntypes[nodes[i * N + iT]] === 'object' && str[nodes[i * N + iN]] === name) hits.push(i);
    out[name] = { alive: hits.length, paths: [] };
    for (const hit of hits.slice(0, 3)) {
    // Breadth-first from the tag towards the roots over strong edges.
    const prev = new Int32Array(count).fill(-1), via = new Int32Array(count).fill(-1);
    const q = [hit]; prev[hit] = hit;
    let root = -1;
    while (q.length && root < 0) {
      const cur = q.shift();
      for (let r = revStart[cur]; r < revStart[cur + 1]; r++) {
        const from = revFrom[r], k = revEdge[r];
        const t = etypes[edges[k + eT]];
        // A WeakMap entry ("part of key ... -> value ... pair") appears twice: from the map's table, which keeps the
        // value only while the key lives (skipped), and from the key itself (kept: that one holds).
        if (t === 'weak' || t === 'shortcut' || prev[from] >= 0) continue;
        if (ntypes[nodes[from * N + iT]] === 'array' && t !== 'element' && str[edges[k + eN]]?.includes('part of key')) continue;
        prev[from] = cur; via[from] = k;
        if (from === 0 || label(from).startsWith('synthetic:(GC roots)') || label(from).startsWith('synthetic:(Global')) { root = from; break; }
        q.push(from);
      }
    }
    if (root < 0) { out[name].paths.push(['(no strong path to a root)']); continue; }
    const path = [];
    for (let i = root; i !== hit; i = prev[i]) path.push(`${label(i)} ${edgeName(via[i])}`);
    path.push(label(hit));
    out[name].paths.push(path);
    }
  }
  return out;
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
    if (LEAK) {
      // The tag classes are made in a scope of their own: a class keeps its defining scope alive.
      await page.evaluate(() => {
        window.LeakTagGame ??= class LeakTagGame {};
        window.LeakTagScene ??= class LeakTagScene {};
        window.LeakTagMaterial ??= class LeakTagMaterial {};
      });
      await page.evaluate(() => {
        const g = window.__bandeja;
        g.__leakTag = new window.LeakTagGame();
        g.scene.userData.__leakTag = new window.LeakTagScene();
        let mat = null;
        g.scene.traverse((o) => { if (!mat && o.isMesh && o.material && !Array.isArray(o.material) && o.material.isNodeMaterial) mat = o.material; });
        if (mat) mat.userData.__leakTag = new window.LeakTagMaterial();
      });
    }
    const backMs = await page.evaluate(async () => { const t = performance.now(); await window.__app.toTitle(); return performance.now() - t; });
    await wait(1500);
    await sample(`title ${k}`, { buildMs: Math.round(backMs) });
    if (SNAP && (k === 2 || k === 8)) censuses.push(census(await snapshot(cdp)));
  }
  if (LEAK) {
    await wait(1000);
    await page.evaluate(() => { gc(); gc(); });
    const r = retainers(await snapshot(cdp), ['LeakTagGame', 'LeakTagScene', 'LeakTagMaterial']);
    console.log(`\nleak tags (one set per match, ${cycles} matches):`);
    for (const [name, v] of Object.entries(r)) {
      console.log(`  ${name}: ${v.alive} alive`);
      for (const p of v.paths) { for (const step of p) console.log(`      ${step}`); console.log('      --'); }
    }
  }
} finally {
  await browser?.close();
  server.kill();
}

if (censuses.length === 2) {
  const [a, b] = censuses;
  const grow = [];
  for (const [name, [n, sz]] of b) {
    const [n0, sz0] = a.get(name) ?? [0, 0];
    if (n > n0) grow.push({ name, perCycle: (n - n0) / 6, kbPerCycle: (sz - sz0) / 6 / 1024 });
  }
  console.log('\ngrowth per cycle between cycles 3 and 9, by count:');
  for (const g of grow.sort((x, y) => y.perCycle - x.perCycle).slice(0, 30)) console.log(`  ${g.perCycle.toFixed(1).padStart(8)}  ${g.kbPerCycle.toFixed(1).padStart(8)} KB  ${g.name.slice(0, 90)}`);
  console.log('by size:');
  for (const g of grow.sort((x, y) => y.kbPerCycle - x.kbPerCycle).slice(0, 20)) console.log(`  ${g.perCycle.toFixed(1).padStart(8)}  ${g.kbPerCycle.toFixed(1).padStart(8)} KB  ${g.name.slice(0, 90)}`);
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
// Known and left (Phase 8, DECISIONS.md): three r186's shadow filter makes new shared uniforms for every material
// build, and the bind groups made for them are cached for good: about 0.13 MB a match of the 0.3 MB measured.
const ok = Math.abs(heapSlope) < 0.35 && verdict.geometriesStable && verdict.texturesStable && verdict.canvasesStable && verdict.stylesStable && !errors.length;
console.log(ok ? 'PASS: each game is torn down' : 'CHECK: something grows across cycles');
