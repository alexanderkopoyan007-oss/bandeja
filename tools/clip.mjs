// A short clip of an autoplay match, the same frames every run: held at its start as still.mjs holds it, stepped by hand
// to T0, then rendered every 1/30 s for SECS and joined into an MP4 (for motion that stills can't show, such as hair).
//   bash tools/one-chrome.sh node tools/clip.mjs <url> <out.mp4> <T0 s> [secs] [w] [h]
// VIEW=behind:N follows player N's head from behind and a little to one side (hair); VIEW=waist:N / chest:N as still.mjs.
// FFMPEG= the ffmpeg binary (default: the mocap venv's imageio-ffmpeg one). The frames stay beside the MP4 in <out>-frames/.
import puppeteer from 'puppeteer-core';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';

const [url, out, T0 = '8', SECS = '3', w = '1280', h = '720'] = process.argv.slice(2);
const FPS = 30;
const ffmpeg = process.env.FFMPEG ?? `${homedir()}/bandeja-mocap/venv/lib/python3.11/site-packages/imageio_ffmpeg/binaries/ffmpeg-macos-aarch64-v9.0`;
const dir = out.replace(/\.mp4$/, '') + '-frames';
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
await page.setViewport({ width: +w, height: +h, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[error]', m.text().slice(0, 600)); });
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
await page.evaluate(() => {
  document.querySelectorAll('.hint, .pill').forEach((e) => { e.style.display = 'none'; });
  document.getElementById('hud').style.visibility = 'hidden';
  // Step to T exactly, a frame (1/60 s) at a time; then place the camera if asked, and draw.
  window.__to = async (T, view) => {
    const g = window.__bandeja;
    for (let i = 0; g.sim.time < T - 1e-6 && i < 100000; i++) {
      g.epoch = performance.now() - Math.min(g.sim.time + 1 / 60, T) * 1000;
      g.tick();
      if (i % 30 === 29) await new Promise((r) => setTimeout(r, 0));
    }
    if (view) {
      const [kind, n] = view.split(':');
      const pl = g.players[+n], c = g.cam.camera;
      const r = pl.root, fx = Math.sin(r.rotation.y), fz = Math.cos(r.rotation.y);
      if (kind === 'behind') {
        const hd = pl.avatar.root.getObjectByName('Head');
        const at = hd.getWorldPosition(c.position.clone());
        c.position.set(at.x - fx * 1.1 + fz * 0.45, at.y + 0.05, at.z - fz * 1.1 - fx * 0.45);
        c.lookAt(at.x, at.y - 0.12, at.z);
      } else {
        const y = kind === 'chest' ? 1.3 : 0.95;
        c.position.set(r.position.x + fx * 1.2 + fz * 0.35, y + 0.1, r.position.z + fz * 1.2 - fx * 0.35);
        c.lookAt(r.position.x, y, r.position.z);
      }
      c.updateMatrixWorld();
    }
    g.renderOnce();
    await new Promise((r) => requestAnimationFrame(() => r()));
    return g.sim.time;
  };
});
const view = process.env.VIEW ?? '';
const n = Math.round(+SECS * FPS);
let last = 0;
for (let k = 0; k <= n; k++) {
  last = await page.evaluate((T, v) => window.__to(T, v), +T0 + k / FPS, view);
  await page.screenshot({ path: `${dir}/f${String(k).padStart(4, '0')}.png` });
}
await browser.close();
if (existsSync(ffmpeg)) {
  execFileSync(ffmpeg, ['-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', `${dir}/f%04d.png`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', out]);
  console.log('wrote', out, `(${n + 1} frames, ${+T0}-${last.toFixed(3)} s)`);
} else console.log('frames in', dir, '(no ffmpeg at', ffmpeg + ')');
