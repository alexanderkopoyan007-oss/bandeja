// What the HUD, sound, stats and the rest read in an online match. The sim's own event list can change under them: a rewind
// takes it back, and the replay may say something else. So they read this instead. An event is passed on once; a replay's new
// ones arrive late rather than never; what ends a point waits until every seat's inputs up to it are known, so no point is
// called and then taken back. In a match without rollback eventsOf() is the sim itself. docs/net-proof.md has the numbers.
import { E_ENDS, E_FAULT, E_GAME, E_LET, E_MATCH, E_POINT, E_SET, type MatchEvent, type MatchSim } from '../sim/match.ts';

export interface EventSource { readonly events: readonly MatchEvent[]; readonly eventSeq: number }

const FEEDS = new WeakMap<object, EventSource>();
export const eventsOf = (sim: MatchSim): EventSource => FEEDS.get(sim) ?? sim;

interface Held { e: MatchEvent; given: boolean }
const blank = (): MatchEvent => ({ seq: -1, kind: 0, time: 0, team: 0, player: -1, a: 0, b: 0, c: 0, x: 0, y: 0, z: 0, d: 0, q: 0 });
const SAME_S = 0.06;
/** A new event from a replay is passed on if it is no older than this (s): later, a sound would belong to nothing on screen. */
const LATE_MAX = 0.3;
const RING = 64;

export class NetFeed implements EventSource {
  readonly events: MatchEvent[] = Array.from({ length: RING }, blank);
  eventSeq = 0;
  /** The match's last point has been confirmed: nothing can change who won. */
  over = false;
  private readonly sim: MatchSim;
  private live: Held[] = [];
  private gone: Held[] = [];
  private read: number;

  constructor(sim: MatchSim) {
    this.sim = sim;
    this.read = sim.eventSeq;
    FEEDS.set(sim, this);
  }

  /** The sim has just gone back to a snapshot. */
  rewound(): void {
    const at = this.sim.eventSeq;
    const keep: Held[] = [];
    for (const h of this.live) (h.e.seq < at ? keep : this.gone).push(h);
    this.live = keep;
    this.read = at;
  }

  /** After any step or replay: read what the sim has added. An event the last timeline had too is the same event. */
  collect(): void {
    const s = this.sim;
    for (; this.read < s.eventSeq; this.read++) {
      const e = { ...s.events[this.read % s.events.length]! };
      const twin = this.gone.findIndex((h) => h.e.kind === e.kind && h.e.player === e.player && Math.abs(h.e.time - e.time) < SAME_S);
      this.live.push({ e, given: twin >= 0 && this.gone[twin]!.given });
      if (twin >= 0) this.gone.splice(twin, 1);
    }
  }

  /** Once a frame. `sure`: the sim time up to which nothing can change. */
  settle(sure: number): void {
    this.gone.length = 0;
    const now = this.sim.time;
    for (const h of this.live) {
      if (h.given) continue;
      const k = h.e.kind, slow = k === E_POINT || k === E_FAULT || k === E_LET || k === E_GAME || k === E_SET || k === E_MATCH || k === E_ENDS;
      if (slow ? h.e.time > sure : false) continue;
      h.given = true;
      if (k === E_MATCH) this.over = true;
      if (!slow && now - h.e.time > LATE_MAX) continue;
      const out = this.events[this.eventSeq % RING]!;
      Object.assign(out, h.e);
      out.seq = this.eventSeq++;
    }
    let drop = 0;
    while (drop < this.live.length && this.live[drop]!.given && this.live[drop]!.e.time <= sure) drop++;
    if (drop > 0) this.live.splice(0, drop);
  }
}
