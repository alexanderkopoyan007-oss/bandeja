// The face's expression and gaze keys (tools/assets/mpfb/person_face.py), driven each frame by what the player is
// doing: blinks (every 2-6 s, about 0.25 s each, and often at their own contact), the eyes on the ball (what the head
// leaves to them, within the eyes' own range, quick as a saccade), effort over a stroke's contact (brows down, eyes
// narrowed, lips pressed; a grunt with the mouth open on smashes and serves), breathing through the mouth after
// running, and the face of a won or lost point. Render-only (no sim state); allocation-free per frame.

export interface FaceInput {
  /** The time to the next planned contact (s, Infinity if none) and since the last one. */
  toContact: number;
  sinceContact: number;
  /** How hard this stroke is (0..1): a volley's punch, a drive, a smash. */
  strain: number;
  /** Open-mouthed grunt on this stroke (smash, serve). */
  grunt: boolean;
  /** How hard the player has been running lately (0..1). */
  puff: number;
  /** After a point this player ended: +1 won, -1 lost, 0 neither; and the time since it ended. */
  mood: number;
  moodT: number;
  /** The ball's direction in the head's frame (radians: + towards the head's left, + up). */
  gazeYaw: number;
  gazePitch: number;
}

/** The eyes' own range before the head must turn (radians); the gaze keys are made at 30 deg sideways, 25 up/down. */
const EYE_YAW = 0.52, EYE_UP = 0.44, EYE_DOWN = 0.44;
const KEY_YAW = (30 * Math.PI) / 180, KEY_PITCH = (25 * Math.PI) / 180;
/** Saccade time constant (s): the eyes reach a new target in about 60 ms. */
const SACCADE = 0.02;

export class FaceDriver {
  /** Every morphed mesh's influences (the face and the hair share them). */
  readonly influences: Float32Array;
  private readonly at: Int32Array;
  private seed: number;
  private nextBlink = 0;
  private blinkT = -1;
  private lastContact = -1;
  private eyeYaw = 0;
  private eyePitch = 0;
  private t = 0;

  constructor(names: string[], seed: number) {
    this.influences = new Float32Array(names.length);
    const want = ['blinkL', 'blinkR', 'squint', 'browDown', 'browInnerUp', 'browUp', 'jawOpen', 'mouthPress', 'smile',
      'grimace', 'sneer', 'neckTense', 'lookLeft', 'lookRight', 'lookUp', 'lookDown'];
    this.at = new Int32Array(want.length);
    for (let i = 0; i < want.length; i++) this.at[i] = names.indexOf(want[i]!);
    this.seed = (seed * 2654435761) >>> 0 || 1;
    this.nextBlink = 0.5 + this.rand() * 3;
  }

  private rand(): number {
    // xorshift32: the blinks vary by player and repeat run to run (captures stay comparable).
    let x = this.seed;
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    this.seed = x;
    return x / 4294967296;
  }

  private set(k: number, v: number): void {
    const i = this.at[k]!;
    if (i >= 0) this.influences[i] = v < 0 ? 0 : v > 1.2 ? 1.2 : v;
  }

  update(dt: number, f: FaceInput): void {
    this.t += dt;
    const t = this.t;
    // ---- blinks: a startle blink at most contacts, else every 2-6 s
    if (f.sinceContact >= 0 && f.sinceContact < 0.05 && this.lastContact < 0) {
      this.lastContact = 1;
      if (this.rand() < 0.6 && this.blinkT < 0) this.blinkT = 0;
    } else if (f.sinceContact > 0.2) this.lastContact = -1;
    if (this.blinkT < 0 && t >= this.nextBlink) this.blinkT = 0;
    let blink = 0;
    if (this.blinkT >= 0) {
      const u = this.blinkT;
      // Closing 70 ms, closed 30 ms, opening 130 ms (the lid falls faster than it rises).
      blink = u < 0.07 ? u / 0.07 : u < 0.1 ? 1 : u < 0.23 ? 1 - (u - 0.1) / 0.13 : 0;
      blink = blink * blink * (3 - 2 * blink);
      this.blinkT += dt;
      if (this.blinkT >= 0.23) { this.blinkT = -1; this.nextBlink = t + 2 + this.rand() * 4; }
    }
    // ---- effort over the contact: up over the last 0.25 s, held a moment, gone in 0.35 s
    const pre = f.toContact < 0.25 ? 1 - f.toContact / 0.25 : 0;
    const post = f.sinceContact >= 0 && f.sinceContact < 0.35 ? 1 - f.sinceContact / 0.35 : 0;
    let e = (pre > post ? pre : post) * f.strain;
    e = e * e * (3 - 2 * e);
    const g = f.grunt ? (f.sinceContact >= 0 && f.sinceContact < 0.3 ? 1 - f.sinceContact / 0.3 : f.toContact < 0.08 ? 1 - f.toContact / 0.08 : 0) : 0;
    // ---- breathing through the mouth after running (about 0.45 Hz at rest after a rally)
    const breath = f.puff * (0.55 + 0.45 * Math.sin(t * 2.8));
    // ---- the point's end
    const mw = f.mood !== 0 ? Math.min(1, f.moodT / 0.25) * (1 - Math.min(1, Math.max(0, (f.moodT - 1.8) / 0.6))) : 0;
    const won = f.mood > 0 ? mw : 0, lost = f.mood < 0 ? mw : 0;
    // ---- gaze: what the head leaves to the eyes, clamped to their range, quick
    const yw = f.gazeYaw > EYE_YAW ? EYE_YAW : f.gazeYaw < -EYE_YAW ? -EYE_YAW : f.gazeYaw;
    const pw = f.gazePitch > EYE_UP ? EYE_UP : f.gazePitch < -EYE_DOWN ? -EYE_DOWN : f.gazePitch;
    const a = dt > 0 ? 1 - Math.exp(-dt / SACCADE) : 1;
    this.eyeYaw += (yw - this.eyeYaw) * a;
    this.eyePitch += (pw - this.eyePitch) * a;

    const squint = e * 0.55 + won * 0.25;
    this.set(0, blink + squint * 0.15 + lost * 0.1);
    this.set(1, blink * 0.97 + squint * 0.15 + lost * 0.1);
    this.set(2, squint);
    this.set(3, e * 0.7 + g * 0.3);
    this.set(4, lost * 0.7);
    this.set(5, won * 0.35);
    this.set(6, g * 0.45 + breath * 0.22 + won * 0.15);
    this.set(7, e * (1 - g) * 0.6 + lost * 0.45);
    this.set(8, won * 0.75);
    this.set(9, g * 0.6 + e * 0.15);
    this.set(10, g * 0.35 + e * 0.1);
    this.set(11, g * 0.6 + e * 0.3);
    this.set(12, this.eyeYaw > 0 ? this.eyeYaw / KEY_YAW : 0);
    this.set(13, this.eyeYaw < 0 ? -this.eyeYaw / KEY_YAW : 0);
    this.set(14, this.eyePitch > 0 ? this.eyePitch / KEY_PITCH : 0);
    this.set(15, this.eyePitch < 0 ? -this.eyePitch / KEY_PITCH + lost * 0.3 : lost * 0.3);
  }
}
