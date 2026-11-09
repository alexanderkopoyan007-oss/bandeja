// "Bodies count" (M5 phase D, sim/player/bodyTune.ts, MatchConfig.bodyScale): a player's own height, legs, arms and
// trunk move their reach, contact heights and top speed; a match without bodies, or with neutral ones, is the match from
// before, to the bit; and bodies far from the tuned one still play whole matches, each meeting the ball where their own
// reach is.
import { describe, expect, it } from 'vitest';
import { MatchSim } from '../../src/sim/match.ts';
import { DEFAULT_TUNING } from '../../src/sim/player/player.ts';
import { isNeutralBody, tuneForBody, type BodyScale } from '../../src/sim/player/bodyTune.ts';

const ONE: BodyScale = { height: 1, legs: 1, arms: 1, torso: 1 };
const GIANT: BodyScale = { height: 1.3, legs: 1, arms: 1.4, torso: 1.1 };
const SMALL: BodyScale = { height: 0.75, legs: 0.8, arms: 0.8, torso: 0.9 };

function run(seed: number, doubles: boolean, bodyScale?: Array<BodyScale | null>, ticks = 10000): MatchSim {
  const n = doubles ? 4 : 2;
  const m = new MatchSim({ seed, doubles, human: new Array(n).fill(false), bodyScale });
  const none = new Array(n).fill(null);
  for (let k = 0; k < ticks; k++) m.step(none);
  return m;
}

describe('bodies count: the tuning', () => {
  it('a neutral body is the tuned player exactly', () => {
    expect(isNeutralBody(null)).toBe(true);
    expect(isNeutralBody(ONE)).toBe(true);
    expect(isNeutralBody({ ...ONE, arms: 1.01 })).toBe(false);
    const t = tuneForBody(DEFAULT_TUNING, ONE);
    for (const k of Object.keys(DEFAULT_TUNING) as Array<keyof typeof DEFAULT_TUNING>) {
      if (typeof DEFAULT_TUNING[k] === 'number') expect(t[k] as number, k).toBeCloseTo(DEFAULT_TUNING[k] as number, 12);
    }
  });

  it('taller, longer-armed and longer-legged reach higher and further and run faster; the racket stays a racket', () => {
    const base = DEFAULT_TUNING;
    const tall = tuneForBody(base, { ...ONE, height: 1.1 });
    // A 10% taller body: shoulder 10% higher, the arm's share of the reach 10% longer, not the racket's.
    expect(tall.reachShoulder).toBeCloseTo(base.reachShoulder * 1.1, 9);
    expect(tall.reachArm - base.reachArm).toBeCloseTo(0.073, 9);
    expect(tall.contactMaxHeight - base.contactMaxHeight).toBeCloseTo(tall.reachShoulder + tall.reachArm - base.reachShoulder - base.reachArm, 9);
    expect(tall.height).toBeCloseTo(base.height * 1.1, 9);
    expect(tall.maxSpeed).toBeCloseTo(base.maxSpeed * Math.sqrt(1.1), 9);
    // Arms alone: further across the floor and higher, no faster; legs alone: higher and faster, no further.
    const arms = tuneForBody(base, { ...ONE, arms: 1.2 }), legs = tuneForBody(base, { ...ONE, legs: 1.1 });
    expect(arms.reachMax - base.reachMax).toBeCloseTo(0.146, 9);
    expect(arms.contactMaxHeight).toBeGreaterThan(base.contactMaxHeight);
    expect(arms.maxSpeed).toBe(base.maxSpeed);
    expect(legs.reachMax).toBe(base.reachMax);
    expect(legs.reachShoulder).toBeGreaterThan(base.reachShoulder);
    expect(legs.maxSpeed).toBeGreaterThan(base.maxSpeed);
    // Overheads are planned higher on a taller reach, in proportion; the jump is the body's own.
    expect(tall.overheadIdealSmash / base.overheadIdealSmash).toBeCloseTo((tall.reachShoulder + tall.reachArm) / (base.reachShoulder + base.reachArm), 9);
    expect(tall.jumpHeight).toBe(base.jumpHeight);
    // Speed moves at most 15% either way, however long or short the legs.
    expect(tuneForBody(base, { ...ONE, height: 1.3, legs: 1.3 }).maxSpeed).toBeCloseTo(base.maxSpeed * 1.15, 9);
    expect(tuneForBody(base, { ...ONE, height: 0.7, legs: 0.65 }).maxSpeed).toBeCloseTo(base.maxSpeed * 0.85, 9);
  });
});

describe('bodies count: in play', () => {
  it('no bodies, neutral bodies and nulls: the match from before, to the bit', () => {
    // (the same golden hashes as tests/sim/rackets.test.ts: the match from before rackets and bodies differed)
    expect(run(42, false).hash().toString(16)).toBe('ef6e47b6');
    expect(run(42, false, [ONE, null]).hash().toString(16)).toBe('ef6e47b6');
    expect(run(7, true, [null, ONE, null, ONE]).hash().toString(16)).toBe('90c06c87');
  });

  it('a body that counts changes the match, and the same body the same way every time', () => {
    const a = run(42, false, [GIANT, null], 4000).hash(), b = run(42, false, [GIANT, null], 4000).hash();
    expect(a).toBe(b);
    expect(a).not.toBe(run(42, false, undefined, 4000).hash());
  });

  it('a giant and a small player play whole points, each meeting the ball within their own reach', () => {
    // (tuned bodies make about 35 contacts each in these 240 s of singles, between points included; these two rally
    // shorter, as the small one can't reach a lob)
    let giantTop = 0;
    for (const seed of [3, 11]) {
      const m = new MatchSim({ seed, doubles: false, human: [false, false], bodyScale: [GIANT, SMALL] });
      const none = [null, null];
      const top = [0, 0], hits = [0, 0], last = [-10, -10];
      for (let k = 0; k < 120 * 240; k++) {
        m.step(none);
        for (let i = 0; i < 2; i++) {
          const p = m.players[i]!;
          if (p.lastContactTime !== last[i]) {
            last[i] = p.lastContactTime;
            hits[i]++;
            top[i] = Math.max(top[i]!, p.lastContact.y);
          }
          expect(Number.isFinite(p.pos.x) && Number.isFinite(p.pos.z)).toBe(true);
        }
      }
      const [g, s] = [m.players[0]!.tune, m.players[1]!.tune];
      expect(hits[0]).toBeGreaterThan(15);
      expect(hits[1]).toBeGreaterThan(15);
      // Each within their own top (a jump's worth over it at most), the small one's well under anyone tuned.
      expect(top[0]).toBeLessThanOrEqual(g.contactMaxHeight + g.jumpHeight + 0.2);
      expect(top[1]).toBeLessThanOrEqual(s.contactMaxHeight + s.jumpHeight + 0.2);
      expect(s.contactMaxHeight).toBeLessThan(DEFAULT_TUNING.contactMaxHeight - 0.5);
      giantTop = Math.max(giantTop, top[0]!);
    }
    // The giant takes balls higher than any tuned body can.
    expect(giantTop).toBeGreaterThan(DEFAULT_TUNING.contactMaxHeight + DEFAULT_TUNING.jumpHeight);
  });
});
