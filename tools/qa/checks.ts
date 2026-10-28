// Per-tick checks for the QA army: what must never happen in a match, whatever the players do. Each problem is
// noted with what it was, where and when; a kind is noted at most a few times per match (the count still grows).
import type { MatchSim } from '../../src/sim/match.ts';
import { SURF_OPEN, type ZoneHit } from '../../src/sim/court/court.ts';
import { DT } from '../../src/sim/core/constants.ts';

export interface Anomaly {
  kind: string;
  /** Short signature to group the same problem across matches (defaults to the detail's start). */
  sig?: string;
  detail: string;
  tick: number;
  time: number;
}

const PH_SETUP = 0;
const PH_TOSS = 1;
const PH_RALLY = 2;
const PH_DEAD = 3;
const E_HIT = 1;

const PER_KIND = 4;

const f3 = (v: number): string => v.toFixed(3);

export class Checks {
  private readonly zone: ZoneHit = { kind: 0, seamDist: 0, joinDist: 0 };
  private readonly seen = new Map<string, number>();
  private phase = -1;
  private lastPhase = -1;
  private phaseSince = 0;
  private slowSince = -1;
  private lastNetSide = 0;
  /** Where and when the ball's centre last crossed the net's plane. */
  private crossX = 0;
  private crossY = 0;
  private crossT = -10;
  private lastSideZ = 0;
  private wasOutside = false;
  private lastSeq = -1;
  private readonly lastVel: number[] = [];
  /** Energy per kg (kinetic + potential) at the end of the last tick. */
  private lastE = -1;
  private readonly windy: boolean;

  private readonly sim: MatchSim;
  private readonly note: (a: Anomaly) => void;

  constructor(sim: MatchSim, note: (a: Anomaly) => void) {
    this.sim = sim;
    this.note = note;
    for (let i = 0; i < sim.players.length * 2; i++) this.lastVel.push(0);
    const env = sim.world.env;
    this.windy = env.windX !== 0 || env.windZ !== 0;
    this.lastSeq = sim.eventSeq - 1;
  }

  private flag(kind: string, sig: string, detail: string): void {
    const k = `${kind}|${sig}`;
    const n = (this.seen.get(k) ?? 0) + 1;
    this.seen.set(k, n);
    if (n <= PER_KIND) this.note({ kind, sig, detail, tick: this.sim.tick, time: this.sim.time });
  }

  afterStep(): void {
    const s = this.sim;
    const b = s.ball;
    const c = s.world.court;
    const r = s.world.spec.radius;
    const t = s.time;
    const ph = s.phase;
    if (ph !== this.phase) { this.phase = ph; this.phaseSince = t; }
    const struck = this.struckThisTick();

    // Numbers stay numbers.
    const bad = (v: number): boolean => !Number.isFinite(v);
    if (bad(b.pos.x) || bad(b.pos.y) || bad(b.pos.z) || bad(b.vel.x) || bad(b.vel.y) || bad(b.vel.z) || bad(b.spin.x) || bad(b.spin.y) || bad(b.spin.z)) {
      this.flag('non-finite', 'ball', `ball pos ${b.pos.x},${b.pos.y},${b.pos.z} vel ${b.vel.x},${b.vel.y},${b.vel.z}`);
      return;
    }
    for (const p of s.players) {
      if (bad(p.pos.x) || bad(p.pos.z) || bad(p.vel.x) || bad(p.vel.z)) this.flag('non-finite', 'player', `player ${p.index} pos ${p.pos.x},${p.pos.z}`);
    }

    const live = ph === PH_RALLY || ph === PH_TOSS;
    if (live && !s.rally.over) {
      const speed = Math.hypot(b.vel.x, b.vel.y, b.vel.z);
      // The floor and the walls hold the ball.
      if (!b.outside) {
        if (b.pos.y < r - 0.004) this.flag('ball-below-floor', 'floor', `ball centre at y ${f3(b.pos.y)} (radius ${f3(r)}) at x ${f3(b.pos.x)} z ${f3(b.pos.z)}`);
        const dx = c.halfW - Math.abs(b.pos.x);
        if (dx < r - 0.006) {
          c.sideZone(b.pos.z, b.pos.y, this.zone);
          if (this.zone.kind !== SURF_OPEN) this.flag('ball-in-wall', 'side', `ball ${f3(r - dx)} m into the side wall at z ${f3(b.pos.z)} y ${f3(b.pos.y)} (surface ${this.zone.kind}), vel ${f3(b.vel.x)},${f3(b.vel.y)},${f3(b.vel.z)}`);
        }
        const dz = c.halfL - Math.abs(b.pos.z);
        if (dz < r - 0.006) {
          c.backZone(b.pos.x, b.pos.y, this.zone);
          if (this.zone.kind !== SURF_OPEN) this.flag('ball-in-wall', 'back', `ball ${f3(r - dz)} m into the back wall at x ${f3(b.pos.x)} y ${f3(b.pos.y)} (surface ${this.zone.kind}), vel ${f3(b.vel.x)},${f3(b.vel.y)},${f3(b.vel.z)}`);
        }
      }
      // Leaving the enclosure only where it is open: through a door or over a wall's top.
      if (b.outside && !this.wasOutside) this.checkExit();
      // Through the net below the tape: the ball's side changes only after its centre crossed the net's plane
      // above the tape (or beyond the posts).
      const pz = s.prevBall.z;
      if (pz !== 0 && b.pos.z !== 0 && Math.sign(pz) !== Math.sign(b.pos.z)) {
        const k = pz / (pz - b.pos.z);
        this.crossX = s.prevBall.x + (b.pos.x - s.prevBall.x) * k;
        this.crossY = s.prevBall.y + (b.pos.y - s.prevBall.y) * k;
        this.crossT = t;
      }
      if (b.netSide !== this.lastNetSide && this.lastNetSide !== 0 && !b.outside && ph === PH_RALLY && this.lastPhase === PH_RALLY) {
        // (the sim measures from the cable as it hangs, a few mm off z = 0: a ball at the plane is crossing it)
        if (t - this.crossT > 0.6 && Math.abs(b.pos.z) < 0.08) { this.crossX = b.pos.x; this.crossY = b.pos.y; this.crossT = t; }
        if (t - this.crossT > 0.6) this.flag('through-net', 'no-crossing', `ball changed sides (to ${b.netSide}) at z ${f3(b.pos.z)} without crossing the net's plane in the last 0.6 s`);
        else if (Math.abs(this.crossX) < c.halfW - 0.1 && this.crossY < c.netHeightAt(this.crossX) - 0.05) {
          this.flag('through-net', 'below-tape', `ball crossed the net's plane at x ${f3(this.crossX)} y ${f3(this.crossY)} (tape at ${f3(c.netHeightAt(this.crossX))}) and changed sides, inNet ${b.inNet}`);
        }
      }
      if (Math.sign(b.sideZ) !== Math.sign(this.lastSideZ) && this.lastSideZ !== 0 && b.sideZ !== 0 && !b.outside
        && Math.abs(b.pos.x) < c.halfW - 0.1 && b.pos.y < c.netHeightAt(b.pos.x) - 0.06 && Math.abs(b.pos.z) < 0.5) {
        this.flag('side-flip-low', 'sideZ', `sideZ changed sign with the ball at y ${f3(b.pos.y)} z ${f3(b.pos.z)} (netSide ${b.netSide}, inNet ${b.inNet})`);
      }
      // Speeds a padel ball can't have, and energy from nowhere.
      if (speed > 60) this.flag('ball-too-fast', 'speed', `ball at ${speed.toFixed(1)} m/s`);
      const w = Math.hypot(b.spin.x, b.spin.y, b.spin.z);
      if (w > 900) this.flag('spin-too-high', 'spin', `spin ${w.toFixed(0)} rad/s`);
      if (b.pos.y > 14) this.flag('ball-very-high', 'height', `ball at ${b.pos.y.toFixed(1)} m`);
      // (spin counts: a felt ball is close to a thin shell, I = 2/3 m r^2, and a bounce turns spin into speed)
      const e = 0.5 * speed * speed + 9.81 * b.pos.y + (r * r / 3) * w * w;
      // (the cloth gives back what the ball stored in it: only free flight and bounces are held to this)
      if (this.lastE >= 0 && !struck && !this.windy && !b.inNet && !b.coupled && e > this.lastE + 0.8) {
        this.flag('energy-gain', 'tick', `ball energy rose ${(e - this.lastE).toFixed(2)} J/kg in one tick (speed ${speed.toFixed(2)}, y ${f3(b.pos.y)}, inNet ${b.inNet}, outside ${b.outside})`);
      }
      this.lastE = e;
      // Never stuck: a still ball must end the point.
      if (ph === PH_RALLY && speed < 0.05) {
        if (this.slowSince < 0) this.slowSince = t;
        else if (t - this.slowSince > 2) {
          this.flag('ball-stuck', 'still', `ball still for 2 s at ${f3(b.pos.x)},${f3(b.pos.y)},${f3(b.pos.z)} (bounces ${s.rally.bounces}, inNet ${b.inNet}, outside ${b.outside}, rolling ${b.rolling})`);
          this.slowSince = t + 1e9;
        }
      } else this.slowSince = -1;
    } else {
      this.lastE = -1;
      this.slowSince = -1;
    }
    this.wasOutside = b.outside;
    this.lastPhase = ph;
    this.lastNetSide = b.netSide;
    this.lastSideZ = b.sideZ;

    // Phases end.
    const age = t - this.phaseSince;
    if (ph === PH_RALLY && (age > 300 || s.rally.shots > 200)) { this.flag('rally-too-long', 'rally', `rally ${age.toFixed(0)} s, ${s.rally.shots} shots`); this.phaseSince = t + 1e9; }
    if (ph === PH_TOSS && age > 6) { this.flag('toss-stuck', 'toss', `toss phase over 6 s, ball at y ${f3(b.pos.y)}`); this.phaseSince = t; }
    if (ph === PH_DEAD && age > 5) { this.flag('dead-stuck', 'dead', 'dead ball phase over 5 s'); this.phaseSince = t; }
    if (ph === PH_SETUP && age > 30 && s.ai[s.score.serverPlayer()]) { this.flag('setup-stuck', 'ai-server', `AI server ${s.score.serverPlayer()} has not served for 30 s`); this.phaseSince = t; }

    // Players: inside their half, at human speeds, partners apart.
    for (const p of s.players) {
      const e = 1e-6;
      if (p.pos.x < p.minX - e || p.pos.x > p.maxX + e || p.pos.z < p.minZ - e || p.pos.z > p.maxZ + e) {
        this.flag('player-out-of-bounds', 'bounds', `player ${p.index} at ${f3(p.pos.x)},${f3(p.pos.z)} outside [${f3(p.minX)},${f3(p.maxX)}]x[${f3(p.minZ)},${f3(p.maxZ)}] (phase ${ph})`);
      }
      const v = Math.hypot(p.vel.x, p.vel.z);
      if (v > p.tune.maxSpeed * 1.08) this.flag('player-too-fast', 'speed', `player ${p.index} at ${v.toFixed(2)} m/s (top ${p.tune.maxSpeed})`);
      const k = p.index * 2;
      // (reaching the edge of the half stops a player dead: a collision with the glass or the net line, not legs)
      const atBound = p.pos.x <= p.minX + 1e-3 || p.pos.x >= p.maxX - 1e-3 || p.pos.z <= p.minZ + 1e-3 || p.pos.z >= p.maxZ - 1e-3;
      if (ph === PH_RALLY && age > DT * 2 && !atBound) {
        const a = Math.hypot(p.vel.x - this.lastVel[k]!, p.vel.z - this.lastVel[k + 1]!) / DT;
        if (a > p.tune.grip * 1.6) this.flag('player-accel', 'accel', `player ${p.index} accelerated ${a.toFixed(1)} m/s² in a tick (grip ${p.tune.grip})`);
      }
      this.lastVel[k] = p.vel.x;
      this.lastVel[k + 1] = p.vel.z;
    }
    if (s.doubles && ph === PH_RALLY) {
      for (let tm = 0; tm < 2; tm++) {
        const a = s.players[tm]!, q = s.players[tm + 2]!;
        const d = Math.hypot(a.pos.x - q.pos.x, a.pos.z - q.pos.z);
        if (d < a.tune.bodyRadius * 2 * 0.9) this.flag('partners-overlap', 'overlap', `players ${tm} and ${tm + 2} ${f3(d)} m apart`);
      }
    }
  }

  private struckThisTick(): boolean {
    const s = this.sim;
    let hit = false;
    for (let q = Math.max(this.lastSeq + 1, s.eventSeq - 64); q < s.eventSeq; q++) {
      const e = s.events[q % 64]!;
      if (e.seq === q && e.kind === E_HIT) hit = true;
    }
    this.lastSeq = s.eventSeq - 1;
    return hit;
  }

  /** The ball just left the enclosure: where it crossed the wall's plane must be open. */
  private checkExit(): void {
    const s = this.sim;
    const b = s.ball;
    const c = s.world.court;
    const px = s.prevBall.x, py = s.prevBall.y, pz = s.prevBall.z;
    if (b.pos.y > 12 && Math.abs(b.pos.x) <= c.halfW && Math.abs(b.pos.z) <= c.halfL) {
      this.flag('ball-very-high', 'exit-top', `ball left the court over 12 m up at ${f3(b.pos.x)},${f3(b.pos.z)}`);
      return;
    }
    if (Math.abs(b.pos.x) > c.halfW && Math.abs(px) <= c.halfW) {
      const plane = Math.sign(b.pos.x) * c.halfW;
      const k = (plane - px) / (b.pos.x - px);
      const z = pz + (b.pos.z - pz) * k, y = py + (b.pos.y - py) * k;
      c.sideZone(z, y, this.zone);
      if (this.zone.kind !== SURF_OPEN) this.flag('tunnel', 'side-wall', `ball left through a solid side wall at z ${f3(z)} y ${f3(y)} (surface ${this.zone.kind}), vel ${f3(b.vel.x)},${f3(b.vel.y)},${f3(b.vel.z)}`);
    }
    if (Math.abs(b.pos.z) > c.halfL && Math.abs(pz) <= c.halfL) {
      const plane = Math.sign(b.pos.z) * c.halfL;
      const k = (plane - pz) / (b.pos.z - pz);
      const x = px + (b.pos.x - px) * k, y = py + (b.pos.y - py) * k;
      c.backZone(x, y, this.zone);
      if (this.zone.kind !== SURF_OPEN) this.flag('tunnel', 'back-wall', `ball left through a solid back wall at x ${f3(x)} y ${f3(y)} (surface ${this.zone.kind}), vel ${f3(b.vel.x)},${f3(b.vel.y)},${f3(b.vel.z)}`);
    }
  }
}
