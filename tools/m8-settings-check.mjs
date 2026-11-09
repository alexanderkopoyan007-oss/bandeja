// M8 phase A in Chrome: the settings added for the brief's accessibility list, through the real menus with a scripted
// pad. With ?creator=1: Controls lists the pad's buttons and one is rebound by pressing A, then the new button (the
// card beside the list follows); Settings lists Field of view, Camera shake and Voices, and Custom quality brings its
// three choices; a match plays the rebound button's shot and draws with the wider lens. Without the flag none of it
// shows and a match plays as before. Prints one line per check and PASS/FAIL.
//   bash tools/one-chrome.sh node tools/m8-settings-check.mjs [origin]   (the dev server: npx vite --port 5190)
import puppeteer from 'puppeteer-core';

const origin = process.argv[2] ?? 'http://localhost:5190';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let browser;
try {
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
    args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  const open = async (path) => {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
    await page.evaluateOnNewDocument(() => {
      try { localStorage.clear(); } catch { /* none */ }
      const pad = { id: 'Scripted pad (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: performance.now(),
        axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })), vibrationActuator: null };
      window.__padSet = (b, on) => { pad.buttons[b] = { pressed: on, touched: on, value: on ? 1 : 0 }; pad.timestamp = performance.now(); };
      Object.defineProperty(navigator, 'getGamepads', { value: () => [pad, null, null, null], configurable: true });
    });
    await page.goto(origin + path, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__app && document.querySelector('#menu.on .item'), { timeout: 180000, polling: 200 });
    return page;
  };
  const press = async (page, b) => { await page.evaluate((x) => window.__padSet(x, true), b); await sleep(120); await page.evaluate((x) => window.__padSet(x, false), b); await sleep(120); };
  const labels = (page) => page.evaluate(() => [...document.querySelectorAll('#menu.on .item')].map((x) => x.querySelector('.lab')?.textContent ?? x.textContent.trim()));
  const click = (page, t, nth = 0) => page.evaluate((t, nth) => {
    const b = [...document.querySelectorAll('#menu.on .item')].filter((x) => (x.querySelector('.lab')?.textContent ?? x.textContent.trim()).startsWith(t))[nth];
    b?.click();
    return !!b;
  }, t, nth);
  /** Focus the nth item labelled `t` with the d-pad (as a pad player would), then A. */
  const padTo = async (page, t, nth = 0) => {
    for (let k = 0; k < 60; k++) {
      const at = await page.evaluate((t, nth) => {
        const els = [...document.querySelectorAll('#menu.on .item')];
        const want = els.filter((x) => (x.querySelector('.lab')?.textContent ?? '').startsWith(t))[nth];
        const cur = els.indexOf(document.activeElement);
        return want ? els.indexOf(want) - cur : null;
      }, t, nth);
      if (at === null) return false;
      if (at === 0) { await press(page, 0); return true; }
      await press(page, at > 0 ? 13 : 12);
    }
    return false;
  };
  const value = (page, t, nth = 0) => page.evaluate((t, nth) => {
    const b = [...document.querySelectorAll('#menu.on .item')].filter((x) => (x.querySelector('.lab')?.textContent ?? '').startsWith(t))[nth];
    return b?.querySelector('.v')?.textContent ?? null;
  }, t, nth);
  const startMatch = async (page) => {
    await page.evaluate(() => { window.__before = window.__bandeja; const s = window.__app.settings; s.setup.mode = 'singles'; s.setup.length = 'short'; });
    await click(page, 'Quick match');
    await sleep(300);
    await click(page, 'Start match');
    await page.waitForFunction(() => window.__bandeja && window.__bandeja !== window.__before && window.__bandeja.running && !window.__app.menu.isOpen,
      { timeout: 180000, polling: 250 });
    await sleep(1500);
  };
  /** The lens in play and the rig's own, and what X on the pad holds. */
  const inPlay = (page) => page.evaluate(async () => {
    const g = window.__bandeja;
    let fov = -1;
    for (let k = 0; k < 400 && fov < 0; k++) {
      // (in play: not walking back, no replay, no change of ends)
      if (g.sim.walking === 0 && g.replays.state === 0 && g.cam.turnStart < 0 && !g.cam.cutOn && !g.cam.estOn) fov = g.cam.camera.fov;
      await new Promise((r) => requestAnimationFrame(r));
    }
    window.__padSet(2, true);
    await new Promise((r) => setTimeout(r, 150));
    const held = g.pads[0].held;
    window.__padSet(2, false);
    await new Promise((r) => setTimeout(r, 150));
    return { fov, base: g.cam.fovBase, held };
  });

  // ---- With the flag ----
  let page = await open('/?creator=1');
  check('title: Controls', await click(page, 'Controls'));
  await sleep(300);
  const ctl = await labels(page);
  // (group headings are not items: the pad's shots are the second Drive, Topspin...)
  check('Controls lists the pad\'s shots', ctl.filter((l) => l === 'Drive').length === 2 && ctl.filter((l) => l === 'Precision').length === 2 && ctl.includes('Reset pad'),
    `${ctl.length} items`);
  check('the pad\'s Drive is A', (await value(page, 'Drive', 1)) === 'A', await value(page, 'Drive', 1));
  check('A on the pad\'s Drive starts a capture', await padTo(page, 'Drive', 1) && /pad button/.test(await value(page, 'Drive', 1) ?? ''), await value(page, 'Drive', 1));
  await press(page, 2);
  const after = { drive: await value(page, 'Drive', 1), topspin: await value(page, 'Topspin', 1),
    stored: await page.evaluate(() => JSON.stringify(window.__app.settings.padKeys)),
    card: await page.evaluate(() => [...document.querySelectorAll('#menu .side tr')].map((r) => r.textContent).join(' | ')) };
  check('X pressed: the drive is X, the topspin loses it, stored', after.drive === 'X' && after.topspin === 'None' && /"drive":\[2\]/.test(after.stored), JSON.stringify(after).slice(0, 200));
  check('the pad card says X drives', /XDrive/.test(after.card) && !/XTopspin/.test(after.card), after.card.slice(0, 120));
  // Start cancels a capture and keeps what there is.
  await padTo(page, 'Lob', 1);
  await press(page, 9);
  check('Start cancels a capture', (await value(page, 'Lob', 1)) === 'Y' && (await page.evaluate(() => window.__app.menu.current?.id)) === 'controls');
  await press(page, 1);
  await sleep(300);
  check('Settings', await click(page, 'Settings'));
  await sleep(300);
  let st = await labels(page);
  check('Settings lists Field of view, Camera shake and Voices', ['Field of view', 'Camera shake', 'Voices'].every((l) => st.includes(l)) && !st.includes('Resolution'));
  await page.evaluate(() => { window.__app.settings.quality = 'custom'; window.__app.menu.refresh(); });
  st = await labels(page);
  check('Custom quality brings Resolution, Shadows and Glow', ['Resolution', 'Shadows', 'Glow'].every((l) => st.includes(l)));
  // Field of view +10 with the pad: Standard, then two to the right.
  await padTo(page, 'Field of view');
  await press(page, 15);
  check('the field of view changes with the pad', (await value(page, 'Field of view')) === '+10°', await value(page, 'Field of view'));
  await page.evaluate(() => { window.__app.settings.quality = 'high'; });
  await press(page, 1);
  await sleep(300);
  await startMatch(page);
  const on = await inPlay(page);
  check('in play: the lens is 10° wider than the rig\'s', Math.abs(on.fov - on.base - 10) < 0.01, `fov ${on.fov.toFixed(2)}, rig ${on.base}`);
  check('X on the pad drives', on.held === 1, `held ${on.held}`);
  await page.close();

  // ---- Without the flag: none of it, the game as it was (the same stored settings) ----
  page = await open('/');
  await page.evaluate(() => {
    const s = window.__app.settings;
    s.fov = 10; s.padKeys = { drive: [2] }; s.shake = false; s.voices = 0; s.quality = 'custom';
  });
  await click(page, 'Controls');
  await sleep(300);
  const ctl0 = await labels(page);
  check('no flag: Controls has no pad buttons', ctl0.filter((l) => l === 'Drive').length === 1 && !ctl0.includes('Reset pad'));
  await press(page, 1);
  await sleep(300);
  await click(page, 'Settings');
  await sleep(300);
  const st0 = await labels(page);
  check('no flag: none of the new settings', !['Field of view', 'Camera shake', 'Voices', 'Resolution'].some((l) => st0.includes(l)) && (await value(page, 'Quality')) === 'Auto',
    `quality reads ${await value(page, 'Quality')}`);
  await press(page, 1);
  await sleep(300);
  await startMatch(page);
  const off = await inPlay(page);
  check('no flag: the rig\'s own lens, X tops', Math.abs(off.fov - off.base) < 0.01 && off.held === 2, `fov ${off.fov.toFixed(2)}, rig ${off.base}, held ${off.held}`);
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' / '));
} catch (e) {
  check('ran', false, String(e?.stack ?? e).slice(0, 400));
} finally {
  await browser?.close();
}
const pass = results.every(Boolean);
console.log(pass ? 'PASS' : 'FAIL');
process.exit(pass ? 0 : 1);
