// The capture day's shot list, from the sim (docs/motion-plan.md: "the shot list comes from the sim, not a guess"). AI
// doubles matches at mixed levels, styles and hands; every contact put in a cell by what its take must look like: the
// family (with the glass it came off), forehand or backhand, the ball's height and how far out to the side it was met.
// The cells that hold 95% of contacts get takes in proportion (at least two each), and each cell lists how its balls were
// met: in front or beside, and how the player came in (still, forward, back, across). Reads the sim only.
//   node tools/shot-list.ts [matches=32] [seconds=600] [takes=250] > docs/mocap-shotlist.md
import { MatchSim, E_HIT, E_FLOOR, E_WALL, E_POINT } from '../src/sim/match.ts';
import { SHOT_KEYS } from '../src/sim/contact/shots.ts';
import { STYLE_KEYS } from '../src/sim/ai/styles.ts';
import { WALL_BACK_NEAR, WALL_BACK_FAR } from '../src/sim/court/court.ts';

const matches = Number(process.argv[2] ?? 32);
const secs = Number(process.argv[3] ?? 600);
const TAKES = Number(process.argv[4] ?? 250);
const COVER = 0.95;
const HIST = 60;  // ticks (half a second at 120 Hz)
const CAP = 10;  // takes in one cell at most (a cell's balls vary only so much: a serve's hardly at all)

// Bins only as fine as a take's look changes: low balls bend the knees, mid ones are the stroke's home, high ones lift the
// arm, overheads are another stroke; close balls cramp the arm, reached ones take a long last step.
const HEIGHT = [[0.6, 'low'], [1.2, 'mid'], [2.0, 'high'], [99, 'overhead']] as const;
const OUT = [[0.5, 'close'], [0.9, 'arm out'], [99, 'reaching']] as const;
// A flat, topspin or slice drive is the same footwork and the same feed; the player varies the swing within the cell.
const BASE: Record<string, string> = { topspin: 'drive', slice: 'drive' };
const bin = (v: number, b: readonly (readonly [number, string])[]): string => b.find(([t]) => v < t)![1];

interface Contact { cell: string; family: string; hand: string; front: string; came: string; spin: string; stretch: boolean }
const contacts: Contact[] = [];
let points = 0;
let rng = 12345;
const rand = (): number => ((rng = (rng * 1103515245 + 12345) >>> 0) / 2 ** 32);

for (let mi = 0; mi < matches; mi++) {
  const lefty = [0, 1, 2, 3].map(() => rand() < 0.2);
  const aiStyle = [0, 1, 2, 3].map(() => (rand() < 0.3 ? '' : STYLE_KEYS[Math.floor(rand() * STYLE_KEYS.length)]!));
  const lv = (): number => 0.35 + 0.65 * rand();
  const m = new MatchSim({ seed: 1000 + mi * 7919, doubles: true, human: [false, false, false, false], aiLevel: [lv(), lv()],
    aiStyle, lefty, women: mi % 3 === 2 });
  const none = [null, null, null, null];
  let seen = 0;
  let bounced = false;
  let walls: number[] = [];
  // each player's velocity over the last half second (the sim plants the feet for the swing: at contact most are still)
  const hx = [0, 1, 2, 3].map(() => new Float64Array(HIST)), hz = [0, 1, 2, 3].map(() => new Float64Array(HIST));
  for (let k = 0; k < 120 * secs; k++) {
    m.step(none);
    for (let i = 0; i < 4; i++) { hx[i]![k % HIST] = m.players[i]!.vel.x; hz[i]![k % HIST] = m.players[i]!.vel.z; }
    while (seen < m.eventSeq) {
      const e = m.events[seen % m.events.length]!;
      seen++;
      if (e.kind === E_FLOOR) { bounced = true; walls = []; }
      else if (e.kind === E_WALL) { if (bounced) walls.push(e.b); }
      else if (e.kind === E_POINT) { points++; bounced = false; walls = []; }
      else if (e.kind === E_HIT) {
        const p = m.players[e.player]!;
        const s = m.side(p.team);
        const shot = SHOT_KEYS[e.a] ?? '?';
        const dx = e.x - p.pos.x, dz = e.z - p.pos.z;
        const contra = shot === 'contrapared';
        const fore = (dx * s * p.handed >= 0) !== contra;
        // the glass the ball came off after its bounce, if any (a drive off the back glass is another stroke)
        const back = walls.some((w) => w === WALL_BACK_NEAR || w === WALL_BACK_FAR);
        const sideGlass = walls.some((w) => w !== WALL_BACK_NEAR && w !== WALL_BACK_FAR);
        const glass = shot === 'serve' || !bounced || walls.length === 0 ? '' : back && sideGlass ? ' off back and side glass' : back ? ' off the back glass' : ' off the side glass';
        const family = (BASE[shot] ?? shot) + glass;
        const hand = shot === 'serve' ? 'forehand' : fore ? 'forehand' : 'backhand';
        const front = -s * dz;  // towards the net from the hips (m)
        // how they came in: their mean velocity over the half second before the contact
        let vx = 0, vz = 0;
        for (let j = 0; j < HIST; j++) { vx += hx[e.player]![j]!; vz += hz[e.player]![j]!; }
        vx /= HIST; vz /= HIST;
        const vf = -s * vz, vs = vx * Math.sign(dx || 1), sp = Math.hypot(vx, vz);
        const came = sp < 0.8 ? 'still' : Math.abs(vf) >= Math.abs(vs) ? (vf > 0 ? 'forward' : 'back') : (vs > 0 ? 'across to it' : 'away');
        contacts.push({
          cell: shot === 'serve' ? 'serve|forehand||' : `${family}|${hand}|${bin(e.y, HEIGHT)}|${bin(Math.abs(dx), OUT)}`,
          family, hand, front: front < -0.15 ? 'behind' : front < 0.3 ? 'beside' : 'in front', came,
          spin: shot === 'topspin' ? 'topspin' : shot === 'slice' ? 'slice' : 'flat', stretch: p.stretchKind !== 0,
        });
        bounced = false;
        walls = [];
      }
    }
  }
}

const N = contacts.length;
const cells = new Map<string, Contact[]>();
for (const c of contacts) (cells.get(c.cell) ?? cells.set(c.cell, []).get(c.cell)!).push(c);
const sorted = [...cells.entries()].sort((a, b) => b[1].length - a[1].length);
const pct = (n: number, of = N): string => `${((100 * n) / of).toFixed(1)}%`;
const mix = (cs: Contact[], key: 'front' | 'came' | 'spin'): string => {
  const n: Record<string, number> = {};
  for (const c of cs) n[c[key]] = (n[c[key]] ?? 0) + 1;
  return Object.entries(n).sort((a, b) => b[1] - a[1]).filter(([, v]) => v / cs.length >= 0.1).map(([k, v]) => `${k} ${Math.round((100 * v) / cs.length)}`).join(', ');
};

let cum = 0, takes = 0;
const rows: string[] = [];
for (const [cell, cs] of sorted) {
  if (cum >= COVER * N) break;
  cum += cs.length;
  const [family, hand, height, out] = cell.split('|');
  const t = Math.min(CAP, Math.max(1, Math.round((TAKES * cs.length) / N)));
  takes += t;
  const swing = family!.startsWith('drive') ? ` (${mix(cs, 'spin')})` : '';
  rows.push(`| ${family}${swing} | ${hand} | ${height || '-'} | ${out || '-'} | ${pct(cs.length)} | ${pct(cum)} | ${t} | ${mix(cs, 'front')} | ${mix(cs, 'came')} |`);
}
const fam = new Map<string, number>();
for (const c of contacts) fam.set(`${c.family}|${c.hand}`, (fam.get(`${c.family}|${c.hand}`) ?? 0) + 1);
const stretched = contacts.filter((c) => c.stretch).length;

const out: string[] = [];
out.push('# Capture shot list, from the sim');
out.push('');
out.push(`*Made by \`node tools/shot-list.ts ${matches} ${secs} ${TAKES}\`: ${matches} AI doubles matches of ${secs / 60} min (AI levels 0.35-1, styles and left-handers mixed, a third women's), ${points} points, ${N} contacts. The sim is a stand-in for real play: a person at the controls hits from the same windows, but their mix will differ a little.*`);
out.push('');
out.push(`**${rows.length} cells hold ${pct(cum)} of all contacts; ${takes} takes** (in proportion to each cell's share of ${TAKES}, at least one and at most ${CAP} per cell). The rest (${sorted.length - rows.length} cells, ${pct(N - cum)}) use the nearest captured take, or the procedural keys until one exists. ${pct(stretched)} of contacts were dives or jumps; those stay procedural (no dives on court).`);
out.push('');
out.push('A drive cell lists its swings (flat, topspin, slice: the same feed, the player varies the swing). In each cell: "met" is where the ball was against the hips (in front, beside, behind), "came in" how the player arrived over the last half second (still under 0.8 m/s; else moving forward, back, across to the ball, away from it), as shares of the cell (%). Film the takes in that mix.');
out.push('');
out.push('| Family | Hand | Ball height | Out to the side | Share | Running total | Takes | Met | Came in |');
out.push('|---|---|---|---|---|---|---|---|---|');
out.push(...rows);
out.push('');
out.push('## By family (all contacts)');
out.push('');
out.push('| Family | Forehand | Backhand |');
out.push('|---|---|---|');
const fams = [...new Set(contacts.map((c) => c.family))].sort((a, b) => ((fam.get(`${b}|forehand`) ?? 0) + (fam.get(`${b}|backhand`) ?? 0)) - ((fam.get(`${a}|forehand`) ?? 0) + (fam.get(`${a}|backhand`) ?? 0)));
for (const f of fams) out.push(`| ${f} | ${pct(fam.get(`${f}|forehand`) ?? 0)} | ${pct(fam.get(`${f}|backhand`) ?? 0)} |`);
out.push('');
const ranges = (b: readonly (readonly [number, string])[]): string => b.map(([t, l], i) => `${l} ${i === 0 ? `under ${t} m` : t === 99 ? `${b[i - 1]![0]} m and up` : `${b[i - 1]![0]}-${t} m`}`).join('; ');
out.push(`Ball height: ${ranges(HEIGHT)}. Out to the side, from the hips: ${ranges(OUT)}.`);
console.log(out.join('\n'));
