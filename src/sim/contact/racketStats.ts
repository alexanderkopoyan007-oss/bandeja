// A racket's stats, measured with the game's own impact model (racket.ts) at fixed swings, so the bars always match
// how the racket plays (data/racket-stats.json says how each is measured and where its 0 and 100 are):
// - power: ball speed off a full drive and a full smash (the face speed scaled by the swing weight, as play does);
// - control: how far off-centre contacts (the game's own contact spread) land from the centre hit;
// - sweet spot: the face's area that keeps nearly all of the drive's pace;
// - spin: topspin off glancing brushes (only a ball sliding on the face feels its roughness);
// - manoeuvrability: swing weight about the butt.
// Pure and allocation-light (a few vectors per call); not for hot loops.
import { V3 } from '../core/v3.ts';
import { GRAVITY } from '../core/constants.ts';
import { clamp, cos, floor, PI, sin, sqrt } from '../core/smath.ts';
import { Racket, swingWeight, type RacketSpec } from './racket.ts';
import statData from '../../../data/racket-stats.json' with { type: 'json' };
import shotData from '../../../data/shots.json' with { type: 'json' };
import ballData from '../../../data/ball.json' with { type: 'json' };

interface StatSpec {
  incoming: number;
  drive: { speed: number; elevation: number };
  smashIn: [number, number];
  brush: { incoming: number; angles: number[] };
  contact: { bad: number; moving: number };
  launchHeight: number;
  sweetGrid: number;
  sweetShare: number;
  scale: Record<'power' | 'control' | 'sweetSpot' | 'spin' | 'manoeuvrability', [number, number]>;
}

const S = statData as unknown as StatSpec;
const SHOTS = shotData as unknown as Record<string, { racketMax: number; impact: number; spinRpm: number }> & {
  swing: { contactAlong: number[]; contactAcross: number[] };
};
const BALL = (ballData as unknown as Record<string, { mass: number; radius: number; inertiaFactor: number }>).standard!;

export interface RacketStats {
  /** 0-100 each, as data/racket-stats.json scales them. */
  power: number;
  control: number;
  sweetSpot: number;
  spin: number;
  manoeuvrability: number;
  /** What they were measured from. */
  raw: {
    /** Mean ball speed of the full drive and smash (km/h). */
    speedKmh: number;
    /** RMS landing distance of off-centre drives from the centre hit's (m). */
    scatterM: number;
    /** Face area keeping sweetShare of the drive's best pace (cm^2). */
    sweetCm2: number;
    /** Mean topspin off the brushes (rpm). */
    spinRpm: number;
    /** Swing weight about the butt (kg cm^2). */
    swingWeight: number;
    /** Full-effort face speed against the reference racket's, and its timing windows'. */
    faceK: number;
    timingK: number;
  };
}

/** 5-point Gauss-Hermite rule for a unit normal: nodes and weights (sum 1). */
const GH_X = [-2.8569700138728056, -1.3556261799742657, 0, 1.3556261799742657, 2.8569700138728056];
const GH_W = [0.011257411327720691, 0.2220759220056126, 0.5333333333333333, 0.2220759220056126, 0.011257411327720691];

const DEG = PI / 180;

const v = new V3();
const w = new V3();
const n = new V3();
const V = new V3();
const a = new V3();
const vo = new V3();
const wo = new V3();
const want = new V3();
const wantW = new V3();

function score(raw: number, range: [number, number]): number {
  return clamp((100 * (raw - range[0])) / (range[1] - range[0]), 0, 100);
}

/** Where a ball launched at vo from launchHeight lands in a vacuum (x across, z along): into land. */
function landing(out: { x: number; z: number }): void {
  const h = vo.x * vo.x + vo.z * vo.z;
  const sh = sqrt(h);
  const t = (vo.y + sqrt(vo.y * vo.y + 2 * GRAVITY * S.launchHeight)) / GRAVITY;
  const r = sh * t;
  out.x = (r * vo.x) / sh;
  out.z = (r * vo.z) / sh;
}

/** The full drive's swing into n, V, a (incoming ball into v, w). */
function driveSwing(rk: Racket): void {
  const d = SHOTS.drive!;
  v.set(0, 0, -S.incoming);
  w.set(0, 0, 0);
  n.set(0, sin(2 * DEG), cos(2 * DEG));
  V.copy(n).scale(d.racketMax * rk.faceK);
  a.set(1, 0, 0);
}

export function racketStats(spec: RacketSpec): RacketStats {
  const rk = new Racket(spec, BALL.mass, BALL.radius, BALL.inertiaFactor);
  const drive = SHOTS.drive!;
  const smash = SHOTS.smash!;

  // Power: full drive and full smash, met in the middle of the face's axis at the planned points.
  driveSwing(rk);
  rk.impact(v, w, n, V, a, drive.impact, 0, vo, wo);
  const driveSpeed = vo.length();
  v.set(0, S.smashIn[0], S.smashIn[1]);
  w.set(0, 0, 0);
  n.set(0, -sin(10 * DEG), cos(10 * DEG));
  V.copy(n).scale(smash.racketMax * rk.faceK);
  a.set(0, 1, 0);
  rk.impact(v, w, n, V, a, smash.impact, 0, vo, wo);
  const smashSpeed = vo.length();
  const speedKmh = ((driveSpeed + smashSpeed) / 2) * 3.6;

  // Control: the drive the player plays (a ball out at drive.speed and drive.elevation with the drive's topspin, the
  // swing found for it as strike() finds it: for the contact this hitter usually gets), met where the game's swing
  // errors spread the contact; landings against the centre hit's.
  const sw = SHOTS.swing;
  const sa = sw.contactAlong[0]! + sw.contactAlong[1]! * S.contact.bad + sw.contactAlong[2]! * S.contact.moving;
  const sc = sw.contactAcross[0]! + sw.contactAcross[1]! * S.contact.bad + sw.contactAcross[2]! * S.contact.moving;
  v.set(0, 0, -S.incoming);
  w.set(0, 0, 0);
  a.set(1, 0, 0);
  const el = S.drive.elevation * DEG;
  want.set(0, sin(el), cos(el)).scale(S.drive.speed);
  wantW.set((drive.spinRpm * 2 * PI) / 60, 0, 0);
  rk.spreadAlong = sa;
  rk.spreadAcross = sc;
  rk.swing(v, w, want, wantW, a, drive.impact, n, V);
  const land = { x: 0, z: 0 };
  rk.impact(v, w, n, V, a, drive.impact, 0, vo, wo);
  landing(land);
  const x0 = land.x, z0 = land.z;
  let miss2 = 0;
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      rk.impact(v, w, n, V, a, drive.impact + GH_X[i]! * sa, GH_X[j]! * sc, vo, wo);
      landing(land);
      const dx = land.x - x0, dz = land.z - z0;
      miss2 += GH_W[i]! * GH_W[j]! * (dx * dx + dz * dz);
    }
  }
  const scatterM = sqrt(miss2);

  // Sweet spot: the face's area where that drive keeps sweetShare of its best pace on this face (a grid centred on the
  // face's axis, which the pace is symmetric about).
  const g = S.sweetGrid;
  const nl = floor(spec.headLength / g), nw = floor(spec.headWidth / 2 / g);
  const speeds: number[] = [];
  let best = 0;
  for (let i = 0; i <= nl; i++) {
    const tip = i * g;
    for (let j = -nw; j <= nw; j++) {
      const x = j * g;
      if (!rk.onFace(tip, x)) continue;
      rk.impact(v, w, n, V, a, tip, x, vo, wo);
      const s = vo.length();
      speeds.push(s);
      if (s > best) best = s;
    }
  }
  let cells = 0;
  for (const s of speeds) if (s >= S.sweetShare * best) cells++;
  const sweetCm2 = cells * g * g * 1e4;

  // Spin: the topspin shot's full face speed brushing up a slow ball; topspin is about +x for a ball going +z.
  const ts = SHOTS.topspin!;
  let rpm = 0;
  for (const deg of S.brush.angles) {
    v.set(0, 0, -S.brush.incoming);
    w.set(0, 0, 0);
    n.set(0, 0, 1);
    V.set(0, sin(deg * DEG), cos(deg * DEG)).scale(ts.racketMax * rk.faceK);
    a.set(1, 0, 0);
    rk.impact(v, w, n, V, a, ts.impact, 0, vo, wo);
    rpm += (wo.x * 60) / (2 * PI);
  }
  const spinRpm = rpm / S.brush.angles.length;

  const sw2 = swingWeight(spec) * 1e4;
  return {
    power: score(speedKmh, S.scale.power),
    control: score(scatterM, S.scale.control),
    sweetSpot: score(sweetCm2, S.scale.sweetSpot),
    spin: score(spinRpm, S.scale.spin),
    manoeuvrability: score(sw2, S.scale.manoeuvrability),
    raw: { speedKmh, scatterM, sweetCm2, spinRpm, swingWeight: sw2, faceK: rk.faceK, timingK: rk.timingK },
  };
}
