// Every menu screen walked with a scripted pad and nothing else (M7 phase F, the brief's "fast, controller-navigable"
// menus). From the title, on each screen:
//   - the d-pad reaches every item that isn't disabled, and wraps round;
//   - a choice or slider changes with d-pad right and comes back with left;
//   - every button is pressed with A. One that opens a screen is walked in turn (to DEPTH), then B must come back to the
//     same screen with the same item focused. One that would start a match only counts (`startMatch` is stubbed in
//     the page), so the walk never leaves the menus. The network is stubbed too (WebSocket, RTCPeerConnection), so the
//     online screens never reach the real rooms;
//   - an item a pad can't use (a text field needs a keyboard) is listed.
// The time from each press to the next screen drawn is measured (press -> two animation frames after the new title;
// headless Chrome paces frames, so this is an upper bound). Page errors fail the walk.
//   bash tools/one-chrome.sh node tools/menu-walk.mjs [url]   (the dev server: npx vite --port 5190; ?creator=1 for all)
//   DEPTH=3 (screens deep), REPEAT=2 (walks of one screen id before it is only checked for reach)
// M8 phase B: LAYOUT=1 also checks each screen's layout (text clipped or spilling out of its row, a side card taller
// than its column, which a pad can't scroll, anything off the screen); VIEW=1024x640 the window, TEXT=1.5 the
// text size and CONTRAST=1 the high-contrast panels (stored settings, as a player would have them).
import puppeteer from 'puppeteer-core';

const url = process.argv[2] ?? 'http://localhost:5190/?creator=1';
const DEPTH = Number(process.env.DEPTH ?? 3);
const REPEAT = Number(process.env.REPEAT ?? 2);
const LAYOUT = process.env.LAYOUT === '1';
const [VW, VH] = (process.env.VIEW ?? '1600x900').split('x').map(Number);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
const notes = [];
const problem = (where, what) => { problems.push(`${where}: ${what}`); console.log(`FAIL ${where}: ${what}`); };

let browser;
try {
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
    args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.setViewport({ width: VW, height: VH, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Requests to the game's own origin that fail (a file the build doesn't have: the clean build CI makes has no
  // MetaHuman packs, phase D of M8).
  const failed = [];
  page.on('response', (r) => { if (r.status() >= 400 && new URL(r.url()).origin === new URL(url).origin) failed.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  page.on('requestfailed', (r) => { if (new URL(r.url()).origin === new URL(url).origin) failed.push(`${r.failure()?.errorText ?? 'failed'} ${new URL(r.url()).pathname}`); });
  const stored = { ...(process.env.TEXT ? { textSize: Number(process.env.TEXT) } : {}), ...(process.env.CONTRAST === '1' ? { contrast: true } : {}) };
  await page.evaluateOnNewDocument((stored) => {
    try { localStorage.setItem('bandeja.settings.v1', JSON.stringify(stored)); } catch { /* none */ }
  }, stored);
  await page.evaluateOnNewDocument(() => {
    // The pad (as tools/pad-check.mjs): standard mapping, its timestamp moved on every change.
    const pad = { id: 'Scripted pad (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: performance.now(),
      axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })), vibrationActuator: null };
    window.__pressAt = 0;
    window.__padSet = (b, on) => { pad.buttons[b] = { pressed: on, touched: on, value: on ? 1 : 0 }; pad.timestamp = performance.now(); if (on) window.__pressAt = performance.now(); };
    window.__padAxis = (a, v) => { pad.axes[a] = v; pad.timestamp = performance.now(); };
    Object.defineProperty(navigator, 'getGamepads', { value: () => [pad, null, null, null], configurable: true });
    // Nothing leaves the page: no rooms, no peers, no windows. A socket fails as an offline one does (an error, then
    // closed), never by throwing.
    window.WebSocket = class extends EventTarget {
      constructor(url) {
        super();
        this.url = String(url); this.readyState = 0; this.onopen = null; this.onerror = null; this.onclose = null; this.onmessage = null;
        setTimeout(() => {
          this.readyState = 3;
          const err = new Event('error'), close = new CloseEvent('close', { code: 1006, wasClean: false });
          this.onerror?.(err); this.dispatchEvent(err); this.onclose?.(close); this.dispatchEvent(close);
        }, 50);
      }
      send() {}
      close() { this.readyState = 3; }
    };
    window.WebSocket.CONNECTING = 0; window.WebSocket.OPEN = 1; window.WebSocket.CLOSING = 2; window.WebSocket.CLOSED = 3;
    window.RTCPeerConnection = class { constructor() { throw new Error('menu walk: no peers'); } };
    window.open = () => null;
    // Long tasks (the page busy over 50 ms: a pad tap shorter than one is never seen), by the screen they came on.
    window.__long = [];
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) window.__long.push({ ms: e.duration, title: window.__app?.menu?.current?.title ?? '' });
      }).observe({ type: 'longtask', buffered: true });
    } catch { /* (no long task timing) */ }
    // The time from a press to the frame after the next screen's title appears.
    window.__lat = [];
    window.__lastTitle = '';
    addEventListener('DOMContentLoaded', () => {
      new MutationObserver(() => {
        const t = document.getElementById('menu-title')?.textContent ?? '';
        if (t === window.__lastTitle || !window.__pressAt) return;
        const from = window.__lastTitle;
        window.__lastTitle = t;
        const t0 = window.__pressAt;
        requestAnimationFrame(() => requestAnimationFrame(() => window.__lat.push({ title: t, from, ms: performance.now() - t0 })));
      }).observe(document.body, { childList: true, subtree: true });
    });
  });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__app?.menu?.isOpen && window.__bandeja?.running && !window.__app.busy, { timeout: 180000, polling: 200 });
  await sleep(800);
  // Matches and online play only counted: the button pressed, where. (Going online is the online e2e's to check:
  // tools/net/online-e2e.mjs, with the rooms' server.)
  await page.evaluate(() => {
    window.__starts = [];
    const app = window.__app;
    const count = () => { window.__starts.push(app.menu.current?.title ?? '?'); };
    app.startMatch = async function () { count(); };
    app.findMatch = count;
    app.connect = count;
  });

  const press = async (b, hold = 80) => {
    await page.evaluate((x) => window.__padSet(x, true), b);
    await sleep(hold);
    await page.evaluate((x) => window.__padSet(x, false), b);
    await sleep(110);
  };
  const A = 0, B = 1, UP = 12, DOWN = 13, LEFT = 14, RIGHT = 15;
  const info = () => page.evaluate(() => {
    const m = window.__app.menu;
    const cur = m.current;
    return {
      open: m.isOpen, id: cur?.id ?? null, title: cur?.title ?? '', focus: m.focusIdx, back: cur && cur.back === null ? null : 1, depth: m.depth,
      items: m.items.map((it, i) => ({ i, label: it.label, kind: it.kind, disabled: !!it.disabled?.(),
        value: it.kind === 'choice' || it.kind === 'slider' || it.kind === 'text' ? String(it.get?.() ?? '') : '' })),
      starts: window.__starts.length, busy: window.__app.busy,
    };
  });
  /** Wait until the screen is another (or `ms` passes); returns the new info. */
  const settle = async (before, ms = 1500) => {
    const t0 = Date.now();
    let s = await info();
    while (Date.now() - t0 < ms) {
      if (s.id !== before.id || s.title !== before.title || s.starts !== before.starts || !s.open) break;
      await sleep(60);
      s = await info();
    }
    // (a screen that builds something, the turntable, can be busy for a moment)
    while (s.busy && Date.now() - t0 < 15000) { await sleep(100); s = await info(); }
    return s;
  };
  const focusTo = async (i) => {
    for (let k = 0; k < 80; k++) {
      const s = await info();
      if (s.focus === i) return true;
      await press(s.focus < i ? DOWN : UP);
    }
    return false;
  };

  const walked = new Map();
  let screens = 0, pressed = 0;
  const same = (a, b) => a.id === b.id && a.title === b.title;
  const named = (stack) => stack.map((x) => x.title || x.id).join(' > ');
  /**
   * Back down to the last screen of `stack` (screens from the title, each with `via`: the label pressed on the one
   * above): from whichever of them the menu is on (the deepest), pressing the labels again. False if it can't.
   */
  async function reenter(stack) {
    let s = await info();
    let j = -1;
    for (let k = stack.length - 1; k >= 0; k--) if (same(stack[k], s)) { j = k; break; }
    if (j < 0) {
      await page.evaluate(() => window.__app.menu.open(window.__app.titleScreen(), true));
      await sleep(300);
      j = 0;
    }
    for (let k = j + 1; k < stack.length; k++) {
      const cur = await info();
      const it = cur.items.find((x) => x.label === stack[k].via && !x.disabled);
      if (!it || !(await focusTo(it.i))) return false;
      const before = await info();
      await press(A);
      const after = await settle(before);
      if (!same(after, stack[k])) return false;
    }
    return true;
  }
  /**
   * The way down to a screen is another now (the walk changed what a button opens: a draw made, a career begun):
   * noted, and the walk goes on from the title's next item. Only failing to get back to the title is a fault.
   */
  async function changed(stack, where) {
    notes.push(`${where}: the way here changed in the walk (the rest of it not walked)`);
    const ok = await reenter(stack.slice(0, 1));
    if (!ok) problem(where, 'can\'t get back to the title');
    return ok;
  }
  /** What doesn't fit on this screen (LAYOUT=1). */
  const layoutSeen = new Set();
  async function layout(where) {
    const found = await page.evaluate(() => {
      const out = [];
      const root = document.querySelector('#menu.on');
      if (!root) return out;
      const vw = innerWidth, vh = innerHeight;
      const shown = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
      const t = (el) => JSON.stringify((el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 48));
      // (inside a container that scrolls, what is out of sight is reached by scrolling: the list by moving the focus,
      // a side card by the right stick or Page Up/Down; the container itself must be on the screen)
      const scroller = (el) => {
        for (let a = el.parentElement; a && a !== root; a = a.parentElement) {
          const o = getComputedStyle(a).overflowY;
          if ((o === 'auto' || o === 'scroll') && a.scrollHeight > a.clientHeight + 2) return a;
        }
        return null;
      };
      for (const el of root.querySelectorAll('h1, .sub, .list, .side, .item, .item .lab, .item .v, .desc, .card, .card h2, .card td, .card p, .foot, .foot span')) {
        if (!shown(el)) continue;
        const cs = getComputedStyle(el);
        if (cs.overflowX !== 'visible' && el.scrollWidth > el.clientWidth + 1) out.push(`clipped ${t(el)} (${el.scrollWidth} in ${el.clientWidth} px)`);
        const r = el.getBoundingClientRect();
        if (r.width > 0 && !scroller(el) && (r.right > vw + 1 || r.left < -1 || r.bottom > vh + 1 || r.top < -1)) out.push(`off the screen ${t(el)}`);
      }
      for (const it of root.querySelectorAll('.item')) {
        if (!shown(it)) continue;
        const r = it.getBoundingClientRect();
        for (const c of it.querySelectorAll('.lab, .val')) {
          const q = c.getBoundingClientRect();
          if (q.width > 0 && (q.right > r.right + 1 || q.left < r.left - 1)) out.push(`spills out of its row ${t(c)} in ${t(it.querySelector('.lab') ?? it)}`);
        }
        const lab = it.querySelector('.lab'), val = it.querySelector('.val');
        if (lab && val && shown(lab) && shown(val) && lab.getBoundingClientRect().right > val.getBoundingClientRect().left + 1) out.push(`label under its value ${t(lab)}`);
      }
      const side = root.querySelector('.side');
      // A side card taller than its column must say so (its foot faded, the footer's Scroll the card).
      if (side && shown(side) && side.scrollHeight > side.clientHeight + 2 && side.scrollTop === 0
        && (!side.classList.contains('more') || !/Scroll the card/.test(root.querySelector('.foot')?.textContent ?? ''))) out.push(`side card taller than its column (${side.scrollHeight} in ${side.clientHeight} px), not marked as scrolling`);
      const panel = root.querySelector('.panel');
      if (side && panel && shown(side) && side.getBoundingClientRect().width > 0 && panel.getBoundingClientRect().right > side.getBoundingClientRect().left + 1) out.push('the list runs under the side card');
      const desc = root.querySelector('.desc');
      if (desc && panel && shown(desc) && desc.getBoundingClientRect().bottom > panel.getBoundingClientRect().bottom + 1) out.push(`the description runs past the panel ${t(desc)}`);
      return out;
    });
    // A tall side card: the right stick takes it to its end and back.
    const tall = await page.evaluate(() => { const s = document.querySelector('#menu.on .side'); return !!s && s.getClientRects().length > 0 && s.scrollHeight > s.clientHeight + 2; });
    if (tall) {
      await page.evaluate(() => window.__padAxis(3, 1));
      await sleep(900);
      await page.evaluate(() => window.__padAxis(3, 0));
      const end = await page.evaluate(() => { const s = document.querySelector('#menu.on .side'); return s.scrollTop + s.clientHeight >= s.scrollHeight - 2 && !s.classList.contains('more'); });
      await page.evaluate(() => window.__padAxis(3, -1));
      await sleep(900);
      await page.evaluate(() => window.__padAxis(3, 0));
      const top = await page.evaluate(() => document.querySelector('#menu.on .side').scrollTop === 0);
      if (!end || !top) found.push(`the right stick doesn't scroll the side card to its end and back (end ${end}, top ${top})`);
    }
    for (const f of found) {
      const key = `${where.split(' > ').at(-1)}: ${f}`;
      if (layoutSeen.has(key)) continue;
      layoutSeen.add(key);
      problem(where, f);
    }
  }
  async function walk(stack, depth) {
    const s = await info();
    const where = named(stack);
    screens++;
    if (LAYOUT) await layout(where);
    // Reach: down through the list and round, every enabled item met.
    const enabled = s.items.filter((it) => !it.disabled).map((it) => it.i);
    const met = new Set([s.focus]);
    for (let k = 0; k < s.items.length + 1; k++) {
      await press(DOWN);
      met.add((await info()).focus);
      // (each item's description, as it is shown on focus)
      if (LAYOUT) {
        const d = await page.evaluate(() => {
          const panel = document.querySelector('#menu.on .panel'), desc = document.querySelector('#menu.on .desc');
          return desc && panel && desc.getBoundingClientRect().bottom > panel.getBoundingClientRect().bottom + 1
            ? `the description runs past the panel ${JSON.stringify(desc.textContent.trim().slice(0, 48))}` : '';
        });
        const key = `${where.split(' > ').at(-1)}: ${d}`;
        if (d && !layoutSeen.has(key)) { layoutSeen.add(key); problem(where, d); }
      }
    }
    const missed = enabled.filter((i) => !met.has(i));
    if (missed.length) problem(where, `the d-pad never reaches ${missed.length} of ${enabled.length} items (${missed.slice(0, 4).map((i) => `"${s.items[i].label}"`).join(', ')}${missed.length > 4 ? ', ...' : ''})`);
    const n = (walked.get(s.id) ?? 0) + 1;
    walked.set(s.id, n);
    if (n > REPEAT) return true;
    for (const it of s.items) {
      if (it.disabled) continue;
      let now = await info();
      if (!same(now, s)) {
        problem(where, `left the screen by itself (now ${now.title})`);
        if (!(await reenter(stack))) return false;
        now = await info();
      }
      const cur = now.items.find((x) => x.label === it.label && x.kind === it.kind);
      if (!cur || cur.disabled) continue;
      if (!(await focusTo(cur.i))) { problem(where, `can't focus "${it.label}"`); continue; }
      if (it.kind === 'choice' || it.kind === 'slider') {
        await press(RIGHT);
        let a = await info();
        const fa = a.items[a.focus];
        if (fa?.label !== it.label) {
          problem(where, `the focus moves off "${it.label}" as it changes (onto "${fa?.label}")`);
          const back = a.items.find((x) => x.label === it.label);
          if (!back || !(await focusTo(back.i))) continue;
        }
        a = await info();
        const va = a.items.find((x) => x.label === it.label)?.value;
        await press(LEFT);
        const vb = (await info()).items.find((x) => x.label === it.label)?.value;
        if (va === cur.value) {
          // A one-option choice, or a slider at its top: the other way.
          await press(LEFT);
          const vc = (await info()).items.find((x) => x.label === it.label)?.value;
          if (vc === cur.value) notes.push(`${where}: "${it.label}" doesn't change`);
          else await press(RIGHT);
        } else if (vb !== cur.value) problem(where, `"${it.label}" doesn't come back with left (${cur.value} -> ${va} -> ${vb})`);
        continue;
      }
      if (it.kind === 'key') continue;
      if (it.kind === 'text') { notes.push(`${where}: "${it.label}" needs a keyboard`); continue; }
      // A button.
      const before = await info();
      await press(A);
      pressed++;
      const after = await settle(before);
      if (after.starts > before.starts) { notes.push(`${where}: "${it.label}" starts a match or goes online`); continue; }
      if (!after.open) {
        problem(where, `"${it.label}" closed the menus`);
        if (!(await reenter(stack))) return false;
        continue;
      }
      if (same(after, before)) continue;
      const up = stack.slice(0, -1).findLastIndex((x) => same(x, after));
      if (up >= 0 || after.depth < before.depth) {
        // A button that goes back (Back, Cancel, Done; or back and onto a fresh screen: a draw dropped): then down here
        // again.
        notes.push(`${where}: "${it.label}" goes back to ${after.title || after.id}`);
        if (!(await reenter(stack))) return changed(stack, where);
        continue;
      }
      if (after.depth === before.depth) {
        // This screen replaced by another (a setup done: the draw made, the career begun). Walk that one in its place;
        // B from it goes where B from this one went.
        notes.push(`${where}: "${it.label}" makes this screen ${after.title || after.id}`);
        const instead = [...stack.slice(0, -1), { id: after.id, title: after.title, via: '' }];
        if (depth < DEPTH) await walk(instead, depth);
        const there = await info();
        if (same(there, after) && stack.length > 1) {
          await press(B);
          const back = await settle(there);
          if (!same(back, stack[stack.length - 2])) problem(named(instead), `B doesn't come back to ${stack[stack.length - 2].title} (now ${back.title || back.id})`);
        }
        if (!(await reenter(stack))) return changed(stack, where);
        continue;
      }
      // Another screen: walk it, then B back.
      const inner = [...stack, { id: after.id, title: after.title, via: it.label }];
      if (depth < DEPTH) await walk(inner, depth + 1);
      // (its walk can end elsewhere: on it again first)
      if (!(await reenter(inner))) {
        notes.push(`${named(inner)}: the way back to it changed in its walk; B from it not checked`);
        if (!(await reenter(stack))) return changed(stack, where);
        continue;
      }
      const there = await info();
      await press(B);
      const back = await settle(there);
      if (!same(back, s)) {
        const at = stack.slice(0, -1).findLastIndex((x) => same(x, back));
        if (there.back === null && same(back, there)) notes.push(`${named(inner)}: no B (its own choices)`);
        else problem(named(inner), `B doesn't come back here (now ${back.title || back.id}${at >= 0 ? ', further up' : ''})`);
        if (!(await reenter(stack))) return changed(stack, where);
      } else if (back.items[back.focus]?.label !== it.label) {
        problem(where, `back from "${it.label}" the focus is on "${back.items[back.focus]?.label}"`);
      }
    }
    return true;
  }
  const t0 = await info();
  await walk([{ id: t0.id, title: t0.title, via: '' }], 0);

  const lat = await page.evaluate(() => window.__lat);
  const ms = lat.map((l) => l.ms).sort((a, b) => a - b);
  const q = (p) => (ms.length ? ms[Math.min(ms.length - 1, Math.floor(p * ms.length))].toFixed(0) : '-');
  console.log(`\n${screens} screens, ${pressed} buttons pressed, ${(await page.evaluate(() => window.__starts.length))} match starts counted`);
  console.log(`press -> next screen drawn: p50 ${q(0.5)} ms, p90 ${q(0.9)} ms, max ${q(1)} ms over ${ms.length} screen changes`);
  const slow = lat.filter((l) => l.ms > 200).map((l) => `${l.from} -> ${l.title} ${l.ms.toFixed(0)} ms`);
  if (slow.length) console.log(`slower than 200 ms: ${slow.slice(0, 12).join(', ')}`);
  const long = await page.evaluate(() => window.__long);
  const byScreen = new Map();
  for (const l of long) { const w = byScreen.get(l.title) ?? { n: 0, over200: 0, max: 0 }; w.n++; if (l.ms > 200) w.over200++; w.max = Math.max(w.max, l.ms); byScreen.set(l.title, w); }
  const worst = [...byScreen].sort((a, b) => b[1].max - a[1].max).slice(0, 10);
  console.log(`long tasks (page busy > 50 ms) by screen: ${worst.map(([t, w]) => `${t || '(none)'} ${w.n}× max ${w.max.toFixed(0)} ms${w.over200 ? `, ${w.over200} over 200` : ''}`).join('; ')}`);
  if (notes.length) console.log(`\nnotes:\n  ${notes.join('\n  ')}`);
  if (errors.length) problem('page', errors.slice(0, 5).join(' / '));
  if (failed.length) problem('requests', [...new Set(failed)].slice(0, 8).join(', '));
} catch (e) {
  problem('walk', String(e?.stack ?? e).slice(0, 500));
} finally {
  await browser?.close();
}
console.log(problems.length ? `\nFAIL (${problems.length})` : '\nPASS');
process.exit(problems.length ? 1 : 0);
