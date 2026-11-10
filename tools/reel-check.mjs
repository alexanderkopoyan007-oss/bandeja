// The highlight reel in Chrome (M7 phase B): a match played to its results (moved to a game short of the match
// through the sim's own scoring, the rest played for real with the keyboard and auto timing), then the results'
// "Watch highlights": the reel plays on court with its caption, Enter skips a point, Escape goes back to the results.
// Prints one line per check and PASS/FAIL.
//   bash tools/one-chrome.sh node tools/reel-check.mjs [url]   (the dev server: npx vite --port 5190)
import puppeteer from 'puppeteer-core';

const url = process.argv[2] ?? 'http://localhost:5190/?creator=1';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let browser;
try {
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__app && document.querySelector('#menu.on .item'), { timeout: 180000, polling: 200 });
  const click = (t) => page.evaluate((t) => {
    const b = [...document.querySelectorAll('#menu .item')].find((x) => x.textContent.trim().startsWith(t) && x.getAttribute('aria-disabled') !== 'true');
    b?.click();
    return !!b;
  }, t);
  const items = () => page.evaluate(() => [...document.querySelectorAll('#menu .item')].map((x) => x.textContent.trim().replace(/\s+/g, ' ')));
  await page.evaluate(() => { const s = window.__app.settings; s.autoTiming = true; s.setup.mode = 'doubles'; s.setup.length = 'short'; });
  // A match on the keyboard alone (the Local match screen with no pads: you and three computers).
  await page.evaluate(() => { window.__before = window.__bandeja; });
  check('title lists Local match', await click('Local match'));
  await sleep(300);
  check('starts a match', await click('Start match'));
  await page.waitForFunction(() => window.__bandeja && window.__bandeja !== window.__before && window.__bandeja.running && !window.__app.menu.isOpen && window.__bandeja.sim.phase !== 4,
    { timeout: 180000, polling: 250 });
  // To a game short of the match for the player's pair: their points won through Score.pointWon to the end of the
  // match, then the last four taken back (the final game from love, played for real).
  const moved = await page.evaluate(() => {
    const g = window.__bandeja, s = g.sim.score, team = g.team, snaps = [];
    for (let k = 0; k < 400; k++) {
      const st = [];
      s.writeState(st);
      snaps.push(st);
      s.pointWon(team);
      if (s.winner >= 0) { s.readState(snaps[Math.max(0, snaps.length - 4)]); break; }
    }
    return { games: [...s.games], sets: s.history.length, points: [...s.points] };
  });
  check('moved to a game short of the match', moved.points[0] === 0 && moved.points[1] === 0, JSON.stringify(moved));
  const pulse = async () => {
    await page.keyboard.down('KeyJ');
    await sleep(900);
    await page.keyboard.up('KeyJ');
    await sleep(80);
  };
  const atResultsNow = () => page.evaluate(() => window.__app.menu.isOpen && window.__app.menu.current?.id === 'results');
  // Some points played for real (the reel's material), then to match point (through the scoring, as above), then
  // played out.
  let t0 = Date.now();
  while (Date.now() - t0 < 75000) await pulse();
  const mp = await page.evaluate(() => {
    const g = window.__bandeja, s = g.sim.score, team = g.team, snap = [];
    for (let k = 0; k < 400; k++) {
      s.writeState(snap);
      s.pointWon(team);
      if (s.winner >= 0) { s.readState(snap); break; }
    }
    return { games: [...s.games], points: [...s.points], played: g.sim.score.history.length };
  });
  check('moved to match point', true, JSON.stringify(mp));
  let atResults = false;
  t0 = Date.now();
  while (Date.now() - t0 < 300000) {
    await pulse();
    if (await atResultsNow()) { atResults = true; break; }
    // (a point lost at match point: back to match point)
    await page.evaluate(() => {
      const g = window.__bandeja, s = g.sim.score, team = g.team, snap = [];
      if (g.sim.phase !== 0 || s.winner >= 0) return;
      for (let k = 0; k < 40; k++) { s.writeState(snap); s.pointWon(team); if (s.winner >= 0) { s.readState(snap); break; } }
    });
  }
  check('played to the results', atResults);
  const kept = await page.evaluate(() => window.__bandeja.highlights.clips.map((c) => ({ n: c.n, score: c.score, label: c.label, why: c.why })));
  check('points kept for the reel', kept.length > 0, JSON.stringify(kept).slice(0, 300));
  let list = await items();
  check('the results offer the highlights', atResults && list.some((x) => x.startsWith('Watch highlights')), list.join(' | '));
  check('watches them', await click('Watch highlights'));
  await page.waitForFunction(() => window.__bandeja.reelOn && window.__bandeja.reel.state === 2, { timeout: 30000, polling: 100 });
  // (the reel shows from the click, its caption from the game's next frame: read after two frames)
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const first = await page.evaluate(() => ({ menu: window.__app.menu.isOpen, tag: document.querySelector('#hud .replay')?.textContent ?? '', on: document.querySelector('#hud .replay')?.classList.contains('on'), index: window.__bandeja.reel.index }));
  check('the reel is on court with its caption', !first.menu && first.on && /HIGHLIGHTS 1\//.test(first.tag), JSON.stringify(first));
  // It plays: the reel's clock runs on.
  const c0 = await page.evaluate(() => window.__bandeja.reel.clock);
  await sleep(1500);
  const c1 = await page.evaluate(() => window.__bandeja.reel.clock);
  check('the point plays', c1 > c0 + 0.5, `${c0.toFixed(2)} -> ${c1.toFixed(2)}`);
  if (kept.length > 1) {
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !window.__bandeja.reelOn || window.__bandeja.reel.index >= 1, { timeout: 10000, polling: 50 });
    const second = await page.evaluate(() => ({ index: window.__bandeja.reel.index, tag: document.querySelector('#hud .replay')?.textContent ?? '' }));
    check('Enter skips to the next point', second.index === 1, JSON.stringify(second));
  }
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__app.menu.isOpen && window.__app.menu.current?.id === 'results', { timeout: 10000, polling: 50 });
  const back = await page.evaluate(() => ({ reel: window.__bandeja.reelOn, tag: document.querySelector('#hud .replay')?.classList.contains('on') }));
  check('Escape goes back to the results', !back.reel && !back.tag, JSON.stringify(back));
  list = await items();
  check('and they still offer the highlights', list.some((x) => x.startsWith('Watch highlights')));
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' / '));
} catch (e) {
  check('ran', false, String(e?.stack ?? e).slice(0, 400));
} finally {
  await browser?.close();
}
const pass = results.every(Boolean);
console.log(pass ? 'PASS' : 'FAIL');
process.exit(pass ? 0 : 1);
