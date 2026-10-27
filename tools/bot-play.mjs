// Plays as the human through real keyboard events (dispatched in the page at precise times) to verify the
// input path end to end: key timestamps -> sim time -> timing grade. With perfect scheduling, the graded
// timing errors should be a few milliseconds, not a frame (33 ms in headless Chrome).
// Usage: node tools/bot-play.mjs [url] [seconds]
import puppeteer from 'puppeteer-core';

const url = process.argv[2] ?? 'http://localhost:5190/?seed=5&assist=1';
const secs = Number(process.argv[3] ?? 60);
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--disable-frame-rate-limit', '--disable-gpu-vsync'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__bandeja, { timeout: 30000 });

const result = await page.evaluate(async (secs) => {
  const g = window.__bandeja;
  const key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
  const wall = (t) => g.epoch + t * 1000; // sim time -> performance.now()
  const deltas = [];
  const stats = { swings: 0, hits: 0, whiffs: 0, won: 0, lost: 0, grades: {} };
  let seen = g.sim.eventSeq;
  let holding = false;
  let scheduled = false;
  let pressedAt = 0;
  const down = () => { key('keydown', 'KeyJ'); holding = true; scheduled = false; pressedAt = performance.now(); };
  const end = performance.now() + secs * 1000;
  while (performance.now() < end) {
    const sim = g.sim;
    const p = sim.players[0];
    // Read new events.
    while (seen < sim.eventSeq) {
      const e = sim.events[seen % sim.events.length]; seen++;
      // Swings and hits are player 0's own; points are the pair's.
      if (e.kind === 5) { if (e.team === 0) stats.won++; else stats.lost++; continue; }
      if (e.player !== 0) continue;
      if (e.kind === 16) { stats.swings++; deltas.push(e.c * 1000); stats.grades[e.b] = (stats.grades[e.b] ?? 0) + 1; }
      if (e.kind === 1) stats.hits++;
      if (e.kind === 11) stats.whiffs++;
    }
    // A press the sim ignored (e.g. still recovering): let go and try again.
    if (p.swing === 0 && holding && !scheduled && performance.now() - pressedAt > 60) { key('keyup', 'KeyJ'); holding = false; }
    // Serve.
    if (sim.phase === 0 && sim.score.serverPlayer() === 0 && !holding && sim.time > sim.phaseUntil) down();
    if (sim.phase === 1 && holding && !scheduled && sim.score.serverPlayer() === 0) {
      scheduled = true;
      const at = wall(sim.tossIdeal);
      setTimeout(() => { key('keyup', 'KeyJ'); holding = false; }, Math.max(0, at - performance.now()));
    }
    // Rally: hold early, release on the moment the timing ring closes (the sim's focus ideal). In doubles only
    // the balls the pair gives player 0 (holding a key would claim the partner's).
    if (sim.phase === 2 && sim.rally.hitter === 1 && (!sim.doubles || sim.taker[0] === 0)) {
      if (!holding && p.swing === 0) down();
      const ideal = sim.focusIdeal(0);
      if (holding && ideal > 0 && sim.focusInReach && !scheduled) {
        const at = wall(ideal);
        if (at - performance.now() < 120) {
          scheduled = true;
          setTimeout(() => { key('keyup', 'KeyJ'); holding = false; }, Math.max(0, at - performance.now()));
        }
      }
    }
    await new Promise((r) => setTimeout(r, 4));
  }
  return { deltas, stats };
}, secs);
await browser.close();

const d = result.deltas.map(Math.abs).sort((a, b) => a - b);
const pct = (p) => (d[Math.floor(d.length * p)] ?? 0).toFixed(1);
console.log('human swings', result.stats.swings, 'hits', result.stats.hits, 'whiffs', result.stats.whiffs,
  'points won', result.stats.won, 'lost', result.stats.lost);
console.log('grades', result.stats.grades, '(0 too early .. 3 perfect .. 5 too late)');
console.log(`|timing error| ms  p50 ${pct(0.5)}  p90 ${pct(0.9)}  max ${(d[d.length - 1] ?? 0).toFixed(1)}`);
