// The whole online path on this machine: the real room server (wrangler's local Durable Objects), the built game in a window each,
// real WebRTC, real key events. `LINKS` lists runs as [players, lag ms, loss, relay 0/1], `SECS` how long each plays.
//   SP=<scratch dir>; VITE_ROOMS=ws://127.0.0.1:8799 npx vite build --outDir $SP/dist-online
//   bash tools/one-chrome.sh node tools/net/online-e2e.mjs $SP/dist-online
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import puppeteer from 'puppeteer-core';

const dist = process.argv[2], SECS = Number(process.env.SECS ?? 40), WHOLE = !!process.env.WHOLE, MENUS = !!process.env.MENUS, HIDE = !!process.env.HIDE, DROP = !!process.env.DROP, FIND = !!process.env.FIND, QUIT = process.env.QUIT ?? '';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const p = join(dist, new URL(req.url, 'http://x').pathname.replace(/\/$/, '/index.html'));
  try { await stat(p); res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' }); res.end(await readFile(p)); } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(4193, '127.0.0.1', r));
// REMOTE=1: the build talks to the deployed server, so nothing local starts.
const rooms = process.env.REMOTE ? null : spawn('npx', ['--yes', 'wrangler@4.156.2', 'dev', '--port', '8799', '--ip', '127.0.0.1'], { cwd: 'worker', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: 'pipe', detached: true });
if (rooms) await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('rooms did not start')), 60000);
  const see = (d) => { if (String(d).includes('Ready on')) { clearTimeout(t); res(); } };
  rooms.stdout.on('data', see); rooms.stderr.on('data', see);
});
// (a run that dies must not leave the server holding the port for the next)
process.on('exit', () => { if (rooms) try { process.kill(-rooms.pid); } catch { /* already gone */ } });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, protocolTimeout: 900000, defaultViewport: { width: 800, height: 450 },
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--autoplay-policy=no-user-gesture-required', '--disable-audio-output',
    '--disable-frame-rate-limit', '--disable-gpu-vsync', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const cdp = await browser.target().createCDPSession();
async function open(url, log) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', newWindow: true, width: 800, height: 450 });
  const t = await browser.waitForTarget((x) => x._targetId === targetId);
  const p = await t.page();
  p.on('pageerror', (e) => log.push(`pageerror ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') log.push(m.text().slice(0, 240)); });
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  return p;
}

// A player: real key events, released where the cue closes, as the rest of the tools play.
const BOT = `(() => {
  const key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
  let holding = false, scheduled = false, pressedAt = 0;
  const down = () => { key('keydown', 'KeyJ'); holding = true; scheduled = false; pressedAt = performance.now(); };
  const up = (at) => { scheduled = true; setTimeout(() => { key('keyup', 'KeyJ'); holding = false; }, Math.max(0, at - performance.now())); };
  window.__bot = setInterval(() => {
    const g = window.__bandeja; if (!g || !g.online || g.paused) return;
    const sim = g.sim, me = g.opts.human, team = me & 1, p = sim.players[me], lead = g.online.lead, wall = (t) => g.epoch + (t - lead) * 1000;
    if (p.swing === 0 && holding && !scheduled && performance.now() - pressedAt > 100) { key('keyup', 'KeyJ'); holding = false; }
    if (sim.phase === 0 && sim.score.serverPlayer() === me && !holding && sim.time > sim.phaseUntil) down();
    if (sim.phase === 1 && holding && !scheduled && sim.score.serverPlayer() === me) up(wall(sim.tossIdeal));
    if (sim.phase === 2 && sim.rally.hitter === 1 - team && sim.taker[team] === me) {
      if (!holding && p.swing === 0) down();
      const ideal = sim.focusIdeal(me);
      if (holding && ideal > 0 && sim.focusInReach && !scheduled && wall(ideal) - performance.now() < 120) up(wall(ideal));
    }
  }, 4);
})()`;
const read = `(() => {
  const a = window.__app, n = a.net, s = a.online, g = a.current;
  return { menu: a.menu.showing ?? null, seat: s?.seat, tick: g?.sim.tick, net: n ? { ...n.stats, rollbacks: n.client.rollbacks, delay: n.client.o.delay, conf: n.client.confirmed, depthMax: Math.max(0, ...n.client.depths), replayMax: Math.max(0, ...n.client.replayMs) } : null,
    links: s?.links ? s.links.ids().map((id) => ({ id, direct: s.links.direct(id), rtt: Math.round(s.links.rtt(id)) })) : [], points: g ? g.sim.score.pointsPlayed ?? null : null, feed: n?.feed.eventSeq, sim: g?.sim.eventSeq };
})()`;
const QS = 'quality=medium&dpr=1&cap=60';
/** Presses a menu's button by its label, as a click. */
async function press(p, screen, label) {
  await p.waitForFunction((s) => window.__app?.menu.showing === s, { timeout: 120000, polling: 100 }, screen);
  await p.evaluate((l) => [...document.querySelectorAll('button.item')].find((b) => b.textContent.includes(l)).click(), label);
}
const runs = JSON.parse(process.env.LINKS ?? '[[2,0,0,0],[2,80,0.02,0],[2,80,0.02,1],[4,40,0.02,0]]');
let bad = 0;
for (const [n, lag, loss, relay] of runs) {
  const logs = [], pages = [];
  const link = `lag=${lag}&loss=${loss}${relay ? '&relay=1' : ''}${WHOLE ? '&short=1' : ''}`;
  // MENUS=1: in through the menus as a person comes: the first by Create, the second by typing the code, the rest by the link.
  // FIND=1: everyone into the public queue, and the queue makes the match.
  const host = await open(`http://127.0.0.1:4193/?${FIND ? 'online=find&' : MENUS ? '' : `online=new&players=${n}&`}${QS}&${link}`, (logs[0] = []));
  pages.push(host);
  if (MENUS) await press(host, 'title', 'Online'), await press(host, 'online', 'Create a match');
  if (!FIND) await host.waitForFunction('window.__app?.online?.you >= 0', { timeout: 120000, polling: 200 });
  const code = FIND ? 'queue' : await host.evaluate('window.__app.online.code');
  for (let i = 1; i < n; i++) {
    if (FIND) { pages.push(await open(`http://127.0.0.1:4193/?online=find&${QS}&${link}`, (logs[i] = []))); continue; }
    const p = await open(`http://127.0.0.1:4193/?${MENUS && i === 1 ? '' : `room=${code}&`}${QS}&${link}`, (logs[i] = []));
    pages.push(p);
    if (MENUS && i === 1) {
      await press(p, 'title', 'Online');
      await press(p, 'online', 'Join with a code');
      await p.waitForFunction("window.__app.menu.showing === 'join'", { polling: 100 });
      await p.keyboard.type(code.toLowerCase());
      await press(p, 'join', 'Join');
    }
  }
  if (MENUS) {
    await Promise.all(pages.map((p) => p.waitForFunction("window.__app.menu.showing === 'lobby'", { timeout: 60000, polling: 200 })));
    await host.waitForFunction(`window.__app.online.players >= ${n} && window.__app.online.links.ids().every((id) => window.__app.online.links.rtt(id) > 0)`, { timeout: 60000, polling: 200 });
    await press(host, 'lobby', 'Start match');
  }
  try {
    await Promise.all(pages.map((p) => p.waitForFunction('window.__app?.current?.online && !window.__app.current.paused', { timeout: Number(process.env.START_S ?? 180) * 1000, polling: 200 })));
  } catch (e) {
    const x = await Promise.all(pages.map((p) => p.evaluate(`(async () => { const a = window.__app, s = a?.online, raf = await Promise.race([new Promise((r) => requestAnimationFrame(() => r(1))), new Promise((r) => setTimeout(() => r(0), 1000))]); return { raf, hidden: document.hidden, menu: a?.menu.showing, sub: document.querySelector('.screen .sub')?.textContent, busy: a?.busy, game: !!a?.current, online: !!a?.current?.online, paused: a?.current?.paused, you: s?.you, players: s?.players, rtt: s?.links?.ids().map((id) => s.links.rtt(id)), loading: document.querySelector('#loading, .loading')?.textContent?.slice(0, 80), err: window.__loadLog?.slice?.(-3) }; })()`)));
    console.log('stuck before the start:', JSON.stringify(x), JSON.stringify(logs));
    throw e;
  }
  await Promise.all(pages.map((p) => p.evaluate(BOT)));
  const t0 = Date.now();
  await new Promise((r) => setTimeout(r, SECS * 1000));
  const r = await Promise.all(pages.map((p) => p.evaluate(read)));
  console.log(`\n${n} players, ${lag} ms, loss ${loss}${relay ? ', through the server' : ''}: code ${code}, ${(Date.now() - t0) / 1000} s`);
  for (const x of r) {
    console.log(` seat ${x.seat}: tick ${x.tick}, menu ${x.menu}, links ${JSON.stringify(x.links)}, delay ${x.net?.delay}, hashes checked ${x.net?.hashesChecked}, rewinds ${x.net?.rollbacks}, depth max ${x.net?.depthMax}, replay max ${x.net?.replayMax?.toFixed(1)} ms, stalled ${x.net?.stalled}, sent ${x.net?.sent}, got ${x.net?.got}, events ${x.feed}/${x.sim}`);
    if (!x.net || x.menu || !x.net.hashesChecked) bad++;
  }
  // QUIT=host|last: someone closes their window: the AI takes the seat on one tick and the rest play on.
  if (QUIT && n > 1) {
    const who = QUIT === 'host' ? await Promise.all(pages.map((p) => p.evaluate('window.__app.online.isHost'))).then((h) => h.indexOf(true)) : n - 1;
    const stay = pages.filter((_, i) => i !== who), was = await Promise.all(stay.map((p) => p.evaluate(read)));
    await pages[who].close();
    pages.splice(who, 1);
    logs.splice(who, 1);
    await new Promise((r) => setTimeout(r, 15000));
    const b = await Promise.all(stay.map((p) => p.evaluate(`(() => { const a = window.__app; return { menu: a.menu.showing ?? null, taken: a.current.sim.aiTaken, tick: a.current.sim.tick, hashes: a.net?.stats.hashesChecked, stalled: a.net?.stats.stalled, host: a.online?.isHost, note: a.net?.note }; })()`)));
    console.log(` seat left (${QUIT}): ${JSON.stringify(b)}, ticks were ${was.map((x) => x.tick)}`);
    if (b.some((x) => x.menu || !x.taken || x.tick < was[0].tick + 1000)) bad++;
    if (stay.length > 1 && (b.some((x) => x.hashes <= was[0].net.hashesChecked) || b.filter((x) => x.host).length !== 1)) bad++;
  }
  // A window minimised: the sim must keep going with no animation frames, or everyone else stops.
  if (HIDE && n > 1) {
    const c = await pages[n - 1].createCDPSession(), { targetInfo } = await c.send('Target.getTargetInfo'), { windowId } = await cdp.send('Browser.getWindowForTarget', { targetId: targetInfo.targetId });
    const before = await Promise.all(pages.map((p) => p.evaluate(read)));
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const x = await Promise.all(pages.map((p) => p.evaluate(`(() => { const a = window.__app, g = a.current; return { hidden: document.hidden, tick: g?.sim.tick, menu: a.menu.showing ?? null }; })()`)));
      console.log('  ', JSON.stringify(x));
    }
    const hidden = await pages[n - 1].evaluate('document.hidden');
    const after = await Promise.all(pages.map((p) => p.evaluate(read)));
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
    console.log(` minimised 12 s: hidden ${hidden}, ticks ${before.map((x) => x.tick)} -> ${after.map((x) => x.tick)}, stalled ${after.map((x) => x.net?.stalled)}`);
    if (after[0].tick - before[0].tick < 1200 || after[n - 1].tick - before[n - 1].tick < 1200) bad++;
    await new Promise((r) => setTimeout(r, 3000));
  }
  // A connection that goes dead for 3 s: the match holds, says so, and goes on in step. Then one that doesn't come back.
  if (DROP && n > 1) {
    const cut = (who, ms) => pages[who].evaluate((m) => { const k = window.__app.online.links; k.send = () => {}; setTimeout(() => { delete k.send; }, m); }, ms);
    // (each way in turn: one player's packets stop, the other's still arrive)
    for (const who of [n - 1, 0]) {
      const watch = pages[who === 0 ? n - 1 : 0], a0 = await watch.evaluate(read);
      await cut(who, 3000);
      await new Promise((r) => setTimeout(r, 2200));
      const during = await watch.evaluate("({ note: document.querySelector('#hud .hint.on')?.textContent ?? null })");
      await new Promise((r) => setTimeout(r, 9000));
      const b = await Promise.all(pages.map((p) => p.evaluate(read)));
      console.log(` seat ${who} cut for 3 s: during ${JSON.stringify(during)}; after: ticks ${b.map((x) => x.tick)}, stalled ${b.map((x) => x.net?.stalled)}, hashes ${b.map((x) => x.net?.hashesChecked)} (were ${a0.net?.hashesChecked}), menu ${b.map((x) => x.menu)}`);
      const ticks = b.map((x) => x.tick);
      if (!during.note || b.some((x) => x.menu) || Math.max(...ticks) - Math.min(...ticks) > 24 || b[0].net.hashesChecked <= a0.net.hashesChecked) bad++;
    }
    // For good: the others give the seat to the AI and play on, and the player cut off is told.
    // Each side then plays on with the AI in the other's seats.
    await pages[n - 1].evaluate(`window.__app.online.handover({ seat: 0, at: 0, first: 0, tail: [] })`);
    await new Promise((r) => setTimeout(r, 2500));
    const forged = await pages[0].evaluate('({ menu: window.__app.menu.showing ?? null, taken: window.__app.current.sim.aiTaken })');
    console.log(` a false word that seat 0 has gone: ${JSON.stringify(forged)}`);
    if (forged.menu || forged.taken) bad++;
    await cut(n - 1, 30000);
    await new Promise((r) => setTimeout(r, 16000));
    const ends = await Promise.all([pages[0], pages[n - 1]].map((p) => p.evaluate('({ menu: window.__app.menu.showing ?? null, taken: window.__app.current.sim.aiTaken, tick: window.__app.current.sim.tick })')));
    console.log(` cut for good: ${JSON.stringify(ends)}`);
    if (ends.some((x) => x.menu || !x.taken)) bad++;
  }
  // Play it out: everyone sees the same result, then the room starts another match.
  if (WHOLE) {
    const watch = setInterval(async () => {
      const x = await Promise.all(pages.map((p) => p.evaluate(`(() => { const a = window.__app, g = a.current, s = g?.sim; return { menu: a.menu.showing ?? null, phase: s?.phase, games: s?.score.games, sets: s?.score.sets, tick: s?.tick, conf: a.net?.client.confirmed, over: a.net?.over, stalled: a.net?.stats.stalled }; })()`))).catch(() => null);
      if (x) console.log('  ', JSON.stringify(x));
    }, 30000);
    await Promise.all(pages.map((p) => p.waitForFunction("window.__app.menu.showing === 'results'", { timeout: 720000, polling: 500 })));
    clearInterval(watch);
    const ends = await Promise.all(pages.map((p) => p.evaluate(`(() => { const s = window.__app.current.sim.score; return JSON.stringify([s.winner, s.sets]); })()`)));
    console.log(` at the end: ${ends.join(' ')}, ${(Date.now() - t0) / 1000} s`);
    if (new Set(ends).size !== 1) bad++;
    if (FIND) await Promise.all(pages.map((p) => p.evaluate('window.__app.findMatch()')));
    else {
      await Promise.all(pages.map((p) => p.evaluate('window.__app.backToRoom()')));
      await host.waitForFunction("window.__app.menu.showing === 'lobby'", { timeout: 20000, polling: 200 });
      await host.evaluate('window.__app.hostStart()');
    }
    await Promise.all(pages.map((p) => p.waitForFunction('window.__app?.net && window.__app.current?.online && !window.__app.current.paused', { timeout: 180000, polling: 200 })));
    await new Promise((r) => setTimeout(r, 20000));
    const again = await Promise.all(pages.map((p) => p.evaluate(read)));
    for (const x of again) {
      console.log(` next match, seat ${x.seat}: tick ${x.tick}, menu ${x.menu}, hashes checked ${x.net?.hashesChecked}, stalled ${x.net?.stalled}`);
      if (!x.net || x.menu || !x.net.hashesChecked) bad++;
    }
  }
  for (const l of logs) if (l.length) { console.log(' console:', l.slice(0, 5).join(' | ')); bad += l.filter((x) => x.startsWith('pageerror')).length; }
  await Promise.all(pages.map((p) => p.close()));
}
await browser.close();
server.close();
console.log(bad ? `\n${bad} PROBLEMS` : '\nall clear');
process.exit(bad ? 1 : 0);
