// Broadcast-style score bug, timing grade, calls and the optional timing meter (DOM overlay).
// Text only changes when the underlying value changes, so the HUD costs nothing per frame.
import type { MatchSim, MatchEvent } from '../sim/match.ts';
import {
  E_HIT, E_SWING, E_WHIFF, E_POINT, E_FAULT, E_LET, E_GAME, E_SET, E_MATCH, E_ENDS, PH_TOSS, PH_RALLY, PH_SETUP,
} from '../sim/match.ts';
import { REASON_TEXT } from '../sim/rules/rally.ts';
import { GRADE_TEXT, G_PERFECT, G_GOOD, G_EARLY, G_LATE } from '../sim/contact/timing.ts';
import { SW_CHARGE } from '../sim/player/player.ts';
import { SHOT_KEYS, SHOT_BANDEJA } from '../sim/contact/shots.ts';

const CSS = `
#hud .bug { position: absolute; left: 16px; top: 16px; background: rgba(10,12,16,.82); border-radius: 6px; overflow: hidden;
  font: 600 14px/1 ui-sans-serif, system-ui, sans-serif; letter-spacing: .02em; box-shadow: 0 2px 12px rgba(0,0,0,.35); }
#hud .row { display: grid; grid-template-columns: 14px 92px repeat(var(--sets), 26px) 34px 74px; align-items: center; height: 30px; }
#hud .row + .row { border-top: 1px solid rgba(255,255,255,.08); }
#hud .row span { text-align: center; color: #cfd6dc; }
#hud .row .name { text-align: left; color: #fff; padding-left: 4px; }
#hud .row .pts { background: #f4d03f; color: #111; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 13px; }
#hud .row .games { color: #fff; }
#hud .dot { width: 6px; height: 6px; border-radius: 50%; margin-left: 6px; background: transparent; }
#hud .dot.on { background: #f4d03f; }
#hud .grade { position: absolute; left: 50%; bottom: 120px; transform: translateX(-50%); font: 800 26px/1 ui-sans-serif, system-ui;
  letter-spacing: .06em; text-transform: uppercase; opacity: 0; transition: opacity .25s; text-shadow: 0 2px 10px rgba(0,0,0,.6); }
#hud .call { position: absolute; left: 50%; top: 22%; transform: translateX(-50%); font: 700 22px/1.2 ui-sans-serif, system-ui;
  color: #fff; opacity: 0; transition: opacity .3s; text-shadow: 0 2px 12px rgba(0,0,0,.7); text-align: center; white-space: pre-line; }
#hud .meter { position: absolute; left: 50%; bottom: 82px; width: 260px; height: 10px; transform: translateX(-50%);
  background: rgba(10,12,16,.6); border-radius: 5px; opacity: 0; transition: opacity .15s; }
#hud .meter .zone { position: absolute; top: 0; bottom: 0; border-radius: 5px; }
#hud .meter .mark { position: absolute; top: -3px; width: 3px; height: 16px; background: #fff; border-radius: 2px; }
#hud .help { position: absolute; right: 16px; bottom: 16px; background: rgba(10,12,16,.7); border-radius: 6px; padding: 10px 12px;
  font: 12px/1.6 ui-sans-serif, system-ui; color: #cfd6dc; }
#hud .help b { color: #fff; font-weight: 600; }
#hud .ms { position: absolute; left: 50%; bottom: 102px; transform: translateX(-50%); font: 600 12px/1 ui-sans-serif, system-ui;
  color: #e6ebef; opacity: 0; transition: opacity .25s; letter-spacing: .04em; text-shadow: 0 1px 6px rgba(0,0,0,.7); }
#hud .hint { position: absolute; left: 50%; bottom: 176px; transform: translateX(-50%); font: 600 13px/1 ui-sans-serif, system-ui;
  color: #bfe9ff; opacity: 0; transition: opacity .2s; letter-spacing: .06em; text-transform: uppercase; text-shadow: 0 1px 8px rgba(0,0,0,.7); }
#hud .shot { position: absolute; left: 50%; bottom: 150px; transform: translateX(-50%); font: 600 13px/1 ui-sans-serif, system-ui;
  color: #cfd6dc; opacity: 0; transition: opacity .25s; letter-spacing: .08em; text-transform: uppercase; }
`;

/** The predicted path climbs well above head height over our half before it bounces: a lob. */
function isLob(sim: MatchSim, team: number): boolean {
  const pr = sim.pred;
  const s = sim.side(team);
  for (let i = 0; i < pr.n && pr.bounces[i]! === sim.rally.bounces && pr.bounces[i]! === 0; i++) {
    if (pr.z[i]! * s > 1.5 && pr.y[i]! > 2.3) return true;
  }
  return false;
}

const GRADE_COLORS = ['#ff5a4f', '#ffb13b', '#8fe36b', '#5ff2ff', '#ffb13b', '#ff5a4f'];

export class Hud {
  readonly root: HTMLElement;
  private readonly rows: HTMLElement[][] = [];
  private readonly grade: HTMLElement;
  private readonly call: HTMLElement;
  private readonly meter: HTMLElement;
  private readonly mark: HTMLElement;
  private readonly shot: HTMLElement;
  private readonly help: HTMLElement;
  private readonly ms: HTMLElement;
  private readonly hint: HTMLElement;
  private lobVersion = -1;
  private lob = false;
  private readonly cache = new Map<HTMLElement, string>();
  private seen = 0;
  private gradeUntil = 0;
  private callUntil = 0;
  pro = false;
  private readonly zones: HTMLElement[] = [];

  constructor(root: HTMLElement, names: [string, string], sets: number) {
    this.root = root;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    const bug = el('div', 'bug');
    bug.style.setProperty('--sets', String(sets));
    for (let t = 0; t < 2; t++) {
      const row = el('div', 'row');
      const cells: HTMLElement[] = [el('span', 'dot'), el('span', 'name')];
      cells[1]!.textContent = names[t]!;
      for (let s = 0; s < sets; s++) cells.push(el('span', 'set'));
      cells.push(el('span', 'games'), el('span', 'pts'));
      for (const c of cells) row.appendChild(c);
      bug.appendChild(row);
      this.rows.push(cells);
    }
    root.appendChild(bug);
    this.grade = root.appendChild(el('div', 'grade'));
    this.shot = root.appendChild(el('div', 'shot'));
    this.call = root.appendChild(el('div', 'call'));
    this.meter = root.appendChild(el('div', 'meter'));
    // Meter zones: perfect window in the middle, good either side.
    const good = el('div', 'zone');
    good.style.cssText = 'left:38%;width:24%;background:rgba(143,227,107,.55)';
    const perf = el('div', 'zone');
    perf.style.cssText = 'left:45%;width:10%;background:rgba(95,242,255,.9)';
    this.meter.append(good, perf);
    this.zones.push(good, perf);
    this.mark = this.meter.appendChild(el('div', 'mark'));
    this.ms = root.appendChild(el('div', 'ms'));
    this.hint = root.appendChild(el('div', 'hint'));
    this.help = root.appendChild(el('div', 'help'));
    this.help.innerHTML =
      '<b>WASD</b> move &nbsp; <b>J</b> drive &nbsp; <b>K</b> topspin &nbsp; <b>L</b> slice &nbsp; <b>I</b> lob &nbsp; <b>U</b> drop<br>' +
      '<b>O</b> overhead for lobs: bandeja, with <b>Space</b> a smash.<br>' +
      'Hold a shot key as the ball comes: <b>WASD then aims</b> the yellow target and you run to the ball by yourself.<br>' +
      '<b>Release</b> when the closing ring meets the ring on the ball. Serve: A/D aims, press to drop, release to hit.<br>' +
      '<b>Space</b> power &nbsp; <b>Shift</b> precision &nbsp; <b>M</b> mouse aim &nbsp; <b>P</b> pro mode &nbsp; <b>F3</b> debug &nbsp; <b>H</b> hide';
  }

  /** Size the meter's Good/Perfect zones to the timing windows (meter spans +-0.25 s). */
  setTiming(scale: number): void {
    const span = 0.5;
    const set = (e: HTMLElement, half: number): void => {
      const w = Math.min(100, ((2 * half * scale) / span) * 100);
      e.style.left = `${50 - w / 2}%`;
      e.style.width = `${w}%`;
    };
    set(this.zones[0]!, 0.06);
    set(this.zones[1]!, 0.025);
  }

  toggleHelp(): void {
    this.help.style.display = this.help.style.display === 'none' ? '' : 'none';
  }

  private set(e: HTMLElement, text: string): void {
    if (this.cache.get(e) === text) return;
    this.cache.set(e, text);
    e.textContent = text;
  }

  update(sim: MatchSim, humanTeam: number, now: number): void {
    const sc = sim.score;
    const pts = sc.display();
    const server = sc.serverTeam();
    for (let t = 0; t < 2; t++) {
      const cells = this.rows[t]!;
      cells[0]!.className = server === t ? 'dot on' : 'dot';
      for (let s = 0; s < cells.length - 4; s++) {
        const h = sc.history[s];
        this.set(cells[2 + s]!, h ? String(h[t]) : '');
      }
      this.set(cells[cells.length - 2]!, String(sc.games[t]));
      this.set(cells[cells.length - 1]!, pts[t] || (pts[1 - t] && !pts[t] ? '' : '0'));
    }

    // New events.
    while (this.seen < sim.eventSeq) {
      const e = sim.events[this.seen % sim.events.length]!;
      this.seen++;
      if (e.seq < 0) continue;
      this.onEvent(sim, e, humanTeam, now);
    }
    if (now > this.gradeUntil) { this.grade.style.opacity = '0'; this.shot.style.opacity = '0'; this.ms.style.opacity = '0'; }
    if (now > this.callUntil) this.call.style.opacity = '0';

    // Timing meter: where "now" sits relative to the best upcoming contact moment.
    let show = false;
    if (humanTeam >= 0 && !this.pro && (sim.phase === PH_RALLY || sim.phase === PH_TOSS)) {
      const p = sim.players[humanTeam]!;
      const ideal = sim.focusIdeal(humanTeam);
      if (ideal >= 0 && (p.swing === SW_CHARGE || sim.phase === PH_TOSS)) {
        const d = sim.time - ideal; // negative = before ideal
        const frac = Math.min(1, Math.max(0, 0.5 + d / 0.5));
        this.mark.style.left = `${(frac * 100).toFixed(1)}%`;
        show = true;
      }
    }
    this.meter.style.opacity = show ? '1' : '0';
    // Teach the court: a lob coming (the overhead key), the overhead you are holding, or a ball to play off the glass.
    let hint = '';
    if (humanTeam >= 0 && !this.pro && sim.phase === PH_RALLY && sim.rally.hitter >= 0 && sim.rally.hitter !== humanTeam) {
      const p = sim.players[humanTeam]!;
      const st = sim.stand[humanTeam]!;
      if (sim.pred.version !== this.lobVersion) {
        this.lobVersion = sim.pred.version;
        this.lob = isLob(sim, humanTeam);
      }
      if (p.shot === SHOT_BANDEJA && p.swing === SW_CHARGE) hint = 'Overhead: bandeja · hold Space to smash';
      else if (this.lob) hint = 'Lob · hold O for an overhead';
      else if (st.valid && st.afterWall) hint = 'Off the glass';
    }
    if (hint) this.set(this.hint, hint);
    this.hint.style.opacity = hint ? '1' : '0';
    if (humanTeam >= 0 && sim.phase === PH_SETUP && sim.score.serverTeam() === humanTeam && now > this.callUntil) {
      this.showCall('Your serve: A/D aims, press a shot key to drop the ball, release to hit', now, 0.05);
    }
  }

  private showCall(text: string, now: number, dur: number): void {
    this.set(this.call, text);
    this.call.style.opacity = '1';
    this.callUntil = now + dur;
  }

  private onEvent(sim: MatchSim, e: MatchEvent, human: number, now: number): void {
    switch (e.kind) {
      case E_SWING:
      case E_WHIFF:
        if (e.team === human && !this.pro && e.b >= 0) {
          const outOfReach = e.kind === E_WHIFF && e.x > 0;
          this.set(this.grade, outOfReach ? 'Out of reach'
            : e.kind === E_WHIFF && e.b !== G_EARLY && e.b !== G_LATE ? `${GRADE_TEXT[e.b]} · miss` : GRADE_TEXT[e.b]!);
          this.grade.style.color = outOfReach ? '#ffb13b' : GRADE_COLORS[e.b]!;
          this.grade.style.opacity = '1';
          const ms = Math.round(Math.abs(e.c) * 1000);
          this.set(this.ms, outOfReach ? `${e.x.toFixed(1)} m away: get to the spot first` : ms === 0 ? 'spot on' : `${ms} ms ${e.c < 0 ? 'early' : 'late'}`);
          this.ms.style.opacity = '1';
          this.gradeUntil = now + 0.9;
        }
        break;
      case E_HIT:
        if (e.team === human) {
          const name = SHOT_KEYS[e.a]!;
          this.set(this.shot, `${name} · ${(e.c * 3.6).toFixed(0)} km/h`);
          this.shot.style.opacity = e.b === G_PERFECT || e.b === G_GOOD || !this.pro ? '1' : '0';
          this.gradeUntil = now + 0.9;
        }
        break;
      case E_POINT: {
        const who = human < 0 ? (e.team === 0 ? 'Near side' : 'Far side') : e.team === human ? 'Your point' : 'Their point';
        this.showCall(`${REASON_TEXT[e.a]}\n${who}`, now, 1.6);
        break;
      }
      case E_FAULT:
        this.showCall(e.b === 2 ? `${REASON_TEXT[e.a]} · Double fault` : `${REASON_TEXT[e.a]} · Second serve`, now, 1.2);
        break;
      case E_LET:
        this.showCall('Let · replay the serve', now, 1.2);
        break;
      case E_GAME:
        this.showCall(e.team === human ? 'Game, you' : 'Game, opponent', now, 1.6);
        break;
      case E_SET:
        this.showCall(e.team === human ? 'Set, you' : 'Set, opponent', now, 2);
        break;
      case E_MATCH:
        this.showCall(e.team === human ? 'Game, set and match. You win!' : 'Game, set and match. Opponent wins.', now, 1e9);
        break;
      case E_ENDS:
        this.showCall('Change of ends', now, 1.4);
        break;
    }
    void sim;
  }
}

function el(tag: string, cls: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}
