// Fits a camera to each reference photo from its marked court points (reference/photos.json `points`: image
// position u, v from 0 to 1 across and down, and the court position x, y, z in metres, sim axes). Unknowns: the
// camera's position, yaw, pitch, roll, vertical field of view and one radial lens term k1 (wide lenses bow the court's
// edges; the game draws without distortion, so photo and game agree best near the centre). Many starts round the
// court, then Levenberg-Marquardt. Writes `cam` back into photos.json and prints each fit's error in pixels.
// Usage: node tools/photo-solve.ts [id]
import { readFileSync, writeFileSync } from 'node:fs';

type Pt = { u: number; v: number; x: number; y: number; z: number; what?: string };
type Photo = { id: string; aspect?: number; px?: number; points?: Pt[]; cam?: unknown; k1?: boolean };
const file = new URL('../reference/photos.json', import.meta.url);
const doc = JSON.parse(readFileSync(file, 'utf8')) as { photos: Photo[] };
const only = process.argv[2];

/** p = [cx, cy, cz, yaw, pitch, roll, vfovDeg, k1]. Yaw 0 looks along -z; positive yaw turns left (towards -x). */
function project(p: number[], aspect: number, x: number, y: number, z: number, out: number[]): boolean {
  const [cx, cy, cz, yaw, pitch, roll, fov, k1] = p as [number, number, number, number, number, number, number, number];
  let dx = x - cx, dy = y - cy, dz = z - cz;
  // Into the camera frame: undo yaw (about y), then pitch (about x), then roll (about z). Camera looks along -z.
  const cyw = Math.cos(yaw), syw = Math.sin(yaw);
  const x1 = cyw * dx - syw * dz, z1 = syw * dx + cyw * dz;
  dx = x1; dz = z1;
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const y2 = cp * dy - sp * dz, z2 = sp * dy + cp * dz;
  dy = y2; dz = z2;
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const x3 = cr * dx + sr * dy, y3 = -sr * dx + cr * dy;
  if (dz > -0.1) return false;
  const f = 1 / Math.tan((fov * Math.PI) / 360); // focal length in half-heights
  let nx = (x3 / -dz) * f / aspect, ny = (y3 / -dz) * f; // -1..1 across the image
  const r2 = nx * nx * aspect * aspect + ny * ny;
  const d = 1 + k1 * r2;
  nx *= d; ny *= d;
  out[0] = 0.5 + nx * 0.5;
  out[1] = 0.5 - ny * 0.5;
  return true;
}

function residuals(p: number[], ph: Photo, aspect: number, out: number[]): number {
  const q = [0, 0];
  let s = 0;
  ph.points!.forEach((pt, i) => {
    let ru = 1, rv = 1;
    if (project(p, aspect, pt.x, pt.y, pt.z, q)) { ru = (q[0]! - pt.u) * aspect; rv = q[1]! - pt.v; }
    out[2 * i] = ru; out[2 * i + 1] = rv;
    s += ru * ru + rv * rv;
  });
  return s;
}

function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]!]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[piv]![c]!)) piv = r;
    [M[c], M[piv]] = [M[piv]!, M[c]!];
    const d = M[c]![c]! || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / d;
      for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  return M.map((r, i) => r[n]! / (r[i]! || 1e-12));
}

function lm(p0: number[], ph: Photo, aspect: number, free: boolean[], iters = 200): { p: number[]; s: number } {
  let p = p0.slice();
  const m = ph.points!.length * 2;
  const r = new Array<number>(m).fill(0), r2 = new Array<number>(m).fill(0);
  let s = residuals(p, ph, aspect, r);
  let lam = 1e-3;
  const idx = free.map((f, i) => (f ? i : -1)).filter((i) => i >= 0);
  for (let it = 0; it < iters; it++) {
    const J: number[][] = [];
    for (const k of idx) {
      const h = k < 3 ? 1e-4 : k === 6 ? 1e-3 : 1e-6;
      const q = p.slice(); q[k]! += h;
      residuals(q, ph, aspect, r2);
      J.push(r2.map((v, i) => (v - r[i]!) / h));
    }
    const n = idx.length;
    const A = Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => J[a]!.reduce((t, v, i) => t + v * J[b]![i]!, 0)));
    const g = Array.from({ length: n }, (_, a) => -J[a]!.reduce((t, v, i) => t + v * r[i]!, 0));
    let improved = false;
    for (let tries = 0; tries < 10; tries++) {
      const Ad = A.map((row, a) => row.map((v, b) => (a === b ? v * (1 + lam) + 1e-12 : v)));
      const dp = solveLinear(Ad, g);
      const q = p.slice();
      idx.forEach((k, a) => { q[k]! += dp[a]!; });
      q[6] = Math.min(150, Math.max(3, q[6]!));
      const sq = residuals(q, ph, aspect, r2);
      if (sq < s) { p = q; s = sq; r.splice(0, m, ...r2); lam = Math.max(1e-9, lam / 3); improved = true; break; }
      lam *= 4;
    }
    if (!improved) break;
  }
  return { p, s };
}

for (const ph of doc.photos) {
  if (only && ph.id !== only) continue;
  if (!ph.points || ph.points.length < 4) continue;
  const aspect = ph.aspect ?? 1.5;
  const free = [true, true, true, true, true, true, true, ph.k1 !== false && ph.points.length >= 6];
  let best = { p: [0, 0, 0, 0, 0, 0, 50, 0], s: Infinity };
  // Starts: round the court at several heights and distances, looking at the court's centre.
  for (const h of [1.2, 1.7, 3, 6, 10, 16, 24]) {
    for (const dist of [6, 10, 15, 22, 32, 45]) {
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        const cx = Math.sin(ang) * dist, cz = Math.cos(ang) * (dist + 4);
        const yaw = Math.atan2(cx, cz); // look back at the origin
        const pitch = -Math.atan2(h - 0.5, Math.hypot(cx, cz));
        for (const fov of [25, 45, 70]) {
          const free6 = [true, true, true, true, true, true, true, false];
          const r = lm([cx, h, cz, yaw, pitch, 0, fov, 0], ph, aspect, free6, 40);
          if (r.s < best.s) best = r;
        }
      }
    }
  }
  best = lm(best.p, ph, aspect, free, 400);
  const [cx, cy, cz, yaw, pitch, roll, fov, k1] = best.p as [number, number, number, number, number, number, number, number];
  const px = ph.px ?? 2000; // residuals are in image heights; reported in pixels of a px-wide image
  const q = [0, 0];
  const per = ph.points.map((pt) => {
    project(best.p, aspect, pt.x, pt.y, pt.z, q);
    return `${pt.what ?? `${pt.x},${pt.y},${pt.z}`}: ${(((q[0]! - pt.u) * px) | 0)},${(((q[1]! - pt.v) * px / aspect) | 0)}`;
  });
  ph.cam = { pos: [+cx.toFixed(3), +cy.toFixed(3), +cz.toFixed(3)], yaw: +yaw.toFixed(5), pitch: +pitch.toFixed(5), roll: +roll.toFixed(5), vfov: +fov.toFixed(3), k1: +k1.toFixed(4) };
  console.log(`${ph.id}: cam (${cx.toFixed(2)}, ${cy.toFixed(2)}, ${cz.toFixed(2)}) yaw ${((yaw * 180) / Math.PI).toFixed(1)}° pitch ${((pitch * 180) / Math.PI).toFixed(1)}° roll ${((roll * 180) / Math.PI).toFixed(2)}° vfov ${fov.toFixed(1)}° k1 ${k1.toFixed(3)}; rms ${(Math.sqrt(best.s / ph.points.length) * px / aspect).toFixed(1)} px of ${px}`);
  console.log('   residual px (u,v):', per.join('  '));
}
writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
