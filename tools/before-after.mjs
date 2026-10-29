// Before/after captures for SUMMARY.md: the same seed and moment on two builds, the broadcast view and close-ups
// placed from the sim's own positions (so they work on any build).
//   bash tools/one-chrome.sh node tools/before-after.mjs <outdir> <tag>:<builddir> ...
// Each build is made with `npx vite build --outDir <dir>` in a worktree of its commit.
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';

const out = process.argv[2];
const builds = process.argv.slice(3).map((a) => { const [tag, dir] = a.split(':'); return { tag, dir }; });
const SHOTS = [
  { name: 'tv', q: 'seed=4', t: 8 },
  { name: 'tv2', q: 'seed=9', t: 21 },
  { name: 'body', q: 'seed=4', t: 8, view: 'body' },
  { name: 'ball', q: 'seed=4', t: 6, view: 'ball' },
  { name: 'net', q: 'seed=4', t: 8, view: 'net' },
];

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] });
let port = 4291;
for (const b of builds) {
  const p = port++;
  const server = spawn('npx', ['vite', 'preview', '--port', String(p), '--strictPort', '--outDir', b.dir], { stdio: 'pipe' });
  await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('no server')), 20000); server.stdout.on('data', (d) => { if (String(d).includes(String(p))) { clearTimeout(t); res(); } }); });
  for (const s of SHOTS) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => console.log('[pageerror]', b.tag, e.message));
    await page.goto(`http://localhost:${p}/?autoplay=1&backend=webgl&${s.q}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__bandeja?.running, { timeout: 90000 });
    const info = await page.evaluate(async (s) => {
      const g = window.__bandeja;
      g.renderer.setAnimationLoop(null);
      const sim = g.sim;
      const step = () => { g.epoch -= 1000 / 60; g.tick(); };
      while (sim.time < s.t) step();
      if (s.view === 'ball') {
        // A ball in flight at a camera's height, moving.
        for (let i = 0; i < 600; i++) {
          const b = sim.ball.pos, v = sim.ball.vel;
          if (b.y > 0.9 && b.y < 1.8 && Math.hypot(v.x, v.y, v.z) > 6 && Math.abs(b.z) > 2) break;
          step();
        }
      }
      const cam = g.cam.camera;
      const p0 = sim.players[0].pos;
      if (s.view === 'body') {
        const sz = Math.sign(p0.z) || 1;
        cam.position.set(p0.x + 1.3, 1.5, p0.z - sz * 2.4);
        cam.lookAt(p0.x, 1.0, p0.z);
      } else if (s.view === 'ball') {
        const b = sim.ball.pos;
        cam.position.set(b.x + 0.32, b.y + 0.1, b.z + 0.38);
        cam.lookAt(b.x, b.y, b.z);
      } else if (s.view === 'net') {
        const hw = sim.world.court.halfW;
        cam.position.set(hw - 0.5, 1.15, 1.4);
        cam.lookAt(-1.5, 0.7, 0);
      }
      if (s.view) {
        const fov0 = cam.fov;
        cam.fov = s.view === 'ball' ? 30 : 45;
        cam.updateProjectionMatrix();
        if (g.renderOnce) g.renderOnce(); else g.renderer.render(g.scene, cam);
        cam.fov = fov0;
      }
      return `t ${sim.time.toFixed(2)}`;
    }, s);
    await page.screenshot({ path: `${out}/ba-${s.name}-${b.tag}.png` });
    console.log('shot', b.tag, s.name, info);
    await page.close();
  }
  server.kill();
}
await browser.close();
