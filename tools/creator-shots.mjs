// Stills of the creator (M5 phase D, ?creator=1): the Players screen's creator with its turntable, a character set up
// as a spec says, the studio stepped by hand at 60 frames a second (the same frames every time, whatever the machine
// draws), shot at the times asked. For the owner's look at the screen and for checking bodies at the ball.
//   bash tools/one-chrome.sh node tools/creator-shots.mjs <out-dir> [spec.json] [url]
// spec.json: [{ "name": "giant-head", "draft": { "silly": true, "body": { "head": 2 } }, "drill": 2,
//   "times": [0, 4.2, 4.5], "angle": 0.6, "zoom": 1, "menu": true }]; angle: the camera round them from their front
//   (rad); drill: -1 still, 3 volleys, 2 overheads (game/studio.ts STUDIO_DRILLS); menu: false hides the list;
//   "around": [-0.2, 0, 0.15] in place of times: those offsets (s) from the player's first contact with the ball;
//   "clip": [x, y, w, h] crops the shot; "bone": "RightForeArm" (with "dist" m, default 0.55, and "angle") aims a close
//   camera at that joint instead of the turntable's framing, "bone": ["RightForeArm", "RightHand"] at the middle of two. SHEET=<file.png> also lays every shot out on one sheet, captioned by name
//   (SHEET_COLS columns, default 4).
import puppeteer from 'puppeteer-core';
import { mkdirSync, readFileSync } from 'node:fs';

const [out = 'tools/out/creator', specFile, url = 'http://localhost:5190/?creator=1'] = process.argv.slice(2);
const spec = specFile ? JSON.parse(readFileSync(specFile, 'utf8')) : [{ name: 'default', draft: {}, drill: -1, times: [0], angle: 0.55, zoom: 1, menu: true }];
mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[error]', m.text().slice(0, 400)); });
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__app && document.querySelector('#menu.on .item'), { timeout: 180000, polling: 200 });
await page.evaluate(async () => {
  const click = (t) => [...document.querySelectorAll('#menu .item')].find((b) => b.textContent.trim().startsWith(t))?.click();
  for (let i = 0; i < 100 && !window.__app.store; i++) await new Promise((r) => setTimeout(r, 100));
  click('Players');
  await new Promise((r) => setTimeout(r, 200));
  click('Create a player');
});
const shots = [];
for (const s of spec) {
  const times = await page.evaluate(async (s) => {
    const app = window.__app, cr = app.creator, st = app.studio;
    const d = cr.draft;
    for (const [k, v] of Object.entries(s.draft ?? {})) d[k] = k === 'body' || k === 'outfit' || k === 'racket' ? { ...d[k], ...v } : v;
    cr.dress();
    await st.ready();
    st.play(s.drill ?? -1);
    // around: shots this far (s) either side of the player's first contact, found by a dry run of the same seed.
    let times = s.times ?? [0];
    if (s.around && st.playing >= 0) {
      const runs = st.runs, sim = st.sim, start = sim.time;
      while (sim.players[0].lastContactTime < start && sim.time < start + 15) sim.step(st.inputs);
      const hit = sim.players[0].lastContactTime - start;
      st.runs = runs - 1;
      st.restart();
      times = s.around.map((o) => Math.max(0, hit + o));
    }
    // Stepped by hand: the loop stopped, a clock of our own; the turntable held at the angle asked.
    app.renderer.setAnimationLoop(null);
    st.spinAt = Infinity;
    st.zoom = s.zoom ?? 1;
    let clock = 1000;
    st.last = 0;
    st.frame(clock);
    st.angle = st.view.root.rotation.y + (s.angle ?? 0.55);
    st.wide = st.playing >= 0 ? 1 : 0;
    document.getElementById('menu').style.visibility = s.menu === false ? 'hidden' : '';
    app.menu.refresh();
    return times;
  }, s);
  let at = 0;
  for (const t of times) {
    await page.evaluate(async (from, to, s) => {
      const st = window.__app.studio;
      // (60 frames a second from `from` to `to` seconds after the build)
      for (let f = Math.round(from * 60); f < Math.round(to * 60); f++) st.frame(1000 + (f + 1) * (1000 / 60));
      st.frame(1000 + Math.round(to * 60) * (1000 / 60) + 0.001);
      if (s.bone) {
        // A close camera on the bone, `angle` round the body from its front, level with the bone.
        const a = st.view.avatar, V = st.camera.position.constructor;
        a.root.updateMatrixWorld(true);
        const names = Array.isArray(s.bone) ? s.bone : [s.bone];
        const at = new V();
        for (const n of names) at.add(a.mesh.skeleton.bones.find((x) => x.name === n).getWorldPosition(new V()));
        at.multiplyScalar(1 / names.length);
        const ang = st.view.root.rotation.y + (s.angle ?? 0), d = s.dist ?? 0.55, c = st.camera;
        c.clearViewOffset();
        c.position.set(at.x + Math.sin(ang) * d, at.y + (s.dy ?? 0), at.z + Math.cos(ang) * d);
        c.lookAt(at.x, at.y + (s.dy ?? 0), at.z);
        c.updateProjectionMatrix();
        window.__app.renderer.render(st.scene, c);
      }
      await new Promise((r) => requestAnimationFrame(() => r()));
    }, at, t, s);
    at = t;
    const file = `${out}/${s.name}-${t.toFixed(2)}.png`;
    await page.screenshot({ path: file, ...(s.clip ? { clip: { x: s.clip[0], y: s.clip[1], width: s.clip[2], height: s.clip[3] } } : {}) });
    shots.push({ file, name: s.name });
    console.log(file);
  }
}
if (process.env.SHEET) {
  // One sheet: the shots as data URLs on a page of their own, in a grid, captioned.
  const cols = Number(process.env.SHEET_COLS ?? 4);
  const cells = shots.map((s) => `<figure><img src="data:image/png;base64,${readFileSync(s.file).toString('base64')}"><figcaption>${s.name}</figcaption></figure>`).join('');
  const sheet = await browser.newPage();
  await sheet.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
  await sheet.setContent(`<style>body{margin:0;background:#111;color:#ddd;font:14px system-ui;display:grid;grid-template-columns:repeat(${cols},1fr);gap:6px;padding:6px}
    figure{margin:0}img{width:100%;display:block}figcaption{padding:3px 2px}</style>${cells}`, { waitUntil: 'load' });
  await sheet.screenshot({ path: process.env.SHEET, fullPage: true });
  console.log(process.env.SHEET);
}
await browser.close();
