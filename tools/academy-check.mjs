// The academy in Chrome (M6 phase D): Title -> Academy (the first lesson open, the second shut) -> Timing, played by
// key events timed in the page to the ring's moment, with the player's own timing whatever the setting -> a medal
// screen with "Next lesson" -> The drive starts. Then "The back glass" draws the coach's ball's path off the glass
// (glass vision), and "Read the glass" draws nothing. Prints one line per check and PASS/FAIL; SHOT=<png> keeps a frame
// of glass vision.
//   bash tools/one-chrome.sh node tools/academy-check.mjs [url]   (the dev server: npx vite --port 5190)
import puppeteer from 'puppeteer-core';

const url = process.argv[2] ?? 'http://localhost:5190/?creator=1';
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
  const items = () => page.evaluate(() => [...document.querySelectorAll('#menu .item')].map((x) => ({ text: x.textContent.trim(), off: x.getAttribute('aria-disabled') === 'true' })));
  const click = (t) => page.evaluate((t) => {
    const b = [...document.querySelectorAll('#menu .item')].find((x) => x.textContent.trim().startsWith(t) && x.getAttribute('aria-disabled') !== 'true');
    b?.click();
    return !!b;
  }, t);
  const screen = () => page.evaluate(() => ({ id: window.__app.menu.current?.id, h1: document.querySelector('#menu h1')?.textContent ?? '', sub: document.querySelector('#menu .sub')?.textContent ?? '', open: window.__app.menu.isOpen }));
  const onCourt = () => page.waitForFunction(() => window.__bandeja?.running && !window.__app.menu.isOpen && window.__bandeja.run, { timeout: 180000, polling: 250 });
  // Assisted timing on in the settings: the timing lesson must still be the player's own.
  await page.evaluate(() => { window.__app.settings.autoTiming = true; window.__app.store.saveDoc('challenges.v1', null); });

  // (VISION=1: only the glass lessons)
  if (!process.env.VISION) {
  check('title lists Academy', await click('Academy'));
  await sleep(250);
  let list = await items();
  check('the first lesson is open', list.some((x) => /^1\. Timing/.test(x.text) && !x.off), list.slice(0, 2).map((x) => `${x.text.slice(0, 18)}${x.off ? ' (shut)' : ''}`).join(' / '));
  check('the second is shut until then', list.some((x) => /^2\. The drive/.test(x.text) && x.off));
  const desc = await page.evaluate(() => document.querySelector('#menu .desc')?.textContent ?? '');
  check('the first lesson has the focus and names the keys in use', /^Hold J/.test(desc), desc.slice(0, 120));
  check('plays Timing', await click('1. Timing'));
  await onCourt();
  const own = await page.evaluate(() => ({ auto: window.__bandeja.sim.cfg.autoTiming, tap: window.__bandeja.sim.cfg.tapSwing, line: window.__bandeja.runLine?.textContent ?? '' }));
  check('with the player’s own timing', own.auto === false && !own.tap, JSON.stringify(own));

  // Hold J as the coach's ball comes, let go on the ring's moment (the sim's focus ideal), as tools/bot-play.mjs does.
  const t0 = Date.now();
  const played = await page.evaluate(async () => {
    const key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
    const end = performance.now() + 300000;
    let holding = false, scheduled = false, pressedAt = 0;
    while (performance.now() < end && !window.__app.menu.isOpen) {
      const g = window.__bandeja, sim = g.sim, p = sim.players[0];
      const wall = (t) => g.epoch + t * 1000;
      if (p.swing === 0 && holding && !scheduled && performance.now() - pressedAt > 60) { key('keyup', 'KeyJ'); holding = false; }
      if (sim.phase === 2 && sim.rally.hitter === 1) {
        if (!holding && p.swing === 0) { key('keydown', 'KeyJ'); holding = true; scheduled = false; pressedAt = performance.now(); }
        const ideal = sim.focusIdeal(0);
        if (holding && ideal > 0 && sim.focusInReach && !scheduled && wall(ideal) - performance.now() < 120) {
          scheduled = true;
          setTimeout(() => { key('keyup', 'KeyJ'); holding = false; }, Math.max(0, wall(ideal) - performance.now()));
        }
      }
      await new Promise((r) => setTimeout(r, 4));
    }
    const r = window.__bandeja.run;
    return { score: r.score, balls: r.balls, id: r.def.id };
  });
  let s = await screen();
  check('the lesson ends on a medal screen', s.id === 'results', `${s.h1} · ${s.sub} · ${JSON.stringify(played)} (${Math.round((Date.now() - t0) / 1000)} s)`);
  check('timed to the ring, it earns a medal', played.score >= 4, `${played.score} of ${played.balls}`);
  list = await items();
  check('“Next lesson” is offered', list.some((x) => x.text.startsWith('Next lesson')), list.map((x) => x.text.slice(0, 14)).join(' / '));
  check('and starts The drive', await click('Next lesson'));
  await onCourt();
  const second = await page.evaluate(() => ({ id: window.__bandeja.run.def.id, auto: window.__bandeja.sim.cfg.autoTiming, line: window.__bandeja.runLine?.textContent ?? '' }));
  check('The drive is on with the setting’s timing', second.id === 'lesson-drive' && second.auto === true, JSON.stringify(second));

  }
  // Glass vision: the lessons off the glass, started as the academy starts them.
  const vision = async (id) => {
    // (from the title, as the menus go: a lesson never starts over another match)
    await page.evaluate(() => window.__app.toTitle());
    await page.waitForFunction(() => window.__app.menu.isOpen && window.__app.menu.current?.id === 'title' && !window.__bandeja?.run, { timeout: 180000, polling: 250 });
    await page.evaluate((id) => import('/src/game/challenge.ts').then(({ LESSONS }) => window.__app.academyHost().start(LESSONS.find((l) => l.id === id))), id);
    await page.waitForFunction((id) => window.__bandeja?.running && window.__bandeja.run?.def.id === id && !window.__app.menu.isOpen, { timeout: 180000, polling: 250 }, id);
    // Watch a few of the coach's balls: how often the path's dots and marks show while one comes.
    return page.evaluate(async () => {
      const g = window.__bandeja, v = g.vision;
      const seen = { coming: 0, dots: 0, wall: 0, floor: 0 };
      const end = performance.now() + 14000;
      while (performance.now() < end) {
        const sim = g.sim;
        if (sim.phase === 2 && sim.rally.hitter === 1) {
          seen.coming++;
          if (v?.dots?.visible) seen.dots++;
          if (v?.wallMark?.visible) seen.wall++;
          if (v?.floorMark?.visible) seen.floor++;
        }
        await new Promise((r) => requestAnimationFrame(r));
      }
      return { level: v ? v.level : null, ...seen };
    });
  };
  const back = await vision('lesson-back-glass');
  check('“The back glass” draws the whole path', back.level === 2 && back.dots > back.coming * 0.5 && back.wall > 0 && back.floor > 0, JSON.stringify(back));
  if (process.env.SHOT) {
    await page.waitForFunction(() => window.__bandeja.vision?.wallMark?.visible, { timeout: 30000, polling: 30 }).catch(() => {});
    await page.screenshot({ path: process.env.SHOT });
  }
  const side = await vision('lesson-side-glass');
  check('“Side glass” only where it meets the glass and comes down', side.level === 1 && side.dots === 0 && side.wall > 0, JSON.stringify(side));
  const read = await vision('lesson-read-glass');
  check('“Read the glass” draws nothing', read.level === null && read.coming > 0, JSON.stringify(read));
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' / '));
} catch (e) {
  check('ran', false, String(e?.stack ?? e).slice(0, 400));
} finally {
  await browser?.close();
}
const pass = results.every(Boolean);
console.log(pass ? 'PASS' : 'FAIL');
process.exit(pass ? 0 : 1);
