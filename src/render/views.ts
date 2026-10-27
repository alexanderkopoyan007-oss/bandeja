// Ball, players, assists and the broadcast camera. Everything here only reads the sim.
import * as THREE from 'three/webgpu';
import type { MatchSim } from '../sim/match.ts';
import { PH_RALLY } from '../sim/match.ts';
import { SW_CHARGE, SW_COMMITTED, SW_RECOVER, type Player } from '../sim/player/player.ts';
import { PF_FLOOR } from '../sim/ball/predict.ts';
import { makeWindows } from '../sim/contact/windows.ts';

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

/**
 * Timing and positioning cues (hidden in Pro mode):
 * - a ring around the ball that closes in as the ideal contact moment approaches and lights up inside the
 *   Good / Perfect windows, so the moment to release is right where you are already looking;
 * - a spot on the floor showing where to stand for the incoming ball.
 */
export class AssistView {
  readonly ring: THREE.Mesh;
  readonly spot: THREE.Mesh;
  private readonly ringMat: THREE.MeshBasicMaterial;
  private readonly wins = makeWindows();
  enabled = true;

  constructor(scene: THREE.Scene) {
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48), this.ringMat);
    this.ring.renderOrder = 10;
    this.ring.visible = false;
    scene.add(this.ring);
    this.spot = new THREE.Mesh(
      new THREE.RingGeometry(0.16, 0.22, 32),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false }),
    );
    this.spot.rotation.x = -Math.PI / 2;
    this.spot.renderOrder = 1;
    this.spot.visible = false;
    scene.add(this.spot);
  }

  update(sim: MatchSim, human: number, ball: THREE.Vector3, camera: THREE.Camera, renderTime: number, timingScale: number): void {
    this.ring.visible = false;
    this.spot.visible = false;
    if (!this.enabled || human < 0) return;
    const st = sim.stand[human]!;
    if (st.valid && sim.phase === PH_RALLY) {
      this.spot.position.set(st.x, 0.006, st.z);
      this.spot.visible = true;
    }
    const n = sim.windowsFor(human, this.wins);
    let ideal = -1;
    for (let i = 0; i < n; i++) {
      const w = this.wins[i]!;
      if (w.ideal >= renderTime - 0.15 && (ideal < 0 || w.ideal < ideal)) ideal = w.ideal;
    }
    if (ideal < 0) return;
    const dt = ideal - renderTime;
    if (dt > 0.7) return;
    const k = timingScale;
    const r = 0.07 + Math.max(0, dt) * 0.85;
    this.ring.scale.set(r, r, r);
    this.ring.position.copy(ball);
    this.ring.quaternion.copy(camera.quaternion);
    const a = Math.abs(dt);
    this.ringMat.color.setHex(a <= 0.025 * k ? 0x5ff2ff : a <= 0.06 * k ? 0x8fe36b : 0xffffff);
    this.ringMat.opacity = dt < 0 ? Math.max(0, 0.9 + dt * 6) : 0.9;
    this.ring.visible = true;
  }
}
