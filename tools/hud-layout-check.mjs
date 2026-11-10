// The match HUD's layout (M8 phase B): a match played with the umpire's captions on, at a text size and window, with
// the simple or the TV score graphics, the HUD sampled four times a second. Fails on a HUD piece off the screen, text
// clipped in its box, or two pieces that should never meet drawn over each other (the score, the calls, the
// captions, the hints, the meter, the TV package's bug, lower third and speed). Prints each finding once, with how
// often it was seen, and PASS/FAIL.
//   bash tools/one-chrome.sh node tools/hud-layout-check.mjs [url]   (the dev server: npx vite --port 5190)
//   VIEW=1280x720 TEXT=1.5 GFX=tv|simple SECS=60 CONTRAST=1
import puppeteer from 'puppeteer-core';

const url = process.argv[2] ?? 'http://localhost:5190/?creator=1';
const [VW, VH] = (process.env.VIEW ?? '1280x720').split('x').map(Number);
const TEXT = Number(process.env.TEXT ?? 1.5);
const GFX = process.env.GFX ?? 'tv';
const SECS = Number(process.env.SECS ?? 60);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const seen = new Map();
let samples = 0;
let fail = false;
let browser;
try {
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
    args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.setViewport({ width: VW, height: VH, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.evaluateOnNewDocument((s) => { try { localStorage.setItem('bandeja.settings.v1', JSON.stringify(s)); } catch { /* none */ } },
    { textSize: TEXT, contrast: process.env.CONTRAST === '1', umpire: 'en', captions: true, graphics: GFX, autoTiming: true, setup: { mode: 'doubles', length: 'short' } });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__app && document.querySelector('#menu.on .item'), { timeout: 180000, polling: 200 });
  const click = (t) => page.evaluate((t) => {
    const b = [...document.querySelectorAll('#menu.on .item')].find((x) => x.textContent.trim().startsWith(t) && x.getAttribute('aria-disabled') !== 'true');
    b?.click();
    return !!b;
  }, t);
  await page.evaluate(() => { window.__before = window.__bandeja; });
  await click('Quick match');
  await sleep(300);
  await click('Start match');
  await page.waitForFunction(() => window.__bandeja && window.__bandeja !== window.__before && window.__bandeja.running && !window.__app.menu.isOpen,
    { timeout: 180000, polling: 250 });
  // Played by holding the drive in pulses (auto timing swings it), as the other match checks do.
  const t0 = Date.now();
  let k = 0;
  while (Date.now() - t0 < SECS * 1000) {
    if (k++ % 4 === 0) await page.keyboard.down('KeyJ');
    if (k % 4 === 3) await page.keyboard.up('KeyJ');
    const found = await page.evaluate(() => {
      const out = [];
      const hud = document.getElementById('hud');
      if (!hud) return out;
      const vw = innerWidth, vh = innerHeight;
      const on = (el) => {
        // (a piece stepping aside, fading out: the TV bug under a tall lower third)
        if (!el.getClientRects().length || el.classList.contains('covered')) return false;
        for (let a = el; a && a !== document.body; a = a.parentElement) {
          const cs = getComputedStyle(a);
          if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.15) return false;
        }
        return (el.textContent ?? '').trim().length > 0 || el.querySelector('canvas,svg') !== null || el.matches('.meter');
      };
      // The pieces that must stay clear of each other (each its own box on screen).
      const sel = { score: '.bug', call: '.call', grade: '.grade', shot: '.shot', mate: '.mate', meter: '.meter', ms: '.ms', hint: '.hint',
        caption: '.umpire-caption', tvbug: '.tv .tvbug', tvl3: '.tv .tvl3', tvspeed: '.tv .tvspeed', replay: '.replay' };
      const boxes = [];
      for (const [name, q] of Object.entries(sel)) {
        for (const el of hud.querySelectorAll(q)) {
          if (!on(el)) continue;
          const r = el.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) continue;
          boxes.push({ name, r, text: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40) });
          if (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1) out.push(`${name} off the screen ("${(el.textContent ?? '').trim().slice(0, 30)}")`);
        }
      }
      for (const el of hud.querySelectorAll('*')) {
        // (a screen reader's live region is clipped to 1 px on purpose)
        if (!on(el) || el.children.length || el.clientWidth <= 2) continue;
        const cs = getComputedStyle(el);
        if ((cs.overflowX === 'hidden' || cs.textOverflow === 'ellipsis') && el.scrollWidth > el.clientWidth + 1) out.push(`clipped "${(el.textContent ?? '').trim().slice(0, 40)}"`);
      }
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i].r, b = boxes[j].r;
          const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (w <= 2 || h <= 2) continue;
          const small = Math.min(a.width * a.height, b.width * b.height);
          if (w * h > 0.1 * small) out.push(`${boxes[i].name} over ${boxes[j].name} ("${boxes[i].text}" / "${boxes[j].text}")`);
        }
      }
      return out;
    });
    samples++;
    for (const f of found) {
      const key = f.replace(/\("[^)]*"\)/, '').trim();
      const e = seen.get(key) ?? { n: 0, ex: f };
      e.n++;
      seen.set(key, e);
    }
    await sleep(250);
  }
  await page.keyboard.up('KeyJ');
  const calls = await page.evaluate(() => window.__bandeja.sim.score.display().join('-'));
  console.log(`${VW}x${VH}, text ${TEXT}, ${GFX} graphics: ${samples} samples over ${SECS} s (score ${calls})`);
  for (const [k, e] of [...seen].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`FAIL ${k}  (${e.n} of ${samples} samples; e.g. ${e.ex})`);
    fail = true;
  }
  if (errors.length) { console.log(`FAIL page errors: ${errors.slice(0, 3).join(' / ')}`); fail = true; }
} catch (e) {
  console.log(`FAIL ran: ${String(e?.stack ?? e).slice(0, 400)}`);
  fail = true;
} finally {
  await browser?.close();
}
console.log(fail ? 'FAIL' : 'PASS');
process.exit(fail ? 1 : 0);
