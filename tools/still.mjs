// The same frame of an autoplay match every time: the game is held at its start and stepped by hand, 1/60 s a frame,
// to sim time T, then shot without the HUD. For before/after stills of a look change between builds (`?cam=` for close
// cameras). Bodies can still differ a little between runs; judge a look, not a pose.
//   bash tools/one-chrome.sh node tools/still.mjs <url> <out.png> <T seconds> [w] [h]
import puppeteer from 'puppeteer-core';

const [url, out, T = '8', w = '1200', h = '900'] = process.argv.slice(2);
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
await page.setViewport({ width: +w, height: +h, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
// Hold the game as it starts: start() runs, then its animation loop is taken away before a frame.
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
const t = await page.evaluate(async (T) => {
  const g = window.__bandeja;
  const t0 = g.sim.time;
  document.querySelectorAll('.hint, .pill').forEach((e) => { e.style.display = 'none'; });
  for (let i = 0; g.sim.time < T - 1e-6 && i < 100000; i++) {
    // (a frame on, or to T exactly: the start isn't always on the same tick)
    g.epoch = performance.now() - Math.min(g.sim.time + 1 / 60, T) * 1000;
    g.tick();
    if (i % 30 === 29) await new Promise((r) => setTimeout(r, 0));
  }
  // (no HUD: the stills are of the bodies)
  document.getElementById('hud').style.visibility = 'hidden';
  g.renderOnce();
  await new Promise((r) => requestAnimationFrame(() => r()));
  return [g.sim.time, t0];
}, +T);
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: out });
await browser.close();
console.log('wrote', out, 'at', t[0].toFixed(4), 'from', t[1].toFixed(4));
