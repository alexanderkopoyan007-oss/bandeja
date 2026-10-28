// Broadcast-style score bug, timing grade, the timing meter, hints and calls (DOM overlay); the timing rings on
// the ball are drawn in the scene (render/views.ts). Text and classes only change when the underlying value
// changes, so the HUD costs next to nothing per frame.
import type { MatchSim, MatchEvent } from '../sim/match.ts';
import {
  E_HIT, E_SWING, E_WHIFF, E_CALL, E_POINT, E_FAULT, E_LET, E_GAME, E_SET, E_MATCH, E_ENDS, E_EXIT, PH_TOSS, PH_RALLY, PH_SETUP,
} from '../sim/match.ts';
import { REASON_TEXT, WHY_EXIT_AFTER_BOUNCE } from '../sim/rules/rally.ts';
import { GRADE_TEXT, G_TOO_EARLY, G_TOO_LATE, G_PERFECT, G_GOOD } from '../sim/contact/timing.ts';
import { SW_CHARGE } from '../sim/player/player.ts';
import { SHAPES, SHOT_BANDEJA, SHOT_VOLLEY } from '../sim/contact/shots.ts';
import tuning from '../../data/tuning.json' with { type: 'json' };

/** E_CALL's words (CALL_MINE, CALL_YOURS, CALL_SWITCH), as a pair shouts them. */
const CALL_TEXT = ['Mine!', 'Yours!', 'Switch!'];

const TIMING = tuning.timing;

const CSS = `
#hud { --display: "Avenir Next Condensed", "DIN Condensed", "Arial Narrow", system-ui, sans-serif;
  --glass: rgba(9,12,17,.66); --edge: rgba(255,255,255,.13); --perfect: #5ff2ff; --good: #8fe36b; --ok: #ffb13b;
  --bad: #ff5a4f; --ball: #ffd84a; }
#hud .bug { position: absolute; left: 16px; top: 16px; background: rgba(10,12,16,.82); border-radius: 6px; overflow: hidden;
  font: 600 14px/1 ui-sans-serif, system-ui, sans-serif; letter-spacing: .02em; box-shadow: 0 2px 12px rgba(0,0,0,.35); }
#hud .row { display: grid; grid-template-columns: 14px var(--name, 112px) repeat(var(--sets), 26px) 34px 74px; align-items: center; height: 30px; }
#hud .row .name { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
#hud .row + .row { border-top: 1px solid rgba(255,255,255,.08); }
#hud .row span { text-align: center; color: #cfd6dc; }
#hud .row .name { text-align: left; color: #fff; padding-left: 4px; }
#hud .row .pts { background: #f4d03f; color: #111; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 13px; }
#hud .row .games { color: #fff; }
#hud .dot { width: 6px; height: 6px; border-radius: 50%; margin-left: 6px; background: transparent; }
#hud .dot.on { background: #f4d03f; }

/* Timing grade, the shot, and the meter: where now sits against the contact moment. */
#hud .grade { position: absolute; left: 50%; bottom: 120px; transform: translateX(-50%); font: 800 26px/1 ui-sans-serif, system-ui;
  letter-spacing: .06em; text-transform: uppercase; opacity: 0; transition: opacity .25s; text-shadow: 0 2px 10px rgba(0,0,0,.6); }
#hud .meter { position: absolute; left: 50%; bottom: 82px; width: 260px; height: 10px; transform: translateX(-50%);
  background: rgba(10,12,16,.6); border-radius: 5px; opacity: 0; transition: opacity .15s; }
#hud .meter .zone { position: absolute; top: 0; bottom: 0; border-radius: 5px; }
#hud .meter .mark { position: absolute; top: -3px; width: 3px; height: 16px; background: #fff; border-radius: 2px; }
#hud .ms { position: absolute; left: 50%; bottom: 102px; transform: translateX(-50%); font: 600 12px/1 ui-sans-serif, system-ui;
  color: #e6ebef; opacity: 0; transition: opacity .25s; letter-spacing: .04em; text-shadow: 0 1px 6px rgba(0,0,0,.7); }
#hud .shot { position: absolute; left: 50%; bottom: 150px; transform: translateX(-50%); font: 600 13px/1 ui-sans-serif, system-ui;
  color: #cfd6dc; opacity: 0; transition: opacity .25s; letter-spacing: .08em; text-transform: uppercase; }
/* The AI partner's call: the shot line's type, above the hint. */
#hud .mate { position: absolute; left: 50%; bottom: 206px; transform: translateX(-50%); font: 600 13px/1 ui-sans-serif, system-ui;
  color: #cfd6dc; opacity: 0; transition: opacity .25s; letter-spacing: .08em; text-transform: uppercase; }

/* Hints: a glass pill with key caps. */
#hud .hint { position: absolute; left: 50%; bottom: 176px; transform: translate(-50%, 6px); opacity: 0;
  transition: opacity .2s, transform .2s; padding: 8px 14px 7px; border-radius: 999px; background: var(--glass);
  border: 1px solid var(--edge); backdrop-filter: blur(8px); font: 700 14px/1 var(--display); letter-spacing: .1em;
  text-transform: uppercase; color: #e9f6ff; white-space: nowrap; box-shadow: 0 6px 18px rgba(0,0,0,.3); }
#hud .hint.on { opacity: 1; transform: translate(-50%, 0); }
#hud .key, #hud .help .key { display: inline-block; min-width: 20px; padding: 3px 5px 2px; margin: 0 2px; border-radius: 5px;
  text-align: center; font: 800 12px/1 var(--display); letter-spacing: .04em; color: #0b0d10;
  background: linear-gradient(180deg, #fff, #cfd6dc); box-shadow: 0 2px 0 #8a939b, 0 3px 6px rgba(0,0,0,.4); }
#hud .hint .key { background: linear-gradient(180deg, #fff3b8, var(--ball)); box-shadow: 0 2px 0 #a8862a, 0 3px 6px rgba(0,0,0,.4); }

/* Calls: a glass banner with a coloured edge; por tres / por cuatro get the big treatment. */
#hud .call { position: absolute; left: 50%; top: 18%; transform: translate(-50%, -8px) scale(.96); opacity: 0;
  transition: opacity .25s, transform .25s; text-align: center; padding: 12px 22px 11px; border-radius: 10px;
  background: var(--glass); border: 1px solid var(--edge); border-left: 4px solid var(--accent, #fff); backdrop-filter: blur(10px);
  box-shadow: 0 10px 30px rgba(0,0,0,.4); }
#hud .call.on { opacity: 1; transform: translate(-50%, 0) scale(1); }
#hud .call .title { font: 800 30px/1 var(--display); letter-spacing: .06em; text-transform: uppercase; color: #fff; }
#hud .call .sub { margin-top: 6px; font: 700 12px/1 var(--display); letter-spacing: .22em; text-transform: uppercase;
  color: var(--accent, rgba(255,255,255,.7)); }
#hud .call .sub:empty { display: none; }
#hud .call.big { border-left-width: 0; padding: 14px 30px 12px; }
#hud .call.big .title { font-size: 64px; font-style: italic; letter-spacing: .04em;
  background: linear-gradient(180deg, #fff6c9, #ffd84a 45%, #ff9a3c); -webkit-background-clip: text; background-clip: text;
  color: transparent; filter: drop-shadow(0 0 14px rgba(255,190,70,.55)); }
#hud .call.big.on { animation: hud-slam .45s cubic-bezier(.2,1.6,.4,1); }
@keyframes hud-slam { from { transform: translate(-50%, 0) scale(1.6); opacity: 0; } to { transform: translate(-50%, 0) scale(1); opacity: 1; } }

#hud .help { position: absolute; right: 16px; bottom: 16px; padding: 12px 14px; border-radius: 10px; background: var(--glass);
  border: 1px solid var(--edge); backdrop-filter: blur(8px); font: 12px/1.9 ui-sans-serif, system-ui; color: #cfd6dc;
  max-width: 470px; box-shadow: 0 8px 24px rgba(0,0,0,.35); }
#hud .help .key { font-size: 11px; min-width: 16px; padding: 2px 4px 1px; }
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

/** Text with [X] key caps turned into styled keys (only our own strings go through here). */
function keys(text: string): string {
  return text.replace(/\[([^\]]+)\]/g, '<span class="key">$1</span>');
}

export class Hud {
  readonly root: HTMLElement;
  private readonly rows: HTMLElement[][] = [];
  private readonly call: HTMLElement;
  private readonly callTitle: HTMLElement;
  private readonly callSub: HTMLElement;
  private readonly grade: HTMLElement;
  private readonly shot: HTMLElement;
  private readonly mate: HTMLElement;
  private mateUntil = 0;
  private readonly meter: HTMLElement;
  private readonly mark: HTMLElement;
  private readonly zones: HTMLElement[] = [];
  private readonly ms: HTMLElement;
  private readonly help: HTMLElement;
  private readonly hint: HTMLElement;
  private lobVersion = -1;
  private lob = false;
  private readonly cache = new Map<HTMLElement, string>();
  private seen = 0;
  private gradeUntil = 0;
  private callUntil = 0;
  private hintOn = false;
  pro = false;
  // Where the ball last left the court (for por tres / por cuatro).
  private exitX = 0;
  private exitZ = 0;
  private exitDoor = false;

  constructor(root: HTMLElement, names: [string, string], sets: number) {
    this.root = root;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    const bug = el('div', 'bug');
    bug.style.setProperty('--sets', String(sets));
    // Doubles rows name two players.
    if (names[0].includes('·') || names[1].includes('·')) bug.style.setProperty('--name', '170px');
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

    this.call = root.appendChild(el('div', 'call'));
    this.callTitle = this.call.appendChild(el('div', 'title'));
    this.callSub = this.call.appendChild(el('div', 'sub'));

    this.grade = root.appendChild(el('div', 'grade'));
    this.shot = root.appendChild(el('div', 'shot'));
    this.mate = root.appendChild(el('div', 'mate'));
    this.meter = root.appendChild(el('div', 'meter'));
    // Meter zones: perfect window in the middle, good either side (sized by setTiming).
    const good = el('div', 'zone');
    good.style.background = 'rgba(143,227,107,.55)';
    const perf = el('div', 'zone');
    perf.style.background = 'rgba(95,242,255,.9)';
    this.meter.append(good, perf);
    this.zones.push(good, perf);
    this.mark = this.meter.appendChild(el('div', 'mark'));
    this.ms = root.appendChild(el('div', 'ms'));
    this.hint = root.appendChild(el('div', 'hint'));
    this.help = root.appendChild(el('div', 'help'));
    this.help.innerHTML = keys(
      '[W][A][S][D] move &nbsp; [J] drive &nbsp; [K] topspin (with [Shift] a chiquita) &nbsp; [L] slice &nbsp; [I] lob &nbsp; [U] drop<br>' +
      '[O] overhead for lobs: a bandeja; with [Space] a smash that can leave the court; with [Shift] a víbora<br>' +
      '[N] volley: take it in the air and punch it; with [Space] flat and hard; [U] in the air is a drop volley<br>' +
      'Hold a shot key as the ball comes: WASD then aims the target and you run to the ball yourself<br>' +
      'Release when the closing ring meets the ring on the ball. Serve: [A]/[D] aims, press to drop, release to hit<br>' +
      'Doubles: you are the ringed player; your partner calls the balls on their side, holding a shot key takes it<br>' +
      '[Space] power &nbsp; [Shift] precision &nbsp; [M] mouse aim &nbsp; [P] pro mode &nbsp; [F3] debug &nbsp; [H] hide<br>' +
      'Gamepad: stick moves &nbsp; A drive &nbsp; X topspin &nbsp; B slice &nbsp; Y lob &nbsp; d-pad drop &nbsp; LB volley &nbsp; RB overhead &nbsp; RT power &nbsp; LT precision',
    );
  }

  /** Size the meter's Good/Perfect zones to the timing windows (meter spans +-0.25 s). */
  setTiming(scale: number): void {
    if (scale === this.timingShown) return;
    this.timingShown = scale;
    const span = 0.5;
    const set = (e: HTMLElement, half: number): void => {
      const w = Math.min(100, ((2 * half * scale) / span) * 100);
      e.style.left = `${50 - w / 2}%`;
      e.style.width = `${w}%`;
    };
    set(this.zones[0]!, TIMING.good);
    set(this.zones[1]!, TIMING.perfect);
  }

  private timingShown = -1;

  toggleHelp(): void {
    this.help.style.display = this.help.style.display === 'none' ? '' : 'none';
  }

  private set(e: HTMLElement, text: string, html = false): void {
    if (this.cache.get(e) === text) return;
    this.cache.set(e, text);
    if (html) e.innerHTML = text;
    else e.textContent = text;
  }

  private toggle(e: HTMLElement, cls: string, on: boolean): void {
    e.classList.toggle(cls, on);
  }

  /** `human`: the human's player number, -1 with autoplay. */
  update(sim: MatchSim, human: number, now: number): void {
    const team = human >= 0 ? sim.players[human]!.team : -1;
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
      this.onEvent(sim, e, human, team, now);
    }
    if (now > this.gradeUntil) { this.grade.style.opacity = '0'; this.shot.style.opacity = '0'; this.ms.style.opacity = '0'; }
    if (now > this.callUntil) this.toggle(this.call, 'on', false);
    if (now > this.mateUntil) this.mate.style.opacity = '0';

    // Timing meter: where "now" sits relative to the best upcoming contact moment.
    let show = false;
    if (human >= 0 && !this.pro && (sim.phase === PH_RALLY || sim.phase === PH_TOSS)) {
      const p = sim.players[human]!;
      const ideal = sim.focusIdeal(human);
      if (ideal >= 0 && (p.swing === SW_CHARGE || sim.phase === PH_TOSS)) {
        // The zones follow the shot being timed (each shot has its own windows).
        this.setTiming(sim.windowScale(human));
        const d = sim.time - ideal; // negative = before ideal
        const frac = Math.min(1, Math.max(0, 0.5 + d / 0.5));
        this.mark.style.left = `${(frac * 100).toFixed(1)}%`;
        show = true;
      }
    }
    this.meter.style.opacity = show ? '1' : '0';

    // Teach the court: a lob coming (the overhead key), the overhead you are holding, or a ball to play off the glass.
    let hint = '';
    if (human >= 0 && !this.pro && sim.phase === PH_RALLY && sim.rally.hitter >= 0 && sim.rally.hitter !== team) {
      const p = sim.players[human]!;
      const st = sim.stand[human]!;
      if (sim.pred.version !== this.lobVersion) {
        this.lobVersion = sim.pred.version;
        this.lob = isLob(sim, team);
      }
      // Doubles: the partner has called it. Holding a shot key takes it anyway.
      const partners = sim.doubles && sim.taker[team] === (human ^ 2) && p.swing !== SW_CHARGE;
      if (partners) hint = sim.rally.isServe ? 'Partner receives' : 'Partner\'s ball · hold a shot key to take it';
      else if (p.shot === SHOT_BANDEJA && p.swing === SW_CHARGE) hint = 'Bandeja · hold [Space] to smash, [Shift] for a víbora';
      else if (p.shot === SHOT_VOLLEY && p.swing === SW_CHARGE) hint = st.valid && st.volley ? 'Volley · hold [Space] to punch it flat' : 'Out of reach in the air · it will be blocked off the bounce';
      else if (this.lob) hint = 'Lob coming · hold [O] for an overhead';
      else if (st.valid && st.afterWall) hint = 'Let it come off the glass';
    }
    if (hint) this.set(this.hint, keys(hint), true);
    if (!!hint !== this.hintOn) { this.hintOn = !!hint; this.toggle(this.hint, 'on', this.hintOn); }
    if (human >= 0 && sim.phase === PH_SETUP && sim.score.serverPlayer() === human && now > this.callUntil) {
      this.showCall('Your serve', keys('[A]/[D] aims · press a shot key to drop · release to hit'), '#ffd84a', now, 0.05);
    }
  }

  /** A neutral banner (the line-up at the start of a match). */
  announce(title: string, sub: string, now: number, dur: number): void {
    this.showCall(title, sub, '#ffffff', now, dur);
  }

  private showCall(title: string, sub: string, accent: string, now: number, dur: number, big = false): void {
    this.set(this.callTitle, title);
    this.set(this.callSub, sub, true);
    this.call.style.setProperty('--accent', accent);
    if (big !== this.call.classList.contains('big')) this.toggle(this.call, 'big', big);
    if (big) {
      // Restart the slam animation.
      this.call.classList.remove('on');
      void this.call.offsetWidth;
    }
    this.toggle(this.call, 'on', true);
    this.callUntil = now + dur;
  }

  /** Your swings and shots are yours alone (`human`, a player); points, games and sets are the pair's (`team`). */
  private onEvent(sim: MatchSim, e: MatchEvent, human: number, team: number, now: number): void {
    switch (e.kind) {
      case E_SWING:
      case E_WHIFF:
        if (human >= 0 && e.player === human && !this.pro && e.b >= 0) {
          const outOfReach = e.kind === E_WHIFF && e.x > 0;
          this.set(this.grade, outOfReach ? 'Out of reach'
            : e.kind === E_WHIFF && e.b !== G_TOO_EARLY && e.b !== G_TOO_LATE ? `${GRADE_TEXT[e.b]} · miss` : GRADE_TEXT[e.b]!);
          this.grade.style.color = outOfReach ? '#ffb13b' : GRADE_COLORS[e.b]!;
          this.grade.style.opacity = '1';
          const ms = Math.round(Math.abs(e.c) * 1000);
          this.set(this.ms, outOfReach ? `${e.x.toFixed(1)} m away: get to the spot first` : ms === 0 ? 'spot on' : `${ms} ms ${e.c < 0 ? 'early' : 'late'}`);
          this.ms.style.opacity = '1';
          this.gradeUntil = now + 0.9;
        }
        break;
      case E_HIT:
        if (human >= 0 && e.player === human) {
          this.set(this.shot, `${SHAPES[e.a]!.name} · ${(e.c * 3.6).toFixed(0)} km/h`);
          this.shot.style.opacity = e.b === G_PERFECT || e.b === G_GOOD || !this.pro ? '1' : '0';
          this.gradeUntil = now + 0.9;
        }
        break;
      case E_CALL:
        // Your partner calls the ball (your own calls and the opponents' are not shown).
        if (human >= 0 && e.player === (human ^ 2)) {
          this.set(this.mate, `Partner · ${CALL_TEXT[e.a]}`);
          this.mate.style.opacity = '1';
          this.mateUntil = now + 1.1;
        }
        break;
      case E_EXIT:
        this.exitX = e.x;
        this.exitZ = e.z;
        this.exitDoor = e.a === 1;
        break;
      case E_POINT: {
        const who = team < 0 ? (e.team === 0 ? 'Near side' : 'Far side') : e.team === team ? 'Your point' : 'Their point';
        const accent = team < 0 ? '#ffffff' : e.team === team ? '#8fe36b' : '#ff5a4f';
        if (e.a === WHY_EXIT_AFTER_BOUNCE) {
          // Out of the court after a good bounce: over the back fence is "por cuatro", over the side or out
          // through a door "por tres".
          const c = sim.world.court;
          const back = !this.exitDoor && Math.abs(this.exitZ) >= c.halfL - 0.05 && Math.abs(this.exitX) < c.halfW - 0.05;
          this.showCall(back ? 'Por cuatro' : 'Por tres', who, accent, now, 2.2, true);
        } else this.showCall(REASON_TEXT[e.a]!, who, accent, now, 1.6);
        break;
      }
      case E_FAULT:
        this.showCall(REASON_TEXT[e.a]!, e.b === 2 ? 'Double fault' : 'Second serve', '#ffb13b', now, 1.2);
        break;
      case E_LET:
        this.showCall('Let', 'Replay the serve', '#5ff2ff', now, 1.2);
        break;
      case E_GAME:
        this.showCall(team < 0 ? 'Game' : e.team === team ? 'Game, you' : sim.doubles ? 'Game, opponents' : 'Game, opponent', '', '#ffd84a', now, 1.6);
        break;
      case E_SET:
        this.showCall(team < 0 ? 'Set' : e.team === team ? 'Set, you' : sim.doubles ? 'Set, opponents' : 'Set, opponent', '', '#ffd84a', now, 2);
        break;
      case E_MATCH:
        this.showCall('Game, set and match', team < 0 ? '' : e.team === team ? 'You win!' : sim.doubles ? 'Opponents win' : 'Opponent wins', '#ffd84a', now, 1e9);
        break;
      case E_ENDS:
        this.showCall('Change of ends', '', '#ffffff', now, 1.4);
        break;
    }
  }
}

function el(tag: string, cls: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}
