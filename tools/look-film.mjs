// A film of an autoplay match as the game draws it at 60 Hz (for looks that live between frames: the look pass's motion
// blur and grain, render/post.ts): held at its start, stepped a 60th at a time with every step drawn, every other frame
// kept and joined into a 30 fps MP4. The scoreboard stays; the key hints go.
//   bash tools/one-chrome.sh node tools/look-film.mjs <url> <out.mp4> <T0 s> [secs] [w] [h]
// FFMPEG= the ffmpeg binary (default: the mocap venv's imageio-ffmpeg one). The frames stay beside the MP4 in <out>-frames/.
import puppeteer from 'puppeteer-core';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';

const [url, out, T0 = '8', SECS = '3', w = '1280', h = '720'] = process.argv.slice(2);
const ffmpeg = process.env.FFMPEG ?? `${homedir()}/bandeja-mocap/venv/lib/python3.11/site-packages/imageio_ffmpeg/binaries/ffmpeg-macos-aarch64-v9.0`;
const dir = out.replace(/\.mp4$/, '') + '-frames';
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
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
  document.querySelectorAll('.hint, .pill, .help, #help').forEach((e) => { e.style.display = 'none'; });
  // One 60th on, drawn; `quiet` steps are not drawn (the run-up).
  window.__step = (T, drawn) => {
    const g = window.__bandeja;
    g.epoch = performance.now() - T * 1000;
    g.tick();
    if (drawn) g.renderOnce();
    return g.sim.time;
  };
  window.__run = async (T) => {
    const g = window.__bandeja;
    for (let i = 0; g.sim.time < T - 1e-6 && i < 100000; i++) {
      window.__step(Math.min(g.sim.time + 1 / 60, T), false);
      if (i % 30 === 29) await new Promise((r) => setTimeout(r, 0));
    }
  };
});
if (process.env.KEYS) for (const k of process.env.KEYS.split(',')) { await page.keyboard.press(k); await new Promise((r) => setTimeout(r, 200)); }
await page.evaluate((T) => window.__run(T), +T0 - 0.5);
// (half a second drawn before the first kept frame: the blur and the cameras' springs have a past by then)
for (let k = 0; k < 30; k++) await page.evaluate((T) => window.__step(T, true), +T0 - 0.5 + (k + 1) / 60);
const n = Math.round(+SECS * 60);
let last = 0, kept = 0;
for (let k = 1; k <= n; k++) {
  last = await page.evaluate((T) => window.__step(T, true), +T0 + k / 60);
  if (k % 2 === 0) {
    await new Promise((r) => setTimeout(r, 0));
    await page.screenshot({ path: `${dir}/f${String(kept++).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 92 });
  }
}
await browser.close();
if (existsSync(ffmpeg)) {
  execFileSync(ffmpeg, ['-loglevel', 'error', '-y', '-framerate', '30', '-i', `${dir}/f%04d.jpg`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', out]);
  console.log('wrote', out, `(${kept} frames, ${+T0}-${last.toFixed(3)} s)`);
} else console.log('frames in', dir, '(no ffmpeg at', ffmpeg + ')');
