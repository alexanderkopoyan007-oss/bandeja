// Hit feedback (Phase 2; FEEL.md): turns the sim's hit and whiff events into sound, gamepad rumble and the
// camera's response to a smash. Reads the event ring like the HUD does; never writes to the sim.
import * as THREE from 'three/webgpu';
import { E_HIT, E_WHIFF, type MatchSim } from '../sim/match.ts';
import { SHOT_SMASH, SHOT_VIBORA, SHOT_DROP, SHOT_CHIQUITA, SHOT_BANDEJA } from '../sim/contact/shots.ts';
import { gradeQuality } from '../sim/contact/timing.ts';
import type { Sound } from '../audio/sound.ts';
import type { GamepadInput } from './input/gamepad.ts';
import type { BroadcastCamera } from '../render/views.ts';

const v = new THREE.Vector3();

export class Feedback {
  private seen = 0;
  private sim: MatchSim | null = null;
  private readonly hitSound = { quality: 1, speed: 0, soft: false, overhead: false, delay: 0, pan: 0, near: 1 };

  private readonly sound: Sound;
  private readonly pad: GamepadInput;
  private readonly cam: BroadcastCamera;

  constructor(sound: Sound, pad: GamepadInput, cam: BroadcastCamera) {
    this.sound = sound;
    this.pad = pad;
    this.cam = cam;
  }

  /** After the frame's sim steps: `renderTime` is the moment being drawn (events up to a tick ahead of it). */
  update(sim: MatchSim, human: number, renderTime: number, nowMs: number): void {
    if (sim !== this.sim) {
      this.sim = sim;
      this.seen = sim.eventSeq;
    }
    // Events older than the ring are gone; skip rather than read overwritten slots.
    if (sim.eventSeq - this.seen > sim.events.length) this.seen = sim.eventSeq - sim.events.length;
    const camera = this.cam.camera;
    while (this.seen < sim.eventSeq) {
      const e = sim.events[this.seen % sim.events.length]!;
      this.seen++;
      if (e.kind !== E_HIT && e.kind !== E_WHIFF) continue;
      // Where it is on screen and how far from the camera, for pan and loudness.
      v.set(e.x, e.y, e.z).project(camera);
      const pan = v.x;
      const d = camera.position.distanceTo(v.set(e.x, e.y, e.z));
      const near = Math.max(0, Math.min(1, 1 - (d - 8) / 22));
      const delay = Math.min(0.05, Math.max(0, e.time - renderTime));
      const mine = human >= 0 && e.player === human;
      if (e.kind === E_WHIFF) {
        if (e.player >= 0) this.sound.whiff(delay, pan, near);
        if (mine) this.pad.rumble(0, 0.15, 40, nowMs);
        continue;
      }
      const shot = e.a;
      const q = gradeQuality(e.b);
      const overhead = shot === SHOT_SMASH || shot === SHOT_VIBORA;
      const h = this.hitSound;
      h.quality = q;
      h.speed = e.c;
      h.soft = shot === SHOT_DROP || shot === SHOT_CHIQUITA;
      h.overhead = overhead;
      h.delay = delay;
      h.pan = pan;
      h.near = near;
      this.sound.hit(h);
      if (mine) {
        // A clean hit is a short, light tap on the high motor; a mistimed one a heavier, longer buzz on the low
        // one; a smash both, hard.
        if (overhead) this.pad.rumble(0.55 + 0.3 * Math.min(1, e.c / 40), 0.6, 110, nowMs);
        else if (q >= 0.8) this.pad.rumble(0.05, 0.25 + 0.25 * Math.min(1, e.c / 30), 45, nowMs);
        else this.pad.rumble(0.35 * (1 - q) + 0.1, 0.1, 90, nowMs);
      }
      // The camera answers a smash (a little for a bandeja's or víbora's pace): a short kick, bigger for a faster
      // ball and for one hit at our end.
      if (shot === SHOT_SMASH || shot === SHOT_VIBORA || (shot === SHOT_BANDEJA && e.c > 20)) {
        const pace = Math.max(0, Math.min(1, (e.c - 15) / 20));
        const k = (shot === SHOT_SMASH ? 1 : 0.4) * pace * (0.5 + 0.5 * near);
        if (k > 0.05) this.cam.kick(k, nowMs / 1000);
      }
    }
  }
}
