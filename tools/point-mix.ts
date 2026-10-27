// How AI-vs-AI points end: reasons, the shot that ended them, rally length. For tuning the AI's error mix.
// node tools/point-mix.ts [seeds=6] [seconds=300] [singles]
import { MatchSim, E_HIT, E_NET, E_POINT } from '../src/sim/match.ts';
import { GRADE_TEXT } from '../src/sim/contact/timing.ts';
import { SHOT_KEYS } from '../src/sim/contact/shots.ts';
import * as R from '../src/sim/rules/rally.ts';

const seeds = Number(process.argv[2] ?? 6);
const secs = Number(process.argv[3] ?? 300);
const doubles = process.argv[4] !== 'singles';
const n = doubles ? 4 : 2;
const whyName: Record<number, string> = {};
for (const [k, v] of Object.entries(R)) if (k.startsWith('WHY_') && typeof v === 'number') whyName[v] = k.slice(4).toLowerCase();

const why: Record<string, number> = {};
const lastShot: Record<string, number> = {};
const lengths: number[] = [];
const byGrade: Record<string, number> = {};
const grades = [0, 0, 0, 0, 0, 0];
const shotsBy: Record<string, number> = {};
let hits = 0;
const lobErr: string[] = [];
let points = 0;
for (let s = 1; s <= seeds; s++) {
  const m = new MatchSim({ seed: s * 7919, doubles, human: new Array(n).fill(false) });
  const none = new Array(n).fill(null);
  let seen = 0, shots = 0, shot = '', grade = 0, speed = 0, cy = 0, cz = 0, net = false;
  for (let k = 0; k < 120 * secs; k++) {
    m.step(none);
    while (seen < m.eventSeq) {
      const e = m.events[seen % m.events.length]!;
      seen++;
      if (e.kind === E_HIT) { hits++; grades[e.b]!++; shots++; shot = SHOT_KEYS[e.a] ?? '?'; shotsBy[shot] = (shotsBy[shot] ?? 0) + 1; grade = e.b; speed = e.c; cy = e.y; cz = e.z; net = false; }
      else if (e.kind === E_NET) net = true;
      else if (e.kind === E_POINT) {
        points++;
        const w = whyName[e.a] ?? String(e.a);
        why[w] = (why[w] ?? 0) + 1;
        if (w === 'own_side' || w === 'out' || w === 'wall_before_bounce' || w === 'own_mesh') lastShot[`${w} after ${shot}`] = (lastShot[`${w} after ${shot}`] ?? 0) + 1;
        if (w === 'own_side') {
          const g = `${GRADE_TEXT[grade]}${net ? ' (net)' : ''}`;
          byGrade[g] = (byGrade[g] ?? 0) + 1;
          if (shot === (process.env.SHOT ?? 'lob')) lobErr.push(`${GRADE_TEXT[grade]} ${(speed * 3.6).toFixed(0)} km/h from ${cy.toFixed(2)} m high ${Math.abs(cz).toFixed(1)} m back${net ? ', net' : ''}`);
        }
        lengths.push(shots);
        shots = 0;
      }
    }
  }
}
const pct = (x: number) => `${((100 * x) / points).toFixed(1)}%`;
console.log(`${points} points, ${seeds} seeds x ${secs} s, ${doubles ? 'doubles' : 'singles'}`);
for (const [k, v] of Object.entries(why).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(26)} ${String(v).padStart(4)}  ${pct(v)}`);
console.log('errors by the shot that made them:');
for (const [k, v] of Object.entries(lastShot).sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${k.padEnd(34)} ${String(v).padStart(4)}  ${pct(v)}`);
console.log(`shots: ${Object.entries(shotsBy).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${((100 * v) / hits).toFixed(1)}%`).join(', ')}`);
console.log(`timing of all ${hits} hits: ${grades.map((g, i) => `${GRADE_TEXT[i]} ${((100 * g) / hits).toFixed(1)}%`).join(', ')}`);
console.log('own-side errors by the timing of the shot:');
for (const [k, v] of Object.entries(byGrade).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(26)} ${String(v).padStart(4)}  ${pct(v)}`);
if (lobErr.length) console.log(`${process.env.SHOT ?? 'lob'} into the net / own side: ${lobErr.join('; ')}`);
lengths.sort((a, b) => a - b);
console.log(`shots per point: median ${lengths[lengths.length >> 1]}, p90 ${lengths[Math.floor(lengths.length * 0.9)]}`);
