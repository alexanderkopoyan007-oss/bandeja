// AI-vs-AI doubles, headless, measured the way match-analysis studies measure professional padel
// (docs/research/shots-movement-feel.md §1, §5): shots and seconds per point, rally-length shares, the shot mix,
// where shots are hit from, how points end (winner / forced error / unforced error), per-stroke outcomes, serve
// numbers, the serving pair's win rate by rally length; plus the doubles, personality and difficulty measures of
// docs/ai.md. Runs on worker threads.
//
//   node tools/match-stats.ts [--points 1500 | --matches 20] [--level 1] [--levels 1,0.4] [--styles reloj,muro,...]
//                             [--workers 6] [--seed0 1] [--json out.json] [--quiet]
//
// --levels gives each team its own level (team 0, team 1); --styles gives the four players' styles (player number
// order: 0 and 1 face each other, 2 and 3 are their partners).
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  MatchSim, E_HIT, E_NET, E_POINT, E_FAULT, E_WALL, E_FLOOR, E_WHIFF, E_MATCH, PH_RALLY, PH_OVER, WHIFF_TIMING,
} from '../src/sim/match.ts';
import { SHOT_KEYS } from '../src/sim/contact/shots.ts';
import { WALL_BACK_NEAR, WALL_BACK_FAR } from '../src/sim/court/court.ts';
import { DT } from '../src/sim/core/constants.ts';
import * as R from '../src/sim/rules/rally.ts';
import { pressureOf, PRESSURE_FORCED } from '../src/sim/ai/pressure.ts';

// ---- what is counted -----------------------------------------------------------------------------------------

/** Stroke classes as the observation studies code them (Mellado-Arbelo et al. 2019; lobs counted inside). */
export const CLASSES = ['serve', 'volley', 'bandeja', 'vibora', 'smash', 'groundstroke', 'back-wall', 'side-wall', 'double-wall'] as const;
type Outcome = 'W' | 'FE' | 'UE' | 'cont';

interface Counts {
  points: number;
  shotsPer: number[];
  secsPer: number[];
  ends: { W: number; FE: number; UE: number };
  endWhy: Record<string, number>;
  /** Winners: double bounce on the opponents' side / ball came back over the net / out of the court. */
  winHow: { bounce: number; back: number; out: number; body: number };
  /** Errors: into the net / on the full into a back wall / side wall / other. */
  errHow: { net: number; back: number; side: number; other: number };
  strokes: Record<string, Record<Outcome, number>>;
  lobs: number;
  chiquitas: number;
  drops: number;
  shots: number;
  zone: { back: number; transition: number; net: number };
  firstServes: number;
  firstFaults: number;
  secondServes: number;
  doubleFaults: number;
  /** Serving pair's points won / played, by rally length in shots: 1-2, 3-4, 5-6, 7-8, 9+. */
  srvLen: number[][];
  srvWon: number;
  /** Rally time (player-ticks) by depth, and per team formation shares (ticks). */
  playerTicks: number;
  netTicks: number;
  formation: { up: number; back: number; split: number };
  /** Both pairs together: both up, one up one back, both back, any split (ticks). */
  pairs: { allUp: number; upBack: number; allBack: number; mixed: number };
  /** Mean distance between partners (sum, n). */
  mateDist: [number, number];
  /** Winners whose last shot was each stroke class (Sánchez-Alcaraz et al. 2022 report this split). */
  lastWin: Record<string, number>;
  lastErr: Record<string, number>;
  /** Per player style: shots by class, lobs, chiquitas+drops, smashes/overheads, net ticks, W/E. */
  perStyle: Record<string, StyleCounts>;
  /** Per team level: W, FE, UE endings caused by that team (winner hit by it / error made by it). */
  perLevel: Record<string, { W: number; FE: number; UE: number; points: number; won: number }>;
  /** Pressure of every shot, and of shots that were errors, in bins of 0.25 (for docs/ai.md). */
  pressureBins: number[];
  pressureErrBins: number[];
  matches: number;
  matchWins: [number, number];
  simSeconds: number;
}

interface StyleCounts {
  shots: number; lobs: number; touch: number; overheads: number; smashes: number; viboras: number; volleys: number;
  wall: number; netTicks: number; ticks: number; W: number; UE: number; FE: number;
}

function emptyCounts(): Counts {
  return {
    points: 0, shotsPer: [], secsPer: [], ends: { W: 0, FE: 0, UE: 0 }, endWhy: {},
    winHow: { bounce: 0, back: 0, out: 0, body: 0 }, errHow: { net: 0, back: 0, side: 0, other: 0 },
    strokes: {}, lobs: 0, chiquitas: 0, drops: 0, shots: 0, zone: { back: 0, transition: 0, net: 0 },
    firstServes: 0, firstFaults: 0, secondServes: 0, doubleFaults: 0,
    srvLen: [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0]], srvWon: 0,
    playerTicks: 0, netTicks: 0, formation: { up: 0, back: 0, split: 0 }, pairs: { allUp: 0, upBack: 0, allBack: 0, mixed: 0 }, mateDist: [0, 0],
    lastWin: {}, lastErr: {}, perStyle: {}, perLevel: {}, pressureBins: new Array(16).fill(0), pressureErrBins: new Array(16).fill(0),
    matches: 0, matchWins: [0, 0], simSeconds: 0,
  };
}

const whyName: Record<number, string> = {};
for (const [k, v] of Object.entries(R)) if (k.startsWith('WHY_') && typeof v === 'number') whyName[v] = k.slice(4).toLowerCase();

interface Hit {
  player: number; team: number; kind: string; cls: string; t: number; pressure: number;
}

interface Job {
  seeds: number[];
  points: number;
  matches: boolean;
  levels: [number, number];
  styles: string[];
}

function runJob(job: Job): Counts {
  const c = emptyCounts();
  const styleKey = (i: number) => job.styles[i] ?? 'reloj';
  const ps = (i: number): StyleCounts => (c.perStyle[styleKey(i)] ??= { shots: 0, lobs: 0, touch: 0, overheads: 0, smashes: 0, viboras: 0, volleys: 0, wall: 0, netTicks: 0, ticks: 0, W: 0, UE: 0, FE: 0 });
  const pl = (team: number) => (c.perLevel[String(job.levels[team])] ??= { W: 0, FE: 0, UE: 0, points: 0, won: 0 });
  for (const seed of job.seeds) {
    const m = new MatchSim({ seed, doubles: true, human: [false, false, false, false], aiLevel: job.levels, aiStyle: job.styles });
    let seen = 0;
    let hits: Hit[] = [];
    let pointStart = -1;
    // Since the last strike: bounces on the floor, walls touched after the bounce, net touched.
    let bounced = 0, backWall = 0, sideWall = 0, netTouch = false, wallOnFull = -1;
    let lastFloorZ = 0;
    let whiffTeam = -1, whiffPressure = 0;
    let lastSpeed = 0;
    let lastStrikeT = -1;
    const limit = job.matches ? 1e9 : job.points;
    let pointsHere = 0;
    for (let k = 0; pointsHere < limit && m.phase !== PH_OVER && k < 120 * 3600 * 4; k++) {
      lastSpeed = Math.hypot(m.ball.vel.x, m.ball.vel.y, m.ball.vel.z);
      m.step([null, null, null, null]);
      if (m.phase === PH_RALLY) {
        for (let i = 0; i < 4; i++) {
          const p = m.players[i]!;
          const near = Math.abs(p.pos.z) < 4;
          c.playerTicks++;
          if (near) c.netTicks++;
          const st = ps(i);
          st.ticks++;
          if (near) st.netTicks++;
        }
        let st0 = 0;
        for (let team = 0; team < 2; team++) {
          const a = m.players[team]!, b = m.players[team + 2]!;
          const ua = Math.abs(a.pos.z) < 5, ub = Math.abs(b.pos.z) < 5;
          const stt = ua && ub ? 1 : !ua && !ub ? 2 : 3;
          if (team === 0) st0 = stt;
          else if (st0 === 3 || stt === 3) c.pairs.mixed++;
          else if (st0 === 1 && stt === 1) c.pairs.allUp++;
          else if (st0 === 2 && stt === 2) c.pairs.allBack++;
          else c.pairs.upBack++;
          if (ua && ub) c.formation.up++; else if (!ua && !ub) c.formation.back++; else c.formation.split++;
          c.mateDist[0] += Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
          c.mateDist[1]++;
        }
      }
      while (seen < m.eventSeq) {
        const e = m.events[seen % m.events.length]!;
        seen++;
        if (e.kind === E_HIT) {
          const kind = SHOT_KEYS[e.a] ?? '?';
          if (kind === 'serve') { hits = []; pointStart = e.time; }
          const p = m.players[e.player]!;
          const pressure = kind === 'serve' ? 0 : m.lastPressure;
          const cls = kind === 'serve' ? 'serve'
            : kind === 'smash' || kind === 'bandeja' || kind === 'vibora' ? kind
              : bounced === 0 ? 'volley'
                : backWall + sideWall > 1 ? 'double-wall' : backWall > 0 ? 'back-wall' : sideWall > 0 ? 'side-wall' : 'groundstroke';
          hits.push({ player: e.player, team: e.team, kind, cls, t: e.time, pressure });
          c.shots++;
          if (kind === 'lob') c.lobs++;
          if (kind === 'chiquita') c.chiquitas++;
          if (kind === 'drop') c.drops++;
          const st = ps(e.player);
          st.shots++;
          if (kind === 'lob') st.lobs++;
          if (kind === 'chiquita' || kind === 'drop') st.touch++;
          if (kind === 'smash' || kind === 'bandeja' || kind === 'vibora') st.overheads++;
          if (kind === 'smash') st.smashes++;
          if (kind === 'vibora') st.viboras++;
          if (cls === 'volley') st.volleys++;
          if (cls.endsWith('wall')) st.wall++;
          if (kind !== 'serve') {
            const bin = Math.min(15, Math.floor(pressure / 0.25));
            c.pressureBins[bin]!++;
          }
          const dz = Math.abs(e.z);
          if (dz < 4) c.zone.net++; else if (dz < 7) c.zone.transition++; else c.zone.back++;
          bounced = 0; backWall = 0; sideWall = 0; netTouch = false; wallOnFull = -1; whiffTeam = -1;
          lastStrikeT = e.time;
        } else if (e.kind === E_WALL) {
          const back = e.b === WALL_BACK_NEAR || e.b === WALL_BACK_FAR;
          if (bounced > 0) { if (back) backWall++; else sideWall++; }
          else if (wallOnFull < 0) wallOnFull = back ? 1 : 0;
        } else if (e.kind === E_FLOOR) { bounced++; lastFloorZ = e.z; }
        else if (e.kind === E_NET) { netTouch = true; }
        else if (e.kind === E_WHIFF && e.y === WHIFF_TIMING) {
          // Swung at a ball in reach and missed it (a ball never reached is the hitter's winner, not an error).
          const p = m.players[e.player]!;
          whiffTeam = e.team;
          const b = m.ball.pos;
          whiffPressure = pressureOf(lastSpeed, lastStrikeT >= 0 ? e.time - lastStrikeT : 9, Math.hypot(b.x - p.pos.x, b.z - p.pos.z), Math.hypot(p.vel.x, p.vel.z), b.y, backWall + sideWall > 0, backWall + sideWall > 1);
        } else if (e.kind === E_FAULT) {
          if (e.b === 1) { c.firstServes++; c.firstFaults++; } else {
            // A double fault: the point goes to the receivers, an unforced error of the server's (one shot).
            c.secondServes++; c.doubleFaults++;
            pointsHere++;
            c.points++;
            c.shotsPer.push(1);
            const why = whyName[e.a] ?? String(e.a);
            c.endWhy[why] = (c.endWhy[why] ?? 0) + 1;
            c.ends.UE++;
            pl(e.team).UE++;
            for (let team = 0; team < 2; team++) { pl(team).points++; if (team !== e.team) pl(team).won++; }
            c.srvLen[0]![1]!++;
            c.lastErr.serve = (c.lastErr.serve ?? 0) + 1;
            if (e.a === R.WHY_SERVE_NET) c.errHow.net++; else if (e.a === R.WHY_SERVE_WALL_FIRST) c.errHow.back++; else c.errHow.other++;
            (c.strokes.serve ??= { W: 0, FE: 0, UE: 0, cont: 0 }).UE++;
          }
          hits = []; lastStrikeT = -1;
        } else if (e.kind === E_MATCH) {
          c.matches++;
          c.matchWins[e.team === 0 ? 0 : 1]++;
        } else if (e.kind === E_POINT) {
          const why = whyName[e.a] ?? String(e.a);
          if (e.b === 1) c.firstServes++; else if (e.b === 2) c.secondServes++;
          const winner = e.team;
          const n = hits.length;
          pointsHere++;
          if (n === 0) { hits = []; continue; }
          c.points++;
          c.endWhy[why] = (c.endWhy[why] ?? 0) + 1;
          c.shotsPer.push(n);
          if (pointStart >= 0) c.secsPer.push(e.time - pointStart);
          const server = hits[0]!.team;
          const bucket = n <= 2 ? 0 : n <= 4 ? 1 : n <= 6 ? 2 : n <= 8 ? 3 : 4;
          c.srvLen[bucket]![1]!++;
          if (winner === server) { c.srvLen[bucket]![0]!++; c.srvWon++; }
          for (let team = 0; team < 2; team++) { pl(team).points++; if (winner === team) pl(team).won++; }
          // The point's last shot: a winner if it was the winning team's and the loser never got a racket to it;
          // otherwise the loser's last action (a shot that failed, or a swing that missed) was an error, forced
          // if the ball put them under pressure (pressure.ts, fixed before any tuning).
          const last = hits[n - 1]!;
          let lastO: Outcome;
          let errTeam = -1;
          if (last.team === winner && whiffTeam !== 1 - winner && e.a !== R.WHY_HIT_BODY_OWN) {
            lastO = 'W';
            c.ends.W++;
            pl(winner).W++;
            ps(last.player).W++;
            c.lastWin[last.cls] = (c.lastWin[last.cls] ?? 0) + 1;
            if (e.a === R.WHY_HIT_BODY_OPP) c.winHow.body++;
            else if (e.a === R.WHY_EXIT_AFTER_BOUNCE) c.winHow.out++;
            else if (Math.sign(lastFloorZ) === Math.sign(m.side(winner))) c.winHow.back++;
            else c.winHow.bounce++;
          } else {
            const whiffed = last.team === winner;
            errTeam = 1 - winner;
            const pr = whiffed ? whiffPressure : last.pressure;
            const forced = pr >= PRESSURE_FORCED;
            lastO = forced ? 'FE' : 'UE';
            if (forced) { c.ends.FE++; pl(errTeam).FE++; } else { c.ends.UE++; pl(errTeam).UE++; }
            if (!whiffed) {
              if (forced) ps(last.player).FE++; else ps(last.player).UE++;
              c.lastErr[last.cls] = (c.lastErr[last.cls] ?? 0) + 1;
              c.pressureErrBins[Math.min(15, Math.floor(pr / 0.25))]!++;
            } else c.lastErr.whiff = (c.lastErr.whiff ?? 0) + 1;
            if (whiffed) c.errHow.other++;
            else if (e.a === R.WHY_OWN_SIDE && netTouch) c.errHow.net++;
            else if (e.a === R.WHY_WALL_BEFORE_BOUNCE) { if (wallOnFull === 1) c.errHow.back++; else c.errHow.side++; }
            else if (e.a === R.WHY_OWN_SIDE) c.errHow.net++;
            else c.errHow.other++;
          }
          // Every shot's outcome, as in Mellado-Arbelo et al. (Table 1a): the last shot W or UE/FE (an error: the
          // error is the failing shot's; FE also credits the shot before it, which forced it), the rest cont.
          for (let i = 0; i < n; i++) {
            const h = hits[i]!;
            const r = (c.strokes[h.cls] ??= { W: 0, FE: 0, UE: 0, cont: 0 });
            let o: Outcome = 'cont';
            if (i === n - 1) o = lastO === 'W' ? 'W' : lastO === 'UE' || lastO === 'FE' ? (last.team === winner ? 'cont' : 'UE') : 'cont';
            else if (i === n - 2 && lastO === 'FE' && last.team !== winner) o = 'FE';
            if (i === n - 1 && lastO === 'FE' && last.team === winner) o = 'FE'; // a forced whiff credits the shot
            r[o]++;
          }
          hits = [];
          pointStart = -1;
          lastStrikeT = -1;
        }
      }
    }
    c.simSeconds += m.time;
  }
  return c;
}

function merge(a: Counts, b: Counts): Counts {
  const out = a;
  const add = (x: Record<string, number>, y: Record<string, number>) => { for (const [k, v] of Object.entries(y)) x[k] = (x[k] ?? 0) + v; };
  out.points += b.points;
  out.shotsPer.push(...b.shotsPer);
  out.secsPer.push(...b.secsPer);
  add(out.ends, b.ends); add(out.endWhy, b.endWhy); add(out.winHow, b.winHow); add(out.errHow, b.errHow);
  for (const [k, v] of Object.entries(b.strokes)) add((out.strokes[k] ??= { W: 0, FE: 0, UE: 0, cont: 0 }), v);
  out.lobs += b.lobs; out.chiquitas += b.chiquitas; out.drops += b.drops; out.shots += b.shots;
  add(out.zone, b.zone);
  out.firstServes += b.firstServes; out.firstFaults += b.firstFaults; out.secondServes += b.secondServes; out.doubleFaults += b.doubleFaults;
  for (let i = 0; i < 5; i++) { out.srvLen[i]![0]! += b.srvLen[i]![0]!; out.srvLen[i]![1]! += b.srvLen[i]![1]!; }
  out.srvWon += b.srvWon;
  out.playerTicks += b.playerTicks; out.netTicks += b.netTicks;
  add(out.formation, b.formation);
  add(out.pairs, b.pairs);
  out.mateDist[0] += b.mateDist[0]; out.mateDist[1] += b.mateDist[1];
  add(out.lastWin, b.lastWin); add(out.lastErr, b.lastErr);
  for (const [k, v] of Object.entries(b.perStyle)) add((out.perStyle[k] ??= { shots: 0, lobs: 0, touch: 0, overheads: 0, smashes: 0, viboras: 0, volleys: 0, wall: 0, netTicks: 0, ticks: 0, W: 0, UE: 0, FE: 0 }) as unknown as Record<string, number>, v as unknown as Record<string, number>);
  for (const [k, v] of Object.entries(b.perLevel)) add((out.perLevel[k] ??= { W: 0, FE: 0, UE: 0, points: 0, won: 0 }), v);
  for (let i = 0; i < 16; i++) { out.pressureBins[i]! += b.pressureBins[i]!; out.pressureErrBins[i]! += b.pressureErrBins[i]!; }
  out.matches += b.matches; out.matchWins[0] += b.matchWins[0]; out.matchWins[1] += b.matchWins[1];
  out.simSeconds += b.simSeconds;
  return out;
}

// ---- the summary, against the published numbers --------------------------------------------------------------

export interface Summary {
  points: number;
  shotsPerPoint: number;
  secondsPerPoint: number;
  shotsPerSecond: number;
  durShare: number[];
  endings: { W: number; FE: number; UE: number };
  errorsIntoNet: number;
  firstServeFaults: number;
  doubleFaults: number;
  serverWins: number;
  serverWinsByLen: number[];
  mix: Record<string, number>;
  lobShare: number;
  zone: { back: number; transition: number; net: number };
  netTime: number;
  formation: { up: number; back: number; split: number };
  pairs: { allUp: number; upBack: number; allBack: number; mixed: number };
  mateDist: number;
  strokes: Record<string, { n: number; W: number; FE: number; UE: number }>;
  perStyle: Record<string, Record<string, number>>;
  perLevel: Record<string, { W: number; FE: number; UE: number; won: number }>;
  winHow: Record<string, number>;
  errHow: Record<string, number>;
  lastWin: Record<string, number>;
  lastErr: Record<string, number>;
  matches: number;
}

export function summarise(c: Counts): Summary {
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const share = (o: Record<string, number>) => { const n = sum(Object.values(o)); return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v / Math.max(1, n)])); };
  const secs = c.secsPer;
  const mix: Record<string, number> = {};
  for (const [k, r] of Object.entries(c.strokes)) mix[k] = (r.W + r.FE + r.UE + r.cont) / Math.max(1, c.shots);
  const strokes: Summary['strokes'] = {};
  for (const [k, r] of Object.entries(c.strokes)) { const n = r.W + r.FE + r.UE + r.cont; strokes[k] = { n, W: r.W / n, FE: r.FE / n, UE: r.UE / n }; }
  const perStyle: Summary['perStyle'] = {};
  for (const [k, s] of Object.entries(c.perStyle)) {
    perStyle[k] = {
      lob: s.lobs / Math.max(1, s.shots), touch: s.touch / Math.max(1, s.shots), overhead: s.overheads / Math.max(1, s.shots),
      smashOfOverheads: s.smashes / Math.max(1, s.overheads), viboraOfOverheads: s.viboras / Math.max(1, s.overheads),
      volley: s.volleys / Math.max(1, s.shots), wall: s.wall / Math.max(1, s.shots), net: s.netTicks / Math.max(1, s.ticks),
      winnersPerShot: s.W / Math.max(1, s.shots), uePerShot: s.UE / Math.max(1, s.shots), shots: s.shots,
    };
  }
  const perLevel: Summary['perLevel'] = {};
  for (const [k, v] of Object.entries(c.perLevel)) {
    const ends = v.W + v.FE + v.UE;
    perLevel[k] = { W: v.W / Math.max(1, ends), FE: v.FE / Math.max(1, ends), UE: v.UE / Math.max(1, ends), won: v.won / Math.max(1, v.points) };
  }
  return {
    points: c.points,
    shotsPerPoint: sum(c.shotsPer) / Math.max(1, c.points),
    secondsPerPoint: sum(secs) / Math.max(1, secs.length),
    shotsPerSecond: sum(c.shotsPer) / Math.max(1e-9, sum(secs)),
    durShare: [secs.filter((x) => x < 4.5).length, secs.filter((x) => x >= 4.5 && x < 7.5).length, secs.filter((x) => x >= 7.5 && x < 11.5).length, secs.filter((x) => x >= 11.5).length].map((v) => v / Math.max(1, secs.length)),
    endings: share(c.ends) as Summary['endings'],
    errorsIntoNet: c.errHow.net / Math.max(1, c.errHow.net + c.errHow.back + c.errHow.side + c.errHow.other),
    firstServeFaults: c.firstFaults / Math.max(1, c.firstServes),
    doubleFaults: c.doubleFaults / Math.max(1, c.secondServes),
    serverWins: c.srvWon / Math.max(1, c.points),
    serverWinsByLen: c.srvLen.map(([w, n]) => w! / Math.max(1, n!)),
    mix,
    lobShare: c.lobs / Math.max(1, c.shots),
    zone: share(c.zone) as Summary['zone'],
    netTime: c.netTicks / Math.max(1, c.playerTicks),
    formation: share(c.formation) as Summary['formation'],
    pairs: share(c.pairs) as Summary['pairs'],
    mateDist: c.mateDist[0] / Math.max(1, c.mateDist[1]),
    strokes, perStyle, perLevel,
    winHow: share(c.winHow), errHow: share(c.errHow), lastWin: share(c.lastWin), lastErr: share(c.lastErr),
    matches: c.matches,
  };
}

const pct = (v: number) => `${(100 * v).toFixed(1)}%`;

export function report(s: Summary, c: Counts): string {
  const L: string[] = [];
  L.push(`${s.points} points${s.matches ? `, ${s.matches} matches` : ''}, ${(c.simSeconds / 3600).toFixed(1)} h of play`);
  L.push(`shots per point ${s.shotsPerPoint.toFixed(1)} (pros 10-11; national 8-9.4)   seconds per point ${s.secondsPerPoint.toFixed(1)} (pros 9.4-14.8)   shots per second ${s.shotsPerSecond.toFixed(2)} (pros 0.80)`);
  L.push(`rally 1-4 s / 5-7 / 8-11 / >11: ${s.durShare.map(pct).join(' / ')} (pros 26 / 26 / 22 / 26)`);
  L.push(`endings W / FE / UE: ${pct(s.endings.W)} / ${pct(s.endings.FE)} / ${pct(s.endings.UE)} (pros men main draw 34-42 / 29-33 / 29-33)`);
  L.push(`  winners: ${Object.entries(s.winHow).map(([k, v]) => `${k} ${pct(v)}`).join(', ')} (pros men: double bounce 48, came back over 35, out 17)`);
  L.push(`  errors: ${Object.entries(s.errHow).map(([k, v]) => `${k} ${pct(v)}`).join(', ')} (pros men: net 51, back wall on the full 28, side 17, other 3)`);
  L.push(`  last shot of winners: ${Object.entries(s.lastWin).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v)}`).join(', ')} (pros: smash 43, volley 28, bandeja/víbora 13, groundstroke 6)`);
  L.push(`  last shot of errors: ${Object.entries(s.lastErr).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v)}`).join(', ')} (pros: volley 30, groundstroke 30, lob 15, bandeja/víbora 10, smash 2)`);
  L.push(`first-serve faults ${pct(s.firstServeFaults)} of ${c.firstServes} (pros ~10)   double faults ${pct(s.doubleFaults)} of ${c.secondServes} second serves (pros ~2)`);
  L.push(`serving pair wins ${pct(s.serverWins)} (pros men ~62); by shots 1-2/3-4/5-6/7-8/9+: ${s.serverWinsByLen.map(pct).join(' / ')} (national 98 / 65 / 64 / 57 / 42)`);
  L.push(`shot mix: ${Object.entries(s.mix).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v)}`).join(', ')}; lobs ${pct(s.lobShare)} of all shots`);
  L.push(`  (pros men 2014: volley 29.6, groundstroke 23.1, serve 12.3, back-wall 12.8, side-wall 2.7, double-wall 3.5, bandeja 6.0, smash 6.9; lobs ~20 elite 2013, 9 national)`);
  L.push(`hit from back / transition / net: ${pct(s.zone.back)} / ${pct(s.zone.transition)} / ${pct(s.zone.net)} (pros 49 / 19 / 26)`);
  L.push(`player-time within 4 m of the net ${pct(s.netTime)}; pairs both up ${pct(s.formation.up)}, both back ${pct(s.formation.back)}, split ${pct(s.formation.split)}; partners ${s.mateDist.toFixed(2)} m apart`);
  L.push(`  both pairs: one up and one back ${pct(s.pairs.upBack)}, all four up ${pct(s.pairs.allUp)}, all four back ${pct(s.pairs.allBack)}, a pair split ${pct(s.pairs.mixed)}`);
  L.push(`per stroke (pros: smash W 45 UE 6; bandeja W 3.5 UE 3; volley W 3-6 UE 3-5; groundstroke/back-wall W <1 UE 5-6):`);
  for (const [k, r] of Object.entries(s.strokes).sort((a, b) => b[1].n - a[1].n)) L.push(`  ${k.padEnd(13)} n ${String(r.n).padStart(6)}  W ${pct(r.W).padStart(6)}  FE ${pct(r.FE).padStart(6)}  UE ${pct(r.UE).padStart(6)}`);
  if (Object.keys(s.perLevel).length > 1) {
    L.push('per level (endings caused by that team; pros W 35-42 UE 29-33, qualifiers UE 37):');
    for (const [k, v] of Object.entries(s.perLevel)) L.push(`  level ${k}: W ${pct(v.W)} FE ${pct(v.FE)} UE ${pct(v.UE)}  points won ${pct(v.won)}`);
  }
  if (Object.keys(s.perStyle).length > 1) {
    L.push('per style: lob / touch / overhead / smash-of-overheads / víbora-of-overheads / volley / wall / net time / W per shot / UE per shot');
    for (const [k, v] of Object.entries(s.perStyle)) L.push(`  ${k.padEnd(10)} ${['lob', 'touch', 'overhead', 'smashOfOverheads', 'viboraOfOverheads', 'volley', 'wall', 'net', 'winnersPerShot', 'uePerShot'].map((f) => pct(v[f]!).padStart(6)).join(' ')}  (${v.shots} shots)`);
  }
  return L.join('\n');
}

// ---- running -------------------------------------------------------------------------------------------------

export async function runStats(opt: { points?: number; matches?: number; levels: [number, number]; styles: string[]; workers?: number; seed0?: number }): Promise<{ summary: Summary; counts: Counts }> {
  const workers = Math.max(1, Math.min(opt.workers ?? Math.min(6, availableParallelism() - 2), 16));
  const matches = opt.matches ?? 0;
  // Points mode: many short runs (one seed each, `per` points) so the sample spans many seeds.
  const per = 60;
  const nSeeds = matches > 0 ? matches : Math.ceil((opt.points ?? 1500) / per);
  const seed0 = opt.seed0 ?? 1;
  const seeds = Array.from({ length: nSeeds }, (_, i) => (seed0 + i) * 7919);
  const jobs: Job[] = Array.from({ length: workers }, (_, w) => ({ seeds: seeds.filter((_, i) => i % workers === w), points: per, matches: matches > 0, levels: opt.levels, styles: opt.styles }));
  const file = fileURLToPath(import.meta.url);
  const parts = await Promise.all(jobs.filter((j) => j.seeds.length).map((j) => new Promise<Counts>((res, rej) => {
    const w = new Worker(file, { workerData: j });
    w.once('message', res);
    w.once('error', rej);
  })));
  const counts = parts.reduce((a, b) => merge(a, b), emptyCounts());
  return { summary: summarise(counts), counts };
}

if (!isMainThread) {
  parentPort!.postMessage(runJob(workerData as Job));
} else if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
  const level = Number(arg('level') ?? 1);
  const lv = arg('levels')?.split(',').map(Number);
  const levels: [number, number] = lv ? [lv[0]!, lv[1] ?? lv[0]!] : [level, level];
  const styles = arg('styles')?.split(',') ?? [];
  const t0 = performance.now();
  const { summary, counts } = await runStats({
    points: arg('points') ? Number(arg('points')) : undefined, matches: arg('matches') ? Number(arg('matches')) : undefined,
    levels, styles, workers: arg('workers') ? Number(arg('workers')) : undefined, seed0: arg('seed0') ? Number(arg('seed0')) : undefined,
  });
  if (!process.argv.includes('--quiet')) console.log(report(summary, counts));
  console.log(`(${((performance.now() - t0) / 1000).toFixed(1)} s)`);
  const out = arg('json');
  if (out) writeFileSync(out, JSON.stringify(summary, null, 1));
}
void DT;
