// A swing measured off a clip (tools/assets/mocap: a pro's stroke tracked on its own page, made to hold, turned onto the
// game's skeleton, and written by keys.py TRACK=) for the avatar to draw a stroke by instead of the three keys and the
// curve between them: the racket's face centre and turn, the elbow, the racket shoulder, the shoulders' turn, the free
// hand and the trunk's lean, sixty times a second from `lead` before the ball to `follow` after it.
//
// The sim decides where the ball is met; the swing bends to it. The racket is kept as the clip has it from the racket
// shoulder, and that arm-and-racket shape is turned about the shoulder (and stretched) so that at the ball it is at the
// sim's contact exactly: a higher ball is the same swing swung higher, not the same path slid up.
//
// Behind ?motion=3 (main.ts loads the tracks when Avatar.motion is 3) until the owner has seen it; the tracks live in public/assets/mocap-local/
// (not in the repository, not in a build) until then. Without the switch nothing here runs.
import * as THREE from 'three/webgpu';
import { BACKHAND, FOREHAND, OVERHEAD, SMASH, VIBORA, VOLLEY_BH, VOLLEY_FH, keepCoded, leftFamily, type Family, type Key } from './strokes.ts';

export interface StrokeTrack {
  name: string;
  fps: number;
  n: number;
  /** Seconds of it before the ball and after. */
  lead: number;
  follow: number;
  /** Per frame, about the stance (model frame: +x the player's left, +z the net): the racket's face centre, its turn
   * (x, y, z, w), the elbow, the racket shoulder, the free hand. */
  p: Float32Array;
  q: Float32Array;
  pole: Float32Array;
  sh: Float32Array;
  off: Float32Array;
  /** Per frame: the shoulders' turn (+ left), the trunk's tilt (the free shoulder up) and bow (forward), the hips' height. */
  yaw: Float32Array;
  tilt: Float32Array;
  bow: Float32Array;
  hipsY: Float32Array;
  /** The racket's centre from the racket shoulder at the ball, and how far that is. */
  c0: THREE.Vector3;
  c0len: number;
}

export interface TrackJson {
  name: string; fps: number; frames: number; lead: number; follow: number;
  p: number[]; q: number[]; pole: number[]; sh: number[]; off: number[]; yaw: number[]; tilt: number[]; bow: number[]; hipsY: number[];
}

/** What sampleTrack fills (one shared set: a sample is used at once). */
export const TS = {
  p: new THREE.Vector3(), q: new THREE.Quaternion(), pole: new THREE.Vector3(), sh: new THREE.Vector3(), off: new THREE.Vector3(),
  yaw: 0.5, tilt: 0.5, bow: 0.5, hipsY: 0.5,
};

function finish(t: Omit<StrokeTrack, 'c0' | 'c0len'>): StrokeTrack {
  const i = Math.round(t.lead * t.fps) * 3;
  const c0 = new THREE.Vector3(t.p[i]! - t.sh[i]!, t.p[i + 1]! - t.sh[i + 1]!, t.p[i + 2]! - t.sh[i + 2]!);
  return { ...t, c0, c0len: c0.length() };
}

export function parseTrack(j: TrackJson): StrokeTrack {
  const n = j.frames;
  const need: Array<[number[], number]> = [[j.p, 3], [j.q, 4], [j.pole, 3], [j.sh, 3], [j.off, 3], [j.yaw, 1], [j.tilt, 1], [j.bow, 1], [j.hipsY, 1]];
  for (const [a, k] of need) if (!Array.isArray(a) || a.length !== n * k || a.some((v) => !Number.isFinite(v))) throw new Error(`stroke track ${j.name}: a channel is not ${n} frames`);
  if (!(j.fps > 0 && j.lead > 0 && j.follow > 0) || Math.round((j.lead + j.follow) * j.fps) !== n - 1) throw new Error(`stroke track ${j.name}: its times don't add up`);
  return finish({
    name: j.name, fps: j.fps, n, lead: j.lead, follow: j.follow,
    p: Float32Array.from(j.p), q: Float32Array.from(j.q), pole: Float32Array.from(j.pole), sh: Float32Array.from(j.sh), off: Float32Array.from(j.off),
    yaw: Float32Array.from(j.yaw), tilt: Float32Array.from(j.tilt), bow: Float32Array.from(j.bow), hipsY: Float32Array.from(j.hipsY),
  });
}

/** The same swing by the other hand: x to -x, turns (x, -y, -z, w), the shoulders' turn the other way (as strokes.ts
 * mirrorKey; tilt is already "the free shoulder up" for either hand). */
export function mirrorTrack(t: StrokeTrack): StrokeTrack {
  const flip = (a: Float32Array): Float32Array => a.map((v, i) => (i % 3 === 0 ? -v : v));
  return finish({
    ...t, p: flip(t.p), pole: flip(t.pole), sh: flip(t.sh), off: flip(t.off),
    q: t.q.map((v, i) => (i % 4 === 1 || i % 4 === 2 ? -v : v)), yaw: t.yaw.map((v) => -v),
  });
}

/** The track at `tau` seconds from the ball (held at its ends), into TS. No allocation. */
export function sampleTrack(t: StrokeTrack, tau: number): void {
  let x = (tau + t.lead) * t.fps;
  const last = t.n - 1;
  if (x < 0) x = 0; else if (x > last) x = last;
  let i = x | 0;
  if (i >= last) i = last - 1;
  const u = x - i, a = i * 3, b = a + 3;
  const P = t.p, S = t.sh, E = t.pole, O = t.off;
  TS.p.x = P[a]! + (P[b]! - P[a]!) * u; TS.p.y = P[a + 1]! + (P[b + 1]! - P[a + 1]!) * u; TS.p.z = P[a + 2]! + (P[b + 2]! - P[a + 2]!) * u;
  TS.sh.x = S[a]! + (S[b]! - S[a]!) * u; TS.sh.y = S[a + 1]! + (S[b + 1]! - S[a + 1]!) * u; TS.sh.z = S[a + 2]! + (S[b + 2]! - S[a + 2]!) * u;
  TS.pole.x = E[a]! + (E[b]! - E[a]!) * u; TS.pole.y = E[a + 1]! + (E[b + 1]! - E[a + 1]!) * u; TS.pole.z = E[a + 2]! + (E[b + 2]! - E[a + 2]!) * u;
  TS.off.x = O[a]! + (O[b]! - O[a]!) * u; TS.off.y = O[a + 1]! + (O[b + 1]! - O[a + 1]!) * u; TS.off.z = O[a + 2]! + (O[b + 2]! - O[a + 2]!) * u;
  // (the file's turns keep one sign from frame to frame, so a straight blend made unit is the short way)
  const Q = t.q, c = i * 4, d = c + 4;
  const qx = Q[c]! + (Q[d]! - Q[c]!) * u, qy = Q[c + 1]! + (Q[d + 1]! - Q[c + 1]!) * u, qz = Q[c + 2]! + (Q[d + 2]! - Q[c + 2]!) * u, qw = Q[c + 3]! + (Q[d + 3]! - Q[c + 3]!) * u;
  const k = 1 / Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw);
  TS.q.x = qx * k; TS.q.y = qy * k; TS.q.z = qz * k; TS.q.w = qw * k;
  TS.yaw = t.yaw[i]! + (t.yaw[i + 1]! - t.yaw[i]!) * u;
  TS.tilt = t.tilt[i]! + (t.tilt[i + 1]! - t.tilt[i]!) * u;
  TS.bow = t.bow[i]! + (t.bow[i + 1]! - t.bow[i]!) * u;
  TS.hipsY = t.hipsY[i]! + (t.hipsY[i + 1]! - t.hipsY[i]!) * u;
}

function keyAt(t: StrokeTrack, tau: number): Key {
  sampleTrack(t, tau);
  return { p: TS.p.clone(), q: TS.q.clone(), pole: TS.pole.clone(), yaw: TS.yaw, off: TS.off.clone() };
}

/**
 * A family drawn by a track from now on: its three keys become the track's own at the take-back's end, the ball and the
 * finish (what the rest of the avatar reads: the hold, the fade, the reach), its times the track's, and the ways the
 * coded swing was shaped (the curve's dip and loop, the overhead's chest-frame arm, the low ball's dropped head) go:
 * the track has them in it. `high` keeps what the avatar did for an overhead besides drawing it, `volley` what it did for a
 * volley (the body going to the ball). The keyed stroke is kept under `coded`: a swing that starts with less than TRACK_RUSH of
 * the track's lead to its ball (avatar.ts pickFamily) is the keyed one.
 */
function drawBy(f: Family, t: StrokeTrack): void {
  keepCoded(f);
  f.back = keyAt(t, -t.lead);
  f.contact = keyAt(t, 0);
  f.finish = keyAt(t, t.follow);
  f.lead = t.lead;
  f.follow = t.follow;
  f.high = f.over !== undefined || f.high === true;
  f.volley = f.wrist !== undefined || f.volley === true;
  f.dip = 0;
  f.loop = 0;
  delete f.over; delete f.via; delete f.viaS; delete f.byHand; delete f.way; delete f.free; delete f.low; delete f.wrist; delete f.tip; delete f.through;
  f.track = t;
}

/** The families the tracks are for, by the track's file. */
const FAMILIES: Array<[string, Family]> = [['forehand', FOREHAND], ['backhand', BACKHAND], ['volley-fh', VOLLEY_FH], ['volley-bh', VOLLEY_BH], ['vibora', VIBORA], ['bandeja', OVERHEAD], ['smash', SMASH]];

/**
 * Fetches the tracks there are under `base` (assets/mocap-local/tracks/) and hands each to its family, both hands. A
 * track that isn't there or doesn't parse leaves its family as coded. Call once, before any avatar is built.
 */
/** The track files' names (tracks/<name>.json). */
export const TRACK_FILES: readonly string[] = FAMILIES.map(([file]) => file);

/** One track's file handed to its family, both hands (the tools read the files themselves). */
export function applyStrokeTrack(file: string, j: TrackJson): void {
  const fam = FAMILIES.find(([f]) => f === file)?.[1];
  if (!fam) throw new Error(`no stroke is drawn by a track called ${file}`);
  const t = parseTrack(j);
  drawBy(leftFamily(fam), mirrorTrack(t));
  drawBy(fam, t);
}

export async function loadStrokeTracks(base: string): Promise<string[]> {
  const got: string[] = [];
  await Promise.all(TRACK_FILES.map(async (file) => {
    try {
      const r = await fetch(`${base}${file}.json`);
      // (the dev server answers a missing file with the page itself)
      if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return;
      applyStrokeTrack(file, await r.json() as TrackJson);
      got.push(file);
    } catch (e) {
      console.warn('stroke track', file, e);
    }
  }));
  return got;
}
