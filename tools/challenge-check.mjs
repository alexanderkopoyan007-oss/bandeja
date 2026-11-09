// Challenges in Chrome (M6 phase C): Title -> Challenges -> one (CHALLENGE=targets|glass|smash|wall, default targets)
// -> Play, its line and rings on screen; the keyboard pulses a shot key with auto timing until the run is over ->
// a medal screen and the best kept with its inputs -> Watch your best: the run plays back from the kept inputs, with
// nobody's keys, and must end on the same score with the same balls (the sim re-run in the real game loop, frame
// pacing and all). Prints one line per check and PASS/FAIL.
//   bash tools/one-chrome.sh node tools/challenge-check.mjs [url]   (the dev server: npx vite --port 5190)
// DUMP=<file.json> writes the kept run (its match, inputs and cast) and the tick each ball ended on;
// `node tools/run-replay.ts <file.json> [id]` re-runs it in Node without the game loop, to tell a log that misses something
// from a watch that builds another match.
import puppeteer from 'puppeteer-core';

const url = process.argv[2] ?? 'http://localhost:5190/?creator=1';
const which = process.env.CHALLENGE ?? 'targets';
const KEY = { targets: 'KeyJ', glass: 'KeyJ', smash: 'KeyO', wall: 'KeyJ' }[which] ?? 'KeyJ';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let browser;
try {
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=metal'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__app && document.querySelector('#menu.on .item') && window.__app.store, { timeout: 180000, polling: 200 });
  const click = (t) => page.evaluate((t) => {
    const b = [...document.querySelectorAll('#menu .item')].find((x) => x.textContent.trim().startsWith(t));
    b?.click();
    return !!b;
  }, t);
  const title = () => page.evaluate(() => ({ id: window.__app.menu.current?.id, h1: document.querySelector('#menu h1')?.textContent ?? '', sub: document.querySelector('#menu .sub')?.textContent ?? '', open: window.__app.menu.isOpen }));
  await page.evaluate(() => { window.__app.settings.autoTiming = true; window.__app.store.saveDoc('challenges.v1', null); });
  const name = await page.evaluate(async (id) => (await import('/src/game/challenge.ts')).CHALLENGES.find((c) => c.id === id).name, which);
  check('title lists Challenges', await click('Challenges'));
  await sleep(250);
  check(`opens ${name}`, await click(name));
  await sleep(200);
  check('play', await click('Play'));
  await page.waitForFunction(() => window.__bandeja?.running && !window.__app.menu.isOpen && window.__bandeja.run, { timeout: 180000, polling: 250 });
  const pointLog = () => page.evaluate(() => {
    window.__points = [];
    let last = -1;
    clearInterval(window.__pointTimer);
    window.__pointTimer = setInterval(() => { const g = window.__bandeja; if (g?.run && g.run.balls !== last) { last = g.run.balls; window.__points.push([last, g.sim.tick, g.run.score]); } }, 20);
  });
  await pointLog();
  const line = await page.evaluate(() => window.__bandeja.runLine?.textContent ?? '');
  check('the run’s line shows', /ball 1 of/i.test(line), line);
  // Play it out: hold the key about a second at a time (auto timing swings), until the medal screen comes up.
  const t0 = Date.now();
  while (Date.now() - t0 < 300000) {
    await page.keyboard.down(KEY);
    await sleep(1000);
    await page.keyboard.up(KEY);
    await sleep(80);
    const s = await title();
    if (s.open && s.id === 'results') break;
  }
  let s = await title();
  const played = await page.evaluate(() => ({ score: window.__bandeja.run.score, balls: window.__bandeja.run.balls, marks: window.__bandeja.run.marks.length, ticks: window.__bandeja.sim.tick }));
  check('the run ends on a medal screen', s.id === 'results', `${s.h1} · ${s.sub} (${Math.round((Date.now() - t0) / 1000)} s)`);
  check('every ball played', played.balls === (await page.evaluate(async (id) => (await import('/src/game/challenge.ts')).CHALLENGES.find((c) => c.id === id).balls, which)), JSON.stringify(played));
  const livePoints = await page.evaluate(() => window.__points ?? []);
  const kept = await page.evaluate(async (id) => { await window.__app.store.flush(); const b = window.__app.bests()[id]; return b ? { score: b.score, hasLog: !!b.log, ticks: b.log?.ticks ?? 0, size: JSON.stringify(b).length } : null; }, which);
  check('the best is kept with its inputs', !!kept && kept.score === played.score && kept.hasLog, JSON.stringify(kept));
  if (process.env.DUMP) {
    const fs = await import('node:fs');
    fs.writeFileSync(process.env.DUMP, JSON.stringify({ best: await page.evaluate((id) => window.__app.bests()[id], which), points: await page.evaluate(() => window.__points ?? []) }));
  }
  check('watch your best', await click('Watch your best'));
  await page.waitForFunction(() => window.__bandeja?.running && !window.__app.menu.isOpen && window.__bandeja.run, { timeout: 180000, polling: 250 });
  await pointLog();
  const t1 = Date.now();
  await page.waitForFunction(() => window.__app.menu.isOpen && window.__app.menu.current?.id === 'results', { timeout: 400000, polling: 500 });
  s = await title();
  const watched = await page.evaluate(() => ({ score: window.__bandeja.run.score, balls: window.__bandeja.run.balls, marks: window.__bandeja.run.marks.length, ticks: window.__bandeja.sim.tick }));
  check('the watched run is the run', watched.score === played.score && watched.balls === played.balls && watched.marks === played.marks,
    `${JSON.stringify(watched)} vs ${JSON.stringify(played)} (${Math.round((Date.now() - t1) / 1000)} s)`);
  // Ball by ball, the same moments (read every 20 ms, so a few ticks either way).
  const watchedPoints = await page.evaluate(() => window.__points ?? []);
  const apart = livePoints.filter(([n]) => n > 0).find(([n, t]) => { const w = watchedPoints.find((p) => p[0] === n); return !w || Math.abs(w[1] - t) > 8; });
  check('every ball ends at the same moment', !apart, apart ? `ball ${apart[0]}: tick ${apart[1]} played, ${JSON.stringify(watchedPoints.find((p) => p[0] === apart[0]) ?? null)} watched` : `${livePoints.length - 1} balls`);
  check('says it was the best run', /Your best run/.test(s.h1), s.h1);
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' / '));
} catch (e) {
  check('ran', false, String(e?.stack ?? e).slice(0, 400));
} finally {
  await browser?.close();
}
const pass = results.every(Boolean);
console.log(pass ? 'PASS' : 'FAIL');
process.exit(pass ? 0 : 1);
