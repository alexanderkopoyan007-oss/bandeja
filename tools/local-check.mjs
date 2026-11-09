// Local multiplayer in Chrome (M6 phase A): two scripted standard-mapping pads beside the keyboard. The Local match
// screen's seat chart (keyboard and pad 2 as pair 1, pad 1 against them), then on court: each device reaches its own
// player only, the far end's stick is turned round to the screen, Start on a pad pauses and resumes, and with every
// device pulsing its drive key (auto timing fires the held swing) each of the three humans hits the ball.
// Prints one line per check and PASS/FAIL.
//   bash tools/one-chrome.sh node tools/local-check.mjs [url]   (the dev server: npx vite --port 5190)
import puppeteer from 'puppeteer-core';

const url = process.argv[2] ?? 'http://localhost:5190/?creator=1';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PLAY_S = Number(process.env.PLAY_S ?? 90);
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
  // Two pads, indices 0 and 1, standard mapping; a change moves the pad's timestamp, as a real one's does.
  await page.evaluateOnNewDocument(() => {
    const mk = (index) => ({ id: `Scripted pad ${index + 1} (STANDARD GAMEPAD)`, index, connected: true, mapping: 'standard', timestamp: performance.now(),
      axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })), vibrationActuator: null });
    const pads = [mk(0), mk(1)];
    window.__pads = pads;
    window.__padSet = (p, b, on) => { pads[p].buttons[b] = { pressed: on, touched: on, value: on ? 1 : 0 }; pads[p].timestamp = performance.now(); };
    window.__padAxis = (p, a, v) => { pads[p].axes[a] = v; pads[p].timestamp = performance.now(); };
    Object.defineProperty(navigator, 'getGamepads', { value: () => [pads[0], pads[1], null, null], configurable: true });
  });
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
  await page.waitForFunction(() => window.__bandeja?.running && !window.__app.menu.isOpen && window.__bandeja.localPlayers.length === 3, { timeout: 180000, polling: 250 });
  const seats = await page.evaluate(() => window.__bandeja.localPlayers);
  check('three locals, P1 the keyboard at seat 0', JSON.stringify(seats) === '[0,2,1]', JSON.stringify(seats));

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
  check('pad 1 moves player 1 only, turned round', f[1]?.x === -1 && f[0]?.x === 0 && f[2]?.x === 0 && f[3] === null, JSON.stringify(f));
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
  await page.keyboard.down('KeyD');
  f = await framesWhen((f) => f[0]?.x !== 0);
  check('keyboard moves P1 only', f[0]?.x === 1 && f[1]?.x === 0 && f[2]?.x === 0, JSON.stringify(f));
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
    await page.evaluate(() => { window.__padSet(0, 0, true); window.__padSet(1, 0, true); });
    await sleep(1100);
    await page.keyboard.up('KeyJ');
    await page.evaluate(() => { window.__padSet(0, 0, false); window.__padSet(1, 0, false); });
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
  check('each human hit the ball (players 0, 1, 2)', hits.by[0] > 0 && hits.by[1] > 0 && hits.by[2] > 0, `hits by player ${JSON.stringify(hits.by)}`);
  const fps = await page.evaluate(() => { const fr = window.__bandeja.probe.frames.slice(-600).filter((d) => d > 0).sort((a, b) => a - b); return { p50: fr[fr.length >> 1], p99: fr[Math.floor(fr.length * 0.99)] }; });
  console.log(`frame ms over the last 600: p50 ${fps.p50?.toFixed(1)} p99 ${fps.p99?.toFixed(1)} (headless, not a perf run)`);
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' / '));
} catch (e) {
  check('ran', false, String(e?.stack ?? e).slice(0, 400));
} finally {
  await browser?.close();
}
const pass = results.every(Boolean);
console.log(pass ? 'PASS' : 'FAIL');
process.exit(pass ? 0 : 1);
