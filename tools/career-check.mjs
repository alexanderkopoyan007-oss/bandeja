// The career in Chrome (M6 phase E): Title -> Career -> pick a partner -> Start -> enter the Club Open -> play the
// semi-final and the final (the pair's chemistry is in the match the sim plays), then lose the Night Cup's first
// tie; the points, the ranking, the season moving on, the chemistry, a career cosmetic earned and the next tier opening
// are checked along the way. To keep it to minutes each tie is moved to match point through the sim's own scoring
// (Score.pointWon) for the side meant to win it, and the last points are played for real with the keyboard (auto
// timing). Prints one line per check and PASS/FAIL.
//   bash tools/one-chrome.sh node tools/career-check.mjs [url]   (the dev server: npx vite --port 5190)
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
  const screen = () => page.evaluate(() => ({ id: window.__app.menu.current?.id, h1: document.querySelector('#menu h1')?.textContent ?? '', sub: document.querySelector('#menu .sub')?.textContent ?? '', side: document.querySelector('#menu .side')?.textContent ?? '' }));
  const career = () => page.evaluate(() => window.__app.career);
  // A fresh start: no career, no progress.
  await page.evaluate(async () => { window.__app.store.saveDoc('career.v1', null); window.__app.settings.autoTiming = true; });

  /** From the career screen, onto court for the tie: moved to match point for `win` (true: the player's pair), the rest
   * played with key pulses, until its results. (The match before it, the title's, runs on while the tie loads: wait for the new one.) */
  const playTie = async (win) => {
    await page.evaluate(() => { window.__before = window.__bandeja; });
    if (!(await click('Play'))) return null;
    await page.waitForFunction(() => window.__bandeja && window.__bandeja !== window.__before && window.__bandeja.running && !window.__app.menu.isOpen && window.__bandeja.sim.phase !== 4,
      { timeout: 180000, polling: 250 });
    const cfg = await page.evaluate((win) => {
      const g = window.__bandeja, s = g.sim.score, team = win ? g.team : 1 - g.team;
      // (to one point short of the match: each point taken back if it would end it)
      for (let k = 0; k < 400; k++) {
        const snap = [];
        s.writeState(snap);
        s.pointWon(team);
        if (s.winner >= 0) { s.readState(snap); break; }
      }
      return { chemistry: g.sim.cfg.chemistry ?? null, team: g.team, human: g.opts.human };
    }, win);
    const t0 = Date.now();
    while (Date.now() - t0 < 240000) {
      await page.keyboard.down('KeyJ');
      await sleep(900);
      await page.keyboard.up('KeyJ');
      await sleep(80);
      const s = await page.evaluate(() => window.__app.menu.isOpen && window.__app.menu.current?.id);
      if (s === 'results') return cfg;
    }
    return null;
  };

  check('title lists Career', await click('Career'));
  await sleep(250);
  let s = await screen();
  check('a new career starts with a partner', s.id === 'career-start', s.sub);
  check('starts it', await click('Start the career'));
  await sleep(250);
  let c = await career();
  s = await screen();
  check('the season opens on the Club Open', s.id === 'career' && /Season 1/.test(s.sub) && c?.next === 0, `${s.sub} · partner ${c?.partner} · chemistry ${c?.chemistry?.[c?.partner]}`);
  let list = await items();
  const shut = list.find((x) => x.text.startsWith('Enter'));
  check('the Club Open is open to a newcomer', !!shut && !shut.off, shut?.text);
  check('enters it', await click('Enter the Club Open'));
  await sleep(250);
  c = await career();
  check('a draw of four, the partner in your entry', c?.tour?.draw?.entries.length === 4 && c.tour.draw.entries[c.tour.draw.you].players.includes(c.partner), JSON.stringify(c?.tour?.draw?.entries.map((e) => e.players.join('+'))));
  const chem0 = c.chemistry[c.partner];

  // The semi-final, won.
  let tie = await playTie(true);
  check('plays the semi-final to its results', !!tie);
  check('the sim plays with the pair’s chemistry', Array.isArray(tie?.chemistry) && tie.chemistry[tie.team] === chem0 && tie.chemistry[1 - tie.team] === null, JSON.stringify(tie));
  s = await screen();
  check('through to the final', s.id === 'results' && /Through to the final/i.test(s.h1), `${s.h1} · ${s.sub}`);
  check('back to the career', await click('Career'));
  await sleep(250);
  // The final, won.
  check('plays the final to its results', !!(await playTie(true)));
  s = await screen();
  c = await career();
  check('champions', s.id === 'results' && /Champions/i.test(s.h1), `${s.h1} · ${s.side.slice(0, 160)}`);
  check('the title’s points kept, the season on to the next event', c?.results?.length === 1 && c.results[0].short === 0 && c.results[0].points === 60 && c.next === 1 && !c.tour, JSON.stringify(c?.results));
  check('the results say so, and what it earned', /60 ranking points/.test(s.side) && /Club green overgrip/.test(s.side), s.side.slice(0, 240));
  const chem2 = c.chemistry[c.partner];
  check('chemistry grew over two wins', Math.abs(chem2 - (chem0 + 2 * (0.06 + 0.04))) < 1e-9, `${chem0} -> ${chem2}`);

  // The Night Cup: out in the first tie.
  check('back to the career', await click('Career'));
  await sleep(250);
  check('enters the Night Cup', await click('Enter the Night Cup'));
  await sleep(250);
  check('plays it to its results', !!(await playTie(false)));
  s = await screen();
  c = await career();
  check('out in the semi-final', s.id === 'results' && /Out in the semi-final/i.test(s.h1), s.h1);
  check('the semi-final’s points, the season on', c?.results?.length === 2 && c.results[1].short === 2 && c.results[1].points === 20 && c.next === 2, JSON.stringify(c?.results?.[1]));
  check('back to the career', await click('Career'));
  await sleep(250);
  s = await screen();
  list = await items();
  const regional = list.find((x) => x.text.startsWith('Enter the Spring Regional'));
  check('80 points open the Regional tier', !!regional && !regional.off && /80 points/.test(s.sub), `${s.sub} · ${regional?.text}${regional?.off ? ' (shut)' : ''}`);
  // The career is kept: read back after a reload.
  await page.evaluate(() => window.__app.store.flush());
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__app && document.querySelector('#menu.on .item') && window.__app.store, { timeout: 180000, polling: 200 });
  const back = await career();
  check('kept across a reload', back?.results?.length === 2 && back.next === 2 && Math.abs(back.chemistry[back.partner] - (chem2 + 0.06)) < 1e-9, JSON.stringify({ next: back?.next, chem: back?.chemistry }));
  const grip = await page.evaluate(() => window.__app.store.owned.has('grip-clubgreen'));
  check('the career cosmetic is owned', grip);
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' / '));
} catch (e) {
  check('ran', false, String(e?.stack ?? e).slice(0, 400));
} finally {
  await browser?.close();
}
const pass = results.every(Boolean);
console.log(pass ? 'PASS' : 'FAIL');
process.exit(pass ? 0 : 1);
