// Animation QA (Phase 3 of the realism brief): plays an AI match with the animated bodies, no browser, and measures
// what looks wrong in motion:
//  - feet sliding while on the ground (the skating measure of Zhang et al. 2018, mode-adaptive networks: the
//    horizontal speed of the lowest point of the sole, weighted 2 - 2^(h/H) below H = 2.5 cm);
//  - the racket missing the ball (distance from the face centre to the ball at the sim's contact, how late the
//    closest moment is, and the angle between the face and the ball's way out);
//  - pops: a joint jumping between frames (a one-frame spike in its rotation), and joints turning faster than
//    people can (peak angular speeds measured in tennis serves and sprints, see LIMITS);
//  - clipping: the racket or the hands inside the body, the legs through each other, the soles below the floor,
//    bodies or the racket through the net or the glass, players inside each other.
// Body volumes are capsules fitted to the mesh itself (the median distance of each segment's vertices from its
// bones: a point that close to the bone is inside the body by any reading).
// Not in the shipped game: tools/anim-check.ts and tests/render/animQa.test.ts use it.
import * as THREE from 'three/webgpu';
import { MatchSim, E_HIT, PH_RALLY, PH_SETUP, PH_TOSS, type MatchConfig } from '../../sim/match.ts';
import type { InputFrame } from '../../sim/input.ts';
import { SHOT_KEYS } from '../../sim/contact/shots.ts';
import { Avatar } from './avatar.ts';
import type { PlayerAsset } from './asset.ts';
import { fitSoles } from './soles.ts';
import { fitCapsules, pointSeg, RACKET_PTS, type CapsuleDef } from './capsules.ts';

export { fitCapsules, pointSeg, RACKET_PTS };

export interface QaOptions {
  seed: number;
  seconds: number;
  doubles?: boolean;
  lefty?: boolean[];
  /** Inertialization on (default) or off, for comparisons. */
  inertial?: boolean;
  /** Every this many frames draw the same moment again (game.ts does, on fast displays): nothing may move. 0: off. */
  repeatEvery?: number;
  /** The match itself (QA army): court, format, styles, levels, humans... over the defaults above. */
  match?: Partial<MatchConfig>;
  /** Inputs for the human players each tick (QA army: bots and monkeys), null for the AI's. */
  inputs?: (m: MatchSim) => Array<InputFrame | null>;
  /** Called on every pop (diagnosis tools): the event as the report's worst list would have it. */
  onPop?: (e: QaEvent) => void;
  /** Called each frame once the avatars are drawn (diagnosis tools). */
  onFrame?: (m: MatchSim, av: Avatar[]) => void;
  /** Each frame with the legs through each other: who, which two capsules, how deep (m). */
  onLegs?: (player: number, where: string, deep: number) => void;
}

/** A distribution: count, mean and quantiles. */
export interface Dist { n: number; mean: number; p50: number; p90: number; p99: number; max: number }

export interface QaEvent { t: number; player: number; what: string; value: number }

export interface QaReport {
  seconds: number;
  frames: number;
  feet: {
    /** Zhang et al.'s skating: mean over all foot-frames of v * (2 - 2^(h/H)), h < H (cm/s). */
    skate: number;
    /** Horizontal speed of a sole flat on the ground (h < 1 cm), cm/s. */
    planted: Dist;
    /** Share of foot-frames on the ground (h < 1 cm). */
    groundShare: number;
    /** Deepest a sole goes below the floor (cm, positive = below) and the share of foot-frames below 1 cm. */
    belowMax: number;
    belowShare: number;
  };
  contact: {
    hits: number;
    /** Face centre to ball at the closest moment near the sim's contact (m). */
    dist: Dist;
    /** |closest moment - sim contact| (s). */
    lag: Dist;
    /** Angle between the face normal and the ball's way out at the closest moment (degrees). */
    face: Dist;
    byShot: Record<string, { n: number; p50: number; p90: number }>;
    /** The chest against the net at the hit, by stroke (degrees; 0 = square to the net): `forehand`, `backhand`,
     * `volley-fh`, `volley-bh`, and the other families by name (strokeGroup). */
    chest: Record<string, { n: number; p50: number; p90: number }>;
    /** The furthest contacts (value: face centre to ball, m; what: the shot and the ball's height). */
    worst: QaEvent[];
  };
  pops: {
    /** One-frame spikes in a joint's rotation, per minute of play (all joints, all players). */
    perMinute: number;
    count: number;
    byJoint: Record<string, number>;
    /** Pops by what the avatar was doing (its swing family, or ready / run / idle). */
    byDoing: Record<string, number>;
    /** Peak angular speed per joint group against what people manage (deg/s). */
    peaks: Record<string, { p99: number; max: number; limit: number; over: number }>;
    worst: QaEvent[];
    /** The largest one-frame turns of any joint (degrees), spike or not: a turn beside a large neighbour is no pop. */
    turnWorst: QaEvent[];
    /**
     * Knees that end up more than KNEE_SPIN degrees from where they were within KNEE_WINDOW frames (0.1 s): a flip
     * spread over several frames, which neither the one-frame turn nor the pop rule sees. A knee can't (it bends
     * about 150° in all and barely twists); arms in a fast swing can, so only the knees are watched.
     */
    kneeSpins: QaEvent[];
  };
  /** Frames drawn twice at the same moment (QaOptions.repeatEvery) and the most any bone turned on the second. */
  repeat: { frames: number; maxDeg: number };
  clip: {
    /** Frames (per player-frame share) with the racket inside the player's own body, by more than 1 cm. */
    racketBody: number;
    racketBodyMax: number;
    /** A hand inside the torso. */
    handTorso: number;
    handTorsoMax: number;
    /** Racket-in-body and hand-in-torso frames by what the player was doing (stroke family, or `ready`/`run`). */
    by: Record<string, { racketBody: number; handTorso: number; legs: number }>;
    /** The legs through each other. */
    legs: number;
    legsMax: number;
    /** Through the net below its top (body or racket), or the glass (beyond a wall's plane outside an opening). */
    net: number;
    wall: number;
    /** Two players' torsos overlapping, and a racket inside another player. */
    players: number;
    racketOther: number;
    worst: QaEvent[];
  };
  /** Hips (horizontal) from the sim's position (m): reaching and lunging move them, nothing else should. */
  hipsFromSim: Dist;
  /** The serve alone (the server from the point's setup to the end of the stroke): frames, and shares of them. */
  serve: { frames: number; racketBody: number; handTorso: number; legs: number; popsPerMinute: number };
  nan: number;
}

/**
 * Peak joint angular speeds people reach (deg/s), what a frame-to-frame rotation above is judged against (with 25%
 * margin before it counts as over). Tennis serve, world-class players (Fleisig et al. 2003): shoulder internal
 * rotation 2420 ± 590, elbow extension 1510 ± 270, wrist flexion 1950 ± 1020, upper torso 870 ± 120, pelvis
 * 440 ± 90. Sprinting: knee and hip angular speeds peak about 1100-1500 and 700-900 (stance and swing; e.g. Nagahara
 * et al. 2014 ranges, from secondary summaries). Head turns: saccadic head rotations peak about 500-700 deg/s.
 * The mean + 2 SD for the serve values.
 */
const LIMITS: Record<string, number> = {
  pelvis: 620,
  torso: 1110,
  shoulder: 3600,
  elbow: 2050,
  wrist: 3990,
  hip: 900,
  knee: 1500,
  ankle: 1200,
  head: 700,
};

const H_SKATE = 0.025;

function dist(a: number[]): Dist {
  if (a.length === 0) return { n: 0, mean: 0, p50: 0, p90: 0, p99: 0, max: 0 };
  const s = a.slice().sort((x, y) => x - y);
  const q = (f: number): number => s[Math.min(s.length - 1, Math.floor(f * (s.length - 1)))]!;
  let m = 0;
  for (const x of s) m += x;
  return { n: s.length, mean: m / s.length, p50: q(0.5), p90: q(0.9), p99: q(0.99), max: s[s.length - 1]! };
}

/** Closest distance between segments p1-q1 and p2-q2. */
function segSeg(p1: THREE.Vector3, q1: THREE.Vector3, p2: THREE.Vector3, q2: THREE.Vector3): number {
  const d1 = new THREE.Vector3().subVectors(q1, p1);
  const d2 = new THREE.Vector3().subVectors(q2, p2);
  const r = new THREE.Vector3().subVectors(p1, p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s = 0, t = 0;
  if (a <= 1e-12 && e <= 1e-12) return r.length();
  if (a <= 1e-12) { s = 0; t = Math.min(1, Math.max(0, f / e)); }
  else {
    const c = d1.dot(r);
    if (e <= 1e-12) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
    else {
      const b = d1.dot(d2), den = a * e - b * b;
      s = den !== 0 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
      else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    }
  }
  const c1 = p1.clone().addScaledVector(d1, s);
  const c2 = p2.clone().addScaledVector(d2, t);
  return c1.distanceTo(c2);
}

/** Joint groups for the angular-speed limits: [group, bone, parent bone or '' for world]. */
const JOINTS: Array<[string, string, string]> = [
  ['pelvis', 'Hips', ''],
  ['torso', 'Spine2', ''],
  ['shoulder', 'RightArm', 'Spine2'], ['shoulder', 'LeftArm', 'Spine2'],
  ['elbow', 'RightForeArm', 'RightArm'], ['elbow', 'LeftForeArm', 'LeftArm'],
  ['wrist', 'RightHand', 'RightForeArm'], ['wrist', 'LeftHand', 'LeftForeArm'],
  ['hip', 'LeftUpLeg', 'Hips'], ['hip', 'RightUpLeg', 'Hips'],
  ['knee', 'LeftLeg', 'LeftUpLeg'], ['knee', 'RightLeg', 'RightUpLeg'],
  ['ankle', 'LeftFoot', 'LeftLeg'], ['ankle', 'RightFoot', 'RightLeg'],
  ['head', 'Head', 'Spine2'],
];

/** A stroke family's group for the chest check: a left-hander's as the right-hander's, ground strokes' variants
 * (slice, lob, drop, chiquita) with their side; the contrapared (facing the glass) and the rest by name. */
export function strokeGroup(name: string): string {
  const n = name.replace(/-left$/, '');
  if (n.endsWith('-contra')) return n;
  if (n.startsWith('forehand')) return 'forehand';
  if (n.startsWith('backhand')) return 'backhand';
  return n;
}

interface Hit { player: number; shot: string; t: number; ball: THREE.Vector3; out: THREE.Vector3; best: number; at: number; face: number; stroke: string; chest: number }

export function runAnimQa(asset: PlayerAsset, opts: QaOptions): QaReport {
  const doubles = opts.doubles ?? true;
  const np = doubles ? 4 : 2;
  const m = new MatchSim({ seed: opts.seed, doubles, human: new Array(np).fill(false), lefty: opts.lefty, ...opts.match });
  const av: Avatar[] = [];
  const scene = new THREE.Scene();
  for (let i = 0; i < np; i++) { const a = new Avatar(asset, 0xffffff); a.inertial = opts.inertial ?? true; av.push(a); scene.add(a.root); }
  const bones = av.map((a) => (a as unknown as { bones: THREE.Bone[] }).bones);
  const caps = fitCapsules(asset);
  const soles = fitSoles(asset);
  const cap = (n: string): CapsuleDef => caps.find((c) => c.name === n)!;
  const torsoCaps = [cap('pelvis'), cap('chest')];
  const legPairs: Array<[CapsuleDef, CapsuleDef]> = [
    [cap('thighL'), cap('thighR')], [cap('shinL'), cap('shinR')], [cap('thighL'), cap('shinR')], [cap('shinL'), cap('thighR')],
  ];
  const jointIdx = JOINTS.map(([g, b, p]) => ({ g, b: asset.bone(b), p: p ? asset.bone(p) : -1, name: b }));

  const court = m.world.court;
  const netH = court.def.net.heightPost;
  const openW = court.def.openings;

  // Per-player, per-frame history.
  const prevSoleAll = av.map(() => soles.map((s) => s.map(() => new THREE.Vector3())));
  const prevQ = av.map(() => jointIdx.map(() => new THREE.Quaternion()));
  const KNEE_WINDOW = 12, KNEE_SPIN = 150;
  const kneeRing = av.map(() => jointIdx.map((J) => (J.name.endsWith('Leg') && !J.name.endsWith('UpLeg') ? Array.from({ length: KNEE_WINDOW }, () => new THREE.Quaternion()) : null)));
  const kneeN = av.map(() => jointIdx.map(() => 0));
  const kneeCool = av.map(() => jointIdx.map(() => 0));
  const kneeSpins: QaEvent[] = [];
  const prevAng = av.map(() => jointIdx.map(() => 0));
  const prevAng2 = av.map(() => jointIdx.map(() => 0));
  const prevRoot = av.map(() => new THREE.Vector3());

  const hits: Hit[] = [];
  const skateSum = { s: 0, n: 0 };
  const planted: number[] = [];
  let ground = 0, footFrames = 0, below = 0, belowMax = 0;
  const peaks: Record<string, number[]> = {};
  const popsBy: Record<string, number> = {};
  const popsDoing: Record<string, number> = {};
  const sv = { frames: 0, racketBody: 0, handTorso: 0, legs: 0, pops: 0 };
  let walkAt = -1;
  let pops = 0;
  const popWorst: QaEvent[] = [];
  const repeatEvery = opts.repeatEvery ?? 0;
  const repQ = Array.from({ length: 80 }, () => new THREE.Quaternion());
  let repeatMax = 0, repeatFrames = 0;
  const turnWorst: QaEvent[] = [];
  const clip = { racketBody: 0, racketBodyMax: 0, handTorso: 0, handTorsoMax: 0, legs: 0, legsMax: 0, net: 0, wall: 0, players: 0, racketOther: 0 };
  const clipWorst: QaEvent[] = [];
  const clipBy: Record<string, { racketBody: number; handTorso: number; legs: number }> = {};
  const doing = (i: number): string => {
    const x = av[i] as unknown as { fam: { name: string }; w: number; ready: number; sp: number };
    return x.w > 0.01 ? x.fam.name : x.ready > 0.5 ? 'ready' : x.sp > 0.9 ? 'run' : 'idle';
  };
  const hips: number[] = [];
  let playerFrames = 0;
  let nan = 0;
  let seen = 0;
  let frames = 0;
  const DTF = 1 / 120;

  const wq = new THREE.Quaternion(), wp = new THREE.Quaternion(), lq = new THREE.Quaternion();
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), D = new THREE.Vector3(), P = new THREE.Vector3();
  const racketW = av.map(() => RACKET_PTS.map(() => new THREE.Vector3()));
  const prevFace = av.map(() => new THREE.Vector3());
  const bpos = (i: number, b: number, out: THREE.Vector3): THREE.Vector3 => out.setFromMatrixPosition(bones[i]![b]!.matrixWorld);
  const shR = asset.bone('RightArm'), shL = asset.bone('LeftArm');
  const note = (list: QaEvent[], e: QaEvent): void => {
    list.push(e);
    list.sort((x, y) => y.value - x.value);
    if (list.length > 12) list.length = 12;
  };

  const total = Math.round(opts.seconds * 120);
  for (let k = 0; k < total; k++) {
    m.step(opts.inputs ? opts.inputs(m) : new Array(np).fill(null));
    frames++;
    while (seen < m.eventSeq) {
      const e = m.events[seen % m.events.length]!;
      seen++;
      if (e.kind === E_HIT) {
        const p = m.players[e.player]!;
        hits.push({
          player: e.player, shot: SHOT_KEYS[e.a]!, t: m.time,
          ball: new THREE.Vector3(p.lastContact.x, p.lastContact.y, p.lastContact.z),
          out: new THREE.Vector3(m.ball.vel.x, m.ball.vel.y, m.ball.vel.z).normalize(), best: Infinity, at: 0, face: 0,
          stroke: '', chest: -1,
        });
      }
    }
    for (let i = 0; i < np; i++) av[i]!.update(m, m.players[i]!, i, 1, m.time);
    // The chest at the hit: the angle between where the shoulders face and the net (0 = square to it).
    for (const h of hits) {
      if (h.chest >= 0) continue;
      const a = av[h.player]!;
      a.root.updateMatrixWorld(true);
      bpos(h.player, shR, A); bpos(h.player, shL, B);
      // (forward is up x right-to-left shoulder, flat)
      const fx = A.z - B.z, fz = B.x - A.x, fl = Math.hypot(fx, fz) || 1;
      const toNet = -m.side(m.players[h.player]!.team);
      h.chest = (Math.acos(Math.max(-1, Math.min(1, (fz / fl) * toNet))) * 180) / Math.PI;
      h.stroke = strokeGroup((a as unknown as { fam: { name: string } }).fam.name);
    }
    opts.onFrame?.(m, av);
    if (repeatEvery > 0 && k % repeatEvery === 3) {
      // The same moment drawn twice: every bone must stay exactly where it was.
      for (let i = 0; i < np; i++) {
        const bs = bones[i]!;
        for (let b = 0; b < bs.length; b++) repQ[b]!.copy(bs[b]!.quaternion);
        av[i]!.update(m, m.players[i]!, i, 1, m.time);
        for (let b = 0; b < bs.length; b++) {
          const q = bs[b]!.quaternion, r = repQ[b]!;
          // Normalised: the solves leave quaternions a hair off unit length, which reads as 0.17° against itself.
          const d = Math.min(1, Math.abs(q.x * r.x + q.y * r.y + q.z * r.z + q.w * r.w) / Math.sqrt(q.lengthSq() * r.lengthSq()));
          const ang = (2 * Math.acos(d) * 180) / Math.PI;
          if (ang > repeatMax) repeatMax = ang;
        }
        repeatFrames++;
      }
    }
    for (let i = 0; i < np; i++) av[i]!.racket.updateMatrixWorld(true);
    const live = m.phase === PH_RALLY || m.phase === PH_SETUP || m.phase === PH_TOSS;

    for (let i = 0; i < np; i++) {
      const a = av[i]!;
      const bs = bones[i]!;
      const p = m.players[i]!;
      // A jump of the root (players placed for the next point) is not animation: skip this frame's motion checks.
      const jump = k > 0 && prevRoot[i]!.distanceTo(a.root.position) > 0.2;
      prevRoot[i]!.copy(a.root.position);
      const motion = k > 1 && !jump;
      const ai = a as unknown as { fam: { name: string }; w: number };
      // (not the walk back to the place first, MatchSim.walking, nor its last steps: they count with the rest of play)
      if (m.walking > 0) walkAt = m.time;
      const serving = ((m.phase === PH_SETUP || m.phase === PH_TOSS) && m.time > walkAt + 0.3 && m.score.serverPlayer() === i)
        || (ai.fam.name.startsWith('serve') && ai.w > 0.01);
      if (serving && motion) sv.frames++;
      playerFrames++;

      // Feet.
      for (let f = 0; f < 2; f++) {
        let low = Infinity, lv = 0;
        for (let s = 0; s < soles[f]!.length; s++) {
          const sp = soles[f]![s]!;
          P.copy(sp.local).applyMatrix4(bs[sp.bone]!.matrixWorld);
          const prev = prevSoleAll[i]![f]![s]!;
          const v = motion ? Math.hypot(P.x - prev.x, P.z - prev.z) / DTF : 0;
          prev.copy(P);
          if (P.y < low) { low = P.y; lv = v; }
        }
        if (!motion) continue;
        footFrames++;
        if (low < H_SKATE) { skateSum.s += lv * (2 - Math.pow(2, Math.max(0, low) / H_SKATE)); }
        skateSum.n++;
        if (low < 0.01) { ground++; planted.push(lv * 100); }
        if (low < -0.01) { below++; if (-low > belowMax) belowMax = -low; }
      }

      // Joint angular speeds and pops.
      for (let j = 0; j < jointIdx.length; j++) {
        const J = jointIdx[j]!;
        bs[J.b]!.getWorldQuaternion(wq);
        if (J.p >= 0) { bs[J.p]!.getWorldQuaternion(wp); lq.copy(wp).invert().multiply(wq); } else lq.copy(wq);
        const q0 = prevQ[i]![j]!;
        const d = Math.min(1, Math.abs(q0.x * lq.x + q0.y * lq.y + q0.z * lq.z + q0.w * lq.w));
        const ang = (2 * Math.acos(d) * 180) / Math.PI;
        q0.copy(lq);
        const ring = kneeRing[i]![j];
        if (ring) {
          if (!motion) kneeN[i]![j] = 0;
          else {
            let net = 0;
            const n = Math.min(kneeN[i]![j]!, KNEE_WINDOW);
            for (let r = 0; r < n; r++) {
              const q = ring[r]!;
              const dd = Math.min(1, Math.abs(q.x * lq.x + q.y * lq.y + q.z * lq.z + q.w * lq.w));
              const a = (2 * Math.acos(dd) * 180) / Math.PI;
              if (a > net) net = a;
            }
            ring[kneeN[i]![j]! % KNEE_WINDOW]!.copy(lq);
            kneeN[i]![j]!++;
            if (net > KNEE_SPIN && frames >= kneeCool[i]![j]!) {
              kneeSpins.push({ t: m.time, player: i, what: `spin ${J.name}`, value: net });
              kneeCool[i]![j] = frames + 30;
            }
          }
        }
        if (!motion) { prevAng2[i]![j] = 0; prevAng[i]![j] = 0; continue; }
        (peaks[J.g] ??= []).push(ang / DTF);
        if (ang > 45) note(turnWorst, { t: m.time, player: i, what: `turn ${J.name}`, value: ang });
        // A one-frame spike: the frame before stands out against both its neighbours.
        const a1 = prevAng[i]![j]!, a2 = prevAng2[i]![j]!;
        if (a1 > 6 && a1 > 3 * Math.max(a2, ang, 1)) {
          pops++;
          if (serving) sv.pops++;
          popsBy[J.name] = (popsBy[J.name] ?? 0) + 1;
          const dn = doing(i);
          popsDoing[dn] = (popsDoing[dn] ?? 0) + 1;
          const pe = { t: m.time - DTF, player: i, what: `pop ${J.name} (${dn})`, value: a1 };
          note(popWorst, pe);
          opts.onPop?.(pe);
        }
        prevAng2[i]![j] = a1;
        prevAng[i]![j] = ang;
      }

      // Racket points in the world.
      for (let r = 0; r < RACKET_PTS.length; r++) racketW[i]![r]!.copy(RACKET_PTS[r]!).applyMatrix4(a.racket.matrixWorld);
      const handed = p.handed;
      const racketArm = handed > 0 ? ['upperArmR', 'foreArmR'] : ['upperArmL', 'foreArmL'];

      if (live) {
        // Racket inside its own body (not the arm that holds it).
        let deep = 0, where = '';
        for (const c of caps) {
          if (racketArm.includes(c.name)) continue;
          bpos(i, c.ia, A); bpos(i, c.ib, B);
          for (let r = 0; r < RACKET_PTS.length; r++) {
            const pen = c.r - pointSeg(racketW[i]![r]!, A, B);
            if (pen > deep) { deep = pen; where = c.name; }
          }
        }
        if (deep > 0.01) {
          clip.racketBody++;
          (clipBy[doing(i)] ??= { racketBody: 0, handTorso: 0, legs: 0 }).racketBody++;
          if (serving && motion) sv.racketBody++;
          if (deep > clip.racketBodyMax) clip.racketBodyMax = deep;
          note(clipWorst, { t: m.time, player: i, what: `racket in ${where}`, value: deep });
        }
        // Hands inside the torso.
        deep = 0;
        for (const hn of ['LeftHand', 'RightHand']) {
          bpos(i, asset.bone(hn), P);
          for (const c of torsoCaps) {
            bpos(i, c.ia, A); bpos(i, c.ib, B);
            const pen = c.r - pointSeg(P, A, B);
            if (pen > deep) { deep = pen; where = `${hn} in ${c.name}`; }
          }
        }
        if (deep > 0.01) {
          clip.handTorso++;
          (clipBy[doing(i)] ??= { racketBody: 0, handTorso: 0, legs: 0 }).handTorso++;
          if (serving && motion) sv.handTorso++;
          if (deep > clip.handTorsoMax) clip.handTorsoMax = deep;
          note(clipWorst, { t: m.time, player: i, what: where, value: deep });
        }
        // Legs through each other.
        deep = 0;
        for (const [c1, c2] of legPairs) {
          bpos(i, c1.ia, A); bpos(i, c1.ib, B); bpos(i, c2.ia, C); bpos(i, c2.ib, D);
          const pen = c1.r + c2.r - segSeg(A, B, C, D);
          if (pen > deep) { deep = pen; where = `${c1.name}/${c2.name}`; }
        }
        if (deep > 0.01) {
          clip.legs++;
          opts.onLegs?.(i, where, deep);
          (clipBy[doing(i)] ??= { racketBody: 0, handTorso: 0, legs: 0 }).legs++;
          if (serving && motion) sv.legs++;
          if (deep > clip.legsMax) clip.legsMax = deep;
          note(clipWorst, { t: m.time, player: i, what: `legs ${where}`, value: deep });
        }
        // Net and glass: racket points and the main joints.
        const s = m.side(p.team);
        let netHit = false, wallHit = false;
        const test = (q: THREE.Vector3): void => {
          if (Math.abs(q.x) < court.halfW && q.z * s < -0.02 && q.y < netH) netHit = true;
          const ax = Math.abs(q.x), az = Math.abs(q.z);
          const inOpening = ax > court.halfW && az < court.halfL && q.y < openW.height;
          if ((ax > court.halfW + 0.01 && !inOpening) || az > court.halfL + 0.01) wallHit = true;
        };
        for (let r = 0; r < RACKET_PTS.length; r++) test(racketW[i]![r]!);
        for (const n of ['Head', 'LeftHand', 'RightHand', 'LeftFoot', 'RightFoot', 'Hips']) test(bpos(i, asset.bone(n), P));
        if (netHit) { clip.net++; note(clipWorst, { t: m.time, player: i, what: 'through the net', value: 0 }); }
        if (wallHit) { clip.wall++; note(clipWorst, { t: m.time, player: i, what: 'through the glass', value: 0 }); }
        // Hips from the sim's position.
        bpos(i, asset.bone('Hips'), P);
        hips.push(Math.hypot(P.x - p.pos.x, P.z - p.pos.z));
      }
    }

    // Players inside each other, and rackets inside another player.
    if (live) {
      for (let i = 0; i < np; i++) {
        for (let o = 0; o < np; o++) {
          if (o === i) continue;
          if (o > i) {
            let deep = 0;
            for (const c1 of torsoCaps) for (const c2 of torsoCaps) {
              bpos(i, c1.ia, A); bpos(i, c1.ib, B); bpos(o, c2.ia, C); bpos(o, c2.ib, D);
              deep = Math.max(deep, c1.r + c2.r - segSeg(A, B, C, D));
            }
            if (deep > 0.01) { clip.players++; note(clipWorst, { t: m.time, player: i, what: `inside player ${o}`, value: deep }); }
          }
          let deep = 0;
          for (const c of caps) {
            bpos(o, c.ia, A); bpos(o, c.ib, B);
            for (let r = 0; r < RACKET_PTS.length; r++) deep = Math.max(deep, c.r - pointSeg(racketW[i]![r]!, A, B));
          }
          if (deep > 0.01) { clip.racketOther++; note(clipWorst, { t: m.time, player: i, what: `racket inside player ${o}`, value: deep }); }
        }
      }
    }

    // Contact: closest approach of the face centre to the contact point near the sim's contact, along the path the
    // face swept since the last frame (the contact falls between frames: a face that passes through the ball on
    // time is already centimetres past it at the frame that reports the hit).
    for (const h of hits) {
      if (m.time > h.t + 0.15 || m.time < h.t - 0.05) continue;
      const c = racketW[h.player]![0]!;
      const d = pointSeg(h.ball, prevFace[h.player]!, c);
      if (d < h.best) {
        h.best = d;
        h.at = m.time - h.t;
        const e = av[h.player]!.racket.matrixWorld.elements;
        const nx = e[8]!, ny = e[9]!, nz = e[10]!;
        const l = Math.hypot(nx, ny, nz) || 1;
        h.face = (Math.acos(Math.min(1, Math.abs(nx * h.out.x + ny * h.out.y + nz * h.out.z) / l)) * 180) / Math.PI;
      }
    }
    for (let i = 0; i < np; i++) prevFace[i]!.copy(racketW[i]![0]!);
    if (k % 60 === 0) for (const a of av) a.root.traverse((o) => { if (!Number.isFinite(o.quaternion.w) || !Number.isFinite(o.position.x)) nan++; });
  }

  const chestBy: Record<string, { n: number; p50: number; p90: number }> = {};
  for (const h of hits) if (h.chest >= 0) (chestBy[h.stroke] ??= { n: 0, p50: 0, p90: 0 }).n++;
  for (const k of Object.keys(chestBy)) {
    const d = dist(hits.filter((h) => h.chest >= 0 && h.stroke === k).map((h) => h.chest));
    chestBy[k]!.p50 = d.p50;
    chestBy[k]!.p90 = d.p90;
  }
  const byShot: Record<string, { n: number; p50: number; p90: number }> = {};
  for (const h of hits) (byShot[h.shot] ??= { n: 0, p50: 0, p90: 0 }).n++;
  for (const k of Object.keys(byShot)) {
    const d = dist(hits.filter((h) => h.shot === k).map((h) => h.best));
    byShot[k]!.p50 = d.p50;
    byShot[k]!.p90 = d.p90;
  }
  const peakOut: Record<string, { p99: number; max: number; limit: number; over: number }> = {};
  for (const [g, a] of Object.entries(peaks)) {
    const d = dist(a);
    const lim = LIMITS[g] ?? 1e9;
    peakOut[g] = { p99: d.p99, max: d.max, limit: lim, over: a.filter((x) => x > lim * 1.25).length };
  }
  const minutes = (frames / 120) / 60;
  const share = (n: number): number => n / Math.max(1, playerFrames);
  return {
    seconds: frames / 120,
    frames,
    feet: {
      skate: (100 * skateSum.s) / Math.max(1, skateSum.n),
      planted: dist(planted),
      groundShare: ground / Math.max(1, footFrames),
      belowMax: belowMax * 100,
      belowShare: below / Math.max(1, footFrames),
    },
    contact: {
      hits: hits.length,
      dist: dist(hits.map((h) => h.best)),
      lag: dist(hits.map((h) => Math.abs(h.at))),
      face: dist(hits.map((h) => h.face)),
      chest: chestBy,
      byShot,
      worst: [...hits].sort((a, b) => b.best - a.best).slice(0, 8)
        .map((h) => ({ t: h.t, player: h.player, what: `${h.shot} at ${h.ball.y.toFixed(2)} m`, value: h.best })),
    },
    pops: { perMinute: pops / Math.max(1e-9, minutes * np), count: pops, byJoint: popsBy, byDoing: popsDoing, peaks: peakOut, worst: popWorst, turnWorst, kneeSpins },
    repeat: { frames: repeatFrames, maxDeg: repeatMax },
    clip: {
      racketBody: share(clip.racketBody), racketBodyMax: clip.racketBodyMax,
      handTorso: share(clip.handTorso), handTorsoMax: clip.handTorsoMax,
      by: clipBy,
      legs: share(clip.legs), legsMax: clip.legsMax,
      net: share(clip.net), wall: share(clip.wall),
      players: clip.players / Math.max(1, frames), racketOther: share(clip.racketOther),
      worst: clipWorst,
    },
    hipsFromSim: dist(hips),
    serve: {
      frames: sv.frames, racketBody: sv.racketBody / Math.max(1, sv.frames), handTorso: sv.handTorso / Math.max(1, sv.frames),
      legs: sv.legs / Math.max(1, sv.frames), popsPerMinute: sv.pops / Math.max(1e-9, sv.frames * DTF / 60),
    },
    nan,
  };
}

/** The capsules and sole points fitted to the mesh (for the report). */
export function bodyModel(asset: PlayerAsset): { capsules: Array<{ name: string; r: number }>; soles: number } {
  return { capsules: fitCapsules(asset).map((c) => ({ name: c.name, r: c.r })), soles: fitSoles(asset)[0]!.length };
}
