// Local multiplayer in Chrome (M6 phase A): two scripted standard-mapping pads beside the keyboard. The Local match
// screen's seat chart (keyboard and pad 2 as pair 1, pad 1 against them), then on court: each device reaches its own
// player only, the far end's stick is turned round to the screen, Start on a pad pauses and resumes, and with every
// device pulsing its drive key (auto timing fires the held swing) each of the three humans hits the ball.
// Prints one line per check and PASS/FAIL.
//   bash tools/one-chrome.sh node tools/local-check.mjs [url]   (the dev server: npx vite --port 5190; or a build: npx vite preview)
//   PADS=3 for all four seats played; PLAY_S=<seconds> (90 by default: under ~40 s a revés player may never get a ball)
import puppeteer from 'puppeteer-core';

const url = process.argv[2] ?? 'http://localhost:5190/?creator=1';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PLAY_S = Number(process.env.PLAY_S ?? 90);
// PADS=3: a third pad, so all four seats are played (keyboard, then pads 1-3 in the chart's order).
const PADS = process.env.PADS === '3' ? 3 : 2;
const HUMANS = PADS + 1;
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let browser;
try {
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
    args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  // Two pads (or PADS), indices 0 up, standard mapping; a change moves the pad's timestamp, as a real one's does.
  await page.evaluateOnNewDocument((n) => {
    const mk = (index) => ({ id: `Scripted pad ${index + 1} (STANDARD GAMEPAD)`, index, connected: true, mapping: 'standard', timestamp: performance.now(),
      axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })), vibrationActuator: null });
    const pads = Array.from({ length: n }, (_, i) => mk(i));
    window.__pads = pads;
    window.__padSet = (p, b, on) => { pads[p].buttons[b] = { pressed: on, touched: on, value: on ? 1 : 0 }; pads[p].timestamp = performance.now(); };
    window.__padAxis = (p, a, v) => { pads[p].axes[a] = v; pads[p].timestamp = performance.now(); };
    Object.defineProperty(navigator, 'getGamepads', { value: () => [0, 1, 2, 3].map((i) => pads[i] ?? null), configurable: true });
  }, PADS);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__app && document.querySelector('#menu.on .item'), { timeout: 180000, polling: 200 });
  const click = (t) => page.evaluate((t) => {
    const b = [...document.querySelectorAll('#menu .item')].find((x) => x.textContent.trim().startsWith(t));
    b?.click();
    return !!b;
  }, t);
  // Auto timing: a held swing fires itself at the ideal moment, so scripted presses hit balls.
  await page.evaluate(() => { const s = window.__app.settings; s.autoTiming = true; s.setup.mode = 'doubles'; s.setup.length = 'short'; });
  check('title lists Local match', await click('Local match'));
  await sleep(300);
  const chart = await page.evaluate(() => ({
    id: window.__app.menu.current?.id,
    rows: [...document.querySelectorAll('#menu .item')].map((x) => x.textContent.trim().replace(/\s+/g, ' ')),
    side: document.querySelector('#menu .side')?.textContent.replace(/\s+/g, ' ') ?? '',
  }));
  check('seat chart shows', chart.id === 'local', chart.rows.join(' | '));
  check('both pads listed', /Scripted pad 1/.test(chart.side) && /Scripted pad 2/.test(chart.side), chart.side.slice(0, 160));
  check('start allowed', await click('Start match'));
  await page.waitForFunction((n) => window.__bandeja?.running && !window.__app.menu.isOpen && window.__bandeja.localPlayers.length === n, { timeout: 180000, polling: 250 }, HUMANS);
  // (the first frames of a match compile its pipelines and can stall for seconds in headless Chrome: the routing checks
  // wait up to 2 s for a change, so they start once 30 frames are drawn, and the longest of those is printed)
  await page.waitForFunction(() => window.__bandeja.probe.frames.length >= 30, { timeout: 120000, polling: 100 });
  const early = await page.evaluate(() => { const f = window.__bandeja.probe.frames.slice(0, 30); return { max: Math.max(...f), over100: f.filter((d) => d > 100).length }; });
  console.log(`first 30 frames: longest ${early.max.toFixed(0)} ms, ${early.over100} over 100 ms`);
  const seats = await page.evaluate(() => window.__bandeja.localPlayers);
  check(`${HUMANS} locals, P1 the keyboard at seat 0`, JSON.stringify(seats) === (PADS === 3 ? '[0,2,1,3]' : '[0,2,1]'), JSON.stringify(seats));

  // Routing: each device reaches its own player's frame only; the far end's stick turned round to the screen.
  const frames = () => page.evaluate(() => { const g = window.__bandeja; return [0, 1, 2, 3].map((i) => { const f = g.inputs[i]; return f ? { x: f.moveX, y: f.moveY, held: f.held } : null; }); });
  // (the frames are rebuilt every tick; a headless frame can stall, so wait for the change, up to 2 s)
  const framesWhen = async (ok) => {
    let f = await frames();
    for (let k = 0; k < 40 && !ok(f); k++) { await sleep(50); f = await frames(); }
    return f;
  };
  await page.evaluate(() => window.__padAxis(0, 0, 1));
  let f = await framesWhen((f) => f[1]?.x !== 0);
  check('pad 1 moves player 1 only, turned round', f[1]?.x === -1 && f[0]?.x === 0 && f[2]?.x === 0 && (PADS === 3 ? f[3]?.x === 0 : f[3] === null), JSON.stringify(f));
  // On screen: player 1's push (moveX -1 at the far end) goes the camera's right.
  const screenRight = await page.evaluate(() => {
    const g = window.__bandeja, cam = g.cam.camera;
    cam.updateMatrixWorld();
    const right = { x: cam.matrixWorld.elements[0], z: cam.matrixWorld.elements[2] };
    const dx = -1 * g.sim.side(1);
    return dx * right.x;
  });
  check('far player goes right on screen', screenRight > 0, screenRight.toFixed(3));
  await page.evaluate(() => { window.__padAxis(0, 0, 0); window.__padAxis(1, 0, 1); });
  f = await framesWhen((f) => f[2]?.x !== 0);
  check('pad 2 moves player 2 only, not turned', f[2]?.x === 1 && f[0]?.x === 0 && f[1]?.x === 0, JSON.stringify(f));
  await page.evaluate(() => window.__padAxis(1, 0, 0));
  const tick = () => page.evaluate(() => ({ tick: window.__bandeja.sim.tick, frame: window.__bandeja.probe.frames.length, menu: window.__app.menu.isOpen }));
  const t0k = await tick();
  await page.keyboard.down('KeyD');
  f = await framesWhen((f) => f[0]?.x !== 0);
  const t1k = await tick();
  check('keyboard moves P1 only', f[0]?.x === 1 && f[1]?.x === 0 && f[2]?.x === 0, `${JSON.stringify(f)}; sim tick ${t0k.tick} -> ${t1k.tick}, frames ${t0k.frame} -> ${t1k.frame}, menu ${t1k.menu}`);
  await page.keyboard.up('KeyD');

  // Start on pad 2 pauses for everyone; Start again resumes.
  await page.evaluate(() => window.__padSet(1, 9, true));
  await sleep(150);
  await page.evaluate(() => window.__padSet(1, 9, false));
  await sleep(150);
  const paused = await page.evaluate(() => ({ open: window.__app.menu.isOpen, id: window.__app.menu.current?.id, p: window.__bandeja.isMenuPaused }));
  check('Start on pad 2 pauses', paused.open && paused.id === 'pause' && paused.p, JSON.stringify(paused));
  await page.evaluate(() => window.__padSet(1, 9, true));
  await sleep(150);
  await page.evaluate(() => window.__padSet(1, 9, false));
  await sleep(250);
  check('Start again resumes', await page.evaluate(() => !window.__app.menu.isOpen && !window.__bandeja.isMenuPaused));

  // Play: every device pulses its drive (J; A on the pads) and the humans hit the ball. Hits are counted off the
  // sim's event ring as they come (E_HIT = 1), the ring being short.
  await page.evaluate(() => {
    const g = window.__bandeja;
    window.__hits = [0, 0, 0, 0];
    let seen = g.sim.eventSeq;
    setInterval(() => {
      const ev = g.sim.events;
      if (g.sim.eventSeq - seen > ev.length) seen = g.sim.eventSeq - ev.length;
      for (; seen < g.sim.eventSeq; seen++) { const e = ev[seen % ev.length]; if (e.kind === 1 && e.player >= 0) window.__hits[e.player]++; }
    }, 40);
  });
  const t0 = Date.now();
  let k = 0;
  while (Date.now() - t0 < PLAY_S * 1000) {
    await page.keyboard.down('KeyJ');
    await page.evaluate(() => { for (let i = 0; i < window.__pads.length; i++) window.__padSet(i, 0, true); });
    await sleep(1100);
    await page.keyboard.up('KeyJ');
    await page.evaluate(() => { for (let i = 0; i < window.__pads.length; i++) window.__padSet(i, 0, false); });
    await sleep(60);
    // (the pause menu or a replay would stop the match: nothing here should open one)
    if (++k % 10 === 0 && await page.evaluate(() => window.__app.menu.isOpen)) break;
  }
  const hits = await page.evaluate(() => {
    const g = window.__bandeja;
    return { by: window.__hits, points: g.stats.team[0].points + g.stats.team[1].points, menu: window.__app.menu.current?.id ?? null, open: window.__app.menu.isOpen };
  });
  check('menu stayed shut while playing', !hits.open, `${hits.menu}`);
  check('points played', hits.points >= Math.max(1, Math.floor(PLAY_S / 25)), `${hits.points} points in ${PLAY_S} s`);
  check(`each human hit the ball (players 0-${HUMANS - 1})`, hits.by.slice(0, HUMANS).every((n) => n > 0), `hits by player ${JSON.stringify(hits.by)}`);
  const fps = await page.evaluate(() => {
    const p = window.__bandeja.probe, pc = (v) => { const s = v.slice(-600).filter((d) => d >= 0).sort((a, b) => a - b); return [s[s.length >> 1], s[Math.floor(s.length * 0.99)]]; };
    const [p50, p99] = pc(p.frames.filter((d) => d > 0)), [w50, w99] = pc(p.works), [s50, s99] = pc(p.sims);
    return { p50, p99, w50, w99, s50, s99 };
  });
  console.log(`frame ms over the last 600: p50 ${fps.p50?.toFixed(1)} p99 ${fps.p99?.toFixed(1)} (headless, not a perf run); CPU work per frame p50 ${fps.w50?.toFixed(2)} p99 ${fps.w99?.toFixed(2)} ms, sim p50 ${fps.s50?.toFixed(3)} p99 ${fps.s99?.toFixed(3)} ms`);
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' / '));
} catch (e) {
  check('ran', false, String(e?.stack ?? e).slice(0, 400));
} finally {
  await browser?.close();
}
const pass = results.every(Boolean);
console.log(pass ? 'PASS' : 'FAIL');
process.exit(pass ? 0 : 1);
