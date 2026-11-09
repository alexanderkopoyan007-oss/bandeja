// The rackets (data/rackets.json, sim/contact/racket.ts, racketStats.ts): every one inside the FIP's limits and the
// published ranges, stats measured from the impact model and ordered as its physics says, the same order showing in
// play through strike(), and a match without rackets (or with `standard` for everyone) is the match from before
// rackets differed, to the bit.
import { describe, expect, it } from 'vitest';
import { MatchSim } from '../../src/sim/match.ts';
import { Ball } from '../../src/sim/ball/ball.ts';
import { Rng } from '../../src/sim/core/rng.ts';
import { V3 } from '../../src/sim/core/v3.ts';
import { Racket, RACKETS, RACKET_IDS, swingWeight, type RacketSpec } from '../../src/sim/contact/racket.ts';
import { racketStats } from '../../src/sim/contact/racketStats.ts';
import racketData from '../../data/rackets.json';
import {
  ShotSolver, strike, MOD_NONE, SHOT_CHIQUITA, SHOT_DRIVE, SHOT_SMASH, type ShotRequest, type ShotResult,
} from '../../src/sim/contact/shots.ts';

const BALL_M = 0.0577, BALL_R = 0.0328, ALPHA = 0.55;
const spec = (id: string): RacketSpec => RACKETS[id]!;
/** The catalogue: every racket but `standard` and the career's prize rackets (M6 phase E: `prize` in data/rackets.json). */
const isPrize = (id: string): boolean => !!(racketData as unknown as Record<string, { prize?: unknown }>)[id]?.prize;
const MADE = RACKET_IDS.filter((id) => id !== 'standard' && !isPrize(id));
const PRIZES = RACKET_IDS.filter(isPrize);
const stats = new Map(RACKET_IDS.map((id) => [id, racketStats(spec(id))]));
const st = (id: string) => stats.get(id)!;

/** Spearman rank correlation. */
function spearman(a: number[], b: number[]): number {
  const rank = (v: number[]): number[] => {
    const o = v.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array<number>(v.length);
    o.forEach(([, i], k) => { r[i] = k; });
    return r;
  };
  const ra = rank(a), rb = rank(b), n = a.length;
  const d2 = ra.reduce((s, r, i) => s + (r - rb[i]!) ** 2, 0);
  return 1 - (6 * d2) / (n * (n * n - 1));
}

describe('rackets: limits and ranges', () => {
  it('24 rackets from 6 made-up makers, 4 each, and `standard` as it was', () => {
    expect(MADE.length).toBe(24);
    const makers = new Map<string, number>();
    for (const id of MADE) makers.set(spec(id).brand!, (makers.get(spec(id).brand!) ?? 0) + 1);
    expect([...makers.values()]).toEqual([4, 4, 4, 4, 4, 4]);
    // No real padel or tennis maker's name, in the maker or the model.
    const real = ['adidas', 'bullpadel', 'nox', 'head', 'babolat', 'wilson', 'siux', 'starvie', 'varlion', 'dunlop', 'drop shot', 'black crown',
      'vibor-a', 'kombat', 'royal padel', 'enebe', 'akkeron', 'vairo', 'joma', 'oxdog', 'softee', 'tecnifibre', 'prince', 'puma', 'asics',
      'slazenger', 'yonex', 'lok', 'kuikma', 'cartri', 'sane', 'mystica', 'orygen', 'harlem', 'j\'hayber', 'zephyr', 'metalbone', 'vertex'];
    for (const id of MADE) for (const r of real) expect(spec(id).name.toLowerCase().split(/[^a-z'-]+/)).not.toContain(r);
    const s = spec('standard');
    expect([s.mass, s.balance, s.iCm, s.iPolar, s.e17, s.eSlope, s.friction, s.headLength, s.headWidth])
      .toEqual([0.36, 0.265, 0.0075, 0.0018, 0.742, 0.0107, 0.35, 0.29, 0.26]);
  });

  it('the career’s three prize rackets are built by the same rules, from the makers, reading unlike any other', () => {
    expect(PRIZES).toEqual(['orza-trofeo', 'vilano-corona', 'granza-maestro']);
    const KC = { round: [0.14434, 0.07071, 0.29, 0.26], teardrop: [0.146, 0.0696, 0.284, 0.256], diamond: [0.1478, 0.0685, 0.276, 0.252] } as const;
    const SLOPE = { soft: 0.0135, medium: 0.0107, hard: 0.0085, xhard: 0.0068 } as const;
    const FRIC = { gloss: 0.22, matte: 0.3, sand: 0.45, rough: 0.62 } as const;
    const makers = new Set(MADE.map((id) => spec(id).brand));
    const read = new Set(MADE.map((id) => { const r = st(id); return [r.power, r.control, r.sweetSpot, r.spin, r.manoeuvrability].map(Math.round).join(','); }));
    for (const id of [...PRIZES, 'qarro-yunque']) {
      const r = spec(id) as ReturnType<typeof spec> & { shape: keyof typeof KC; core: keyof typeof SLOPE; face: keyof typeof FRIC };
      const [kc, kp, hl, hw] = KC[r.shape];
      expect(r.iCm, id).toBeCloseTo(r.mass * kc * kc, 5);
      expect(r.iPolar, id).toBeCloseTo(r.mass * kp * kp, 5);
      expect(r.eSlope, id).toBe(SLOPE[r.core]);
      expect(r.e17, id).toBeCloseTo(0.67245 + 6.5 * SLOPE[r.core], 4);
      expect(r.friction, id).toBe(FRIC[r.face]);
      expect([r.headLength, r.headWidth], id).toEqual([hl, hw]);
      expect(makers.has(r.brand), id).toBe(true);
    }
    for (const id of PRIZES) {
      const x = st(id);
      expect(read.has([x.power, x.control, x.sweetSpot, x.spin, x.manoeuvrability].map(Math.round).join(',')), id).toBe(false);
    }
  });

  it('every racket meets the FIP limits: 45.5 cm long, 26 cm wide, 38 mm thick', () => {
    for (const id of RACKET_IDS) {
      const s = spec(id);
      expect(s.length, id).toBeLessThanOrEqual(0.455);
      expect(s.headWidth, id).toBeLessThanOrEqual(0.26);
      expect(s.thickness ?? 0.038, id).toBeLessThanOrEqual(0.038);
      // The head and a 12 cm handle fit in the length; the balance point is inside the racket.
      expect(s.headLength + 0.12, id).toBeLessThanOrEqual(s.length);
      expect(s.balance, id).toBeLessThan(s.length);
    }
  });

  it('inside the published ranges: mass 340-385 g, balance 255-285 mm, face friction 0.14-0.93, ACOR 0.36-0.55 at its best', () => {
    for (const id of RACKET_IDS) {
      const s = spec(id);
      expect(s.mass, id).toBeGreaterThanOrEqual(0.34);
      expect(s.mass, id).toBeLessThanOrEqual(0.385);
      expect(s.balance, id).toBeGreaterThanOrEqual(0.255);
      expect(s.balance, id).toBeLessThanOrEqual(0.285);
      expect(s.friction, id).toBeGreaterThanOrEqual(0.14);
      expect(s.friction, id).toBeLessThanOrEqual(0.93);
      // Viollaz & Viollaz (ISBS 2008): apparent COR at the best point 0.36-0.55 for 14 rackets, measured at 17 and 29 m/s.
      const rk = new Racket(s, BALL_M, BALL_R, ALPHA);
      for (const u of [17, 23, 29]) {
        expect(rk.acor(u, rk.comFromTip, 0), `${id} ${u}`).toBeGreaterThan(0.36);
        expect(rk.acor(u, rk.comFromTip, 0), `${id} ${u}`).toBeLessThan(0.55);
      }
    }
  });
});

describe('rackets: stats', () => {
  it('are 0-100, and the standard racket swings and times exactly as before', () => {
    for (const id of RACKET_IDS) {
      const r = st(id);
      for (const k of ['power', 'control', 'sweetSpot', 'spin', 'manoeuvrability'] as const) {
        expect(r[k], `${id} ${k}`).toBeGreaterThanOrEqual(0);
        expect(r[k], `${id} ${k}`).toBeLessThanOrEqual(100);
      }
    }
    const rk = new Racket(spec('standard'), BALL_M, BALL_R, ALPHA);
    expect(rk.faceK).toBe(1);
    expect(rk.timingK).toBe(1);
  });

  it('they spread: every bar spans at least 60 points across the 24, and no two rackets read the same', () => {
    for (const k of ['power', 'control', 'sweetSpot', 'spin', 'manoeuvrability'] as const) {
      const v = MADE.map((id) => st(id)[k]);
      expect(Math.max(...v) - Math.min(...v), k).toBeGreaterThan(60);
    }
    const keys = new Set(MADE.map((id) => { const r = st(id); return [r.power, r.control, r.sweetSpot, r.spin, r.manoeuvrability].map(Math.round).join(','); }));
    expect(keys.size).toBe(24);
  });

  // Twins: one racket changed in one thing, so the stat follows that thing alone.
  const base = spec('palique-tertulia');
  it('a harder core hits a full swing faster (power), a softer one returns a slow ball faster', () => {
    const hard = { ...base, e17: 0.7277, eSlope: 0.0085 }, soft = { ...base, e17: 0.7602, eSlope: 0.0135 };
    expect(racketStats(hard).power).toBeGreaterThan(racketStats(base).power);
    expect(racketStats(base).power).toBeGreaterThan(racketStats(soft).power);
    const rh = new Racket(hard, BALL_M, BALL_R, ALPHA), rs = new Racket(soft, BALL_M, BALL_R, ALPHA);
    expect(rs.acor(15, 0.128, 0)).toBeGreaterThan(rh.acor(15, 0.128, 0));
    expect(rh.acor(35, 0.128, 0)).toBeGreaterThan(rs.acor(35, 0.128, 0));
  });

  it('more inertia across and along the face scatters off-centre hits less (control) and keeps more face in pace (sweet spot)', () => {
    const stable = { ...base, iCm: base.iCm * 1.15, iPolar: base.iPolar * 1.15 };
    expect(racketStats(stable).control).toBeGreaterThan(racketStats(base).control);
    expect(racketStats(stable).sweetSpot).toBeGreaterThan(racketStats(base).sweetSpot);
    // (A narrower face doesn't shrink it: pace falls off across the face well inside its edge. The face's size shows
    // as frame hits in strike() instead.)
  });

  it('a rougher face spins a glancing brush more, until the ball grips', () => {
    const fr = [0.22, 0.3, 0.45, 0.62].map((f) => racketStats({ ...base, friction: f }).spin);
    for (let k = 1; k < fr.length; k++) expect(fr[k]).toBeGreaterThan(fr[k - 1]!);
    // Square on, every face grips and gives the same spin (TWU).
    const v = new V3(0, 0, -12), w = new V3(), n = new V3(0, 0, 1), a = new V3(1, 0, 0), V = new V3(0, 0.34, 0.94).scale(19);
    const spinOf = (f: number): number => {
      const vo = new V3(), wo = new V3();
      new Racket({ ...base, friction: f }, BALL_M, BALL_R, ALPHA).impact(v, w, n, V, a, 0.128, 0, vo, wo);
      return wo.x;
    };
    expect(spinOf(0.62)).toBeCloseTo(spinOf(0.3), 6);
  });

  it('a lighter swing weight swings faster (manoeuvrability) and turns the face faster, so its windows are a little tighter', () => {
    const light = { ...base, mass: 0.345 }, heavy = { ...base, mass: 0.38, balance: 0.28 };
    expect(swingWeight(light)).toBeLessThan(swingWeight(base));
    expect(racketStats(light).manoeuvrability).toBeGreaterThan(racketStats(heavy).manoeuvrability);
    const rl = new Racket(light, BALL_M, BALL_R, ALPHA), rh = new Racket(heavy, BALL_M, BALL_R, ALPHA);
    expect(rl.faceK).toBeGreaterThan(1);
    expect(rh.faceK).toBeLessThan(1);
    expect(rl.timingK).toBeLessThan(1);
    expect(rh.timingK).toBeGreaterThan(1);
    // A little: Cross & Bower's n = 0.27 keeps every racket within 6% of the standard's face speed.
    for (const id of RACKET_IDS) {
      const r = st(id).raw;
      expect(Math.abs(r.faceK - 1), id).toBeLessThan(0.06);
      expect(r.timingK * r.timingK * r.faceK, id).toBeCloseTo(1, 12);
    }
  });
});

describe('rackets: in play (strike)', () => {
  const m = new MatchSim({ seed: 1, doubles: true, human: [false, false, false, false] });
  const solver = new ShotSolver(m.world, RACKET_IDS, RACKET_IDS.length);
  const res: ShotResult = { reachable: false, speed: 0, idealX: 0, idealZ: 0 };
  function hit(id: string, shot: number, seed: number, p: number[], v: number[], tz: number, q: number, wx = 0): Ball {
    const b = new Ball();
    b.pos.set(p[0]!, p[1]!, p[2]!);
    b.vel.set(v[0]!, v[1]!, v[2]!);
    b.spin.set(wx, 0, 0);
    const req: ShotRequest = {
      shot, mod: MOD_NONE, targetX: 0, targetZ: tz, inAir: true, quality: q, timingDelta: 0, handSide: 1, moving: 0.3, stretch: 0,
      power: 1, control: 1, spinScale: 1, motor: 0, bodyX: p[0]! + 0.6, bodyZ: p[2]! + 0.3,
    };
    strike(solver, b, req, new Rng(seed), res, solver.rackets[RACKET_IDS.indexOf(id)]!);
    return b;
  }

  it('the solver holds each player\'s racket, `standard` as the one shared racket', () => {
    const s = new ShotSolver(m.world, ['qarro-yunque', undefined as unknown as string, 'standard', 'no-such-racket'], 4);
    expect(s.rackets[0]!.spec).toBe(spec('qarro-yunque'));
    expect(s.rackets[1]).toBe(s.racket);
    expect(s.rackets[2]).toBe(s.racket);
    expect(s.rackets[3]).toBe(s.racket);
    expect(new ShotSolver(m.world).rackets.every((r) => r === new ShotSolver(m.world).racket || r.spec === spec('standard'))).toBe(true);
  });

  it('power: a full smash is faster off a higher-power racket (rank correlation over all 25)', () => {
    const speed = RACKET_IDS.map((id) => {
      let s = 0;
      for (let k = 0; k < 6; k++) { hit(id, SHOT_SMASH, 100 + k, [0.3, 2.7, 4.5], [0, -5, 4], -6, 1); s += res.speed; }
      return s / 6;
    });
    expect(spearman(RACKET_IDS.map((id) => st(id).power), speed)).toBeGreaterThan(0.9);
    const i = RACKET_IDS.indexOf('qarro-yunque'), j = RACKET_IDS.indexOf('vilano-pavesa');
    expect(speed[i]! - speed[j]!).toBeGreaterThan(1.2); // m/s
  });

  it('control: drives off a higher-control racket land closer together (same swings, same errors)', () => {
    const scatter = (id: string): number => {
      const L: Array<[number, number]> = [];
      for (let k = 0; k < 120; k++) {
        const b = hit(id, SHOT_DRIVE, 500 + k, [0.5, 0.9, 9], [0, -2, 12], -7, 0.82);
        let vy = b.vel.y;
        for (let t = 0; t < 720; t++) {
          b.step(m.world, 1 / 120, null);
          if (vy < 0 && b.vel.y > 0 && b.pos.y < 0.3) { L.push([b.pos.x, b.pos.z]); break; }
          vy = b.vel.y;
        }
      }
      const mx = L.reduce((a, l) => a + l[0], 0) / L.length, mz = L.reduce((a, l) => a + l[1], 0) / L.length;
      return Math.sqrt(L.reduce((a, l) => a + (l[0] - mx) ** 2 + (l[1] - mz) ** 2, 0) / L.length);
    };
    const byControl = [...MADE].sort((a, b) => st(b).control - st(a).control);
    const top = byControl.slice(0, 3).map(scatter), bottom = byControl.slice(-3).map(scatter);
    expect(Math.max(...top)).toBeLessThan(Math.min(...bottom));
  });

  it('spin: a chiquita against a topspin ball (the spin turned round) keeps more of its spin off a rougher face', () => {
    const spin = (id: string): number => {
      let s = 0;
      for (let k = 0; k < 4; k++) s += Math.abs(hit(id, SHOT_CHIQUITA, 300 + k, [0.3, 0.6, 7], [0, -2, 8], -3.3, 1, 241).spin.x);
      return s / 4;
    };
    // Gloss, matte, sand, rough: the same maker's shapes, one face each.
    const g = spin('palique-sobremesa'), mt = spin('palique-tertulia'), sd = spin('palique-verbena'), rg = spin('granza-lija');
    expect(g).toBeLessThan(mt);
    expect(mt).toBeLessThan(sd);
    // (sand and rough both grip here: the same spin, as TWU found for every face in the grip range)
    expect(rg).toBeGreaterThan(sd * 0.99);
    expect(st('granza-lija').spin).toBeGreaterThan(st('palique-sobremesa').spin);
  });
});

describe('rackets: determinism', () => {
  /** 10k ticks (83 s) of AI play; the hashes below were taken before rackets differed (commit c153442). */
  function run(seed: number, doubles: boolean, rackets?: string[]): number {
    const n = doubles ? 4 : 2;
    const m = new MatchSim({ seed, doubles, human: new Array(n).fill(false), rackets });
    const none = new Array(n).fill(null);
    for (let k = 0; k < 10000; k++) m.step(none);
    return m.hash();
  }

  it('no rackets, all `standard`, and the match from before rackets differed: the same state after 10k ticks', () => {
    const singles = run(42, false), doubles = run(7, true);
    expect(singles.toString(16)).toBe('ef6e47b6');
    expect(doubles.toString(16)).toBe('90c06c87');
    expect(run(42, false, ['standard', 'standard'])).toBe(singles);
    expect(run(7, true, ['standard', 'standard', 'standard', 'standard'])).toBe(doubles);
  });

  it('other rackets play another match, the same one every time', () => {
    const mixed = ['qarro-yunque', 'lumbra-sosiego', 'vilano-pavesa', 'orza-galerna'];
    const a = run(7, true, mixed);
    expect(a).not.toBe(run(7, true));
    expect(run(7, true, mixed)).toBe(a);
  });
});
