// Ball, players, assists and the broadcast camera. Everything here only reads the sim.
import * as THREE from 'three/webgpu';
import type { MatchSim } from '../sim/match.ts';
import { PH_RALLY } from '../sim/match.ts';
import { SW_CHARGE, SW_COMMITTED, SW_RECOVER, type Player } from '../sim/player/player.ts';
import { PF_FLOOR } from '../sim/ball/predict.ts';
import { SHOT_BANDEJA } from '../sim/contact/shots.ts';
import { BTN_POWER, BTN_PRECISION } from '../sim/input.ts';
import { decal, makeAimTexture, makeSpotTexture, makeSpreadTexture } from './decals.ts';

const BALL_COLOR = 0xdff23b;
const TEAM_COLORS = [0xff7a45, 0x35c9a8];
const TRAIL = 28;

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();

function smooth(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

export class BallView {
  readonly mesh: THREE.Mesh;
  readonly shadow: THREE.Mesh;
  readonly trail: THREE.Line;
  readonly marker: THREE.Mesh;
  private readonly trailPos: Float32Array;
  private trailCount = 0;
  private lastTrailTime = -1;
  showTrail = true;
  showMarker = true;

  constructor(scene: THREE.Scene, radius: number) {
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 20, 14),
      new THREE.MeshStandardMaterial({ color: BALL_COLOR, roughness: 0.55, emissive: 0x2a3008 }),
    );
    this.mesh.castShadow = true;
    scene.add(this.mesh);

    // Crisp contact shadow straight below the ball: the main cue for judging height and depth.
    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(radius * 1.15, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 1;
    scene.add(this.shadow);

    this.trailPos = new Float32Array(TRAIL * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    this.trail = new THREE.Line(g, new THREE.LineBasicMaterial({ color: BALL_COLOR, transparent: true, opacity: 0.45 }));
    this.trail.frustumCulled = false;
    scene.add(this.trail);

    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.1, 0.14, 28),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false }),
    );
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.position.y = 0.004;
    this.marker.renderOrder = 1;
    scene.add(this.marker);
  }

  update(sim: MatchSim, alpha: number, humanTeam: number): void {
    const b = sim.ball.pos;
    const p = sim.prevBall;
    const x = p.x + (b.x - p.x) * alpha;
    const y = p.y + (b.y - p.y) * alpha;
    const z = p.z + (b.z - p.z) * alpha;
    this.mesh.position.set(x, y, z);
    const h = Math.max(0, y - sim.world.spec.radius);
    this.shadow.position.set(x, 0.003, z);
    const sc = 1 + h * 0.25;
    this.shadow.scale.set(sc, sc, sc);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.12, 0.72 - h * 0.13);

    // Trail: one point per sim tick.
    if (this.showTrail && sim.phase >= 1) {
      if (sim.time !== this.lastTrailTime) {
        this.lastTrailTime = sim.time;
        this.trailPos.copyWithin(3, 0, (TRAIL - 1) * 3);
        this.trailPos[0] = b.x; this.trailPos[1] = b.y; this.trailPos[2] = b.z;
        this.trailCount = Math.min(TRAIL, this.trailCount + 1);
        (this.trail.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
        this.trail.geometry.setDrawRange(0, this.trailCount);
      }
      this.trail.visible = true;
    } else {
      this.trailCount = 0;
      this.trail.visible = false;
    }

    // Bounce marker: where the incoming ball will first land on the human's side.
    this.marker.visible = false;
    if (this.showMarker && sim.phase === PH_RALLY && sim.rally.hitter !== humanTeam && sim.rally.bounces === 0) {
      const pr = sim.pred;
      const s = sim.side(humanTeam);
      for (let i = pr.indexAt(sim.time); i < pr.n; i++) {
        if ((pr.flags[i]! & PF_FLOOR) !== 0) {
          if (pr.z[i]! * s > 0) {
            this.marker.position.set(pr.x[i]!, 0.004, pr.z[i]!);
            this.marker.visible = true;
          }
          break;
        }
      }
    }
  }
}

export class PlayerView {
  readonly root = new THREE.Group();
  readonly body: THREE.Mesh;
  readonly racket = new THREE.Group();
  private readonly ready = new THREE.Vector3();

  constructor(scene: THREE.Scene, team: number) {
    const mat = new THREE.MeshStandardMaterial({ color: TEAM_COLORS[team], roughness: 0.75 });
    this.body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 1.2, 6, 14), mat);
    this.body.position.y = 0.8;
    this.body.castShadow = true;
    this.root.add(this.body);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xd9b38c, roughness: 0.8 }),
    );
    head.position.y = 1.66;
    head.castShadow = true;
    this.root.add(head);
    // A visor-like nose so the facing direction reads at a glance.
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.1), mat);
    nose.position.set(0, 1.7, -0.12);
    this.root.add(nose);
    scene.add(this.root);

    const face = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.13, 0.03, 24),
      new THREE.MeshStandardMaterial({ color: 0x1d1f24, roughness: 0.4, metalness: 0.2 }),
    );
    face.rotation.x = Math.PI / 2;
    face.scale.set(1, 1, 1.12);
    face.castShadow = true;
    this.racket.add(face);
    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.016, 0.016, 0.2, 10),
      new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 }),
    );
    handle.position.y = -0.24;
    this.racket.add(handle);
    scene.add(this.racket);
  }

  update(sim: MatchSim, p: Player, idx: number, alpha: number, renderTime: number): void {
    const pp = sim.prevPlayers[idx]!;
    const x = pp.x + (p.pos.x - pp.x) * alpha;
    const z = pp.z + (p.pos.z - pp.z) * alpha;
    this.root.position.set(x, 0, z);
    this.root.rotation.y = p.facing;
    // Lean into acceleration a little.
    const sp = p.speed();
    this.body.rotation.x = -Math.min(0.15, sp * 0.02);

    // Racket: ready position, backswing while charging, swing through the contact point, follow-through.
    const s = sim.side(p.team);
    const fwd = -s;
    const hand = p.handSide * p.handed;
    this.ready.set(x + 0.32 * s * hand, 1.0, z + 0.25 * fwd);
    // Overhead key: the racket loads up above and behind the head (trophy position) instead of at the waist.
    const overhead = p.shot === SHOT_BANDEJA;
    const back = overhead
      ? v1.set(x + 0.3 * s * hand, 2.05, z - 0.2 * fwd)
      : v1.set(x + 0.55 * s * hand, 1.15, z - 0.35 * fwd);
    const tgt = v2;
    if (p.swing === SW_CHARGE) {
      tgt.copy(back);
    } else if (p.swing === SW_COMMITTED) {
      const i = sim.pred.indexAt(p.contactTime);
      v3.set(sim.pred.x[i]!, sim.pred.y[i]!, sim.pred.z[i]!);
      const u = smooth(1 - (p.contactTime - renderTime) / 0.22);
      tgt.copy(back).lerp(v3, u);
    } else if (p.swing === SW_RECOVER) {
      const u = smooth((renderTime - p.lastContactTime) / p.tune.recoverTime);
      v3.set(x - 0.45 * s * hand, 1.3, z + 0.2 * fwd);
      tgt.set(p.lastContact.x, p.lastContact.y, p.lastContact.z).lerp(v3, u);
    } else {
      tgt.copy(this.ready);
    }
    this.racket.position.lerp(tgt, p.swing === SW_COMMITTED || p.swing === SW_RECOVER ? 1 : 0.35);
    this.racket.lookAt(this.racket.position.x, this.racket.position.y, this.racket.position.z + fwd);
  }
}

/** Broadcast camera high behind the back glass of the human's end; swings round smoothly at changes of ends. */
export class BroadcastCamera {
  readonly camera: THREE.PerspectiveCamera;
  private angle = 0;
  private from = 0;
  private to = 0;
  private turnStart = -1;
  private lookX = 0;
  shake = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(42, aspect, 0.1, 300);
  }

  update(sim: MatchSim, humanTeam: number, ballX: number, now: number): void {
    const want = sim.side(humanTeam) > 0 ? 0 : Math.PI;
    if (Math.abs(want - this.to) > 1e-6) {
      this.from = this.angle;
      this.to = want;
      this.turnStart = now;
    }
    if (this.turnStart >= 0) {
      const u = smooth((now - this.turnStart) / 1.6);
      this.angle = this.from + (this.to - this.from) * u;
      if (u >= 1) this.turnStart = -1;
    } else {
      this.angle = this.to;
    }
    const halfL = sim.world.court.halfL;
    const R = halfL + 9.2;
    this.lookX += (ballX * 0.12 - this.lookX) * 0.05;
    const ca = Math.cos(this.angle);
    const sa = Math.sin(this.angle);
    this.camera.position.set(sa * R + this.lookX * ca, 6.3, ca * R - this.lookX * sa);
    this.camera.lookAt(this.lookX * ca * 0.8, 0.35, -ca * 1.4);
  }
}

const C_WHITE = 0xffffff;
const C_LOCK = 0x8fe36b;
const C_OFF = 0xffc04a;
const C_AIM = 0xffd84a;

/**
 * Floor cues for the human player (the timing cue on the ball is the 2D overlay in ui/cue.ts).
 * - Where to stand (hidden in Pro mode): a pool of light with a dashed ring that turns slowly, green once you
 *   are on it, amber when you will struggle to get there in time.
 * - Aim (always): a reticle on the far court while the shot can be steered, with a dashed spread circle that
 *   tightens with precision (Shift) and widens with power (Space), in proportion to the error model.
 */
export class AssistView {
  private readonly spotRoot: THREE.Group;
  readonly spot: THREE.Mesh;
  private readonly spotMat: THREE.MeshBasicMaterial;
  readonly aim: THREE.Group;
  private readonly reticle: THREE.Mesh;
  private readonly spread: THREE.Mesh;
  private readonly spreadMat: THREE.MeshBasicMaterial;
  private spreadScale = 1;
  private locked = 0;
  enabled = true;

  constructor(scene: THREE.Scene) {
    this.spotRoot = new THREE.Group();
    this.spot = decal(makeSpotTexture(), 0.95, C_WHITE, 0.9);
    this.spotMat = this.spot.material as THREE.MeshBasicMaterial;
    this.spotRoot.add(this.spot);
    this.spotRoot.position.y = 0.006;
    this.spotRoot.visible = false;
    scene.add(this.spotRoot);

    this.aim = new THREE.Group();
    this.reticle = decal(makeAimTexture(), 1.7, C_AIM, 1);
    this.spread = decal(makeSpreadTexture(), 1.2, C_AIM, 0.55);
    this.spreadMat = this.spread.material as THREE.MeshBasicMaterial;
    this.aim.add(this.reticle, this.spread);
    this.aim.position.y = 0.008;
    this.aim.visible = false;
    scene.add(this.aim);
  }

  /**
   * Seen from the broadcast camera the far court is at a grazing angle, where a round floor decal is a thin
   * sliver. Turn the decal's group to face the camera and stretch it along the view, so it reads as a circle.
   */
  private foreshorten(g: THREE.Object3D, cam: THREE.Vector3): void {
    const dx = cam.x - g.position.x;
    const dz = cam.z - g.position.z;
    const sinE = cam.y / Math.sqrt(cam.y * cam.y + dx * dx + dz * dz);
    g.rotation.y = Math.atan2(dx, dz);
    g.scale.z = Math.min(3, Math.max(1, 0.6 / sinE));
  }

  /** `held`: the human's held buttons (power / precision change the spread shown). `cam`: camera position. */
  update(sim: MatchSim, human: number, now: number, dt: number, held: number, cam: THREE.Vector3): void {
    this.spotRoot.visible = false;
    this.aim.visible = false;
    if (human < 0) return;
    const p = sim.players[human]!;

    if (p.aiming) {
      this.aim.position.x = p.aimX;
      this.aim.position.z = p.aimZ;
      this.foreshorten(this.aim, cam);
      this.reticle.rotation.z = now * 0.6;
      const pulse = 1 + 0.04 * Math.sin(now * 7);
      this.reticle.scale.set(pulse, pulse, 1);
      // Spread follows the modifier's error multiplier (precision 0.6, power 1.45), eased.
      const want = (held & BTN_POWER) !== 0 ? 1.45 : (held & BTN_PRECISION) !== 0 ? 0.6 : 1;
      this.spreadScale += (want - this.spreadScale) * Math.min(1, dt * 12);
      this.spread.scale.set(this.spreadScale, this.spreadScale, 1);
      this.spread.rotation.z = -now * 0.25;
      this.spreadMat.color.setHex((held & BTN_POWER) !== 0 ? 0xff9a3c : C_AIM);
      this.aim.visible = true;
    }
    if (!this.enabled) return;

    const st = sim.stand[human]!;
    if (st.valid && sim.phase === PH_RALLY) {
      const d = Math.hypot(p.pos.x - st.x, p.pos.z - st.z);
      // On the spot: green, with a little pop as you arrive.
      const on = d < 0.18 && st.inTime;
      this.locked = on ? Math.min(1, this.locked + dt * 6) : Math.max(0, this.locked - dt * 6);
      this.spotRoot.position.x = st.x;
      this.spotRoot.position.z = st.z;
      this.foreshorten(this.spotRoot, cam);
      this.spot.rotation.z = now * 0.8;
      const sc = 1 + 0.05 * Math.sin(now * 5) - 0.12 * this.locked;
      this.spot.scale.set(sc, sc, 1);
      this.spotMat.color.setHex(!st.inTime ? C_OFF : this.locked > 0.5 ? C_LOCK : C_WHITE);
      this.spotRoot.visible = true;
    }
  }
}
