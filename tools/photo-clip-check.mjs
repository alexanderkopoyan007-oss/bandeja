// Photo mode and clip export in Chrome (M7 phase C). Mid-match: pause, Photo mode (the HUD gone, the keys' panel up),
// the camera driven with the keys, P saves a PNG (a real download, read back: a PNG, and not a blank one), Escape back
// to the pause menu, Resume. Then the match to its results (as tools/reel-check.mjs) and "Save highlights as video":
// the reel plays (Enter skips to the last point), and the file the browser saves is read back (a WebM or an MP4 of
// some size). Then Match stats: its four views, each with its card. Played with the umpire's captions and the TV
// graphics on (the settings): the calls read as shown, the last the match's. Prints one line per check and PASS/FAIL.
//   bash tools/one-chrome.sh node tools/photo-clip-check.mjs [url]   (the dev server: npx vite --port 5190)
import puppeteer from 'puppeteer-core';
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2] ?? 'http://localhost:5190/?creator=1';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = mkdtempSync(join(tmpdir(), 'bandeja-dl-'));
/** A file in the download folder whose name matches, once it is whole (Chrome writes .crdownload first). */
async function download(re, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const f = readdirSync(dir).find((n) => re.test(n) && !n.endsWith('.crdownload'));
    if (f) { await sleep(300); return join(dir, f); }
    await sleep(200);
  }
  return null;
}
let browser;
try {
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__app && document.querySelector('#menu.on .item'), { timeout: 180000, polling: 200 });
  const click = (t) => page.evaluate((t) => {
    const b = [...document.querySelectorAll('#menu.on .item')].find((x) => x.textContent.trim().startsWith(t) && x.getAttribute('aria-disabled') !== 'true');
    b?.click();
    return !!b;
  }, t);
  const menuId = () => page.evaluate(() => (window.__app.menu.isOpen ? window.__app.menu.current?.id : null));
  // (M7's settings on: the umpire in English with captions, and the TV graphics)
  await page.evaluate(() => {
    const s = window.__app.settings; s.autoTiming = true; s.setup.mode = 'doubles'; s.setup.length = 'short';
    s.umpire = 'en'; s.captions = true; s.graphics = 'tv';
  });
  await page.evaluate(() => { window.__before = window.__bandeja; });
  check('title lists Local match', await click('Local match'));
  await sleep(300);
  check('starts a match', await click('Start match'));
  await page.waitForFunction(() => window.__bandeja && window.__bandeja !== window.__before && window.__bandeja.running && !window.__app.menu.isOpen,
    { timeout: 180000, polling: 250 });
  const pulse = async () => { await page.keyboard.down('KeyJ'); await sleep(900); await page.keyboard.up('KeyJ'); await sleep(80); };
  // Every caption the umpire shows, as it is shown.
  const ump = await page.evaluate(() => {
    const el = document.querySelector('#hud .umpire-caption');
    window.__calls = [];
    if (el) new MutationObserver(() => window.__calls.push(el.textContent)).observe(el, { childList: true, characterData: true, subtree: true });
    return { caption: !!el, tv: !!document.querySelector('#hud .tv'), voices: speechSynthesis.getVoices().filter((v) => v.localService).map((v) => v.lang).slice(0, 6).join(' ') };
  });
  check('the settings bring the umpire\'s captions and the TV graphics', ump.caption && ump.tv, `local voices: ${ump.voices || 'none'}`);
  for (let k = 0; k < 12; k++) await pulse();

  // ---- Photo mode ----
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__app.menu.isOpen && window.__app.menu.current?.id === 'pause', { timeout: 10000, polling: 50 });
  check('the pause menu offers Photo mode', await click('Photo mode'));
  await page.waitForFunction(() => window.__bandeja.photoOn, { timeout: 5000, polling: 50 });
  const before = await page.evaluate(() => ({ cam: window.__bandeja.cam.camera.position.toArray(), tick: window.__bandeja.sim.tick, hud: getComputedStyle(document.querySelector('#hud .layer')).visibility,
    panel: [...document.body.children].some((e) => /PHOTO MODE/.test(e.textContent ?? '')) }));
  check('photo mode: the HUD hidden, the keys shown', before.hud === 'hidden' && before.panel, JSON.stringify({ hud: before.hud, panel: before.panel }));
  await page.keyboard.down('ArrowRight'); await sleep(600); await page.keyboard.up('ArrowRight');
  await page.keyboard.down('KeyW'); await sleep(400); await page.keyboard.up('KeyW');
  const after = await page.evaluate(() => ({ cam: window.__bandeja.cam.camera.position.toArray(), tick: window.__bandeja.sim.tick }));
  const moved = Math.hypot(...after.cam.map((v, i) => v - before.cam[i]));
  check('the camera moves with the keys, the match stands still', moved > 1 && after.tick === before.tick, `moved ${moved.toFixed(2)} m, tick ${before.tick} -> ${after.tick}`);
  await page.keyboard.press('KeyP');
  const png = await download(/^bandeja-photo-.*\.png$/, 15000);
  const pngOk = png && readFileSync(png).subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  check('P saves a PNG, and not a blank one', !!pngOk && statSync(png).size > 60000, png ? `${png.split('/').pop()}, ${(statSync(png).size / 1024).toFixed(0)} KB` : 'no file');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__bandeja.photoOn && window.__app.menu.isOpen && window.__app.menu.current?.id === 'pause', { timeout: 5000, polling: 50 });
  const back = await page.evaluate(() => ({ hud: getComputedStyle(document.querySelector('#hud .layer')).visibility, panel: [...document.body.children].some((e) => /PHOTO MODE/.test(e.textContent ?? '')) }));
  check('Escape: back to the pause menu, the HUD back, the panel gone', back.hud !== 'hidden' && !back.panel, JSON.stringify(back));
  check('resumes', await click('Resume'));
  await sleep(500);
  check('the match goes on', await page.evaluate(() => !window.__app.menu.isOpen && !window.__bandeja.isMenuPaused));

  // ---- To the results, then the highlights as a video ----
  await page.evaluate(() => {
    const g = window.__bandeja, s = g.sim.score, snap = [];
    for (let k = 0; k < 400; k++) { s.writeState(snap); s.pointWon(g.team); if (s.winner >= 0) { s.readState(snap); break; } }
  });
  let atResults = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 300000) {
    await pulse();
    if ((await menuId()) === 'results') { atResults = true; break; }
    await page.evaluate(() => {
      const g = window.__bandeja, s = g.sim.score, snap = [];
      if (g.sim.phase !== 0 || s.winner >= 0) return;
      for (let k = 0; k < 40; k++) { s.writeState(snap); s.pointWon(g.team); if (s.winner >= 0) { s.readState(snap); break; } }
    });
  }
  check('played to the results', atResults);
  const calls = await page.evaluate(() => window.__calls);
  // (the check moves the score to match point, so only the points played count: a few)
  check('the umpire called the points, and the match', calls.length >= 2 && /^Game, set and match, \S/.test(calls.at(-1) ?? ''),
    `${calls.length} calls: ${calls.slice(0, 4).join(' | ')} ... ${calls.at(-1)}`);
  const n = await page.evaluate(() => window.__bandeja.highlights.clips.length);
  check('the results offer the video', await click('Save highlights as video'), `${n} points kept`);
  await page.waitForFunction(() => window.__bandeja.reelOn, { timeout: 10000, polling: 50 });
  // To the last point quickly, then it plays to its end and the file is made.
  for (let k = 0; k < 20; k++) {
    const at = await page.evaluate(() => (window.__bandeja.reelOn ? window.__bandeja.reel.index : -1));
    if (at < 0 || at >= n - 1) break;
    await sleep(1200);
    await page.keyboard.press('Enter');
  }
  await page.waitForFunction(() => !window.__bandeja.reelOn, { timeout: 90000, polling: 200 });
  const vid = await download(/^bandeja-highlights-.*\.(webm|mp4)$/, 30000);
  let kind = '';
  if (vid) {
    const h = readFileSync(vid).subarray(0, 12);
    kind = h.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) ? 'webm' : h.subarray(4, 8).toString() === 'ftyp' ? 'mp4' : 'unknown';
  }
  check('the browser saves a video of it', !!vid && kind !== 'unknown' && statSync(vid).size > 100000, vid ? `${vid.split('/').pop()}, ${kind}, ${(statSync(vid).size / 1024).toFixed(0)} KB` : 'no file');
  check('back to the results', (await menuId()) === 'results');

  // ---- The match's stats: each view's card, then back ----
  check('the results offer Match stats', await click('Match stats'));
  await page.waitForFunction(() => window.__app.menu.current?.id === 'stats', { timeout: 5000, polling: 50 });
  const landed = await page.evaluate(() => window.__bandeja.stats.team.reduce((n, t) => n + t.landed, 0));
  const views = [];
  for (let k = 0; k < 4; k++) {
    views.push(await page.evaluate(() => {
      const s = document.querySelector('#menu .side');
      return { h2: s?.querySelector('h2')?.textContent ?? '', rows: s?.querySelectorAll('tr').length ?? 0, dots: s?.querySelectorAll('circle').length ?? 0 };
    }));
    await click('Show');
    await sleep(150);
  }
  const titles = new Set(views.map((v) => v.h2));
  check('four views, each with its card, a dot for every shot that came down', titles.size === 4 && views[0].rows > 3 && views[1].rows > 8 && views[2].rows > 5 && views[3].dots === landed && landed > 0,
    views.map((v) => `${v.h2.slice(0, 22)}: ${v.rows} rows, ${v.dots} dots`).join(' / '));
  check('back from the stats', await click('Back to the results'));
  await sleep(200);
  check('at the results again', (await menuId()) === 'results');
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' / '));
} catch (e) {
  check('ran', false, String(e?.stack ?? e).slice(0, 400));
} finally {
  await browser?.close();
}
console.log(`downloads in ${dir}`);
const pass = results.every(Boolean);
console.log(pass ? 'PASS' : 'FAIL');
process.exit(pass ? 0 : 1);
