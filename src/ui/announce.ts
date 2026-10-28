// Screen-reader announcements (Phase 8 accessibility): an ARIA live region, visually hidden, that says what the
// umpire would after each point (who won it and why, then the score, the player's side first), faults, lets, games,
// sets and the match. Off with the Accessibility setting "Announce the score".
import type { MatchSim, MatchEvent } from '../sim/match.ts';
import { PH_DEAD, E_POINT, E_FAULT, E_LET, E_GAME, E_SET, E_MATCH, E_ENDS } from '../sim/match.ts';
import { REASON_TEXT } from '../sim/rules/rally.ts';

export class Announcer {
  private readonly el: HTMLElement;
  private seen = 0;
  private wasDead = false;
  private pending = '';
  /** Text waiting for the next task (the region is cleared first, so the same words twice are read twice). */
  private next = '';
  private timer = 0;

  /** `sim`: start from its current events (turned on mid-match, nothing already said is said again). */
  constructor(root: HTMLElement, sim?: MatchSim) {
    if (sim) this.seen = sim.eventSeq;
    this.el = document.createElement('div');
    this.el.setAttribute('aria-live', 'polite');
    this.el.setAttribute('role', 'status');
    // Visually hidden, still read.
    this.el.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap';
    root.appendChild(this.el);
  }

  /** `team`: the player's team. */
  update(sim: MatchSim, team: number): void {
    if (sim.eventSeq - this.seen > sim.events.length) this.seen = sim.eventSeq - sim.events.length;
    while (this.seen < sim.eventSeq) {
      const e = sim.events[this.seen % sim.events.length]!;
      this.seen++;
      if (e.seq >= 0) this.onEvent(sim, e, team);
    }
    // The score is counted when the dead time ends: say it then, with what was saved from the point.
    const dead = sim.phase === PH_DEAD;
    if (this.wasDead && !dead && this.pending) {
      const pts = sim.score.display();
      const us = pts[team] || '0', them = pts[1 - team] || '0';
      const g = sim.score.games;
      const points = us === '0' && them === '0' ? '' : us === them ? ` ${us} all.` : ` ${us}, ${them}.`;
      this.say(`${this.pending}${points} Games ${g[team]}, ${g[1 - team]}.`);
      this.pending = '';
    }
    this.wasDead = dead;
  }

  private onEvent(sim: MatchSim, e: MatchEvent, team: number): void {
    const ours = e.team === team;
    switch (e.kind) {
      case E_POINT:
        this.pending = `${ours ? 'Your point' : 'Their point'}: ${REASON_TEXT[e.a] ?? ''}.`;
        break;
      case E_FAULT:
        if (e.b === 2) this.pending = `Double fault: ${REASON_TEXT[e.a] ?? ''}.`;
        else this.say(`Fault: ${REASON_TEXT[e.a] ?? ''}. Second serve.`);
        break;
      case E_LET:
        this.say('Let. Replay the serve.');
        break;
      case E_GAME:
        this.pending = `${this.pending} Game, ${ours ? 'you' : sim.doubles ? 'opponents' : 'opponent'}.`;
        break;
      case E_SET:
        this.pending = `${this.pending} Set, ${ours ? 'you' : sim.doubles ? 'opponents' : 'opponent'}.`;
        break;
      case E_MATCH:
        this.say(`${this.pending} Game, set and match. ${ours ? 'You win.' : sim.doubles ? 'Opponents win.' : 'Opponent wins.'}`);
        this.pending = '';
        break;
      case E_ENDS:
        this.pending = `${this.pending} Change of ends.`;
        break;
    }
  }

  private say(text: string): void {
    // A live region reads a change of its text. Clearing it and setting the same words in one task is no change
    // to a screen reader, so the words go in a later task (two calls in one frame are said together).
    this.next = this.next ? `${this.next} ${text.trim()}` : text.trim();
    this.el.textContent = '';
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => { this.el.textContent = this.next; this.next = ''; }, 60);
  }

  /** Turned off mid-match. */
  dispose(): void {
    clearTimeout(this.timer);
    this.el.remove();
  }
}
