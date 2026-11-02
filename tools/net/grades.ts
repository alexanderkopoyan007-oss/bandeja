// What input delay does to timing: a player lets go at the moment the cue shows, within `timed` s, and the sim takes the
// release `delay` ticks later. `lead` moves the cue that much sooner. No link here: both clients hear each other at once.
//   node tools/net/grades.ts [secs]
import { E_HIT, E_WHIFF, PH_SETUP, PH_TOSS, type MatchConfig } from '../../src/sim/match.ts';
import { GRADE_TEXT } from '../../src/sim/contact/timing.ts';
import { DT } from '../../src/sim/core/constants.ts';
import { RollbackClient } from '../../src/net/rollback.ts';
import { Hands } from './hash-core.ts';

const FORMAT = { mode: 1, setsToWin: 2, gamesPerSet: 6, finalSet: 0 };
const cfgOf = (seed: number): MatchConfig => ({ seed, doubles: true, human: [true, true, false, false], aiLevel: [0.8, 0.8], aiStyle: [], timingScale: 1.5, assist: 0.45, format: FORMAT, world: { court: 'standard', floor: 'turf', ball: 'standard', env: { temperatureC: 20, altitudeM: 0, windX: 0, windZ: 0, ceiling: 19 } } } as never);

function run(seed: number, delay: number, lead: number, timed: number, secs: number): number[] {
  const cfg = cfgOf(seed), a = new RollbackClient(cfg, [0], { delay }), b = new RollbackClient(cfg, [1], { delay });
  const H = [new Hands(seed), new Hands(seed + 977)];
  for (const h of H) { h.timed = timed; h.lead = lead; }
  const n = new Array(GRADE_TEXT.length + 1).fill(0);
  let seen = 0;
  const m = a.sim, M = m as never as { score: { serverPlayer(): number } };
  for (let t = 0; t < secs * 120; t++) {
    const toss = (s: number): boolean => (m.phase === PH_SETUP || m.phase === PH_TOSS) && M.score.serverPlayer() === s;
    a.local(0, H[0]!.frame(m, 0, m.tick, toss(0)));
    b.local(1, H[1]!.frame(b.sim, 1, b.sim.tick, toss(1)));
    const pa = a.packet(0), pb = b.packet(1);
    b.receive(pa);
    a.receive(pb);
    a.advance();
    b.advance();
    for (; seen < m.eventSeq; seen++) {
      const e = m.events[seen % m.events.length]!;
      if (e.player !== 0 && e.player !== 1) continue;
      if (e.kind === E_HIT) n[e.b]++;
      else if (e.kind === E_WHIFF) n[GRADE_TEXT.length]++;
    }
  }
  return n;
}

const secs = +(process.argv[2] ?? 600);
console.log(`released within ± of the cue | delay | cue moved | ${GRADE_TEXT.join(' | ')} | whiff | hits`);
for (const timed of [0.045, 0.08]) {
  for (const [delay, moved] of [[0, 0], [3, 0], [6, 0], [9, 0], [3, 1], [6, 1], [9, 1]] as const) {
    const n = new Array(GRADE_TEXT.length + 1).fill(0);
    for (const s of [61, 62, 63, 64, 65, 66, 67, 68, 69, 70]) run(5300000 + s, delay, moved ? delay * DT : 0, timed, secs / 10).forEach((v, i) => { n[i] += v; });
    const all = n.reduce((p, c) => p + c, 0);
    console.log(`${timed * 1000} ms | ${delay}t | ${moved ? 'yes' : 'no'} | ${n.map((v) => ((100 * v) / all).toFixed(0).padStart(3)).join(' | ')} | ${all}`);
  }
}
