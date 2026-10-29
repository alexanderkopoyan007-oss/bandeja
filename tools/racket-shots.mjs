// Racket captures (render/avatar/racket.ts): the review cameras (a player's racket hand, a whole player, the TV
// view) and studio close-ups placed from the racket's own frame (face on, the edge and bumper, the throat and grip,
// the four rackets side by side), on one or both backends. Serves a build itself.
//   bash tools/one-chrome.sh node tools/racket-shots.mjs <outdir> <prefix> <builddir> <port> [webgpu,webgl]
// Writes <outdir>/<prefix>-<shot>[-<backend>].png and prints each page's console errors and whether it ran.
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';

const [out, prefix, dir, port = '4471', backends = 'webgpu,webgl'] = process.argv.slice(2);
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const SEED = process.env.SEED ?? '4';
/** Whose racket the studio shots show (player number). */
const RP = +(process.env.RP ?? 0);
const T = +(process.env.AT ?? 8); // (not T: one-chrome.sh uses T for its queue ticket)
const SHOTS = [
  { name: 'hand-p0', q: 'cam=hand&camp=0' },
  { name: 'hand-p1', q: 'cam=hand&camp=1' },
  { name: 'hand-p2', q: 'cam=hand&camp=2' },
  { name: 'hand-p3', q: 'cam=hand&camp=3' },
  { name: 'body', q: 'cam=body&camp=0' },
  { name: 'tv', q: '' },
  { name: 'face', q: 'cam=hand&camp=0', studio: 'face' },
  { name: 'edge', q: 'cam=hand&camp=0', studio: 'edge' },
  { name: 'throat', q: 'cam=hand&camp=0', studio: 'throat' },
  { name: 'holes', q: 'cam=hand&camp=0', studio: 'holes' },
  { name: 'lineup', q: 'cam=hand&camp=0', studio: 'lineup' },
  { name: 'lineup-back', q: 'cam=hand&camp=0', studio: 'lineup-back' },
  { name: 'tv-zoom', q: '', studio: 'tvzoom' },
  { name: 'grip', q: 'cam=hand&camp=0', studio: 'grip' },
  { name: 'butt', q: 'cam=hand&camp=0', studio: 'butt' },
  { name: 'side', q: 'cam=hand&camp=0', studio: 'side' },
].filter((s) => !ONLY || ONLY.includes(s.name));

const server = spawn('npx', ['vite', 'preview', '--port', port, '--strictPort', '--outDir', dir], { stdio: 'pipe' });
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
try {
  for (const be of backends.split(',')) {
    for (const s of SHOTS) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
      const errors = [];
      page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      const q = `autoplay=1&seed=${SEED}${s.q ? '&' + s.q : ''}${be === 'webgl' ? '&backend=webgl' : ''}`;
      await page.goto(`http://localhost:${port}/?${q}`, { waitUntil: 'load' });
      let ran = true;
      try { await page.waitForFunction(() => window.__bandeja?.running, { timeout: 120000 }); } catch { ran = false; }
      if (!ran) { console.log(be, s.name, 'NOT RUNNING', errors.join(' | ')); await page.close(); continue; }
      const info = await page.evaluate(async (s, T, RP) => {
        const g = window.__bandeja;
        g.renderer.setAnimationLoop(null);
        for (const id of ['hud', 'help', 'overlay']) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }
        for (const el of document.querySelectorAll('body > div')) el.style.display = 'none';
        const sim = g.sim;
        const step = () => { g.epoch -= 1000 / 60; g.tick(); };
        while (sim.time < T) step();
        const cam = g.cam.camera;
        const V = cam.position.constructor;
        const r = g.players[s.studio && s.studio !== 'tvzoom' ? RP : 0].avatar.racket;
        r.updateMatrixWorld(true);
        const e = r.matrixWorld.elements;
        // The racket's axes and origin in the world.
        const X = new V(e[0], e[1], e[2]).normalize(), Y = new V(e[4], e[5], e[6]).normalize(), Z = new V(e[8], e[9], e[10]).normalize();
        const O = new V(e[12], e[13], e[14]);
        const root = g.players[0].root.position;
        const chest = new V(root.x, 1.25, root.z);
        // The face side away from the body.
        const zs = O.clone().addScaledVector(Z, 0.5).distanceTo(chest) > O.clone().addScaledVector(Z, -0.5).distanceTo(chest) ? 1 : -1;
        let fov = 30;
        const at = (x, y, z) => O.clone().addScaledVector(X, x).addScaledVector(Y, y).addScaledVector(Z, z * zs);
        const extra = [];
        if (s.studio === 'face') {
          cam.position.copy(at(0.12, 0.05, 0.85)); cam.up.copy(Y); cam.lookAt(at(0, -0.06, 0)); fov = 36;
        } else if (s.studio === 'edge') {
          cam.position.copy(at(0.42, 0.34, 0.22)); cam.up.copy(Y); cam.lookAt(at(0, 0.06, 0)); fov = 34;
        } else if (s.studio === 'throat') {
          cam.position.copy(at(0.2, -0.12, 0.36)); cam.up.copy(Y); cam.lookAt(at(0, -0.17, 0)); fov = 36;
        } else if (s.studio === 'holes') {
          cam.position.copy(at(0.08, 0.06, 0.16)); cam.up.copy(Y); cam.lookAt(at(0.03, 0.03, 0)); fov = 38;
        } else if (s.studio === 'grip' || s.studio === 'butt' || s.studio === 'side') {
          // One racket alone in front of the camera (a clone, players hidden), turned to show the handle, the cap's
          // end or the frame's side and protector.
          const c = r.clone();
          for (const ch of [...c.children]) if (ch.name === 'cord') c.remove(ch);
          const base = new V(0, 1.3, 3.2);
          c.position.copy(base);
          if (s.studio === 'grip') c.rotation.set(0.25, 0.9, 0);
          else if (s.studio === 'butt') c.rotation.set(-1.15, 0.5, 0);
          else c.rotation.set(0.05, 1.32, 0);
          c.updateMatrixWorld(true);
          g.scene.add(c);
          extra.push(c);
          for (const pv of g.players) pv.root.visible = false;
          const aim = s.studio === 'grip' ? new V(0, -0.21, 0) : s.studio === 'butt' ? new V(0, -0.3, 0) : new V(0, 0.02, 0);
          aim.applyMatrix4(c.matrixWorld);
          cam.position.set(aim.x + 0.02, aim.y + 0.02, aim.z + (s.studio === 'side' ? 0.62 : 0.3));
          cam.up.set(0, 1, 0);
          cam.lookAt(aim);
          fov = s.studio === 'side' ? 32 : 30;
        } else if (s.studio === 'lineup' || s.studio === 'lineup-back') {
          // The four rackets side by side (clones share geometry and materials), face on, in the arena's light.
          const back = s.studio === 'lineup-back';
          const base = new V(0, 1.35, 3.2);
          for (let i = 0; i < g.players.length; i++) {
            const c = g.players[i].avatar.racket.clone();
            for (const ch of [...c.children]) if (ch.name === 'cord') c.remove(ch);
            c.position.set(base.x + (i - (g.players.length - 1) / 2) * 0.3, base.y, base.z);
            c.rotation.set(0, back ? Math.PI : 0, 0);
            c.updateMatrixWorld(true);
            g.scene.add(c);
            extra.push(c);
          }
          for (const pv of g.players) pv.root.visible = false;
          cam.position.set(0.05, 1.32, base.z + (back ? -1.55 : 1.55)); cam.up.set(0, 1, 0); cam.lookAt(0, 1.27, base.z); fov = 34;
        } else if (s.studio === 'tvzoom') {
          // The TV camera's own lens, zoomed on player 0 (the racket at broadcast distance, enlarged after).
          cam.lookAt(O); fov = 6;
        }
        if (s.studio) {
          const fov0 = cam.fov;
          cam.fov = fov;
          cam.updateProjectionMatrix();
          cam.updateMatrixWorld();
          g.renderOnce();
          cam.fov = fov0;
          cam.up.set(0, 1, 0);
        }
        // Where each racket is on screen (px) and which level it shows.
        const screen = g.players.map((pv) => {
          const q = pv.avatar.racket.getWorldPosition(new V());
          q.project(cam);
          const near = pv.avatar.racket.getObjectByName('racketNear');
          return [Math.round((q.x + 1) * 800), Math.round((1 - q.y) * 450), near ? (near.visible ? 'near' : 'far') : '-'];
        });
        // Racket stats: meshes, triangles.
        let meshes = 0, tris = 0;
        r.traverse((o) => {
          if (!o.isMesh || o.name === 'cord' || o.name === 'racketFar') return;
          const gg = o.geometry;
          const groups = Array.isArray(o.material) ? Math.max(1, gg.groups.length) : 1;
          meshes += groups;
          tris += (gg.index ? gg.index.count : gg.attributes.position.count) / 3;
        });
        return { t: sim.time.toFixed(2), meshes, tris, extra: extra.length, running: g.running, screen };
      }, s, T, RP);
      const file = `${out}/${prefix}-${s.name}${RP && s.studio ? '-p' + RP : ''}${backends.includes(',') || prefix.startsWith('after') ? '-' + be : ''}.png`;
      await page.screenshot({ path: file });
      console.log(be, s.name, JSON.stringify(info), file, errors.length ? 'ERRORS: ' + errors.join(' | ') : 'no errors');
      await page.close();
    }
  }
} finally {
  await browser.close();
  kill();
}
