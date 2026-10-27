// Ball, players, assists and the broadcast camera. Everything here only reads the sim.
import * as THREE from 'three/webgpu';
import type { MatchSim } from '../sim/match.ts';
import { PH_RALLY, PH_TOSS } from '../sim/match.ts';
import { SW_CHARGE, SW_COMMITTED, SW_RECOVER, type Player } from '../sim/player/player.ts';
import { PF_FLOOR } from '../sim/ball/predict.ts';

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
    const back = v1.set(x + 0.55 * s * hand, 1.15, z - 0.35 * fwd);
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
 * - Positioning (hidden in Pro mode): a spot where to stand (orange when you will struggle to get there).
 * - Aim (always): the shot's target on the far court while it can be steered.
 */
export class AssistView {
  private readonly approach = new RingStrip(64, C_WHITE);
  private readonly target = new RingStrip(48, C_WHITE);
  readonly spot: THREE.Mesh;
  private readonly spotMat: THREE.MeshBasicMaterial;
  readonly aim: THREE.Group;
  private readonly aimMat: THREE.MeshBasicMaterial;
  enabled = true;

  constructor(scene: THREE.Scene) {
    scene.add(this.approach.mesh, this.target.mesh);
    this.spotMat = new THREE.MeshBasicMaterial({ color: C_WHITE, transparent: true, opacity: 0.45, depthWrite: false });
    this.spot = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.22, 32), this.spotMat);
    this.spot.rotation.x = -Math.PI / 2;
    this.spot.renderOrder = 1;
    this.spot.visible = false;
    scene.add(this.spot);

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

  update(
    sim: MatchSim, human: number, ball: THREE.Vector3, camera: THREE.Camera, renderTime: number, timingScale: number,
    now: number,
  ): void {
    this.approach.mesh.visible = false;
    this.target.mesh.visible = false;
    this.spot.visible = false;
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
      this.spot.position.set(st.x, 0.006, st.z);
      this.spotMat.color.setHex(st.inTime ? C_WHITE : C_OFF);
      this.spot.visible = true;
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
    const dt = ideal - renderTime;
    if (dt > APPROACH_SHOW || dt < -0.15) return;
    const k = timingScale;
    const a = Math.abs(dt);
    const reach = sim.focusInReach;
    const col = !reach ? C_OFF : a <= 0.025 * k ? C_PERFECT : a <= 0.06 * k ? C_GOOD : C_WHITE;
    const fade = dt < 0 ? Math.max(0, 1 + dt / 0.15) : 1;

    this.target.set(tr, lw);
    this.target.mat.color.setHex(col);
    this.target.mat.opacity = (reach ? 0.75 : 0.35) * fade;
    this.place(this.target.mesh, ball, camera);
    if (dt > 0) {
      this.approach.set(tr + d * APPROACH_RATE * dt, lw);
      this.approach.mat.color.setHex(col);
      this.approach.mat.opacity = (reach ? 0.95 : 0.4) * Math.min(1, (APPROACH_SHOW - dt) / 0.12);
      this.place(this.approach.mesh, ball, camera);
    }
  }

  private place(m: THREE.Mesh, ball: THREE.Vector3, camera: THREE.Camera): void {
    m.position.copy(ball);
    m.quaternion.copy(camera.quaternion);
    m.visible = true;
  }
}
