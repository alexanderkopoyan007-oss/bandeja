// Low quality's simpler triangles (src/render/lodCore.ts) against the full ones on the same frame: an autoplay match held and
// stepped to T as tools/still.mjs does, drawn once as the game picks (Avatar.pickLod) and once with every player in full,
// both written as PNGs, with how much of the picture differs and where. VIEW=waist:N etc. as still.mjs (the near camera:
// the game should draw them in full there, so the two should be the same).
//   bash tools/one-chrome.sh node tools/lod-check.mjs <url with quality=low> <out prefix> [T seconds] [w] [h]
import puppeteer from 'puppeteer-core';
import { execFileSync } from 'node:child_process';

const [url, out, T = '8', w = '1920', h = '1080'] = process.argv.slice(2);
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
await page.setViewport({ width: +w, height: +h, deviceScaleFactor: 1 });
let errors = 0;
page.on('pageerror', (e) => { errors++; console.log('[pageerror]', e.message); });
page.on('console', (m) => { if (m.type() === 'error') { errors++; console.log('[error]', m.text().slice(0, 600)); } });
await page.evaluateOnNewDocument(() => {
  const id = setInterval(() => {
    const g = window.__bandeja;
    if (!g) return;
    clearInterval(id);
    const start = g.start.bind(g);
    g.start = () => { start(); g.renderer.setAnimationLoop(null); window.__held = true; };
  }, 1);
});
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__held === true, { timeout: 120000, polling: 100 });
const info = await page.evaluate(async (T, view) => {
  const g = window.__bandeja;
  document.querySelectorAll('.hint, .pill').forEach((e) => { e.style.display = 'none'; });
  for (let i = 0; g.sim.time < T - 1e-6 && i < 100000; i++) {
    g.epoch = performance.now() - Math.min(g.sim.time + 1 / 60, T) * 1000;
    g.tick();
    if (i % 30 === 29) await new Promise((r) => setTimeout(r, 0));
  }
  if (view) {
    const [kind, n] = view.split(':');
    const r = g.players[+n].root, c = g.cam.camera;
    const fx = Math.sin(r.rotation.y), fz = Math.cos(r.rotation.y), y = kind === 'chest' ? 1.3 : kind === 'feet' ? 0.08 : 0.95;
    const d = kind === 'feet' ? 0.95 : 1.2;
    c.position.set(r.position.x + fx * d + fz * 0.35, y + 0.1, r.position.z + fz * d - fx * 0.35);
    c.lookAt(r.position.x, y, r.position.z);
    c.updateMatrixWorld();
  }
  document.getElementById('hud').style.visibility = 'hidden';
  g.renderOnce();
  await new Promise((r) => requestAnimationFrame(() => r()));
  return g.players.map((p) => p.avatar?.lodState ?? null);
}, +T, process.env.VIEW ?? '');
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: `${out}-lod.png` });
await page.evaluate(async () => {
  const g = window.__bandeja;
  // every player in full (a camera infinitely sharp), and the game kept from picking again
  const eye = g.cam.camera.position;
  for (const p of g.players) p.avatar?.pickLod(eye, 1e12);
  g.lodPick = false;
  // (and the props drawn simpler from the start: lod.ts lowerStatic)
  g.scene.traverse((o) => { if (o.userData.lodFull) o.geometry = o.userData.lodFull; });
  g.renderOnce();
  await new Promise((r) => requestAnimationFrame(() => r()));
});
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: `${out}-full.png` });
// The control: the same frame drawn once more, unchanged (whatever moves between two draws of one frame is not the triangles).
const boxes = await page.evaluate(async () => {
  const g = window.__bandeja;
  g.renderOnce();
  await new Promise((r) => requestAnimationFrame(() => r()));
  // each player's box on screen (feet to above the head, a metre either side), in CSS pixels; then each simplified prop's
  const c = g.cam.camera, W = innerWidth, H = innerHeight;
  const props = [];
  g.scene.traverse((o) => {
    if (!o.userData.lodFull) return;
    o.geometry.computeBoundingBox();
    const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
      const v = b.min.clone().set(x, y, z).project(c);
      if (v.z > 1) continue;
      const sx = (v.x + 1) / 2 * W, sy = (1 - v.y) / 2 * H;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    if (x1 > 0 && y1 > 0 && x0 < W && y0 < H) props.push([Math.max(0, Math.floor(x0 - 4)), Math.max(0, Math.floor(y0 - 4)), Math.min(W, Math.ceil(x1 + 4)), Math.min(H, Math.ceil(y1 + 4)), o.name]);
  });
  window.__lodProps = props;
  return g.players.map((p) => {
    const r = p.root.position;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const dx of [-0.9, 0.9]) for (const dz of [-0.9, 0.9]) for (const y of [0, 2.1]) {
      const v = r.clone(); v.x += dx; v.z += dz; v.y = y;
      v.project(c);
      const sx = (v.x + 1) / 2 * W, sy = (1 - v.y) / 2 * H;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    return [Math.max(0, Math.floor(x0)), Math.max(0, Math.floor(y0)), Math.min(W, Math.ceil(x1)), Math.min(H, Math.ceil(y1))];
  });
});
const props = await page.evaluate(() => window.__lodProps);
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: `${out}-again.png` });
await browser.close();
info.forEach((s, i) => console.log(`player ${i}: ${s ? `${s.on ? 'simpler' : 'full'} (${s.full} -> ${s.low} triangles, ${(s.error * 1000).toFixed(1)} mm)` : 'no simpler triangles'}`));
// How the two pictures differ (python3 with PIL: our own PNGs).
const py = `
import sys, json
from PIL import Image, ImageChops
a, b, c = (Image.open(f).convert('RGB') for f in sys.argv[1:4])
boxes = json.loads(sys.argv[4])
def stats(x, y, box=None):
    d = ImageChops.difference(x, y).convert('L')
    if box: d = d.crop(box)
    px = list(d.getdata()); n = max(1, len(px))
    return '>8 %.2f%%, >24 %.2f%%, >64 %.3f%%, largest %d, mean %.3f' % (100*sum(v > 8 for v in px)/n, 100*sum(v > 24 for v in px)/n, 100*sum(v > 64 for v in px)/n, max(px or [0]), sum(px)/n)
print('whole picture  simpler vs full: ' + stats(a, b))
print('               control (full twice): ' + stats(b, c))
for i, bx in enumerate(boxes):
    if bx[2] <= bx[0] or bx[3] <= bx[1]: continue
    print('player %d %s  simpler vs full: %s | control: %s' % (i, bx, stats(a, b, tuple(bx)), stats(b, c, tuple(bx))))
`;
console.log(execFileSync('python3', ['-c', py, `${out}-lod.png`, `${out}-full.png`, `${out}-again.png`, JSON.stringify(boxes)]).toString().trim());
const pyProps = py.replace("print('player %d", "print('prop %d").replace("for i, bx in enumerate(boxes):", "for i, bx in enumerate([b[:4] for b in boxes]):");
if (props.length) console.log(execFileSync('python3', ['-c', pyProps, `${out}-lod.png`, `${out}-full.png`, `${out}-again.png`, JSON.stringify(props)]).toString().trim().split('\n').filter((l) => l.startsWith('prop')).map((l, i) => l.replace(/^prop \d+/, `prop ${i} (${props[i][4]})`)).join('\n'));
console.log(errors ? `${errors} page errors` : 'no page errors');
