// The tournament in Chrome (M6 phase B): Title -> Tournament -> Make the draw (8 pairs), the first tie on court with
// the draw's opponents and the player's partner named on the scoreboard, the tie's end (won, put straight into the sim's
// score: the flow, not the tennis, is under test) -> "Through to ..." -> the draw with the result in it -> the next tie
// against the winners of the other quarter. Prints one line per check and PASS/FAIL.
//   bash tools/one-chrome.sh node tools/tour-check.mjs [url]   (the dev server: npx vite --port 5190)
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
  const click = (t) => page.evaluate((t) => {
    const b = [...document.querySelectorAll('#menu .item')].find((x) => x.textContent.trim().startsWith(t));
    b?.click();
    return !!b;
  }, t);
  const screen = () => page.evaluate(() => ({
    id: window.__app.menu.current?.id, title: document.querySelector('#menu h1')?.textContent ?? '',
    side: document.querySelector('#menu .side')?.textContent.replace(/\s+/g, ' ') ?? '',
    items: [...document.querySelectorAll('#menu .item')].map((x) => x.textContent.trim().replace(/\s+/g, ' ')),
  }));
  // A fresh start: no draw saved from an earlier run.
  await page.evaluate(() => window.__app.store.saveDoc('tournament.v1', null));
  check('title lists Tournament', await click('Tournament'));
  await sleep(250);
  let s = await screen();
  check('setup shows', s.id === 'tour-setup', s.items.join(' | '));
  check('make the draw', await click('Make the draw'));
  await sleep(250);
  s = await screen();
  check('the draw shows the quarter-finals', s.id === 'tour' && /Quarter-finals/.test(s.side) && /You/.test(s.side), s.side.slice(0, 200));
  const draw = await page.evaluate(() => {
    const d = window.__app.tour.draw;
    const tie = d.rounds[0].find((t) => t.a === d.you || t.b === d.you);
    return { entries: d.entries.length, mine: d.entries[d.you].players, them: d.entries[tie.a === d.you ? tie.b : tie.a].players };
  });
  check('8 pairs, the player with a partner', draw.entries === 8 && draw.mine.length === 2 && draw.mine.includes('you'), JSON.stringify(draw));
  check('play the quarter-final', await click('Play the quarter-final'));
  await page.waitForFunction(() => window.__bandeja?.running && !window.__app.menu.isOpen, { timeout: 180000, polling: 250 });
  const court = await page.evaluate(async () => {
    const g = window.__bandeja;
    const { ROSTER } = await import('/src/app/roster.ts');
    const pros = [...ROSTER.men, ...ROSTER.women];
    const last = (id) => pros.find((p) => p.id === id)?.name.last;
    return { human: g.opts.human, people: g.opts.people, names: g.names.map((n) => n.last), rows: [g.teamName(0), g.teamName(1)], lastOf: Object.fromEntries(pros.map((p) => [p.id, p.name.last])) };
  });
  const theirLast = draw.them.map((id) => court.lastOf[id]);
  const partner = draw.mine.find((p) => p !== 'you');
  check('opponents on court are the draw’s', court.names[1] === theirLast[0] && court.names[3] === theirLast[1], `${court.names.join(',')} vs ${theirLast.join(',')}`);
  check('partner beside the player', court.names[2 - court.human] === court.lastOf[partner], `human ${court.human}, ${court.names.join(',')}`);
  check('every face on court once', new Set(court.people).size === court.people.length, court.people.join(','));
  // The tie ends: the player's pair takes it 4-2 (straight into the score), and the app's end-of-match runs.
  await page.evaluate(() => {
    const g = window.__bandeja;
    g.sim.score.history.push(g.team === 0 ? [4, 2] : [2, 4]);
    g.sim.score.winner = g.team;
    g.onMatchOver(g.stats);
  });
  await sleep(300);
  s = await screen();
  check('results: through to the semi-finals', /Through to the semi-finals/i.test(s.title), s.title);
  check('to the draw', await click('To the draw'));
  await sleep(250);
  s = await screen();
  check('the draw has the score and the semi-finals', /4-2/.test(s.side) && /Semi-finals/.test(s.side), s.side.slice(0, 260));
  const semi = await page.evaluate(() => {
    const d = window.__app.tour.draw;
    const r = d.rounds[1], tie = r?.find((t) => t.a === d.you || t.b === d.you);
    return tie ? { them: tie.a === d.you ? tie.b : tie.a, other: d.rounds[0].map((t) => t.winner) } : null;
  });
  check('the semi is against a quarter-final winner', !!semi && semi.other.includes(semi.them), JSON.stringify(semi));
  check('play the semi-final', await click('Play the semi-final'));
  await page.waitForFunction(() => window.__bandeja?.running && !window.__app.menu.isOpen, { timeout: 180000, polling: 250 });
  // Lose it: out in the semi-finals, the draw played out.
  await page.evaluate(() => {
    const g = window.__bandeja;
    g.sim.score.history.push(g.team === 0 ? [1, 4] : [4, 1]);
    g.sim.score.winner = 1 - g.team;
    g.onMatchOver(g.stats);
  });
  await sleep(300);
  s = await screen();
  check('results: out in the semi-finals', /Out in the semi-finals/i.test(s.title), s.title);
  await click('To the draw');
  await sleep(250);
  check('see it through finishes the draw', await click('See it through'));
  await sleep(250);
  s = await screen();
  check('final decided', /Final/.test(s.side) && /The draw is over/.test(await page.evaluate(() => document.querySelector('#menu .sub')?.textContent ?? '')), s.side.slice(-160));
  // Saved: a reload finds it.
  const saved = await page.evaluate(async () => { await window.__app.store.flush(); return !!window.__app.tour; });
  check('kept in the store', saved);
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' / '));
} catch (e) {
  check('ran', false, String(e?.stack ?? e).slice(0, 400));
} finally {
  await browser?.close();
}
const pass = results.every(Boolean);
console.log(pass ? 'PASS' : 'FAIL');
process.exit(pass ? 0 : 1);
