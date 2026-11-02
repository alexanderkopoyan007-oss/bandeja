// A player gone mid-match: the AI takes the seat on one agreed tick, whoever heard how much of their last hands.
import { describe, expect, it } from 'vitest';
import { CASES, Hands } from '../../tools/net/hash-core.ts';
import { RollbackClient, type Packet } from '../../src/net/rollback.ts';
import { MatchSim, PH_SETUP, PH_TOSS, type MatchConfig } from '../../src/sim/match.ts';

const LATENCY = 10, GONE_AT = 3000, NOTICE = 240, AFTER = 3000, TAIL = 64;

/** Three players; seat 2 stops at GONE_AT. `lost`: for the last 40 ticks before that, this client hears nothing of them. */
function run(cfg: MatchConfig, lost: number): { compared: number; differ: number; taken: number[] } {
  const clients = [0, 1, 2].map((s) => new RollbackClient(cfg, [s], { delay: 4 }));
  const hands = [0, 1, 2].map((s) => { const h = new Hands(cfg.seed + s * 977); h.timed = 0.045; return h; });
  const q: Array<{ at: number; to: number; p: Packet }> = [];
  for (let w = 0; w < GONE_AT + NOTICE + AFTER; w++) {
    for (let i = q.length - 1; i >= 0; i--) if (q[i]!.at <= w) { clients[q[i]!.to]!.receive(q[i]!.p); q.splice(i, 1); }
    for (let a = 0; a < 3; a++) {
      if (a === 2 && w >= GONE_AT) continue;
      const c = clients[a]!, m = c.sim, M = m as never as { score: { serverPlayer(): number } };
      c.local(a, hands[a]!.frame(m, a, m.tick, (m.phase === PH_SETUP || m.phase === PH_TOSS) && M.score.serverPlayer() === a));
      const p = c.packet(a);
      for (let b = 0; b < 3; b++) {
        if (b === a || (a === 2 && b === lost && w >= GONE_AT - 40)) continue;
        q.push({ at: w + LATENCY, to: b, p });
      }
      c.advance();
    }
    // Noticed: everyone passes on what they last heard of the seat, so the one who decides has it all.
    if (w === GONE_AT + NOTICE - 120) {
      const p = clients[1]!.packet(2, Math.max(0, clients[1]!.lastKnown[2]! - TAIL + 1));
      q.push({ at: w + LATENCY, to: 0, p });
    }
    if (w === GONE_AT + NOTICE) {
      // The lowest player left says when, with the last hands it has.
      const c0 = clients[0]!, at = c0.lastKnown[2]! + 1, first = Math.max(0, at - TAIL), tail = c0.packet(2, first).frames;
      expect(c0.dropSeat(2, at, first, tail)).toBe(true);
      expect(clients[1]!.dropSeat(2, at, first, tail)).toBe(true);
    }
  }
  const [a, b] = [clients[0]!, clients[1]!];
  let compared = 0, differ = 0;
  const sure = Math.min(a.confirmed, b.confirmed);
  for (const [t, h] of a.hashes) {
    if (t <= GONE_AT - 100 || t >= sure || !b.hashes.has(t)) continue;
    compared++;
    if (b.hashes.get(t) !== h) differ++;
  }
  return { compared, differ, taken: [a.sim.aiTaken, b.sim.aiTaken] };
}

describe('a player who has walked away', () => {
  it('the AI takes their seat when their serve has waited too long, on every client alike', () => {
    const cfg: MatchConfig = { ...CASES[2]!.cfg, firstServer: 0, serveClock: 3 };
    const a = new MatchSim(cfg), b = new MatchSim(cfg);
    let played = false;
    for (let i = 0; i < 120 * 12; i++) {
      a.step([null, null, null, null]);
      b.step([null, null, null, null]);
      played ||= a.phase !== PH_SETUP;
    }
    expect(a.aiTaken).toBeGreaterThan(0);
    expect(played).toBe(true);
    expect(b.hash()).toBe(a.hash());
  });

  it('without the clock a match waits, as it always has', () => {
    const m = new MatchSim({ ...CASES[2]!.cfg, firstServer: 0 });
    for (let i = 0; i < 120 * 12; i++) m.step([null, null, null, null]);
    expect(m.aiTaken).toBe(0);
    expect(m.phase).toBe(PH_SETUP);
  });
});

describe('a player leaving', () => {
  const cfg: MatchConfig = { ...CASES[2]!.cfg, human: [true, true, true, false] };
  for (const [name, lost] of [['everyone heard the same', -1], ['the other heard less', 1], ['the leader heard less', 0]] as const) {
    it(`the AI takes the seat and both stay on one match: ${name}`, () => {
      const r = run(cfg, lost);
      expect(r.taken).toEqual([4, 4]);
      expect(r.compared).toBeGreaterThan(30);
      expect(r.differ).toBe(0);
    });
  }
});
