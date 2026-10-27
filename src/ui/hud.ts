// Broadcast-style score bug, the timing bar, shot chips, hints and calls (DOM overlay), plus the on-ball timing cue.
// Text and classes only change when the underlying value changes, so the HUD costs next to nothing per frame.
import type { MatchSim, MatchEvent } from '../sim/match.ts';
import {
  E_HIT, E_SWING, E_WHIFF, E_POINT, E_FAULT, E_LET, E_GAME, E_SET, E_MATCH, E_ENDS, E_EXIT, PH_TOSS, PH_RALLY, PH_SETUP,
} from '../sim/match.ts';
import { REASON_TEXT, WHY_EXIT_AFTER_BOUNCE } from '../sim/rules/rally.ts';
import { GRADE_TEXT, G_TOO_EARLY, G_TOO_LATE } from '../sim/contact/timing.ts';
import { SW_CHARGE, SW_COMMITTED } from '../sim/player/player.ts';
import { SHAPES, SHOT_BANDEJA } from '../sim/contact/shots.ts';
import { TimingCue, GRADE_CSS } from './cue.ts';
import tuning from '../../data/tuning.json' with { type: 'json' };

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

/* Timing bar: glass track, graded zones, a glowing needle, and where you released. */
#hud .tbar { position: absolute; left: 50%; bottom: 66px; width: 380px; transform: translateX(-50%); opacity: 0;
  transition: opacity .18s; }
#hud .tbar.on { opacity: 1; }
#hud .track { position: relative; height: 14px; border-radius: 8px; border: 1px solid var(--edge);
  background: linear-gradient(180deg, rgba(255,255,255,.07), rgba(255,255,255,0) 60%), var(--glass);
  box-shadow: inset 0 2px 4px rgba(0,0,0,.55), 0 8px 24px rgba(0,0,0,.35); backdrop-filter: blur(8px); }
#hud .zone { position: absolute; top: 2px; bottom: 2px; border-radius: 6px; }
#hud .zone.ok { background: linear-gradient(90deg, rgba(255,177,59,0), rgba(255,177,59,.38) 18%, rgba(255,177,59,.38) 82%, rgba(255,177,59,0)); }
#hud .zone.good { background: linear-gradient(90deg, rgba(143,227,107,.35), rgba(143,227,107,.75) 30%, rgba(143,227,107,.75) 70%, rgba(143,227,107,.35)); }
#hud .zone.perfect { background: linear-gradient(180deg, #b9fbff, var(--perfect)); box-shadow: 0 0 10px rgba(95,242,255,.85), 0 0 22px rgba(95,242,255,.45); }
#hud .tbar.hot .zone.perfect { animation: hud-pulse .18s ease-in-out infinite alternate; }
@keyframes hud-pulse { to { box-shadow: 0 0 16px rgba(95,242,255,1), 0 0 34px rgba(95,242,255,.7); } }
#hud .tick { position: absolute; top: -3px; bottom: -3px; width: 1px; background: rgba(255,255,255,.35); }
#hud .needle { position: absolute; top: -7px; width: 4px; height: 28px; margin-left: -2px; border-radius: 2px; background: #fff;
  box-shadow: 0 0 6px #fff, 0 0 14px rgba(255,255,255,.7); }
#hud .needle::after { content: ""; position: absolute; left: -4px; top: -6px; border: 6px solid transparent; border-top-color: #fff; border-bottom: 0; }
#hud .rel { position: absolute; top: 1px; width: 10px; height: 10px; margin-left: -5px; transform: rotate(45deg); border-radius: 2px;
  border: 2px solid currentColor; box-shadow: 0 0 8px currentColor; opacity: 0; transition: opacity .2s; }
#hud .tlabels { display: flex; justify-content: space-between; margin-top: 9px; font: 700 10px/1 var(--display);
  letter-spacing: .24em; color: rgba(255,255,255,.5); text-transform: uppercase; }
#hud .tlabels .mid { color: rgba(95,242,255,.8); }

/* After a shot: timing error and the shot itself. */
#hud .chips { position: absolute; left: 50%; bottom: 22px; transform: translateX(-50%); display: flex; gap: 8px; opacity: 0;
  transition: opacity .25s; }
#hud .chips.on { opacity: 1; }
#hud .chip { padding: 6px 12px 5px; border-radius: 999px; background: var(--glass); border: 1px solid var(--edge);
  backdrop-filter: blur(8px); font: 700 13px/1 var(--display); letter-spacing: .12em; text-transform: uppercase; color: #fff;
  white-space: nowrap; box-shadow: 0 6px 18px rgba(0,0,0,.3); }
#hud .chip:empty { display: none; }
#hud .chip b { font-weight: 800; }

/* Hints: a glass pill with key caps. */
#hud .hint { position: absolute; left: 50%; bottom: 122px; transform: translate(-50%, 6px); opacity: 0;
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

/** Bar span either side of the ideal moment, seconds. */
const BAR_SPAN = 0.25;

/** Text with [X] key caps turned into styled keys (only our own strings go through here). */
function keys(text: string): string {
  return text.replace(/\[([^\]]+)\]/g, '<span class="key">$1</span>');
}

export class Hud {
  readonly root: HTMLElement;
  readonly cue: TimingCue;
  private readonly rows: HTMLElement[][] = [];
  private readonly call: HTMLElement;
  private readonly callTitle: HTMLElement;
  private readonly callSub: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly needle: HTMLElement;
  private readonly rel: HTMLElement;
  private readonly zones: HTMLElement[] = [];
  private readonly chips: HTMLElement;
  private readonly msChip: HTMLElement;
  private readonly shotChip: HTMLElement;
  private readonly help: HTMLElement;
  private readonly hint: HTMLElement;
  private lobVersion = -1;
  private lob = false;
  private readonly cache = new Map<HTMLElement, string>();
  private seen = 0;
  private chipsUntil = 0;
  private callUntil = 0;
  private relUntil = 0;
  private barOn = false;
  private barHot = false;
  private hintOn = false;
  private _pro = false;
  // Where the ball last left the court (for por tres / por cuatro).
  private exitX = 0;
  private exitZ = 0;
  private exitDoor = false;

  get pro(): boolean { return this._pro; }
  set pro(v: boolean) { this._pro = v; this.cue.pro = v; }

  constructor(root: HTMLElement, names: [string, string], sets: number) {
    this.root = root;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.cue = new TimingCue(root);
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

    // Timing bar: ok / good / perfect zones (sized by setTiming), quarter ticks, the needle and the release marker.
    this.bar = root.appendChild(el('div', 'tbar'));
    const track = this.bar.appendChild(el('div', 'track'));
    for (const z of ['ok', 'good', 'perfect']) this.zones.push(track.appendChild(el('div', `zone ${z}`)));
    for (const f of [0.25, 0.75]) track.appendChild(el('div', 'tick')).style.left = `${f * 100}%`;
    this.rel = track.appendChild(el('div', 'rel'));
    this.needle = track.appendChild(el('div', 'needle'));
    const labels = this.bar.appendChild(el('div', 'tlabels'));
    labels.innerHTML = '<span>Early</span><span class="mid">Perfect</span><span>Late</span>';

    this.chips = root.appendChild(el('div', 'chips'));
    this.msChip = this.chips.appendChild(el('div', 'chip'));
    this.shotChip = this.chips.appendChild(el('div', 'chip'));
    this.hint = root.appendChild(el('div', 'hint'));
    this.help = root.appendChild(el('div', 'help'));
    this.help.innerHTML = keys(
      '[W][A][S][D] move &nbsp; [J] drive &nbsp; [K] topspin (with [Shift] a chiquita) &nbsp; [L] slice &nbsp; [I] lob &nbsp; [U] drop<br>' +
      '[O] overhead for lobs: a bandeja; with [Space] a smash that can leave the court; with [Shift] a víbora<br>' +
      'Hold a shot key as the ball comes: WASD then aims the target and you run to the ball yourself<br>' +
      'Release when the closing ring meets the ring on the ball. Serve: [A]/[D] aims, press to drop, release to hit<br>' +
      'Doubles: you are the ringed player; your partner calls the balls on their side, holding a shot key takes it<br>' +
      '[Space] power &nbsp; [Shift] precision &nbsp; [M] mouse aim &nbsp; [P] pro mode &nbsp; [F3] debug &nbsp; [H] hide',
    );
  }

  /** Size the bar's zones to the timing windows (the bar spans +-BAR_SPAN). */
  setTiming(scale: number): void {
    const set = (e: HTMLElement, half: number): void => {
      const w = Math.min(100, ((half * scale) / BAR_SPAN) * 100);
      e.style.left = `${50 - w / 2}%`;
      e.style.width = `${w}%`;
    };
    set(this.zones[0]!, TIMING.ok);
    set(this.zones[1]!, TIMING.good);
    set(this.zones[2]!, TIMING.perfect);
  }

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
    if (now > this.chipsUntil) this.toggle(this.chips, 'on', false);
    if (now > this.callUntil) this.toggle(this.call, 'on', false);

    // Timing bar: where "now" sits relative to the contact moment the player is going for.
    let show = false;
    let hot = false;
    if (human >= 0 && !this._pro && (sim.phase === PH_RALLY || sim.phase === PH_TOSS)) {
      const p = sim.players[human]!;
      const ideal = sim.focusIdeal(human);
      if (ideal >= 0 && (p.swing === SW_CHARGE || sim.phase === PH_TOSS) && p.swing !== SW_COMMITTED) {
        const d = sim.time - ideal; // negative = before the ideal
        this.needle.style.left = `${(Math.min(1, Math.max(0, 0.5 + d / (2 * BAR_SPAN))) * 100).toFixed(1)}%`;
        show = true;
        hot = sim.focusInReach && Math.abs(d) <= TIMING.good * (sim.cfg.timingScale ?? 1);
      }
    }
    // Keep the bar up briefly after a release so the marker can be read.
    if (now < this.relUntil) show = true;
    else this.rel.style.opacity = '0';
    if (show !== this.barOn) { this.barOn = show; this.toggle(this.bar, 'on', show); }
    if (hot !== this.barHot) { this.barHot = hot; this.toggle(this.bar, 'hot', hot); }

    // Teach the court: a lob coming (the overhead key), the overhead you are holding, or a ball to play off the glass.
    let hint = '';
    if (human >= 0 && !this._pro && sim.phase === PH_RALLY && sim.rally.hitter >= 0 && sim.rally.hitter !== team) {
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

  /** Release marker on the bar, in the grade's colour. */
  private markRelease(delta: number, grade: number, now: number): void {
    this.rel.style.left = `${(Math.min(1, Math.max(0, 0.5 + delta / (2 * BAR_SPAN))) * 100).toFixed(1)}%`;
    this.rel.style.color = GRADE_CSS[grade]!;
    this.rel.style.opacity = '1';
    this.relUntil = now + 0.7;
  }

  /** Your swings and shots are yours alone (`human`, a player); points, games and sets are the pair's (`team`). */
  private onEvent(sim: MatchSim, e: MatchEvent, human: number, team: number, now: number): void {
    switch (e.kind) {
      case E_SWING:
      case E_WHIFF:
        if (human >= 0 && e.player === human && !this._pro && e.b >= 0) {
          const outOfReach = e.kind === E_WHIFF && e.x > 0;
          if (outOfReach) this.cue.flash('Out of reach', '#ffb13b', now);
          else if (e.kind === E_WHIFF && e.b !== G_TOO_EARLY && e.b !== G_TOO_LATE) this.cue.flash(`${GRADE_TEXT[e.b]} · miss`, GRADE_CSS[e.b]!, now);
          else this.cue.flash(GRADE_TEXT[e.b]!, GRADE_CSS[e.b]!, now);
          if (!outOfReach) this.markRelease(e.c, e.b, now);
          const ms = Math.round(Math.abs(e.c) * 1000);
          this.set(this.msChip, outOfReach ? `<b>${e.x.toFixed(1)} m</b> away · get to the spot first`
            : ms === 0 ? '<b>Spot on</b>' : `<b>${ms} ms</b> ${e.c < 0 ? 'early' : 'late'}`, true);
          this.msChip.style.color = outOfReach ? '#ffb13b' : GRADE_CSS[e.b]!;
          if (e.kind === E_WHIFF) this.set(this.shotChip, '');
          this.toggle(this.chips, 'on', true);
          this.chipsUntil = now + 1.4;
        }
        break;
      case E_HIT:
        if (human >= 0 && e.player === human) {
          this.set(this.shotChip, `${SHAPES[e.a]!.name} · <b>${(e.c * 3.6).toFixed(0)}</b> km/h`, true);
          this.toggle(this.chips, 'on', true);
          this.chipsUntil = now + 1.4;
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
