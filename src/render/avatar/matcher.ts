// Motion matching at run time (docs/motion-plan.md, phase 2), behind ?motion=2: which frame of which locomotion clip
// the legs play, chosen by matchDb.ts's search from where the sim is taking the player. It is built against the five
// cycles the game has now, so it is ready when the captured footwork lands; with these five it mostly does what the
// sector blend does, and what it adds (the path ahead, staying on the frame playing, the jump to another frame left to
// the inertializer) is what captured starts, stops and plants will need.
//
// The sim stays the truth (motion plan, the rule): the query's path is the sim's own velocity, carried ahead towards
// the sim's own movement wish (Player.driveX/driveZ, at the top speed for that way) with the sim's push and braking
// (data/tuning.json player accel, brake). Nothing here feeds back into the sim. No allocation per frame: inputs and
// outputs go through fields (V8 boxes doubles passed to calls it doesn't inline; CLAUDE.md, V8 traps).
import type { Clip, PlayerAsset } from './asset.ts';
import { F_DIR, F_FEET, F_HIPS_V, F_TRAJ, FEATURES, MatchDb, TRAJ_T, sourceOf } from './matchDb.ts';

/** Seconds between searches (Clavet 2016 searched every 0.1 s, at once when the stick moved a lot). */
export const SEARCH_EVERY = 0.1;
/** Another frame must be nearer than the one playing by this much (squared scaled distance) to be taken. */
const SLACK = 0.5;
/** A frame this close ahead of the one playing in the same clip is the clip carrying on, not a jump (frames). */
const SAME_RUN = 3;
/** A cycle plays at the ground speed over its own (distance, as the sector blend's phase), at most this fast (the
 * blend's cap: the legs never spin). */
const RATE_MAX = 1.7;
/** The prediction's step (s): 0.6 s ahead in twelve. */
const PRED_H = 0.05;
/**
 * The most a cycle's legs are turned onto the way the body is going (the avatar's warp), and so the furthest from it a
 * clip's own travel may lie to be picked: half a sector, as the sector blend's warp. Without it the path ahead picked
 * strafes up to 90 degrees off the way the body still went, and their legs, turned only so far, crossed through each
 * other (8% of frames on seed 1 against the blend's 6.6%); with the blend's cross-fade band on top (54 degrees) still
 * 7%. A clip that travels nowhere (a stop, a plant) is always allowed. With only the four directions, this leaves the
 * path ahead nothing to pick early across a turn: captured turns and plants will.
 */
export const WARP_REACH = Math.PI / 4;
/** Below this ground speed (m/s) the way of travel isn't settled and every clip is allowed. */
const REACH_FROM = 0.5;

export class Matcher {
  readonly db: MatchDb;
  /** Inputs, set before step(): velocity now and the movement wish as a velocity, both in the body's frame (+z
   *  ahead, +x its left; m/s); the sim's push and braking (m/s^2); the frame's time step and ground speed. */
  vx = 0;
  vz = 0;
  wx = 0;
  wz = 0;
  accel = 8.5;
  brake = 8;
  dt = 0;
  sp = 0;
  /** The cadence over the clip's own (a walk's steps are shorter than the jog's it is drawn from: more of them). */
  cadence = 1;
  /** Out: the source playing (index into the clips given), its clip time (s), and whether this step jumped to
   *  another frame (the avatar then hands the jump to the inertializer). */
  src = -1;
  t = 0;
  jumped = false;
  /** The clip playing's phase (0..1 from its re-phased start, as sampleCycle takes it): out after step(); in for
   *  applyPhase(). (A field: a double returned from or passed to a call V8 doesn't inline is boxed, every frame.) */
  ph = 0;
  /** The row playing and the time since the last search. */
  private row = -1;
  private since = 1e9;
  private readonly q = new Float32Array(FEATURES);
  /** Each source's first row, its travel's bearing (atan2 x, z) or NaN if it travels nowhere, and whether the search
   *  may pick it now. */
  private readonly first: Int32Array;
  private readonly bearing: Float64Array;
  private readonly allow: Uint8Array;

  constructor(asset: PlayerAsset, clips: Clip[]) {
    this.db = new MatchDb(asset, clips.map(sourceOf));
    this.first = new Int32Array(clips.length).fill(-1);
    for (let r = this.db.n - 1; r >= 0; r--) this.first[this.db.sourceOf[r]!] = r;
    this.bearing = new Float64Array(clips.length);
    this.allow = new Uint8Array(clips.length);
    for (let i = 0; i < clips.length; i++) {
      const s = this.db.sources[i]!;
      this.bearing[i] = s.vx === 0 && s.vz === 0 ? NaN : Math.atan2(s.vx, s.vz);
    }
  }

  /** Back to no frame (a cut: the next step searches at once). */
  reset(): void {
    this.src = -1;
    this.row = -1;
    this.since = 1e9;
  }

  /** The playing clip's time from `ph` (the avatar pulls the arms in time with the procedural feet). */
  applyPhase(): void {
    const c = this.db.sources[this.src]!.clip;
    const u = this.ph + c.phase0;
    this.t = (u - Math.floor(u)) * c.duration;
    this.row = this.rowAt(this.src);
  }

  /** `ph` from the playing clip's time. */
  private measurePhase(): void {
    const c = this.db.sources[this.src]!.clip;
    const u = this.t / c.duration - c.phase0;
    this.ph = u - Math.floor(u);
  }

  step(): void {
    this.search();
    if (this.src >= 0) this.measurePhase();
  }

  private search(): void {
    const dt = this.dt;
    this.jumped = false;
    // Carry the clip on: a cycle at the ground speed over its own (distance, so the feet don't skate), else in time.
    if (this.src >= 0) {
      const c = this.db.sources[this.src]!.clip;
      let rate = 1;
      if (c.loop && c.speed > 0) {
        rate = this.sp / c.speed;
        rate = (rate > RATE_MAX ? RATE_MAX : rate) * this.cadence;
      }
      this.t += dt * rate;
      if (c.loop) this.t -= Math.floor(this.t / c.duration) * c.duration;
      else if (this.t > c.duration) this.t = c.duration;
      this.row = this.rowAt(this.src);
    }
    this.since += dt;
    if (this.since < SEARCH_EVERY && this.src >= 0) return;
    this.since = 0;
    this.query();
    // Only clips whose travel the legs can be turned onto (WARP_REACH); all of them if none is.
    const sp = Math.sqrt(this.vx * this.vx + this.vz * this.vz), way = Math.atan2(this.vx, this.vz);
    let any = 0;
    for (let i = 0; i < this.allow.length; i++) {
      const b = this.bearing[i]!;
      let d = way - b;
      d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
      const ok = sp < REACH_FROM || b !== b || (d < 0 ? -d : d) <= WARP_REACH ? 1 : 0;
      this.allow[i] = ok;
      any += ok;
    }
    const best = this.db.search(this.q, this.row, SLACK, any > 0 ? this.allow : null);
    if (best === this.row) return;
    const s = this.db.sourceOf[best]!, f = this.db.frameOf[best]!;
    if (s === this.src) {
      // A little way ahead in the clip playing is the clip carrying on (no jump, nothing to blend).
      const c = this.db.sources[s]!.clip, n = c.frames - (c.loop ? 1 : 0);
      const at = this.row - this.first[s]!;
      let ahead = f - at;
      if (c.loop && ahead < 0) ahead += n;
      if (ahead >= 0 && ahead <= SAME_RUN) return;
    }
    const was = this.src;
    if (was >= 0) this.measurePhase();
    this.jumped = was >= 0;
    this.src = s;
    this.row = best;
    this.t = f / this.db.sources[s]!.clip.fps;
    // From one cycle to another, the footfall carries on: every cycle is re-phased to the left foot landing at phase
    // 0, so the new one starts at the phase the old one was at (the sector blend's shared phase). Jumping to the
    // frame whose feet scored best instead put the legs out of step, and the inertializer carried them through each
    // other.
    if (was >= 0 && was !== s && this.db.sources[was]!.clip.loop && this.db.sources[s]!.clip.loop) {
      this.applyPhase();
    }
  }

  /** The library row of source s at the clip time playing. */
  private rowAt(s: number): number {
    const c = this.db.sources[s]!.clip, n = c.frames - (c.loop ? 1 : 0);
    let f = Math.floor(this.t * c.fps);
    if (f >= n) f = c.loop ? f % n : n - 1;
    return this.first[s]! + f;
  }

  /** The query: the playing frame's own feet, the sim's velocity, and the path ahead towards the wish. */
  private query(): void {
    const q = this.q, db = this.db;
    if (this.row >= 0) {
      const o = this.row * FEATURES;
      for (let k = F_FEET; k < F_HIPS_V; k++) q[k] = db.feat[o + k]! / db.scale[k]! + db.mean[k]!;
    } else {
      // Nothing playing yet: the feet are whatever the library's average is (the path decides).
      for (let k = F_FEET; k < F_HIPS_V; k++) q[k] = db.mean[k]!;
    }
    q[F_HIPS_V] = this.vx;
    q[F_HIPS_V + 1] = this.vz;
    // The velocity driven towards the wish at the sim's push (speeding up) or braking (slowing or turning), in
    // PRED_H steps; positions kept at TRAJ_T.
    let vx = this.vx, vz = this.vz, px = 0, pz = 0, j = 0;
    const steps = Math.round(TRAJ_T[TRAJ_T.length - 1]! / PRED_H);
    for (let i = 1; i <= steps; i++) {
      const dx = this.wx - vx, dz = this.wz - vz, dl = Math.sqrt(dx * dx + dz * dz);
      const a = (dx * vx + dz * vz < 0 ? this.brake : this.accel) * PRED_H;
      if (dl <= a) { vx = this.wx; vz = this.wz; } else { vx += (dx / dl) * a; vz += (dz / dl) * a; }
      px += vx * PRED_H;
      pz += vz * PRED_H;
      if (j < TRAJ_T.length && Math.abs(i * PRED_H - TRAJ_T[j]!) < PRED_H * 0.5) {
        q[F_TRAJ + j * 2] = px;
        q[F_TRAJ + j * 2 + 1] = pz;
        // The clips keep facing ahead, and so does the body here (the avatar turns its root to the stance itself).
        q[F_DIR + j * 2] = 0;
        q[F_DIR + j * 2 + 1] = 1;
        j++;
      }
    }
  }
}
