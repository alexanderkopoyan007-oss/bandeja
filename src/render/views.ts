// Ball, players, assists and the broadcast camera. Everything here only reads the sim.
import * as THREE from 'three/webgpu';
import { PAL, gradeColour } from '../ui/palette.ts';
import type { MatchSim } from '../sim/match.ts';
import { PH_OVER, PH_RALLY, PH_SETUP, PH_TOSS } from '../sim/match.ts';
import { SW_CHARGE, SW_COMMITTED, SW_RECOVER, type Player } from '../sim/player/player.ts';
import { PF_FLOOR } from '../sim/ball/predict.ts';
import { SHOT_BANDEJA } from '../sim/contact/shots.ts';
import { decal, makeSpotTexture } from './decals.ts';
import tuning from '../../data/tuning.json' with { type: 'json' };
import { Avatar } from './avatar/avatar.ts';
import { dressRacket, makeRacketModel, racketLookFor } from './avatar/racket.ts';
import type { PlayerAsset } from './avatar/asset.ts';
import { kitFor } from './avatar/kit.ts';
import type { Cast } from '../game/cast.ts';
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
  private readonly blur: { value: THREE.Vector2 };
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

  /** The next frame draws another match or moment (replays): no trail carried over, no spin blur from the jump. */
  cutNext(): void {
    this.trailCount = 0;
    this.lastTrailTime = -1;
    this.lastSpinT = -1;
    this.placedAt = -1;
  }

  /** The server's routine bounce touched the floor this frame (serveBounce): the game plays its sound. */
  routineBounce = false;
  /** When everyone was last in place for the serve (sim time), for the server's routine bounces. */
  private placedAt = -1;

  update(sim: MatchSim, alpha: number, humanTeam: number): void {
    const b = sim.ball.pos;
    const p = sim.prevBall;
    const x = p.x + (b.x - p.x) * alpha;
    let y = p.y + (b.y - p.y) * alpha;
    const z = p.z + (b.z - p.z) * alpha;
    y = this.serveBounce(sim, y, sim.time + alpha * DT);
    this.mesh.position.set(x, y, z);
    {
      const t = sim.time + alpha * DT;
      const dt = this.lastSpinT < 0 || t < this.lastSpinT || t - this.lastSpinT > 0.25 ? 0 : t - this.lastSpinT;
      this.lastSpinT = t;
      const w = sim.ball.spin, v = sim.ball.vel;
      this.blur.value.x = spinBall(this.mesh, this.felt, w.x, w.y, w.z, dt, v.x, v.y, v.z, this.radius, BallView.shutter);
    }
    const h = Math.max(0, y - sim.world.spec.radius);
    this.shadow.position.set(x, 0.003, z);
    const sc = 1 + h * 0.25;
    this.shadow.scale.set(sc, sc, sc);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.12, 0.72 - h * 0.13);

    // Trail: one point per sim tick, while a struck ball is in play (from the toss it hung under the dropped ball like a
    // string, and stayed drawn behind a dead one between points).
    if (this.showTrail && sim.phase === PH_RALLY && sim.rally.hitter >= 0 && !sim.rally.over) {
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

  /** The ball's drawn height during the server's routine bounces (else `y`); sets routineBounce at each floor. */
  private serveBounce(sim: MatchSim, y: number, t: number): number {
    this.routineBounce = false;
    if (sim.phase !== PH_SETUP || sim.walking !== 0) { this.placedAt = -1; this.lastRoutine = -1; return y; }
    if (this.placedAt < 0) this.placedAt = t;
    const u = t - this.placedAt - ROUTINE_AFTER;
    if (u < 0 || u >= ROUTINE_BOUNCES * ROUTINE_PERIOD) return y;
    const k = Math.floor(u / ROUTINE_PERIOD);
    const f = u / ROUTINE_PERIOD - k;
    const r = sim.world.spec.radius;
    // Down from the hand, off the floor at the half period, back up into it.
    const a = 2 * f - 1;
    if (f >= 0.5 && this.lastRoutine !== k) { this.lastRoutine = k; this.routineBounce = true; }
    return r + (y - r) * a * a;
  }
  private lastRoutine = -1;
}

/**
 * The server's routine before the serve, drawn only (the sim holds the ball in the hand): once everyone is in place,
 * after ROUTINE_AFTER s, ROUTINE_BOUNCES bounces from the hand, each ROUTINE_PERIOD s, the ball fastest at the floor.
 */
const ROUTINE_AFTER = 0.25;
const ROUTINE_BOUNCES = 2;
const ROUTINE_PERIOD = 0.5;

export class PlayerView {
  /** At the player's feet. */
  readonly root: THREE.Group;
  /** The animated body; null when the asset didn't load (then a capsule stands in, as in M1). */
  readonly avatar: Avatar | null;
  private readonly body: THREE.Mesh | null = null;
  private readonly racket: THREE.Group | null = null;
  private readonly ready = new THREE.Vector3();

  constructor(scene: THREE.Scene, idx: number, asset: PlayerAsset | null = null, cast?: Cast) {
    if (asset) {
      // Dressed as the person dealt to them (game/cast.ts) when they loaded, else the mannequin.
      const person = cast ? asset.people.find((p) => p.look!.name === cast.people[idx]) : asset.people[idx];
      this.avatar = new Avatar(person ?? asset, kitFor(idx, cast?.kits));
      // Each player's own racket (data/racket-looks/).
      dressRacket(this.avatar.racket, racketLookFor(idx));
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
    this.racket = makeRacketModel(racketLookFor(idx));
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

  /** The next frame draws another match or moment (replays). */
  cutNext(): void {
    this.avatar?.cutNext();
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
/**
 * The camera choices (Settings > Camera; review round 3, critic High #4: there was one locked camera).
 * - tv: the broadcast main camera above.
 * - near: TV close, the same end camera nearer (8 m back, 7.8 m up, 36°): the players bigger, the far court flatter.
 * - player: lower behind your end (6 m back, 5.8 m up, 44°), sliding with you (`follow` of your x) rather than with
 *   the ball, as a game's player camera does.
 * Every camera behind the glass sees the end wall's top, the mesh band from 3 to 4 m up, across the picture. Each
 * keeps it where the broadcast camera does, between the near pair's heads (1.8 m, 1.5 m in from the glass) and the
 * far pair's feet (1.5 m in from theirs): height under 0.8 x back + 3 and over 0.216 x back + 4. At 6.5 m back and
 * 4.6 m up the far pair played behind the mesh. Each is also above the stadium's end stand where it stands (rows from
 * 1.6 m behind the glass, 0.42 m up every 0.82 m: 2.7 m and heads at 3.9 m at 6 m back).
 */
export const CAMERA_PRESETS = {
  tv: { back: CAM_BACK, height: CAM_HEIGHT, fov: FOV, follow: 0 },
  near: { back: 8.0, height: 7.8, fov: 36, follow: 0 },
  player: { back: 6.0, height: 5.8, fov: 44, follow: 0.55 },
} as const;
export type CameraPreset = keyof typeof CAMERA_PRESETS;
/** The pan's response (s): 5% a 60 Hz frame, as it was a frame at any rate (critic Low #14: 2.4x faster at 144 Hz). */
const PAN_LAG = 0.325;
const KICK_DECAY = 0.09;
/** Lob tilt: the ball kept this far (rad) below the top edge; the most the camera tilts up (rad); its lag (s). */
const TILT_MARGIN = (2.5 * Math.PI) / 180;
const TILT_MAX = (14 * Math.PI) / 180;
const TILT_LAG = 0.2;

/**
 * The cut-away between points (BroadcastCamera.cutaways): while the players walk back (MatchSim.walking) a camera at
 * the net post on the side of the pair that won the point, CUT_HEIGHT up, CUT_POST in from the side glass and
 * CUT_NET onto their half, frames them (CUT_FOV, following their middle with CUT_LAG); the broadcast angle comes back
 * for the serve, as TV coverage cuts to a close shot of a pair after a point. A pair walking back from the net has
 * its back to that post: the camera is in the corner by their back glass instead (CUT_BACK in from it), in front of
 * them (those shots were half backs: review round 9, the critic's #6).
 */
const CUT_HEIGHT = 1.7;
const CUT_POST = 0.7;
const CUT_NET = 0.8;
const CUT_BACK = 0.8;
/** How far (m) the pair has to go back, on average, for that. */
const CUT_GOING_BACK = 1;
const CUT_FOV = 34;
const CUT_LAG = 0.35;
/**
 * After match point the cut-away frames the winners as they react and walk to the net (MatchSim.overStage 1-2), then
 * cuts to a shot along the net (NET_SHOT_*: from by the side glass, NET_SHOT_Z onto the losers' half so the winners
 * face it) as both pairs touch rackets across it.
 */
const NET_SHOT_IN = 0.35;
const NET_SHOT_HEIGHT = 1.6;
const NET_SHOT_Z = 1.9;
const NET_SHOT_FOV = 40;

/** Broadcast camera high behind the back glass of the human's end; swings round smoothly at changes of ends. */
export class BroadcastCamera {
  /** Cut away to a close camera while the players walk back between points (?cutaway=0 keeps the broadcast angle). */
  static cutaways = true;
  readonly camera: THREE.PerspectiveCamera;
  /** The cut-away: which team it frames, where it looks (followed), and whether it is on. */
  private cutTeam = 0;
  private cutOn = false;
  private cutX = 0;
  private cutZ = 0;
  private cutSide = 1;
  /** The cut-away looks from the pair's back glass (CUT_BACK), not the net post. */
  private cutBack = false;
  private netShot = false;
  private angle = 0;
  private from = 0;
  private to = 0;
  private turnStart = -1;
  private lookX = 0;
  /** The kick a smash gives the camera (FEEL.md): when, and how hard (0..1). */
  private kickAt = -1;
  private kickAmp = 0;
  private fovNow = FOV;
  private back = CAM_BACK;
  private height = CAM_HEIGHT;
  private fov0 = FOV;
  private follow = 0;
  private lastPan = -1;
  /** The player the 'player' camera slides with. */
  followPlayer = 0;

  /** Settings > Camera. */
  setPreset(name: CameraPreset): void {
    const p = CAMERA_PRESETS[name] ?? CAMERA_PRESETS.tv;
    this.back = p.back;
    this.height = p.height;
    this.fov0 = p.fov;
    this.follow = p.follow;
  }
  private tilt = 0;
  private lastNow = -1;

  /** How much higher the camera goes at the middle of the change-of-ends swing (m; per arena: over the stadium's
   * stands, never through a hall's roof). */
  private readonly swingRise: number;

  constructor(aspect: number, swingRise = 0) {
    this.camera = new THREE.PerspectiveCamera(FOV, aspect, 0.1, 300);
    this.swingRise = swingRise;
  }

  /** Something else pointed the camera (a replay): the next update sets its lens again and starts any cut-away afresh. */
  retake(): void {
    this.fovNow = -1;
    this.cutOn = false;
    this.lastNow = -1;
    this.lastPan = -1;
  }

  /** The camera is swinging round at a change of ends. */
  get swinging(): boolean {
    return this.turnStart >= 0;
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

  /** The cut-away's pose for this frame (see CUT_*); returns its field of view. A cut, not a move, when it starts. */
  private cutaway(sim: MatchSim, dt: number): number {
    const court = sim.world.court;
    const over = sim.phase === PH_OVER;
    const net = over && sim.overStage >= 3;
    // (a team's players are every second number, in singles too: stepping by 1 took both players, and team 0's points
    // cut to the empty court between them)
    const ti = net ? 1 : 2;
    let mx = 0, mz = 0;
    for (let i = net ? 0 : this.cutTeam; i < sim.players.length; i += ti) { mx += sim.players[i]!.pos.x; mz += sim.players[i]!.pos.z; }
    const n = net ? sim.players.length : sim.doubles ? 2 : 1;
    mx /= n; mz /= n;
    // The pair's half from where they are (nobody changes ends after match point).
    let wz = 0;
    for (let i = this.cutTeam; i < sim.players.length; i += 2) wz += sim.players[i]!.pos.z;
    const side = wz >= 0 ? 1 : -1;
    if (net !== this.netShot) { this.netShot = net; this.cutOn = false; }
    if (!this.cutOn) {
      this.cutOn = true;
      this.cutX = mx;
      this.cutZ = mz;
      // The post on the side away from the pair's middle (so the shot looks across them, not along the glass).
      this.cutSide = mx > 0 ? -1 : 1;
      let back = 0;
      for (let i = this.cutTeam; i < sim.players.length; i += 2) back += (sim.walkHomeZ[i]! - sim.players[i]!.pos.z) * side;
      this.cutBack = !over && back / (sim.doubles ? 2 : 1) > CUT_GOING_BACK;
    } else if (dt > 0) {
      const a = 1 - Math.exp(-dt / CUT_LAG);
      this.cutX += (mx - this.cutX) * a;
      this.cutZ += (mz - this.cutZ) * a;
    }
    if (net) {
      this.camera.position.set(this.cutSide * (court.halfW - NET_SHOT_IN), NET_SHOT_HEIGHT, -side * NET_SHOT_Z);
      this.camera.lookAt(this.cutX, 1.2, this.cutZ);
      return NET_SHOT_FOV;
    }
    this.camera.position.set(this.cutSide * (court.halfW - CUT_POST), CUT_HEIGHT, side * (this.cutBack ? court.halfL - CUT_BACK : CUT_NET));
    this.camera.lookAt(this.cutX, 1.15, this.cutZ);
    return CUT_FOV;
  }

  /** `ball`: where the ball is drawn (null: placing the camera before play). `now` in seconds. */
  update(sim: MatchSim, humanTeam: number, ball: THREE.Vector3 | null, now: number): void {
    const want = sim.side(humanTeam) > 0 ? 0 : Math.PI;
    if (Math.abs(want - this.to) > 1e-6) {
      this.from = this.angle;
      this.to = want;
      this.turnStart = now;
    }
    // The change-of-ends swing goes round an ellipse (a side's stands come nearer the court than an end's) and
    // climbs over them: on the end's 25.5 m circle the lens went through the stadium's back rows.
    let swing = 0;
    if (this.turnStart >= 0) {
      const u = smooth((now - this.turnStart) / 1.6);
      this.angle = this.from + (this.to - this.from) * u;
      swing = Math.sin(Math.PI * u);
      if (u >= 1) this.turnStart = -1;
    } else {
      this.angle = this.to;
    }
    const court = sim.world.court;
    const Rz = court.halfL + this.back;
    const Rx = court.halfW + this.back;
    const ballX = ball ? ball.x : 0;
    const fx = this.follow > 0 ? sim.players[this.followPlayer]!.pos.x : 0;
    // (on the match clock, as the tilt: stepped captures and pauses included)
    const pdt = this.lastPan < 0 ? 0 : Math.min(0.1, Math.max(0, sim.time - this.lastPan));
    const panWant = ballX * 0.12 * (1 - this.follow) + fx * this.follow;
    this.lookX += (panWant - this.lookX) * (this.lastPan < 0 ? 1 : 1 - Math.exp(-pdt / PAN_LAG));
    this.lastPan = sim.time;
    const ca = Math.cos(this.angle);
    const sa = Math.sin(this.angle);
    let jolt = 0;
    let fov = this.fov0;
    if (this.kickAt >= 0) {
      const u = now - this.kickAt;
      if (u > 0.35) this.kickAt = -1;
      else {
        const env = this.kickAmp * Math.exp(-u / KICK_DECAY);
        jolt = 0.02 * env * Math.sin(2 * Math.PI * 11 * u);
        fov = this.fov0 * (1 - 0.029 * env * Math.min(1, u / 0.03));
      }
    }
    const camY = this.height + this.swingRise * swing + jolt;
    const tx = this.lookX * ca * 0.8, ty = 0.35 + jolt * 0.5, tz = -ca * 1.1;
    this.camera.position.set(sa * Rx + this.lookX * ca, camY, ca * Rz - this.lookX * sa);
    this.camera.lookAt(tx, ty, tz);
    // Tilt up with a lob, as the operator does: keep the ball TILT_MARGIN below the top of the frame, following
    // with a TILT_LAG response (and easing back down).
    // On the match clock (stepped captures included); the operator leads a rising ball by the lag.
    const dt = this.lastNow < 0 ? 0 : Math.min(0.1, Math.max(0, sim.time - this.lastNow));
    this.lastNow = sim.time;
    let tiltWant = 0;
    if (ball) {
      const p = this.camera.position;
      const hx = ball.x - p.x, hz = ball.z - p.z;
      const lead = Math.max(0, sim.ball.vel.y) * TILT_LAG;
      const ballPitch = Math.atan2(ball.y + lead - p.y, Math.sqrt(hx * hx + hz * hz));
      const vx = tx - p.x, vz = tz - p.z;
      const viewPitch = Math.atan2(ty - p.y, Math.sqrt(vx * vx + vz * vz));
      const top = viewPitch + ((this.fov0 / 2) * Math.PI) / 180 - TILT_MARGIN;
      tiltWant = Math.min(TILT_MAX, Math.max(0, ballPitch - top));
    }
    this.tilt += (tiltWant - this.tilt) * (dt > 0 ? 1 - Math.exp(-dt / (tiltWant > this.tilt ? TILT_LAG : TILT_LAG * 2)) : 0);
    if (this.tilt > 1e-5) this.camera.rotateX(this.tilt);
    const over = sim.phase === PH_OVER;
    const pw = over ? sim.score.winner : sim.pointWinner;
    if (pw >= 0) this.cutTeam = pw;
    if (BroadcastCamera.cutaways && (sim.walking > 0 || over) && this.turnStart < 0) {
      fov = this.cutaway(sim, dt);
    } else this.cutOn = false;
    if (fov !== this.fovNow) {
      this.fovNow = fov;
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }
}

/**
 * The replays' cameras (game/replay.ts), where a padel broadcast has its others, fixed where they stand and panning:
 * 0 low behind the winning hitter's back glass, its lens against the glass (RP_BACK out, RP_LOW up) in the middle
 * of a panel across from them (1.2 m back, the panel's posts swung into the picture as black bars); 1 a jib high
 * over the side stands by the net (RP_SIDE out, RP_HIGH up: at 0.5 m out and 3.9 m up it looked flat across at the
 * far glass). Both follow the ball with RP_LAG, a little ahead of it; the jib keeps RP_JIB_HITTER of its look on
 * the hitter, so the shot and where it goes share the frame. Never looking above RP_LOOK_MAX (from the low camera
 * a lob took the frame up into the roof). A cut, not a move, when a replay starts; each the other replay's angle.
 */
const RP_BACK = 0.35;
const RP_LOW = 1.8;
const RP_ACROSS = 0.5;
const RP_SIDE = 3;
const RP_HIGH = 6.5;
const RP_FOV = [40, 44] as const;
const RP_LAG = 0.12;
const RP_LOOK_MAX = [1.5, 2.5] as const;
const RP_JIB_HITTER = 0.35;

export class ReplayCamera {
  private on = false;
  private lx = 0;
  private ly = 0;
  private lz = 0;
  private camX = 0;
  private sideX = 1;

  /** The next replay starts with a cut. */
  reset(): void {
    this.on = false;
  }

  /** Point `camera` for the replay of `hitter`'s winner from `angle`, the ball drawn at `ball`; `dt` replay time. */
  aim(camera: THREE.PerspectiveCamera, sim: MatchSim, hitter: number, angle: number, ball: THREE.Vector3, dt: number): void {
    const court = sim.world.court;
    const h = sim.players[hitter]!;
    const s = h.pos.z >= 0 ? 1 : -1;
    const v = sim.ball.vel;
    // Where to look: the ball, a little ahead of it (the jib partly the hitter).
    const hw = angle === 1 ? RP_JIB_HITTER : 0;
    const ax = (ball.x + v.x * 0.08) * (1 - hw) + h.pos.x * hw;
    const ay = (ball.y + v.y * 0.08) * (1 - hw) + 1.1 * hw;
    const az = (ball.z + v.z * 0.08) * (1 - hw) + h.pos.z * hw;
    if (!this.on) {
      this.on = true;
      this.lx = ax; this.ly = ay; this.lz = az;
      // The panel's middle nearest across from the hitter (panels from the side wall, glassPanelWidth each).
      const pw = court.def.backWall.glassPanelWidth;
      const k = Math.round((-h.pos.x * RP_ACROSS + court.halfW - pw / 2) / pw);
      this.camX = Math.max(-court.halfW + pw / 2, Math.min(court.halfW - pw / 2, -court.halfW + pw / 2 + k * pw));
      this.sideX = h.pos.x >= 0 ? -1 : 1;
    } else if (dt > 0) {
      const a = 1 - Math.exp(-dt / RP_LAG);
      this.lx += (ax - this.lx) * a;
      this.ly += (ay - this.ly) * a;
      this.lz += (az - this.lz) * a;
    }
    if (angle === 0) camera.position.set(this.camX, RP_LOW, s * (court.halfL + RP_BACK));
    else camera.position.set(this.sideX * (court.halfW + RP_SIDE), RP_HIGH, s * 0.5);
    camera.lookAt(this.lx, Math.min(RP_LOOK_MAX[angle]!, Math.max(0.6, this.ly)), this.lz);
    const fov = RP_FOV[angle]!;
    if (camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
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

// Sizes in radians of view angle at the old 42° lens, so the cue looks the same near and far (~1400 px per radian at
// 1080p); scaled by the lens in use (lensScale), so it keeps the size on screen the owner saw with the 42° lens.
const TARGET_R = 0.0115;
const APPROACH_RATE = 0.11; // per second before the ideal moment
const APPROACH_SHOW = 0.6; // seconds before the ideal moment the approaching ring appears
const LINE_W = 0.0022;

/** View angle per screen height relative to the 42° lens the cue sizes were set with. */
function lensScale(camera: THREE.Camera): number {
  const fov = (camera as THREE.PerspectiveCamera).fov;
  return fov ? Math.tan((fov * Math.PI) / 360) / Math.tan((21 * Math.PI) / 180) : 1;
}

const C_WHITE = 0xffffff;
const C_AIM = 0xffd84a;

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
      this.spotMat.color.setHex(!st.inTime ? PAL.off : this.locked > 0.5 ? PAL.good : C_WHITE);
      this.spotRoot.visible = true;
    }

    const d = camera.position.distanceTo(ball) * lensScale(camera);
    const lw = d * LINE_W;
    const tr = d * TARGET_R;
    // Just released: flash the grade on the target ring.
    const sinceRelease = renderTime - p.release;
    if (p.grade >= 0 && sinceRelease >= 0 && sinceRelease < 0.35) {
      this.target.set(tr * (1 + sinceRelease * 1.6), lw * 1.6);
      this.target.mat.color.setHex(p.grade >= 0 && p.grade <= 5 ? gradeColour(p.grade) : C_WHITE);
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
    const col = !reach ? PAL.off : a <= TIMING.perfect * k ? PAL.perfect : a <= TIMING.good * k ? PAL.good : C_WHITE;
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
