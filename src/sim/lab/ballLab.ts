// Ball test lab: fires balls at set speeds and spins at the floor, every wall, the corners and the joins, and
// measures each contact (restitution, the tangential rebound, angles, spin), plus the things players see: how
// high and how far a ball comes off the back glass, how a slice dies there. tools/ball-lab.ts prints the report,
// tests/sim/ballLab.test.ts holds the tuned numbers, and ?lab=ball replays the shots in the browser.
// Pure sim code (no DOM).
import { Ball, HIT_FLOOR, HIT_WALL, LEFT_COURT, type BallWorld } from '../ball/ball.ts';
import { makeWorld, type FloorName } from '../setup.ts';
import { DT } from '../core/constants.ts';
import { Rng } from '../core/rng.ts';
import { WALL_BACK_NEAR, WALL_BACK_FAR, WALL_SIDE_LEFT, WALL_SIDE_RIGHT, SURF_GLASS, SURF_MESH } from '../court/court.ts';
import { atan2, cos, max, PI, sin } from '../core/smath.ts';

/** rpm to rad/s. */
export const RPM = (2 * PI) / 60;

export interface LabShot {
  id: string;
  group: 'floor' | 'back glass' | 'side glass' | 'mesh' | 'corner' | 'join';
  label: string;
  /** Start state, a little before the first contact (m, m/s, rad/s). */
  pos: [number, number, number];
  vel: [number, number, number];
  spin: [number, number, number];
  floor?: FloorName;
  /** Runs with random bounce noise (mesh, seams, turf); 1 = the noise-free bounce. */
  runs?: number;
  /** Stop after this many contacts (default 3) or seconds (default 3). */
  contacts?: number;
  secs?: number;
}

export interface LabContact {
  kind: number;
  surface: number;
  wall: number;
  t: number;
  x: number;
  y: number;
  z: number;
  /** Surface normal into the court. */
  n: [number, number, number];
  /** Speed and its normal / tangential parts before and after (m/s). */
  speedIn: number;
  speedOut: number;
  vnIn: number;
  vnOut: number;
  vtIn: number;
  vtOut: number;
  /** Normal restitution (-vn out / vn in) and the tangential speed kept. */
  en: number;
  tKept: number;
  /** Angles to the surface (deg). */
  angIn: number;
  angOut: number;
  /** Tangential COR of the contact point: -(u out)/(u in) along the incoming slip. */
  ex: number;
  /** Spin about the axis that rolls the ball along its incoming tangential path (rpm; + = rolling forward). */
  rollIn: number;
  rollOut: number;
  /** Angle between the outgoing path and the mirror of the incoming one (deg): the bounce's scatter. */
  deflect: number;
  /** Kinetic energy per kg before and after, translation plus spin (J/kg). */
  energyIn: number;
  energyOut: number;
}

export interface LabRun {
  contacts: LabContact[];
  /** Positions every 1/120 s (x, y, z triples), for drawing. */
  path: number[];
  /** Highest point after the first contact (m). */
  apexAfter: number;
  /** Ended at rest, out of the court, or by time. */
  end: string;
}

/** The lab's shots. The near back wall is z = +10, the right side wall x = +5. */
export function labShots(): LabShot[] {
  const r = 0.0328;
  const deg = PI / 180;
  const shots: LabShot[] = [];
  // Floor: the FIP drop test, then oblique bounces from grazing to steep at 20 m/s.
  shots.push({ id: 'drop-hard', group: 'floor', label: 'FIP drop test, 2.54 m onto a hard floor', floor: 'hard', pos: [0, 2.54 + r, 3], vel: [0, 0, 0], spin: [0, 0, 0], contacts: 2 });
  shots.push({ id: 'drop-turf', group: 'floor', label: 'Drop test onto sand-filled turf', pos: [0, 2.54 + r, 3], vel: [0, 0, 0], spin: [0, 0, 0], contacts: 2 });
  for (const a of [10, 16, 20, 25, 35, 50, 70]) {
    const s = 20;
    shots.push({
      id: `floor-${a}`, group: 'floor', label: `Turf, 20 m/s flat at ${a}° to the floor`,
      pos: [0, r + 0.1, 5 - 0.1 / (sin(a * deg) / cos(a * deg))], vel: [0, -s * sin(a * deg), s * cos(a * deg)], spin: [0, 0, 0], contacts: 1, secs: 0.5,
    });
  }
  // Typical rally balls landing (speed at the bounce, angle, spin).
  const land = (id: string, label: string, s: number, a: number, rpm: number): void => {
    shots.push({
      id, group: 'floor', label, pos: [0, r + 0.1, 4 - 0.1 / (sin(a * deg) / cos(a * deg))],
      vel: [0, -s * sin(a * deg), s * cos(a * deg)], spin: [rpm * RPM, 0, 0], contacts: 1, secs: 0.6,
    });
  };
  land('land-flat', 'Flat drive landing, 20 m/s at 12°', 20, 12, 0);
  land('land-top', 'Topspin drive landing, 18 m/s at 18°, 2,500 rpm', 18, 18, 2500);
  land('land-slice', 'Slice landing, 17 m/s at 10°, 2,000 rpm back', 17, 10, -2000);
  land('land-lob', 'Lob landing, 12 m/s at 60°, 1,000 rpm top', 12, 60, 1000);
  land('land-turf-random', 'Flat drive on turf, the sand\'s scatter (200 runs)', 20, 12, 0);
  shots[shots.length - 1]!.runs = 200;
  // The court-pace test (ITF; IBV ran it on padel balls for Testfakta at 70 km/h): fired at 16 deg with no spin,
  // mu = (vx in - vx out) / ((1 + e) vy in), CPR = 100 (1 - mu) + 150 (0.81 - e).
  shots.push({
    id: 'cpr-turf', group: 'floor', label: 'Court pace test: 70 km/h at 16° onto turf (padel balls: CPR 36-50, mu 0.57-0.62)',
    pos: [0, r + 0.1, 4 - 0.1 * cos(16 * deg) / sin(16 * deg)], vel: [0, -19.44 * sin(16 * deg), 19.44 * cos(16 * deg)], spin: [0, 0, 0],
    contacts: 1, secs: 0.5,
  });

  // Back glass: balls that bounce at 7-8.6 m and go into the near back glass, the way rallies play it.
  const deep = (id: string, label: string, z: number, s: number, a: number, rpm: number, x = 0.5, extra?: Partial<LabShot>): void => {
    shots.push({
      id, group: 'back glass', label, pos: [x, r + 0.1, z - 0.1 / (sin(a * deg) / cos(a * deg))],
      vel: [0, -s * sin(a * deg), s * cos(a * deg)], spin: [rpm * RPM, 0, 0], contacts: 3, secs: 3, ...extra,
    });
  };
  deep('glass-flat', 'Flat drive, bounce at 7 m, into the back glass', 7, 20, 12, 0);
  deep('glass-top', 'Topspin drive, bounce at 7 m, 2,500 rpm', 7, 18, 18, 2500);
  deep('glass-slice', 'Slice, bounce at 7.5 m, 2,000 rpm back (should die off the glass)', 7.5, 17, 10, -2000);
  deep('glass-lob', 'Deep lob, bounce at 8.6 m, 60°, 1,000 rpm top', 8.6, 12, 60, 1000);
  deep('glass-smash', 'Smash, bounce at 6 m, 28 m/s at 35° (por tres?)', 6, 28, 35, 1500);
  // Restitution against impact speed, straight into the glass (no bounce first).
  for (const v of [3, 7, 13, 20, 30]) {
    shots.push({ id: `glass-cor-${v}`, group: 'back glass', label: `Straight into the glass at ${v} m/s`, pos: [0.5, 1.2, 9.9 - r], vel: [0, 0, v], spin: [0, 0, 0], contacts: 1, secs: 0.3 });
  }
  shots.push({ id: 'glass-direct', group: 'back glass', label: 'Straight into the glass at 1.2 m, 25 m/s, no bounce', pos: [0.5, 1.2, 9.5], vel: [0, -0.5, 25], spin: [0, 0, 0], contacts: 2 });

  // Side glass: a cross-court ball after its bounce; a víbora's sidespin.
  // The court-pace test against the side glass (30 m/s at 16 deg): felt on smooth glazed tile reads SPR 65.5.
  shots.push({
    id: 'spr-glass', group: 'side glass', label: 'Court pace test against the side glass: 30 m/s at 16° (glazed tile: SPR 65.5, mu 0.35)',
    pos: [5 - r - 0.1, 1.0, 7 - 0.1 * cos(16 * deg) / sin(16 * deg)], vel: [30 * sin(16 * deg), 0, 30 * cos(16 * deg)], spin: [0, 0, 0],
    contacts: 1, secs: 0.2,
  });
  shots.push({ id: 'side-cross', group: 'side glass', label: 'Cross-court, bounce at (3.8, 7.6), into the right side glass', pos: [3.8 - 0.06, r + 0.1, 7.6 - 0.06], vel: [9, -4, 12], spin: [0, 0, 0], contacts: 3 });
  shots.push({ id: 'side-vibora-in', group: 'side glass', label: 'Víbora sidespin into the side glass, 2,000 rpm (kicks along)', pos: [3.8 - 0.06, r + 0.1, 7.6 - 0.06], vel: [9, -4, 12], spin: [0, 2000 * RPM, 0], contacts: 3 });
  shots.push({ id: 'side-vibora-out', group: 'side glass', label: 'Same, sidespin the other way (checks up)', pos: [3.8 - 0.06, r + 0.1, 7.6 - 0.06], vel: [9, -4, 12], spin: [0, -2000 * RPM, 0], contacts: 3 });

  // Mesh: the side mesh near the net (no glass 4-10 m from the back) and the back mesh above the glass.
  shots.push({ id: 'mesh-side', group: 'mesh', label: 'Side mesh at 1.5 m high, 18 m/s at 40° (300 runs)', pos: [4.6, 1.5, 2.6], vel: [18 * sin(40 * deg), 0, 18 * cos(40 * deg)], spin: [0, 0, 0], runs: 300, contacts: 2 });
  shots.push({ id: 'mesh-back', group: 'mesh', label: 'Back mesh above the glass, 20 m/s straight in (300 runs)', pos: [0.5, 3.4, 9.5], vel: [0, 0.4, 20], spin: [0, 0, 0], runs: 300, contacts: 2 });

  // Corners: back glass then side glass; the foot of the back wall (rincón).
  shots.push({ id: 'corner-back-side', group: 'corner', label: 'Into the back-right corner after a bounce: back glass then side', pos: [3.4, r + 0.1, 7.6], vel: [5.5, -3.2, 15], spin: [0, 0, 0], contacts: 4 });
  shots.push({ id: 'corner-rincon', group: 'corner', label: 'Landing at the foot of the back glass (rincón), 20 m/s at 30°', pos: [0.5, r + 0.1, 10 - r - 0.004 - 0.1 / (sin(30 * deg) / cos(30 * deg))], vel: [0, -20 * sin(30 * deg), 20 * cos(30 * deg)], spin: [0, 0, 0], contacts: 3, runs: 1 });

  // Joins: a seam between back glass panels, the glass/mesh line on the back wall, the side wall's step and its
  // glass/mesh edge.
  shots.push({ id: 'join-back-seam', group: 'join', label: 'Back glass seam (x = 1 m), 22 m/s straight in (200 runs)', pos: [1.0, 1.2, 9.4], vel: [0, 0, 22], spin: [0, 0, 0], runs: 200, contacts: 2 });
  shots.push({ id: 'join-glass-mesh', group: 'join', label: 'Back wall at the glass top (3 m), 20 m/s (200 runs)', pos: [0.5, 2.98, 9.4], vel: [0, 0.2, 20], spin: [0, 0, 0], runs: 200, contacts: 2 });
  shots.push({ id: 'join-side-step', group: 'join', label: 'Side wall where the glass steps down, 2 m from the back (200 runs)', pos: [4.4, 1.0, 7.92], vel: [14, 0, 2], spin: [0, 0, 0], runs: 200, contacts: 2 });
  shots.push({ id: 'join-side-edge', group: 'join', label: 'Side wall at the glass/mesh edge, 4 m from the back (200 runs)', pos: [4.4, 1.0, 5.92], vel: [14, 0, 2], spin: [0, 0, 0], runs: 200, contacts: 2 });
  return shots;
}

const SUB = 10; // lab substeps per sim tick: in/out velocities read 1/1200 s either side of a contact

/** Fire one shot once (rng null: the noise-free bounce). */
export function runShot(shot: LabShot, world: BallWorld, rng: Rng | null): LabRun {
  const b = new Ball();
  b.pos.set(shot.pos[0], shot.pos[1], shot.pos[2]);
  b.vel.set(shot.vel[0], shot.vel[1], shot.vel[2]);
  b.spin.set(shot.spin[0], shot.spin[1], shot.spin[2]);
  const out: LabRun = { contacts: [], path: [b.pos.x, b.pos.y, b.pos.z], apexAfter: 0, end: 'time' };
  const maxC = shot.contacts ?? 3;
  const secs = shot.secs ?? 3;
  const h = DT / SUB;
  const r = world.spec.radius;
  let t = 0;
  for (let k = 0; t < secs; k++) {
    const vx = b.vel.x, vy = b.vel.y, vz = b.vel.z;
    const wx = b.spin.x, wy = b.spin.y, wz = b.spin.z;
    b.step(world, h, rng);
    t += h;
    if (k % SUB === SUB - 1) out.path.push(b.pos.x, b.pos.y, b.pos.z);
    if (out.contacts.length > 0 && b.pos.y > out.apexAfter) out.apexAfter = b.pos.y;
    for (let e = 0; e < b.eventCount; e++) {
      const ev = b.events[e]!;
      if (ev.kind !== HIT_FLOOR && ev.kind !== HIT_WALL) {
        if (ev.kind === LEFT_COURT) out.end = 'left the court';
        continue;
      }
      out.contacts.push(measure(ev.kind, ev.surface, ev.wall, t - h + ev.t, ev.x, ev.y, ev.z, [vx, vy, vz], [wx, wy, wz],
        [b.vel.x, b.vel.y, b.vel.z], [b.spin.x, b.spin.y, b.spin.z], r, world.spec.inertiaFactor * r * r));
    }
    if (out.contacts.length >= maxC || b.outside || b.rolling) {
      if (b.rolling) out.end = 'rolling';
      else if (b.outside) out.end = 'left the court';
      else out.end = `${maxC} contacts`;
      break;
    }
  }
  if (out.path.length % 3 === 0) out.path.push(b.pos.x, b.pos.y, b.pos.z);
  return out;
}

function normalOf(kind: number, wall: number): [number, number, number] {
  if (kind === HIT_FLOOR) return [0, 1, 0];
  if (wall === WALL_BACK_NEAR) return [0, 0, -1];
  if (wall === WALL_BACK_FAR) return [0, 0, 1];
  if (wall === WALL_SIDE_LEFT) return [1, 0, 0];
  if (wall === WALL_SIDE_RIGHT) return [-1, 0, 0];
  return [0, 1, 0];
}

const dot = (a: number[], b: number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const cross = (a: number[], b: number[]): [number, number, number] =>
  [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
const len = (a: number[]): number => Math.sqrt(dot(a, a));

function measure(
  kind: number, surface: number, wall: number, t: number, x: number, y: number, z: number,
  vIn: number[], wIn: number[], vOut: number[], wOut: number[], r: number, kI: number,
): LabContact {
  const n = normalOf(kind, wall);
  const vnIn = dot(vIn, n);
  const vnOut = dot(vOut, n);
  const vtInV = [vIn[0]! - vnIn * n[0], vIn[1]! - vnIn * n[1], vIn[2]! - vnIn * n[2]];
  const vtOutV = [vOut[0]! - vnOut * n[0], vOut[1]! - vnOut * n[1], vOut[2]! - vnOut * n[2]];
  const vtIn = len(vtInV);
  const vtOut = len(vtOutV);
  // Tangent direction: the incoming slide (or any tangent for a straight-on hit).
  let tdir: number[] = vtIn > 1e-6 ? vtInV.map((c) => c / vtIn) : (Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
  if (vtIn <= 1e-6) {
    const d = dot(tdir, n);
    tdir = [tdir[0]! - d * n[0], tdir[1]! - d * n[1], tdir[2]! - d * n[2]];
    const l = len(tdir);
    tdir = tdir.map((c) => c / l);
  }
  // Contact point velocity u = v + w x (-r n); e_x along the incoming slip.
  const rc = [-r * n[0], -r * n[1], -r * n[2]];
  const uIn = dot(vIn, tdir) + dot(cross(wIn, rc), tdir);
  const uOut = dot(vOut, tdir) + dot(cross(wOut, rc), tdir);
  // Rolling axis for motion along tdir on this surface: n x tdir (spin about it rolls the ball forward).
  const axis = cross(n, tdir);
  // Deflection: the outgoing path against the mirror of the incoming one (works for straight-in hits too).
  const mir = [vIn[0]! - 2 * vnIn * n[0], vIn[1]! - 2 * vnIn * n[1], vIn[2]! - 2 * vnIn * n[2]];
  const lo = len(vOut) * len(mir);
  const deflect = lo > 1e-6 ? (atan2(len(cross(mir, vOut)), dot(mir, vOut)) * 180) / PI : 0;
  return {
    kind, surface, wall, t, x, y, z, n,
    speedIn: len(vIn), speedOut: len(vOut), vnIn: -vnIn, vnOut, vtIn, vtOut,
    energyIn: 0.5 * dot(vIn, vIn) + 0.5 * kI * dot(wIn, wIn),
    energyOut: 0.5 * dot(vOut, vOut) + 0.5 * kI * dot(wOut, wOut),
    en: vnIn < 0 ? vnOut / -vnIn : 0,
    // (Undefined for a straight-in hit: reported as NaN below 2 m/s of incoming slide.)
    tKept: vtIn > 2 ? dot(vOut, tdir) / vtIn : NaN,
    angIn: (atan2(-vnIn, vtIn) * 180) / PI,
    angOut: (atan2(vnOut, vtOut) * 180) / PI,
    ex: Math.abs(uIn) > 0.05 ? -uOut / uIn : 0,
    rollIn: dot(wIn, axis) / RPM,
    rollOut: dot(wOut, axis) / RPM,
    deflect,
  };
}

export interface ShotSummary {
  shot: LabShot;
  /** The noise-free run (or the first of the random ones). */
  run: LabRun;
  /** Over the random runs: mean and spread of the first wall/floor contact the shot is about. */
  stats?: { n: number; en: [number, number]; tKept: [number, number]; deflect: [number, number]; angOut: [number, number] };
  /** Court-pace tests (cpr-/spr- shots): the ITF numbers of the key contact. */
  itf?: { mu: number; e: number; cpr: number; spr: number };
  /** Back glass: how the ball comes off it. */
  glass?: { heightAtGlass: number; speedIntoGlass: number; speedOff: number; enGlass: number; apexAfterGlass: number; comesBack: number; heightAt1m: number };
}

/** The contact a shot is about: the first wall for wall groups, the first floor bounce for floor shots. */
export function keyContact(shot: LabShot, run: LabRun): LabContact | undefined {
  if (shot.group === 'floor') return run.contacts.find((c) => c.kind === HIT_FLOOR);
  return run.contacts.find((c) => c.kind === HIT_WALL);
}

const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / max(1, a.length);
const sd = (a: number[]): number => { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))); };

export function summarize(shot: LabShot, worlds: Map<string, BallWorld>): ShotSummary {
  const key = shot.floor ?? 'turf';
  let world = worlds.get(key);
  if (!world) { world = makeWorld({ floor: key }); worlds.set(key, world); }
  const runs = shot.runs ?? 1;
  const run = runShot(shot, world, runs > 1 ? new Rng(1234) : null);
  const out: ShotSummary = { shot, run };
  if (runs > 1) {
    const rng = new Rng(98765);
    const en: number[] = [], tk: number[] = [], df: number[] = [], ao: number[] = [];
    for (let i = 0; i < runs; i++) {
      const c = keyContact(shot, runShot(shot, world, rng));
      if (!c) continue;
      en.push(c.en); df.push(c.deflect); ao.push(c.angOut);
      if (Number.isFinite(c.tKept)) tk.push(c.tKept);
    }
    out.stats = { n: en.length, en: [mean(en), sd(en)], tKept: tk.length ? [mean(tk), sd(tk)] : [NaN, NaN], deflect: [mean(df), sd(df)], angOut: [mean(ao), sd(ao)] };
  }
  if (shot.id.startsWith('cpr-') || shot.id.startsWith('spr-')) {
    const c = keyContact(shot, run);
    if (c) {
      const mu = (c.vtIn - c.vtOut) / ((1 + c.en) * c.vnIn);
      out.itf = { mu, e: c.en, cpr: 100 * (1 - mu) + 150 * (0.81 - c.en), spr: 100 * (1 - mu) };
    }
  }
  if (shot.group === 'back glass' || shot.id === 'corner-back-side') {
    const g = run.contacts.find((c) => c.kind === HIT_WALL && c.wall === WALL_BACK_NEAR && c.surface === SURF_GLASS);
    if (g) {
      const after = run.contacts.filter((c) => c.t > g.t);
      const nextFloor = after.find((c) => c.kind === HIT_FLOOR);
      // Height as the ball comes back past 1 m from the glass (where a player waiting for it would take it).
      let h1 = NaN;
      const p = run.path;
      for (let i = 3; i < p.length; i += 3) {
        if (p[i + 2]! < 9 && p[i - 1]! >= 9 && i / 3 / 120 > g.t) { h1 = p[i + 1]!; break; }
      }
      out.glass = {
        heightAtGlass: g.y, speedIntoGlass: g.speedIn, speedOff: g.speedOut, enGlass: g.en,
        apexAfterGlass: maxAfter(run.path, g.t), comesBack: nextFloor ? 10 - nextFloor.z : NaN, heightAt1m: h1,
      };
    }
  }
  return out;
}

function maxAfter(path: number[], t: number): number {
  let m = 0;
  for (let i = 0; i < path.length; i += 3) if (i / 3 / 120 >= t && path[i + 1]! > m) m = path[i + 1]!;
  return m;
}

export function runLab(): ShotSummary[] {
  const worlds = new Map<string, BallWorld>();
  return labShots().map((s) => summarize(s, worlds));
}

export { SURF_GLASS, SURF_MESH };
