// Ball, players, assists and the broadcast camera. Everything here only reads the sim.
import * as THREE from 'three/webgpu';
import type { MatchSim } from '../sim/match.ts';
import { PH_RALLY, PH_TOSS } from '../sim/match.ts';
import { SW_CHARGE, SW_COMMITTED, SW_RECOVER, type Player } from '../sim/player/player.ts';
import { PF_FLOOR } from '../sim/ball/predict.ts';
import { SHOT_BANDEJA } from '../sim/contact/shots.ts';
import { decal, makeSpotTexture } from './decals.ts';
import tuning from '../../data/tuning.json' with { type: 'json' };
import { Avatar, makeRacket } from './avatar/avatar.ts';
import type { PlayerAsset } from './avatar/asset.ts';
import { kitFor } from './avatar/kit.ts';
import { makeBall, spinBall } from './ballLook.ts';
import { DT } from '../sim/core/constants.ts';

const TIMING = tuning.timing;
const BALL_COLOR = 0xdff23b;
// By player number (team + 2 * slot): each pair in its colour, the partner a lighter shade of it.
const PLAYER_COLORS = [0xff7a45, 0x35c9a8, 0xffb48a, 0x8be3cf];
const TRAIL = 28;

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();

function smooth(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

export class BallView {
  /** Holds the ball at its position, stretched along its path for the shutter (ballLook.ts). */
  readonly mesh = new THREE.Group();
  private readonly felt: THREE.Mesh;
  private readonly blur: { value: number };
  private readonly radius: number;
  private lastSpinT = -1;
  /** Camera shutter for the ball's stretch (s; broadcast cameras run 1/100-1/1000 s; longer reads as an egg up close without a real blur). */
  static shutter = 1 / 500;
  readonly shadow: THREE.Mesh;
  readonly trail: THREE.Line;
  readonly marker: THREE.Mesh;
  private readonly trailPos: Float32Array;
  private trailCount = 0;
  private lastTrailTime = -1;
  showTrail = true;
  showMarker = true;

  constructor(scene: THREE.Scene, radius: number) {
    const look = makeBall(radius);
    this.felt = look.mesh;
    this.blur = look.blur;
    this.radius = radius;
    this.mesh.add(this.felt);
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
    {
      const t = sim.time + alpha * DT;
      const dt = this.lastSpinT < 0 || t < this.lastSpinT || t - this.lastSpinT > 0.25 ? 0 : t - this.lastSpinT;
      this.lastSpinT = t;
      const w = sim.ball.spin, v = sim.ball.vel;
      this.blur.value = spinBall(this.mesh, this.felt, w.x, w.y, w.z, dt, v.x, v.y, v.z, this.radius, BallView.shutter);
    }
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
  /** At the player's feet. */
  readonly root: THREE.Group;
  /** The animated body; null when the asset didn't load (then a capsule stands in, as in M1). */
  readonly avatar: Avatar | null;
  private readonly body: THREE.Mesh | null = null;
  private readonly racket: THREE.Group | null = null;
  private readonly ready = new THREE.Vector3();

  constructor(scene: THREE.Scene, idx: number, asset: PlayerAsset | null = null) {
    if (asset) {
      this.avatar = new Avatar(asset, kitFor(idx));
      this.root = this.avatar.root;
      scene.add(this.root);
      return;
    }
    this.avatar = null;
    this.root = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: PLAYER_COLORS[idx], roughness: 0.75 });
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
    this.racket = makeRacket();
    scene.add(this.racket);
  }

  /** A thin ring on the floor under the human's player, so you can tell yourself from your partner. */
  markYou(): void {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.36, 0.42, 40),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.006;
    ring.renderOrder = 1;
    this.root.add(ring);
  }

  update(sim: MatchSim, p: Player, idx: number, alpha: number, renderTime: number): void {
    if (this.avatar) {
      this.avatar.update(sim, p, idx, alpha, renderTime);
      return;
    }
    const body = this.body!;
    const racket = this.racket!;
    const pp = sim.prevPlayers[idx]!;
    const x = pp.x + (p.pos.x - pp.x) * alpha;
    const z = pp.z + (p.pos.z - pp.z) * alpha;
    this.root.position.set(x, 0, z);
    this.root.rotation.y = p.facing;
    // Lean into acceleration a little.
    const sp = p.speed();
    body.rotation.x = -Math.min(0.15, sp * 0.02);

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
    racket.position.lerp(tgt, p.swing === SW_COMMITTED || p.swing === SW_RECOVER ? 1 : 0.35);
    racket.lookAt(racket.position.x, racket.position.y, racket.position.z + fwd);
  }
}

/**
 * The broadcast main camera ("the WPT angle", the de facto standard of professional padel video): about 7.6 m above
 * the floor and 15.5 m behind the back glass (Javadiha et al. 2021, Sensors 21(10) 3368, from professional
 * footage: from there the near end's mesh covers the far court from the foot of the net to the far service line,
 * as on TV). A long lens frames the whole court from that far back (vertical FOV, degrees). Was 6.3 m up, 9.2 m
 * back, 42°: closer, with a wide angle's perspective.
 */
const CAM_BACK = 15.5;
const CAM_HEIGHT = 7.6;
const FOV = 26;
const KICK_DECAY = 0.09;

/** Broadcast camera high behind the back glass of the human's end; swings round smoothly at changes of ends. */
export class BroadcastCamera {
  readonly camera: THREE.PerspectiveCamera;
  private angle = 0;
  private from = 0;
  private to = 0;
  private turnStart = -1;
  private lookX = 0;
  /** The kick a smash gives the camera (FEEL.md): when, and how hard (0..1). */
  private kickAt = -1;
  private kickAmp = 0;
  private fovNow = FOV;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(FOV, aspect, 0.1, 300);
  }

  /**
   * A smash: the shot camera's operator flinches with it. A quick push in (up to 2.9% of zoom) and a 2 cm jolt
   * that rings down over a quarter of a second (11 Hz, 90 ms decay): felt, not seen as shake.
   */
  kick(strength: number, now: number): void {
    const live = this.kickAt >= 0 ? this.kickAmp * Math.exp(-(now - this.kickAt) / KICK_DECAY) : 0;
    if (strength <= live) return;
    this.kickAt = now;
    this.kickAmp = Math.min(1, strength);
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
    const R = halfL + CAM_BACK;
    this.lookX += (ballX * 0.12 - this.lookX) * 0.05;
    const ca = Math.cos(this.angle);
    const sa = Math.sin(this.angle);
    let jolt = 0;
    let fov = FOV;
    if (this.kickAt >= 0) {
      const u = now - this.kickAt;
      if (u > 0.35) this.kickAt = -1;
      else {
        const env = this.kickAmp * Math.exp(-u / KICK_DECAY);
        jolt = 0.02 * env * Math.sin(2 * Math.PI * 11 * u);
        fov = FOV * (1 - 0.029 * env * Math.min(1, u / 0.03));
      }
    }
    this.camera.position.set(sa * R + this.lookX * ca, CAM_HEIGHT + jolt, ca * R - this.lookX * sa);
    this.camera.lookAt(this.lookX * ca * 0.8, 0.35 + jolt * 0.5, -ca * 1.1);
    if (fov !== this.fovNow) {
      this.fovNow = fov;
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }
}

/** A flat ring whose radius and line width are set every frame (constant on-screen thickness). */
class RingStrip {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.MeshBasicMaterial;
  private readonly pos: Float32Array;
  private readonly attr: THREE.BufferAttribute;
  private readonly cs: Float32Array;
  private readonly sn: Float32Array;
  private readonly seg: number;

  constructor(seg: number, color: number) {
    this.seg = seg;
    this.cs = new Float32Array(seg + 1);
    this.sn = new Float32Array(seg + 1);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      this.cs[i] = Math.cos(a);
      this.sn[i] = Math.sin(a);
    }
    this.pos = new Float32Array((seg + 1) * 2 * 3);
    const idx: number[] = [];
    for (let i = 0; i < seg; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const g = new THREE.BufferGeometry();
    this.attr = new THREE.BufferAttribute(this.pos, 3);
    g.setAttribute('position', this.attr);
    g.setIndex(idx);
    this.mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.visible = false;
  }

  set(r: number, w: number): void {
    const p = this.pos;
    const ri = Math.max(0, r - w);
    for (let i = 0, k = 0; i <= this.seg; i++) {
      p[k++] = this.cs[i]! * ri; p[k++] = this.sn[i]! * ri; p[k++] = 0;
      p[k++] = this.cs[i]! * r; p[k++] = this.sn[i]! * r; p[k++] = 0;
    }
    this.attr.needsUpdate = true;
  }
}

// Sizes in radians of view angle, so the cue looks the same near and far (~1400 px per radian at 1080p).
const TARGET_R = 0.0115;
const APPROACH_RATE = 0.11; // per second before the ideal moment
const APPROACH_SHOW = 0.6; // seconds before the ideal moment the approaching ring appears
const LINE_W = 0.0022;

const C_WHITE = 0xffffff;
const C_LOCK = 0x8fe36b;
const C_GOOD = 0x8fe36b;
const C_PERFECT = 0x5ff2ff;
const C_OFF = 0xffc04a;
const C_BAD = 0xff5a4a;
const C_AIM = 0xffd84a;
const GRADE_HEX = [C_BAD, C_OFF, C_GOOD, C_PERFECT, C_OFF, C_BAD];

/**
 * Cues for the human player.
 * - Timing (hidden in Pro mode): a fixed target ring on the ball and an approaching ring that meets it at the
 *   ideal moment. Green inside Good, cyan inside Perfect; dim orange while the planned contact is still out
 *   of reach. On release the target ring flashes the grade.
 * - Where to stand (hidden in Pro mode): a pool of light with a dashed ring that turns slowly, green once you
 *   are on it, amber when you will struggle to get there in time.
 * - Aim (always): the shot's target on the far court while it can be steered.
 */
export class AssistView {
  private readonly approach = new RingStrip(64, C_WHITE);
  private readonly target = new RingStrip(48, C_WHITE);
  private readonly spotRoot: THREE.Group;
  readonly spot: THREE.Mesh;
  private readonly spotMat: THREE.MeshBasicMaterial;
  readonly aim: THREE.Group;
  private readonly aimMat: THREE.MeshBasicMaterial;
  private locked = 0;
  enabled = true;

  constructor(scene: THREE.Scene) {
    scene.add(this.approach.mesh, this.target.mesh);
    this.spotRoot = new THREE.Group();
    this.spot = decal(makeSpotTexture(), 0.95, C_WHITE, 0.9);
    this.spotMat = this.spot.material as THREE.MeshBasicMaterial;
    this.spotRoot.add(this.spot);
    this.spotRoot.position.y = 0.006;
    this.spotRoot.visible = false;
    scene.add(this.spotRoot);

    this.aimMat = new THREE.MeshBasicMaterial({ color: C_AIM, transparent: true, opacity: 0.9, depthWrite: false });
    this.aim = new THREE.Group();
    // Big enough to read at the far baseline (20 m away and seen at a grazing angle).
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.64, 48), this.aimMat);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.12, 24), this.aimMat);
    const fill = new THREE.Mesh(
      new THREE.CircleGeometry(0.5, 48),
      new THREE.MeshBasicMaterial({ color: C_AIM, transparent: true, opacity: 0.18, depthWrite: false }),
    );
    for (const m of [fill, ring, dot]) {
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 2;
      this.aim.add(m);
    }
    this.aim.position.y = 0.007;
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

  update(
    sim: MatchSim, human: number, ball: THREE.Vector3, camera: THREE.Camera, renderTime: number, timingScale: number,
    now: number, dt: number, cueTime = renderTime,
  ): void {
    this.approach.mesh.visible = false;
    this.target.mesh.visible = false;
    this.spotRoot.visible = false;
    this.aim.visible = false;
    if (human < 0) return;
    const p = sim.players[human]!;

    // Aim target: while it can be steered.
    if (p.aiming) {
      this.aim.position.x = p.aimX;
      this.aim.position.z = p.aimZ;
      const pulse = 1 + 0.06 * Math.sin(now * 9);
      this.aim.scale.set(pulse, pulse, pulse);
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
      this.foreshorten(this.spotRoot, camera.position);
      this.spot.rotation.z = now * 0.8;
      const sc = 1 + 0.05 * Math.sin(now * 5) - 0.12 * this.locked;
      this.spot.scale.set(sc, sc, 1);
      this.spotMat.color.setHex(!st.inTime ? C_OFF : this.locked > 0.5 ? C_LOCK : C_WHITE);
      this.spotRoot.visible = true;
    }

    const d = camera.position.distanceTo(ball);
    const lw = d * LINE_W;
    const tr = d * TARGET_R;
    // Just released: flash the grade on the target ring.
    const sinceRelease = renderTime - p.release;
    if (p.grade >= 0 && sinceRelease >= 0 && sinceRelease < 0.35) {
      this.target.set(tr * (1 + sinceRelease * 1.6), lw * 1.6);
      this.target.mat.color.setHex(GRADE_HEX[p.grade] ?? C_WHITE);
      this.target.mat.opacity = 1 - sinceRelease / 0.35;
      this.place(this.target.mesh, ball, camera);
      return;
    }
    const charging = p.swing === SW_CHARGE;
    const ideal = sim.focusIdeal(human);
    if (ideal < 0 || (!charging && sim.phase !== PH_TOSS && sim.phase !== PH_RALLY)) return;
    // Counted down on the clock the release is judged on (now), not the drawn moment: while a swing is held the
    // picture is a tick behind, and a ring closing at the drawn moment sends every release on it a tick late.
    const left = ideal - cueTime;
    if (left > APPROACH_SHOW || left < -0.15) return;
    // The shot's own windows (a volley is easier to time than a víbora), times the timing setting.
    const k = charging || sim.phase === PH_TOSS ? sim.windowScale(human) : timingScale;
    const a = Math.abs(left);
    const reach = sim.focusInReach;
    const col = !reach ? C_OFF : a <= TIMING.perfect * k ? C_PERFECT : a <= TIMING.good * k ? C_GOOD : C_WHITE;
    const fade = left < 0 ? Math.max(0, 1 + left / 0.15) : 1;

    this.target.set(tr, lw);
    this.target.mat.color.setHex(col);
    this.target.mat.opacity = (reach ? 0.75 : 0.35) * fade;
    this.place(this.target.mesh, ball, camera);
    if (left > 0) {
      this.approach.set(tr + d * APPROACH_RATE * left, lw);
      this.approach.mat.color.setHex(col);
      this.approach.mat.opacity = (reach ? 0.95 : 0.4) * Math.min(1, (APPROACH_SHOW - left) / 0.12);
      this.place(this.approach.mesh, ball, camera);
    }
  }

  private place(m: THREE.Mesh, ball: THREE.Vector3, camera: THREE.Camera): void {
    m.position.copy(ball);
    m.quaternion.copy(camera.quaternion);
    m.visible = true;
  }
}
