// Menus and pausing with a scripted standard-mapping gamepad in Chrome (Phase 8 review): Quick match chosen with the
// pad, then A, the stick and the d-pad during play must never reach the menu that started it (no restart, no menu,
// no focus ticks); Start pauses and resumes, also from a pause sub-screen without changing a setting; a swing held
// on the keyboard through Esc -> key up -> Esc is let go at the resume. Prints one line per check and PASS/FAIL.
//   npm run build && bash tools/one-chrome.sh node tools/pad-check.mjs
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';

const PORT = 4196;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const outDir = process.env.OUTDIR ? ['--outDir', process.env.OUTDIR] : [];
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', ...outDir], { stdio: 'pipe' });
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('preview server did not start')), 20000);
  server.stdout.on('data', (d) => { if (String(d).includes(String(PORT))) { clearTimeout(t); resolve(); } });
});

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
  // The fake pad: 17 buttons, 4 axes, standard mapping; its timestamp moves on every change, as a real one's does.
  await page.evaluateOnNewDocument(() => {
    const pad = { id: 'Scripted pad (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: performance.now(),
      axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })), vibrationActuator: null };
    window.__pad = pad;
    window.__padSet = (b, on) => { pad.buttons[b] = { pressed: on, touched: on, value: on ? 1 : 0 }; pad.timestamp = performance.now(); };
    window.__padAxis = (a, v) => { pad.axes[a] = v; pad.timestamp = performance.now(); };
    // Ticks of the menu's move sound (Menu.onSound 'move'), counted for the check that hidden focus never moves.
    window.__moves = 0;
    Object.defineProperty(navigator, 'getGamepads', { value: () => [pad.connected ? pad : null, null, null, null], configurable: true });
  });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__app?.menu?.isOpen && window.__bandeja?.running, { timeout: 60000, polling: 100 });
  await sleep(800);
  await page.evaluate(() => {
    const m = window.__app.menu;
    const was = m.onSound;
    m.onSound = (k) => { if (k === 'move') window.__moves++; was?.(k); };
  });
  const press = async (b, hold = 90) => { await page.evaluate((x) => window.__padSet(x, true), b); await sleep(hold); await page.evaluate((x) => window.__padSet(x, false), b); await sleep(90); };
  const state = () => page.evaluate(() => {
    const a = window.__app, g = window.__bandeja;
    return { open: a.menu.isOpen, screen: a.menu.current?.id ?? null, focus: document.activeElement?.getAttribute('aria-label') ?? '',
      playing: a.playing, tag: g.__tag ?? 0, paused: g.isMenuPaused, moves: window.__moves, items: a.menu.items.length };
  });
  console.log('document.hasFocus() in this Chrome:', await page.evaluate(() => document.hasFocus()));

  // Title: d-pad down to Quick match, A.
  await press(13);
  const s0 = await state();
  check('d-pad down focuses Quick match', s0.focus === 'Quick match', s0.focus);
  await press(0);
  await page.waitForFunction(() => window.__app.playing && window.__bandeja.running && !window.__app.busy, { timeout: 60000, polling: 100 });
  await sleep(1500);
  await page.evaluate(() => { window.__bandeja.__tag = 1; window.__moves = 0; });
  const s1 = await state();
  check('Quick match by pad A starts a match with the menu closed', s1.playing && !s1.open, JSON.stringify(s1));
  check('nothing of the title menu is left pressable', s1.items === 0, `items ${s1.items}`);

  // Play: A (drive) several times, the stick round, the d-pad.
  for (let k = 0; k < 6; k++) { await press(0, 120); await sleep(250); }
  for (const [a, v] of [[0, 1], [0, -1], [1, 1], [1, -1]]) { await page.evaluate(([x, y]) => window.__padAxis(x, y), [a, v]); await sleep(500); }
  await page.evaluate(() => { window.__padAxis(0, 0); window.__padAxis(1, 0); });
  await press(13); await press(12);
  await sleep(600);
  const s2 = await state();
  check('A during play never restarts the match', s2.tag === 1 && s2.playing, `tag ${s2.tag}`);
  check('no menu opens and hidden focus never moves', !s2.open && s2.moves === 0, `open ${s2.open}, move ticks ${s2.moves}`);

  // Start pauses; Start resumes.
  await press(9);
  const s3 = await state();
  check('Start pauses', s3.open && s3.screen === 'pause' && s3.paused, JSON.stringify(s3));
  await press(9);
  const s4 = await state();
  check('Start resumes', !s4.open && !s4.paused, JSON.stringify(s4));

  // Start on a pause sub-screen (Settings) resumes and changes nothing.
  await press(9);
  await press(13); // Settings
  await press(0);
  const before = await page.evaluate(() => JSON.stringify(window.__app.settings));
  const s5 = await state();
  check('pause -> Settings by pad', s5.screen === 'settings', s5.screen);
  await press(9);
  const s6 = await state();
  const after = await page.evaluate(() => JSON.stringify(window.__app.settings));
  check('Start on Settings (from pause) resumes and changes no setting', !s6.open && !s6.paused && before === after, `open ${s6.open}, same ${before === after}`);

  // A swing held on the keyboard through a pause is let go at the resume.
  let charged = false;
  for (let k = 0; k < 120 && !charged; k++) {
    await page.keyboard.down('KeyJ');
    await sleep(120);
    charged = await page.evaluate(() => window.__bandeja.sim.players[0].swing === 1);
    if (!charged) { await page.keyboard.up('KeyJ'); await sleep(250); }
  }
  check('a swing charged with J', charged);
  if (charged) {
    await page.keyboard.press('Escape');
    await sleep(150);
    await page.keyboard.up('KeyJ');
    await sleep(300);
    const held = await page.evaluate(() => window.__bandeja.sim.players[0].swing);
    await page.keyboard.press('Escape');
    await sleep(400);
    const s7 = await page.evaluate(() => ({ swing: window.__bandeja.sim.players[0].swing, open: window.__app.menu.isOpen }));
    check('held through Esc / key up / Esc: not left charged after the resume', held === 1 && s7.swing !== 1 && !s7.open, `during pause ${held}, after ${s7.swing}`);
  }
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser?.close();
  server.kill();
}
const pass = results.every(Boolean);
console.log(pass ? 'PASS' : 'FAIL');
process.exit(pass ? 0 : 1);
