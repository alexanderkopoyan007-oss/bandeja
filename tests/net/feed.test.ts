// The feed: an event is told once, a replay's new ones arrive late, and a point is called only when it can't be taken back.
import { describe, expect, it } from 'vitest';
import { NetFeed } from '../../src/net/feed.ts';
import { E_HIT, E_MATCH, E_POINT, type MatchEvent, type MatchSim } from '../../src/sim/match.ts';

function fakeSim() {
  const blank = (): MatchEvent => ({ seq: -1, kind: 0, time: 0, team: 0, player: -1, a: 0, b: 0, c: 0, x: 0, y: 0, z: 0, d: 0, q: 0 });
  const sim = { events: Array.from({ length: 64 }, blank), eventSeq: 0, time: 0 };
  const emit = (kind: number, player: number, time: number): void => {
    const e = sim.events[sim.eventSeq % 64]!;
    Object.assign(e, blank(), { kind, player, time, seq: sim.eventSeq++ });
  };
  return { sim: sim as unknown as MatchSim, raw: sim, emit };
}
const told = (f: NetFeed): Array<[number, number]> => Array.from({ length: f.eventSeq }, (_, i) => [f.events[i]!.kind, f.events[i]!.player]);

describe('the event feed', () => {
  it('passes a hit on at once and holds a point until it is sure', () => {
    const { sim, raw, emit } = fakeSim(), f = new NetFeed(sim);
    raw.time = 1;
    emit(E_HIT, 0, 0.9);
    emit(E_POINT, -1, 1);
    f.collect();
    f.settle(0.95);
    expect(told(f)).toEqual([[E_HIT, 0]]);
    f.settle(1.01);
    expect(told(f)).toEqual([[E_HIT, 0], [E_POINT, -1]]);
  });

  it('tells a replayed event once, and one a replay adds late', () => {
    const { sim, raw, emit } = fakeSim(), f = new NetFeed(sim);
    raw.time = 1;
    emit(E_HIT, 0, 0.95);
    f.collect();
    f.settle(0.5);
    // Back to before the hit: the same hit again a tick later, and a new one by the other player.
    raw.eventSeq = 0;
    f.rewound();
    emit(E_HIT, 0, 0.96);
    emit(E_HIT, 1, 0.97);
    f.collect();
    f.settle(0.5);
    expect(told(f)).toEqual([[E_HIT, 0], [E_HIT, 1]]);
  });

  it('a point a replay takes away is never called', () => {
    const { sim, raw, emit } = fakeSim(), f = new NetFeed(sim);
    raw.time = 1;
    emit(E_POINT, -1, 0.98);
    f.collect();
    f.settle(0.5);
    raw.eventSeq = 0;
    f.rewound();
    f.collect();
    f.settle(2);
    expect(f.eventSeq).toBe(0);
  });

  it('a match is over only when its last point is sure, and not if a replay takes it away', () => {
    const { sim, raw, emit } = fakeSim(), f = new NetFeed(sim);
    raw.time = 1;
    emit(E_MATCH, -1, 0.98);
    f.collect();
    f.settle(0.5);
    expect(f.over).toBe(false);
    raw.eventSeq = 0;
    f.rewound();
    f.collect();
    f.settle(2);
    expect(f.over).toBe(false);
    emit(E_MATCH, -1, 1.5);
    f.collect();
    f.settle(2);
    expect(f.over).toBe(true);
  });

  it('drops a new event that comes too late to mean anything', () => {
    const { sim, raw, emit } = fakeSim(), f = new NetFeed(sim);
    raw.time = 2;
    emit(E_HIT, 1, 1);
    f.collect();
    f.settle(0.5);
    expect(f.eventSeq).toBe(0);
  });
});
