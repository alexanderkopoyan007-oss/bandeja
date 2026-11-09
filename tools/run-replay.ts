// Replays a kept challenge run (a DUMP from tools/challenge-check.mjs) in Node, straight through MatchSim with no game
// loop, and prints the tick each ball ended on beside the browser's: where a watched run parts from the run it kept.
//   node tools/run-replay.ts <dump.json> [challenge id]
import { readFileSync } from 'node:fs';
import { CHALLENGES, LESSONS, ChallengeRun } from '../src/game/challenge.ts';
import { LogPlayer } from '../src/game/inputLog.ts';
import { MatchSim } from '../src/sim/match.ts';

const dump = JSON.parse(readFileSync(process.argv[2]!, 'utf8'));
const id = process.argv[3] ?? 'targets';
const def = [...CHALLENGES, ...LESSONS].find((c) => c.id === id)!;
const sim = new MatchSim(dump.best.cfg);
const log = new LogPlayer(dump.best.log);
const run = new ChallengeRun(def);
const inputs = new Array(sim.players.length).fill(null);
const points: number[][] = [];
let last = 0;
while (!log.over) {
  inputs[0] = log.next();
  sim.step(inputs);
  run.update(sim);
  if (run.balls !== last) { last = run.balls; points.push([last, sim.tick, run.score]); }
}
console.log('node    ', JSON.stringify(points));
console.log('browser ', JSON.stringify(dump.points));
console.log('end', { ticks: sim.tick, balls: run.balls, score: run.score, hash: sim.hash() });
