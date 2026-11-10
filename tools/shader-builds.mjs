// The shaders the title's first load builds (M8 phase C): every node-builder cache miss (one TSL build: the costly
// part of a warm-up), with its material, object, time, whether it came inside the warm-up's compileAsync or after it
// (on a first frame, synchronously), and the target it was built for; misses grouped by the shaders they produced, so a
// material built twice under two cache keys shows as one group of two. Also the scene's materials by type and the
// renderer's program and pipeline counts. Nothing should be built after the warm-up but the shadow and post passes.
//   OUTDIR=<a build> bash tools/one-chrome.sh node tools/shader-builds.mjs
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
const OUT = process.env.OUTDIR;
if (!OUT) throw new Error('OUTDIR=<a build> please');
const server = spawn('npx', ['vite', 'preview', '--port', '4192', '--strictPort', '--outDir', OUT], { stdio: 'pipe', cwd: new URL('..', import.meta.url).pathname });
await new Promise((res) => server.stdout.on('data', (d) => { if (String(d).includes('4192')) res(); }));
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--disable-audio-output'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  await page.evaluateOnNewDocument(() => {
    window.__misses = [];
    let g0;
    Object.defineProperty(window, '__bandeja', { configurable: true, get: () => g0, set: (g) => {
      g0 = g;
      const nodes = g.renderer._nodes;
      if (!nodes || nodes.__patched) return;
      nodes.__patched = true;
      const R = g.renderer;
      window.__phase = 'pre';
      const oc = R.compileAsync.bind(R);
      R.compileAsync = async (...a) => { window.__phase = 'compileAsync'; try { return await oc(...a); } finally { window.__phase = 'after'; } };
      const orig = nodes.getForRender.bind(nodes);
      nodes.getForRender = (ro, a) => {
        const had = nodes.get(ro).nodeBuilderState !== undefined;
        const key = had ? null : nodes.getForRenderCacheKey(ro);
        const miss = key !== null && !nodes.nodeBuilderCache.has(key);
        const t0 = performance.now();
        const r = orig(ro, a);
        if (miss) {
          let path = [];
          for (let o = ro.object; o && path.length < 4; o = o.parent) path.push(o.name || o.type);
          window.__misses.push({ key, ms: performance.now() - t0, obj: path.join('<'), mat: ro.material.type + (ro.material.name ? ':' + ro.material.name : ''), phase: window.__phase, rt: R.getRenderTarget() ? (R.getRenderTarget().texture?.type + '/' + (R.getRenderTarget().samples ?? 0)) : 'canvas', ctx: ro.context?.id ?? '', pass: ro.material.isShadowPassMaterial || ro.context?.isShadow ? 'shadow' : '', skinned: !!ro.object.isSkinnedMesh });
        }
        return r;
      };
    } });
  });
  await page.goto('http://localhost:4192/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__app?.menu?.isOpen, { timeout: 180000, polling: 100 });
  const r = await page.evaluate(() => {
    const g = window.__bandeja, R = g.renderer;
    const mats = new Map(), objs = { meshes: 0, visible: 0 };
    const seen = new Set();
    g.scene.traverse((o) => {
      if (!o.material) return;
      objs.meshes++;
      for (const m of [].concat(o.material)) {
        if (seen.has(m)) continue;
        seen.add(m);
        const k = m.type + (m.name ? ':' + m.name : '');
        mats.set(k, (mats.get(k) ?? 0) + 1);
      }
    });
    const nodes = R._nodes, pipes = R._pipelines;
    return {
      objs, materials: seen.size,
      byType: [...mats].sort((a, b) => b[1] - a[1]).slice(0, 40),
      nodeBuilderCache: nodes?.nodeBuilderCache?.size,
      programs: pipes ? { vertex: pipes.programs?.vertex?.size, fragment: pipes.programs?.fragment?.size, compute: pipes.programs?.compute?.size, caches: pipes.caches?.size } : null,
      states: (() => {
        const out = new Map();
        for (const [k, st] of nodes.nodeBuilderCache) {
          const sig = (st.vertexShader ?? '').length + '/' + (st.fragmentShader ?? '').length;
          const h = (str) => { let x = 0; for (let i = 0; i < str.length; i++) x = (x * 31 + str.charCodeAt(i)) | 0; return x; };
          const key = h(st.vertexShader ?? '') + ':' + h(st.fragmentShader ?? '');
          const e = out.get(key) ?? { n: 0, used: 0, sig, frag: (st.fragmentShader ?? '').slice(0, 0) };
          e.n++; e.used += st.usedTimes; out.set(key, e);
        }
        const arr = [...out.values()];
        return { distinct: arr.length, dupes: arr.filter((e) => e.n > 1).map((e) => `${e.n}x ${e.sig}`).join(', ') };
      })(),
      misses: (() => {
        const h = (str) => { let x = 0; for (let i = 0; i < str.length; i++) x = (x * 31 + str.charCodeAt(i)) | 0; return x; };
        const by = new Map();
        for (const m of window.__misses) {
          const st = nodes.nodeBuilderCache.get(m.key);
          const sh = st ? h(st.vertexShader ?? '') + ':' + h(st.fragmentShader ?? '') : 'gone';
          const l = by.get(sh) ?? [];
          l.push(`${m.ms.toFixed(0)}ms [${m.phase} ${m.rt}] ${m.mat} ${m.obj}${m.skinned ? ' skinned' : ''}`);
          by.set(sh, l);
        }
        const total = window.__misses.reduce((a, m) => a + m.ms, 0);
        return { count: window.__misses.length, totalMs: Math.round(total), groups: [...by.values()].sort((a, b) => b.length - a.length).map((l) => l.length + ': ' + l.slice(0, 8).join(' | ')) };
      })(),
      log: window.__loadLog.map((e) => `${e.name} ${(e.t / 1000).toFixed(2)}`).join(' | '),
    };
  });
  console.log(`stages: ${r.log}`);
  console.log(`${r.objs.meshes} meshes, ${r.materials} materials (${r.byType.map(([k, n]) => `${n} ${k}`).join(', ')})`);
  console.log(`node builder states ${r.nodeBuilderCache}, programs: ${r.programs?.vertex} vertex, ${r.programs?.fragment} fragment; pipelines ${r.programs?.caches}`);
  console.log(`${r.misses.count} builds, ${r.misses.totalMs} ms (grouped by the shaders they made; [when target]):`);
  for (const g of r.misses.groups) console.log('  ' + g.slice(0, 300));
} finally { await browser.close(); server.kill(); }
