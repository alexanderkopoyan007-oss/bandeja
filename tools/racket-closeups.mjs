// Racket close-ups and in-game checks (render/avatar/racket.ts): the hand camera on each player at three moments,
// studio close-ups of the rackets (clones in the arena's light, players hidden, the camera placed in the racket's own
// frame with the near plane at 4 mm: the collar, the heart, the holes, the protector, the frame's side, the butt), the
// level-of-detail switch (both levels side by side at the switching distance), the body camera and the TV view. Serves
// a build itself.
//   bash tools/one-chrome.sh node tools/racket-closeups.mjs <outdir> <builddir> <port> [webgpu,webgl] [hand,studio,lodpop,body,tv]
// PREFIX= names the files (<outdir>/<prefix>-<shot>-<backend>.png), ONLY= a comma list of studio shots; "nohand" in
// the groups skips the hand camera's own shots (the studio shots use its page).
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const [out, dist, port = '4450', backends = 'webgpu,webgl', groups = 'hand,studio,tv'] = process.argv.slice(2);
const PRE = process.env.PREFIX ?? 'closeup';
const G = groups.split(',');
fs.mkdirSync(out, { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--port', port, '--strictPort', '--outDir', dist], { stdio: 'pipe' });
const kill = () => { try { server.kill(); } catch { /* gone */ } };
process.on('exit', kill);
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('no server')), 30000);
  server.stdout.on('data', (d) => { if (String(d).includes(port)) { clearTimeout(t); res(); } });
});
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'],
});
const log = [];
const say = (...a) => { const s = a.join(' '); console.log(s); log.push(s); };

async function open(be, q, w, h) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text().slice(0, 400)}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(`http://localhost:${port}/?autoplay=1&seed=4${q ? '&' + q : ''}${be === 'webgl' ? '&backend=webgl' : ''}`, { waitUntil: 'load' });
  let ran = true;
  try { await page.waitForFunction(() => window.__bandeja?.running, { timeout: 120000 }); } catch { ran = false; }
  await page.evaluate(() => {
    const g = window.__bandeja;
    g.renderer.setAnimationLoop(null);
    for (const el of document.querySelectorAll('body > div')) el.style.display = 'none';
  });
  return { page, errors, ran };
}

const stepTo = (page, t) => page.evaluate((t) => {
  const g = window.__bandeja;
  const step = () => { g.epoch -= 1000 / 60; g.tick(); };
  if (g.sim.time >= t) step();
  while (g.sim.time < t) step();
  // Which level each racket shows, its on-screen height (px), the draw calls in it.
  const cam = g.cam.camera;
  const V = cam.position.constructor;
  const H = g.renderer.domElement.height;
  return {
    t: +g.sim.time.toFixed(2), running: g.running, fov: +cam.fov.toFixed(2),
    rk: g.players.map((pv) => {
      const r = pv.avatar.racket;
      const a = new V(0, 0.145, 0).applyMatrix4(r.matrixWorld).project(cam), b = new V(0, -0.31, 0).applyMatrix4(r.matrixWorld).project(cam);
      const c = r.getWorldPosition(new V()).project(cam);
      let calls = 0, lvl = '-';
      r.traverse((o) => {
        if (!o.isMesh) return;
        let vis = true;
        for (let p = o; p; p = p.parent) if (!p.visible) vis = false;
        if (vis) calls++;
        if (o.name === 'racketNear' && vis) lvl = 'near';
        if (o.name === 'racketFar' && vis) lvl = 'far';
      });
      return { lvl, calls, px: Math.round(Math.hypot((a.x - b.x) * g.renderer.domElement.width / 2, (a.y - b.y) * H / 2)), sx: Math.round((c.x + 1) / 2 * g.renderer.domElement.width), sy: Math.round((1 - c.y) / 2 * H) };
    }),
    info: g.renderer.info?.render ? { calls: g.renderer.info.render.drawCalls ?? g.renderer.info.render.calls, tris: g.renderer.info.render.triangles } : null,
  };
}, t);

// A studio set: clones of the players' rackets in the arena's light (players hidden), a camera placed in the
// racket's frame. `set`: which rackets, how turned; `cam`: eye and aim in the first racket's local frame.
const studio = (page, spec) => page.evaluate((spec) => {
  const g = window.__bandeja;
  const cam = g.cam.camera;
  const V = cam.position.constructor;
  for (const o of g.__rkExtra ?? []) g.scene.remove(o);
  g.__rkExtra = [];
  const base = new V(0, 1.3, 3.2);
  const made = [];
  spec.set.forEach((s, i) => {
    const c = g.players[s.p].avatar.racket.clone();
    for (const ch of [...c.children]) if (ch.name === 'cord') c.remove(ch);
    c.position.set(base.x + (s.dx ?? 0), base.y, base.z);
    c.rotation.set(s.rx ?? 0, s.ry ?? 0, s.rz ?? 0);
    c.updateMatrixWorld(true);
    g.scene.add(c);
    g.__rkExtra.push(c);
    made.push(c);
  });
  for (const pv of g.players) pv.root.visible = false;
  const r = made[spec.ref ?? 0];
  const eye = new V(...spec.eye).applyMatrix4(r.matrixWorld);
  const aim = new V(...spec.aim).applyMatrix4(r.matrixWorld);
  const up = spec.up ? new V(...spec.up).transformDirection(r.matrixWorld) : new V(0, 1, 0);
  cam.position.copy(eye); cam.up.copy(up); cam.lookAt(aim);
  const fov0 = cam.fov, near0 = cam.near;
  cam.fov = spec.fov; cam.near = 0.004; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
  g.renderOnce();
  cam.fov = fov0; cam.near = near0; cam.updateProjectionMatrix(); cam.up.set(0, 1, 0);
  const lv = made.map((c) => { let l = '-'; c.traverse((o) => { if (o.name === 'racketNear' && o.visible) l = 'near'; if (o.name === 'racketFar' && o.visible) l = 'far'; }); return l; });
  return lv;
}, spec);

const unstudio = (page) => page.evaluate(() => {
  const g = window.__bandeja;
  for (const o of g.__rkExtra ?? []) g.scene.remove(o);
  g.__rkExtra = [];
  for (const pv of g.players) pv.root.visible = true;
});

const PI = Math.PI;
// Face normal along world +x (ry = pi/2): the camera on +z sees the racket's edge (its -x side).
const STUDIO0 = [
  { name: 'edge-full', set: [{ p: 0, ry: PI / 2 }], eye: [-0.95, -0.08, 0], aim: [0, -0.08, 0], fov: 30 },
  { name: 'edge-lineup', set: [0, 1, 2, 3].map((p) => ({ p, ry: PI / 2, dx: (p - 1.5) * 0.16 })), ref: 0, eye: [-0.62, -0.08, 0.24], aim: [0, -0.08, 0.24], fov: 46 },
  { name: 'edge-top', set: [{ p: 0, ry: PI / 2 }], eye: [-0.2, 0.1, 0], aim: [0, 0.1, 0], fov: 30 },
  { name: 'tip-down', set: [{ p: 0 }], eye: [0, 0.145 + 0.22, 0.0001], aim: [0, 0.145, 0], up: [0, 0, 1], fov: 30 },
  { name: 'bumper-end', set: [{ p: 0, ry: 0.5 }], eye: [-0.2, 0.15, 0.09], aim: [-0.115, 0.07, 0], fov: 30 },
  { name: 'holes-oblique', set: [{ p: 0 }], eye: [0.06, 0.07, 0.085], aim: [0.01, 0.01, 0], fov: 30 },
  { name: 'holes-oblique-p1', set: [{ p: 1 }], eye: [0.06, 0.07, 0.085], aim: [0.01, 0.01, 0], fov: 30 },
  { name: 'holes-macro', set: [{ p: 0 }], eye: [0.035, 0.035, 0.045], aim: [0.0, 0.0, 0], fov: 30 },
  { name: 'collar-front', set: [{ p: 0 }], eye: [0.0, -0.13, 0.11], aim: [0, -0.168, 0], fov: 30 },
  { name: 'collar-side', set: [{ p: 0 }], eye: [0.11, -0.13, 0.0], aim: [0, -0.168, 0], fov: 30 },
  { name: 'collar-45', set: [{ p: 1 }], eye: [0.08, -0.14, 0.08], aim: [0, -0.168, 0], fov: 30 },
  { name: 'grip-close', set: [{ p: 1 }], eye: [0.0, -0.23, 0.13], aim: [0, -0.235, 0], fov: 30 },
  { name: 'grip-close-p0', set: [{ p: 0 }], eye: [0.02, -0.23, 0.13], aim: [0, -0.235, 0], fov: 30 },
  { name: 'throat-p2', set: [{ p: 2 }], eye: [0.12, -0.07, 0.3], aim: [0, -0.12, 0], fov: 30 },
  { name: 'face-p3', set: [{ p: 3 }], eye: [0.1, 0.0, 0.75], aim: [0, -0.06, 0], fov: 36 },
  { name: 'face-p1', set: [{ p: 1 }], eye: [-0.1, 0.0, 0.75], aim: [0, -0.06, 0], fov: 36 },
  { name: 'face-p2', set: [{ p: 2 }], eye: [0.1, 0.0, 0.75], aim: [0, -0.06, 0], fov: 36 },
  { name: 'back-p0', set: [{ p: 0 }], eye: [0.1, 0.0, -0.75], aim: [0, -0.06, 0], fov: 36 },
  { name: 'profile-close', set: [{ p: 1, ry: PI / 2 }], eye: [-0.36, 0.0, 0], aim: [-0.13, 0.0, 0], fov: 30 },
  { name: 'profile-tip', set: [{ p: 0, ry: PI / 2 }], eye: [-0.2, 0.2, 0], aim: [-0.07, 0.13, 0], fov: 30 },
  { name: 'heart-close', set: [{ p: 0 }], eye: [0.07, -0.08, 0.17], aim: [0, -0.12, 0], fov: 30 },
  { name: 'hole-wall', set: [{ p: 2 }], eye: [0.045, 0.06, 0.06], aim: [0.0, 0.02, 0], fov: 30 },
  { name: 'butt-end', set: [{ p: 0 }], eye: [0.03, -0.31 - 0.13, 0.03], aim: [0, -0.31, 0], up: [0, 0, 1], fov: 30 },
];

const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const STUDIO = STUDIO0.filter((s) => !ONLY || ONLY.includes(s.name));
try {
  for (const be of backends.split(',')) {
    if (G.includes('hand')) {
      const { page, errors, ran } = await open(be, 'cam=hand&camp=0', 1600, 900);
      say(be, 'hand page running', ran);
      for (const t of G.includes('nohand') ? [] : [6, 12.5, 19]) {
        for (let p = 0; p < 4; p++) {
          await page.evaluate((p) => { window.__bandeja.opts.closeCamPlayer = p; }, p);
          const info = await stepTo(page, t);
          const f = `${out}/${PRE}-hand-p${p}-t${t}-${be}.png`;
          await page.screenshot({ path: f });
          say(be, 'hand', p, t, JSON.stringify(info));
        }
      }
      if (G.includes('studio')) {
        for (const s of STUDIO) {
          const lv = await studio(page, s);
          const f = `${out}/${PRE}-${s.name}-${be}.png`;
          await page.screenshot({ path: f });
          say(be, 'studio', s.name, JSON.stringify(lv));
        }
        await unstudio(page);
      }
      say(be, 'hand page errors:', errors.length ? errors.join(' | ') : 'none', 'running', await page.evaluate(() => window.__bandeja.running));
      await page.close();
    }
    if (G.includes('lodpop')) {
      const { page, errors, ran } = await open(be, 'cam=hand&camp=0', 1920, 1080);
      await stepTo(page, 6);
      for (const lvl of [0, 1]) {
        const r = await page.evaluate((lvl) => {
          const g = window.__bandeja;
          const cam = g.cam.camera;
          const V = cam.position.constructor;
          for (const o of g.__rkExtra ?? []) g.scene.remove(o);
          g.__rkExtra = [];
          for (const pv of g.players) pv.root.visible = false;
          // Camera at the near baseline looking down the court; rackets ~10.6 m away (the switch for a 26-degree lens).
          cam.position.set(0, 1.6, 9.5); cam.up.set(0, 1, 0); cam.lookAt(0, 1.2, -1);
          const fov0 = cam.fov; cam.fov = 26; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
          const out = [];
          [0, 1, 2, 3].forEach((p, i) => {
            const c = g.players[p].avatar.racket.clone();
            for (const ch of [...c.children]) if (ch.name === 'cord') c.remove(ch);
            c.position.set((i - 1.5) * 0.5, 1.25, -1.0);
            c.rotation.set(0, 0.35, 0);
            c.traverse((o) => { if (o.isLOD) { o.autoUpdate = false; o.levels[0].object.visible = lvl === 0; o.levels[1].object.visible = lvl === 1; } });
            c.updateMatrixWorld(true);
            g.scene.add(c); g.__rkExtra.push(c);
            const q = c.getWorldPosition(new V()).project(cam);
            out.push([Math.round((q.x + 1) / 2 * 1920), Math.round((1 - q.y) / 2 * 1080)]);
          });
          g.renderOnce();
          cam.fov = fov0; cam.updateProjectionMatrix();
          return out;
        }, lvl);
        await page.screenshot({ path: `${out}/${PRE}-lodpop-${lvl ? 'far' : 'near'}-${be}.png` });
        fs.writeFileSync(`${out}/${PRE}-lodpop-${be}.json`, JSON.stringify(r));
        say(be, 'lodpop', lvl, JSON.stringify(r));
      }
      say(be, 'lodpop errors:', errors.length ? errors.join(' | ') : 'none');
      await page.close();
    }
    if (G.includes('body')) {
      const { page, errors, ran } = await open(be, 'cam=body&camp=0', 1600, 900);
      say(be, 'body page running', ran);
      for (const t of [7, 15]) {
        const info = await stepTo(page, t);
        await page.screenshot({ path: `${out}/${PRE}-body-t${t}-${be}.png` });
        say(be, 'body', t, JSON.stringify(info));
      }
      say(be, 'body page errors:', errors.length ? errors.join(' | ') : 'none');
      await page.close();
    }
    if (G.includes('tv')) {
      const { page, errors, ran } = await open(be, '', 1920, 1080);
      say(be, 'tv page running', ran);
      for (const t of [8, 14, 21]) {
        const info = await stepTo(page, t);
        await page.screenshot({ path: `${out}/${PRE}-tv-t${t}-${be}.png` });
        say(be, 'tv', t, JSON.stringify(info));
        fs.writeFileSync(`${out}/${PRE}-tv-t${t}-${be}.json`, JSON.stringify(info));
      }
      // Six consecutive frames (shimmer), then the same moment with the near level forced (what the LOD hides).
      for (let k = 0; k < 6; k++) {
        const info = await stepTo(page, 0);
        await page.screenshot({ path: `${out}/${PRE}-tvseq${k}-${be}.png` });
        fs.writeFileSync(`${out}/${PRE}-tvseq${k}-${be}.json`, JSON.stringify(info));
      }
      await page.evaluate(() => {
        const g = window.__bandeja;
        for (const pv of g.players) pv.avatar.racket.traverse((o) => { if (o.isLOD) { o.autoUpdate = false; o.levels[0].object.visible = true; o.levels[1].object.visible = false; } });
        g.renderOnce();
      });
      await page.screenshot({ path: `${out}/${PRE}-tvseq5-nearforced-${be}.png` });
      say(be, 'tv page errors:', errors.length ? errors.join(' | ') : 'none', 'running', await page.evaluate(() => window.__bandeja.running));
      await page.close();
    }
  }
} finally {
  fs.writeFileSync(`${out}/${PRE}-log.txt`, log.join('\n') + '\n', { flag: 'a' });
  await browser.close();
  kill();
}
