// A generic broadcast graphics package (Phase 5, `?gfx=tv`): the score bug in the pairs' shirt colours with the
// server's ball, a situation tag that slides out of it (break, set and match point, star and golden point,
// tie-break), a radar-gun readout for serves and smashes, a lower third after each point (how it was won and how
// long the rally was), the scoreboard after each game, and a stats panel at the change of ends. No real event's
// names, logos or branding. Off by default until the owner has seen it (the old bug stays the default).
import type { MatchSim, MatchEvent } from '../sim/match.ts';
import { E_HIT, E_POINT, E_GAME, E_SET, E_MATCH, E_ENDS, E_FAULT } from '../sim/match.ts';
import {
  REASON_TEXT, WHY_DOUBLE_BOUNCE, WHY_EXIT_AFTER_BOUNCE, WHY_HIT_BODY_OPP, WHY_OWN_SIDE,
  WHY_WALL_BEFORE_BOUNCE, WHY_OWN_MESH, WHY_OUT, WHY_HIT_BODY_OWN,
} from '../sim/rules/rally.ts';
import { Score, EV_GAME, EV_SET, EV_MATCH, MODE_STAR, MODE_GOLDEN } from '../sim/rules/score.ts';
import { SHOT_SERVE, SHOT_SMASH, SHOT_KEYS } from '../sim/contact/shots.ts';

const CSS = `
#hud .tv { --tv-ink: #f4f6fa; --tv-dim: #a9b3c4; --tv-bg: rgba(11,17,38,.9); --tv-bg2: rgba(20,29,61,.92); --tv-gold: #f2c14e;
  --tv-font: "Avenir Next Condensed", "DIN Condensed", "Roboto Condensed", "Arial Narrow", system-ui, sans-serif;
  position: absolute; inset: 0; pointer-events: none; font-family: var(--tv-font); color: var(--tv-ink); }
#hud.tvmode .bug, #hud.tvmode .call:not(.big) { display: none; }
#hud.tvmode .help:not(.shown) { display: none; }
#hud .tv .tvbug { position: absolute; left: 3.2vw; top: 3.4vh; display: flex; align-items: stretch; filter: drop-shadow(0 4px 14px rgba(0,0,0,.45)); }
#hud .tv .tvbug .tvlogo { width: 46px; background: linear-gradient(160deg, #1d2b63, #0b1126); display: grid; place-items: center;
  border-radius: 6px 0 0 6px; font: 800 11px/1.05 var(--tv-font); letter-spacing: .08em; text-align: center; color: var(--tv-gold); }
#hud .tv .tvrows { background: var(--tv-bg); border-radius: 0 6px 6px 0; overflow: hidden; }
#hud .tv .tvrow { display: grid; grid-template-columns: 5px 18px var(--tvname, 236px) repeat(var(--sets), 26px) 30px 46px; align-items: center;
  height: 30px; font: 700 17px/1 var(--tv-font); letter-spacing: .04em; }
#hud .tv .tvrow + .tvrow { border-top: 1px solid rgba(255,255,255,.07); }
#hud .tv .tvrow .chip { height: 100%; }
#hud .tv .tvrow .srv { width: 8px; height: 8px; border-radius: 50%; margin-left: 6px; background: #d9ec3c; opacity: 0;
  box-shadow: 0 0 6px rgba(217,236,60,.8); transition: opacity .3s; }
#hud .tv .tvrow .srv.on { opacity: 1; }
#hud .tv .tvrow .nm { text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: 8px; }
#hud .tv .tvrow .st { text-align: center; color: var(--tv-dim); font-weight: 600; }
#hud .tv .tvrow .st.won { color: var(--tv-ink); }
#hud .tv .tvrow .gm { text-align: center; background: var(--tv-bg2); height: 100%; display: grid; place-items: center; }
#hud .tv .tvrow .pt { text-align: center; background: var(--tv-ink); color: #0b1126; height: 100%; display: grid; place-items: center;
  font-weight: 800; transition: background .25s; }
#hud .tv .tvrow .pt.flash { background: var(--tv-gold); }
#hud .tv .tvtag { align-self: center; margin-left: 6px; padding: 7px 12px 6px; border-radius: 4px; background: var(--tv-gold); color: #0b1126;
  font: 800 14px/1 var(--tv-font); letter-spacing: .12em; text-transform: uppercase; clip-path: inset(0 100% 0 0);
  transition: clip-path .35s cubic-bezier(.2,.8,.2,1); }
#hud .tv .tvtag.on { clip-path: inset(0 0 0 0); }
/* Radar gun: serve and smash speeds, bottom right. */
#hud .tv .tvspeed { position: absolute; right: 3.2vw; bottom: 9vh; display: flex; align-items: stretch; border-radius: 6px; overflow: hidden;
  filter: drop-shadow(0 4px 14px rgba(0,0,0,.45)); clip-path: inset(0 0 0 100%); transition: clip-path .35s cubic-bezier(.2,.8,.2,1); }
#hud .tv .tvspeed.on { clip-path: inset(0 0 0 0); }
#hud .tv .tvspeed .k { background: var(--tv-bg2); padding: 9px 12px 8px; font: 700 13px/1 var(--tv-font); letter-spacing: .14em;
  text-transform: uppercase; color: var(--tv-dim); display: grid; place-items: center; }
#hud .tv .tvspeed .v { background: var(--tv-bg); padding: 6px 12px 5px; font: 800 26px/1 var(--tv-font); }
#hud .tv .tvspeed .v small { font-size: 13px; color: var(--tv-dim); margin-left: 4px; letter-spacing: .08em; }
/* Lower third. */
#hud .tv .tvl3 { position: absolute; left: 3.2vw; bottom: 9vh; min-width: 360px; filter: drop-shadow(0 6px 18px rgba(0,0,0,.5));
  clip-path: inset(0 100% 0 0); transition: clip-path .45s cubic-bezier(.2,.8,.2,1); }
#hud .tv .tvl3.on { clip-path: inset(0 0 0 0); }
#hud .tv .tvl3 .h { display: flex; align-items: center; gap: 10px; background: var(--tv-bg); padding: 10px 16px 9px;
  border-left: 5px solid var(--acc, var(--tv-gold)); font: 800 22px/1 var(--tv-font); letter-spacing: .05em; text-transform: uppercase; }
#hud .tv .tvl3 .s { background: var(--tv-bg2); padding: 8px 16px 7px 21px; font: 600 14px/1 var(--tv-font); letter-spacing: .12em;
  text-transform: uppercase; color: var(--tv-dim); }
#hud .tv .tvl3 table { border-collapse: collapse; width: 100%; background: var(--tv-bg2); font: 700 16px/1 var(--tv-font); letter-spacing: .05em; }
#hud .tv .tvl3 td { padding: 7px 12px 6px; text-align: center; border-top: 1px solid rgba(255,255,255,.06); }
#hud .tv .tvl3 td.l { text-align: left; color: var(--tv-dim); text-transform: uppercase; letter-spacing: .1em; font-size: 13px; }
#hud .tv .tvl3 td.n { text-align: left; text-transform: uppercase; }
#hud .tv .tvl3 td.won { color: var(--tv-gold); }
@media (prefers-reduced-motion: reduce) { #hud .tv * { transition: none !important; } }
`;

const MS_TO_KMH = 3.6;

function el(tag: string, cls: string, parent?: HTMLElement): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  if (parent) parent.appendChild(e);
  return e;
}

interface TeamStats { points: number; winners: number; errors: number; doubleFaults: number; fastest: number; servePts: number; serveWon: number }

export class TvGraphics {
  private readonly root: HTMLElement;
  private readonly rows: HTMLElement[][] = [];
  private readonly tag: HTMLElement;
  private readonly speed: HTMLElement;
  private readonly speedK: HTMLElement;
  private readonly speedV: HTMLElement;
  private readonly l3: HTMLElement;
  private readonly names: [string, string];
  private readonly colors: [string, string];
  private readonly stats: [TeamStats, TeamStats];
  private readonly scratch: Score;
  private readonly state: number[] = [];
  private seen = 0;
  private lastKey = '';
  private speedUntil = 0;
  private l3Until = 0;
  private l3Queue: Array<{ html: string; acc: string; secs: number; passing?: boolean }> = [];
  private longest = 0;
  private readonly cache = new Map<HTMLElement, string>();

  constructor(hud: HTMLElement, names: [string, string], colors: [string, string], sets: number, sim: MatchSim) {
    hud.classList.add('tvmode');
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.names = names;
    this.colors = colors;
    this.root = el('div', 'tv', hud);
    const bug = el('div', 'tvbug', this.root);
    const logo = el('div', 'tvlogo', bug);
    logo.innerHTML = 'BDJ<br>OPEN';
    const rows = el('div', 'tvrows', bug);
    rows.style.setProperty('--sets', String(sets));
    for (let t = 0; t < 2; t++) {
      const r = el('div', 'tvrow', rows);
      const chip = el('span', 'chip', r);
      chip.style.background = colors[t]!;
      const cells = [chip, el('span', 'srv', r), el('span', 'nm', r)];
      cells[2]!.textContent = names[t]!;
      for (let s = 0; s < sets; s++) cells.push(el('span', 'st', r));
      cells.push(el('span', 'gm', r), el('span', 'pt', r));
      this.rows.push(cells);
    }
    this.tag = el('div', 'tvtag', bug);
    this.speed = el('div', 'tvspeed', this.root);
    this.speedK = el('div', 'k', this.speed);
    this.speedV = el('div', 'v', this.speed);
    this.l3 = el('div', 'tvl3', this.root);
    const z = (): TeamStats => ({ points: 0, winners: 0, errors: 0, doubleFaults: 0, fastest: 0, servePts: 0, serveWon: 0 });
    this.stats = [z(), z()];
    this.scratch = new Score(sim.score.format, 0, sim.doubles);
  }

  private set(e: HTMLElement, text: string): void {
    if (this.cache.get(e) === text) return;
    this.cache.set(e, text);
    e.textContent = text;
  }

  /** What the next point would decide for `team` (EV_* flags), on a copy of the score. */
  private stakes(sim: MatchSim, team: number): number {
    this.state.length = 0;
    sim.score.writeState(this.state);
    this.scratch.readState(this.state);
    return this.scratch.pointWon(team);
  }

  private situation(sim: MatchSim): string {
    const sc = sim.score;
    if (sc.winner >= 0) return '';
    const srv = sc.serverTeam(), rcv = 1 - srv;
    const a = this.stakes(sim, srv), b = this.stakes(sim, rcv);
    if ((a | b) & EV_MATCH) return 'Match point';
    if ((a | b) & EV_SET) return 'Set point';
    if (b & EV_GAME) return sc.isDecidingPoint() ? (sc.format.mode === MODE_STAR ? 'Star point' : 'Golden point') : 'Break point';
    if (sc.isDecidingPoint()) return sc.format.mode === MODE_STAR ? 'Star point' : sc.format.mode === MODE_GOLDEN ? 'Golden point' : '';
    if (sc.tiebreak) return 'Tie-break';
    return '';
  }

  /** `now`: the match's clock (s), so the graphics keep pace with a match stepped faster than real time. */
  update(sim: MatchSim): void {
    const now = sim.time;
    const sc = sim.score;
    const pts = sc.display();
    const server = sc.serverTeam();
    const key = `${sc.points[0]},${sc.points[1]},${sc.games[0]},${sc.games[1]},${sc.history.length},${sc.winner}`;
    for (let t = 0; t < 2; t++) {
      const c = this.rows[t]!;
      c[1]!.className = server === t && sc.winner < 0 ? 'srv on' : 'srv';
      const nSets = c.length - 5;
      for (let s = 0; s < nSets; s++) {
        const h = sc.history[s];
        this.set(c[3 + s]!, h ? String(h[t]) : '');
        c[3 + s]!.className = h && h[t]! > h[1 - t]! ? 'st won' : 'st';
      }
      this.set(c[c.length - 2]!, String(sc.games[t]));
      // Deuce and star-point text is long: the point cells read 40-40 and the tag says the rest.
      const deuceLike = (x: string): boolean => /^(Deuce|Star|Golden)/.test(x);
      let p = pts[t]!;
      const o = pts[1 - t]!;
      if (deuceLike(p) || deuceLike(o)) p = '40';
      else if (p.startsWith('AD')) p = 'AD';
      else if (!p && o.startsWith('AD')) p = '40';
      this.set(c[c.length - 1]!, p);
    }
    if (key !== this.lastKey) {
      this.lastKey = key;
      const s = this.situation(sim);
      const deuce = /^Deuce \d/.test(pts[0]!) ? pts[0]! : '';
      const txt = s || deuce;
      if (txt) this.set(this.tag, txt);
      this.tag.classList.toggle('on', !!txt);
    }

    while (this.seen < sim.eventSeq) {
      const e = sim.events[this.seen % sim.events.length]!;
      this.seen++;
      if (e.seq < 0) continue;
      this.onEvent(sim, e, now);
    }
    if (now > this.speedUntil) this.speed.classList.remove('on');
    if (now > this.l3Until) {
      const next = this.l3Queue.shift();
      if (next) {
        this.l3.innerHTML = next.html;
        this.l3.style.setProperty('--acc', next.acc);
        this.l3.classList.add('on');
        this.l3Until = now + next.secs;
      } else this.l3.classList.remove('on');
    }
  }

  private onEvent(sim: MatchSim, e: MatchEvent, now: number): void {
    if (e.kind === E_HIT && (e.a === SHOT_SERVE || e.a === SHOT_SMASH)) {
      const kmh = e.c * MS_TO_KMH;
      if (kmh > 40) {
        this.speedK.textContent = SHOT_KEYS[e.a]!;
        this.speedV.innerHTML = `${Math.round(kmh)}<small>KM/H</small>`;
        this.speed.classList.add('on');
        this.speedUntil = now + 2.6;
        if (e.a === SHOT_SMASH) this.stats[e.team]!.fastest = Math.max(this.stats[e.team]!.fastest, kmh);
      }
    } else if (e.kind === E_FAULT && e.a !== 14) {
      // A first-serve fault; the second is a double fault, which ends the point with no E_POINT of its own.
      if (e.b === 1) this.queue({ html: `<div class="h">Fault</div><div class="s">${esc(REASON_TEXT[e.a]?.replace(/^Fault: /, '') ?? '')} · Second serve</div>`, acc: '#e8e8e8', secs: 2 }, true);
      else {
        const srv = e.team;
        this.stats[srv]!.doubleFaults++;
        this.pointWon(sim, 1 - srv, 'Double fault');
      }
    } else if (e.kind === E_POINT) {
      const w = e.team, l = 1 - w, why = e.a;
      const shots = sim.rally.shots;
      const hitter = sim.rally.hitter;
      let head: string;
      if ((why === WHY_DOUBLE_BOUNCE || why === WHY_EXIT_AFTER_BOUNCE || why === WHY_HIT_BODY_OPP) && hitter === w) {
        this.stats[w]!.winners++;
        head = why === WHY_EXIT_AFTER_BOUNCE ? 'Out of the court' : shots <= 1 ? 'Ace' : 'Winner';
      } else if ((why === WHY_OWN_SIDE || why === WHY_WALL_BEFORE_BOUNCE || why === WHY_OWN_MESH || why === WHY_OUT || why === WHY_HIT_BODY_OWN) && hitter === l) {
        this.stats[l]!.errors++;
        head = 'Error · ' + (REASON_TEXT[why] ?? '');
      } else head = REASON_TEXT[why] ?? 'Point';
      this.pointWon(sim, w, head);
    } else if (e.kind === E_GAME || e.kind === E_SET || e.kind === E_MATCH) {
      this.queue({ html: this.board(sim, e.kind === E_MATCH ? 'Match' : e.kind === E_SET ? 'Set' : 'Game'), acc: this.colors[e.team]!, secs: 4.5 });
    } else if (e.kind === E_ENDS) {
      this.queue({ html: this.statsPanel(), acc: 'var(--tv-gold)', secs: 6 });
    }
  }

  /** A point to pair `w`: the stats and its strap. Points end in an E_POINT, or in a double fault (E_FAULT b=2). */
  private pointWon(sim: MatchSim, w: number, head: string): void {
    this.stats[w]!.points++;
    const srv = sim.score.serverTeam();
    this.stats[srv]!.servePts++;
    if (w === srv) this.stats[srv]!.serveWon++;
    const shots = sim.rally.shots;
    this.longest = Math.max(this.longest, shots);
    const sub = shots > 1 ? `Rally · ${shots} shots` : '';
    this.queue({
      html: `<div class="h">${esc(head)}<span style="color:var(--tv-dim);font-size:15px;letter-spacing:.1em">${esc(this.names[w]!)}</span></div>` +
        (sub ? `<div class="s">${esc(sub)}</div>` : ''),
      acc: this.colors[w]!, secs: 2.6,
    }, true);
  }

  /** Queue a strap; a passing one (a point, a fault) replaces any passing one still waiting, so they never pile up. */
  private queue(item: { html: string; acc: string; secs: number; passing?: boolean }, passing = false): void {
    item.passing = passing;
    if (passing) this.l3Queue = this.l3Queue.filter((q) => !q.passing);
    this.l3Queue.push(item);
  }

  private board(sim: MatchSim, what: string): string {
    const sc = sim.score;
    const rows = [0, 1].map((t) => {
      const sets = sc.history.map((h) => `<td class="${h[t]! > h[1 - t]! ? 'won' : ''}">${h[t]}</td>`).join('');
      const live = sc.winner < 0 ? `<td>${sc.games[t]}</td>` : '';
      return `<tr><td class="n"><span style="display:inline-block;width:10px;height:10px;margin-right:8px;background:${this.colors[t]}"></span>${esc(this.names[t]!)}</td>${sets}${live}</tr>`;
    }).join('');
    return `<div class="h">${what}</div><table>${rows}</table>`;
  }

  private statsPanel(): string {
    const [a, b] = this.stats;
    const pct = (s: TeamStats): string => (s.servePts ? `${Math.round((100 * s.serveWon) / s.servePts)}%` : '–');
    const line = (label: string, x: string | number, y: string | number): string => `<tr><td>${x}</td><td class="l">${label}</td><td>${y}</td></tr>`;
    return `<div class="h">Change of ends · Match stats</div><table>` +
      `<tr><td class="n" style="color:${this.colors[0]}">${esc(this.names[0])}</td><td></td><td class="n" style="color:${this.colors[1]};text-align:right">${esc(this.names[1])}</td></tr>` +
      line('Points won', a.points, b.points) + line('Winners', a.winners, b.winners) + line('Errors', a.errors, b.errors) +
      line('Double faults', a.doubleFaults, b.doubleFaults) + line('Won on serve', pct(a), pct(b)) +
      line('Fastest smash', a.fastest ? `${Math.round(a.fastest)} km/h` : '–', b.fastest ? `${Math.round(b.fastest)} km/h` : '–') +
      `</table><div class="s">Longest rally · ${this.longest} shots</div>`;
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
