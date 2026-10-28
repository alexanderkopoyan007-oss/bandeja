// Between points and games (Phase 8). The sim puts the players back in their places the instant a point's dead time
// ends; a broadcast cuts away there, so the picture dips (a quarter-second fade to near black and back) over that
// instant instead of showing four players jump. After a game or a set a score card shows the match so far while
// the next server sets up. It sits under the HUD's own calls and never covers the score bug.
import type { MatchSim, MatchEvent } from '../sim/match.ts';
import { PH_DEAD, E_GAME, E_SET } from '../sim/match.ts';

const CSS = `
#hud .dip { position: absolute; inset: 0; background: #05070a; opacity: 0; pointer-events: none; }
#hud .card { position: absolute; left: 50%; top: 62%; transform: translate(-50%, 8px); opacity: 0;
  transition: opacity .3s, transform .3s; padding: 12px 18px 12px; border-radius: 10px; background: var(--glass);
  border: 1px solid var(--edge); backdrop-filter: blur(10px); box-shadow: 0 10px 30px rgba(0,0,0,.4);
  font: 700 15px/1 var(--display); letter-spacing: .06em; color: #fff; min-width: 300px; }
#hud .card.on { opacity: 1; transform: translate(-50%, 0); }
#hud .card .head { font: 700 11px/1 var(--display); letter-spacing: .24em; text-transform: uppercase;
  color: var(--ball); margin-bottom: 10px; }
#hud .card .r { display: grid; grid-template-columns: 1fr repeat(var(--cols), 30px); align-items: center; height: 26px; }
#hud .card .r + .r { border-top: 1px solid rgba(255,255,255,.1); }
#hud .card .r span { text-align: center; color: #cfd6dc; }
#hud .card .r span.nm { text-align: left; color: #fff; padding-right: 14px; white-space: nowrap; text-transform: uppercase; }
#hud .card .r span.now { color: #111; background: var(--ball); border-radius: 4px; height: 20px; line-height: 21px; }
@media (prefers-reduced-motion: reduce) { #hud .card { transition: opacity .3s; transform: translate(-50%, 0); } }
:root.calm #hud .card { transition: opacity .3s; transform: translate(-50%, 0); }
`;

let styled = false;

/** Fade in this long before the players are put back, out this long after (s of sim time). */
const DIP_IN = 0.22;
const DIP_OUT = 0.3;
const DIP_PEAK = 0.85;
const CARD_SECS = 2.8;

export class Transitions {
  private readonly dip: HTMLElement;
  private readonly card: HTMLElement;
  private readonly names: [string, string];
  private wasDead = false;
  private liftAt = -1;
  private shown = -1;
  private seen = 0;
  /** A game or set ended: show the card once the next point is set up. */
  private cardDue = '';
  private cardUntil = 0;

  constructor(root: HTMLElement, names: [string, string]) {
    if (!styled) {
      styled = true;
      const st = document.createElement('style');
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    this.names = names;
    this.dip = el('div', 'dip');
    // Under everything else in the HUD's layer: calls stay readable through the dip.
    root.insertBefore(this.dip, root.firstChild);
    this.card = root.appendChild(el('div', 'card'));
    this.card.setAttribute('aria-hidden', 'true');
  }

  /** `team`: the human's team (or 0), whose row goes first. `now`: seconds. */
  update(sim: MatchSim, team: number, now: number): void {
    if (sim.eventSeq - this.seen > sim.events.length) this.seen = sim.eventSeq - sim.events.length;
    while (this.seen < sim.eventSeq) {
      const e = sim.events[this.seen % sim.events.length]!;
      this.seen++;
      if (e.seq >= 0) this.onEvent(e);
    }
    const dead = sim.phase === PH_DEAD;
    let a = 0;
    if (dead) {
      const rem = sim.phaseUntil - sim.time;
      if (rem < DIP_IN) a = DIP_PEAK * Math.min(1, (DIP_IN - rem) / DIP_IN);
    } else {
      if (this.wasDead) this.liftAt = sim.time;
      if (this.liftAt >= 0) {
        const t = sim.time - this.liftAt;
        a = t < DIP_OUT ? DIP_PEAK * (1 - t / DIP_OUT) : 0;
        if (t >= DIP_OUT) this.liftAt = -1;
        // The players are in their new places: the card for the game just won.
        if (this.cardDue && t >= DIP_OUT * 0.5) this.showCard(sim, team, now);
      }
    }
    this.wasDead = dead;
    const q = Math.round(a * 100);
    if (q !== this.shown) {
      this.shown = q;
      this.dip.style.opacity = String(q / 100);
    }
    if (this.cardUntil > 0 && now > this.cardUntil) {
      this.cardUntil = 0;
      this.card.classList.remove('on');
    }
  }

  private onEvent(e: MatchEvent): void {
    if (e.kind === E_SET) this.cardDue = 'Set';
    else if (e.kind === E_GAME && this.cardDue !== 'Set') this.cardDue = 'Game';
  }

  private showCard(sim: MatchSim, team: number, now: number): void {
    const kind = this.cardDue;
    this.cardDue = '';
    const sc = sim.score;
    const sets = sc.history.length;
    const order = team === 1 ? [1, 0] : [0, 1];
    // After a set: the sets so far. After a game: those and the set being played, highlighted.
    const live = kind !== 'Set';
    this.card.style.setProperty('--cols', String(sets + (live ? 1 : 0)));
    let h = `<div class="head">${live ? `Set ${sets + 1}` : `End of set ${sets}`}</div>`;
    for (const t of order) {
      h += `<div class="r"><span class="nm">${esc(this.names[t]!)}</span>`;
      for (let s = 0; s < sets; s++) h += `<span>${sc.history[s]![t]}</span>`;
      if (live) h += `<span class="now">${sc.games[t]}</span>`;
      h += '</div>';
    }
    this.card.innerHTML = h;
    this.card.classList.add('on');
    this.cardUntil = now + CARD_SECS;
  }
}

function el(tag: string, cls: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
