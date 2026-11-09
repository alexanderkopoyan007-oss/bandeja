// Challenges (M6 phase C, behind ?creator=1 until the owner has seen them): a run of balls fed by the practice coach
// (the sim's practice mode: data/practice.json's drills), scored from the sim's events as the stats are (stats.ts):
// rings to land in, a zone to reach, balls put out of the court, points won off the coach (data/challenges.json).
// The daily challenge is one of them picked by the date, its feeds seeded by it and its rings moved a little, the same
// for everyone that day. Nothing here touches the sim.
import data from '../../data/challenges.json' with { type: 'json' };
import academy from '../../data/academy.json' with { type: 'json' };
import practiceData from '../../data/practice.json' with { type: 'json' };
import { E_FLOOR, E_HIT, E_POINT, E_WALL, type MatchSim } from '../sim/match.ts';
import { WHY_EXIT_AFTER_BOUNCE } from '../sim/rules/rally.ts';
import { SHOT_KEYS } from '../sim/contact/shots.ts';
import { G_GOOD, G_PERFECT } from '../sim/contact/timing.ts';
import { eventsOf } from '../net/feed.ts';

export type ChallengeKind = 'targets' | 'zone' | 'exits' | 'won' | 'timing' | 'shot' | 'glass';

export interface Target { x: number; depth: number; r: number; points: number }

export interface ChallengeDef {
  id: string;
  name: string;
  desc: string;
  kind: ChallengeKind;
  /** The practice drill feeding it (data/practice.json, by index: MatchConfig.practice). */
  drill: number;
  balls: number;
  targets: Target[];
  zone: { x: [number, number]; depth: [number, number] } | null;
  /** Bronze, silver, gold. */
  medals: [number, number, number];
  /** The academy's (M6 phase D): the shot a 'shot' lesson asks for (SHOT_KEYS index, -1 any), how much of the ball's path
   * off the glass is drawn (render/glassVision.ts), the player's own timing whatever the setting, and that it is a lesson. */
  shot: number;
  vision: number;
  ownTiming: boolean;
  lesson: boolean;
}

const KINDS: readonly ChallengeKind[] = ['targets', 'zone', 'exits', 'won', 'timing', 'shot', 'glass'];

export const CHALLENGES: readonly ChallengeDef[] = data.challenges.map((c) => {
  const drill = practiceData.drills.findIndex((d) => d.name === c.drill);
  if (drill < 0) throw new Error(`challenge ${c.id}: no drill ${c.drill}`);
  const kind = KINDS.includes(c.kind as ChallengeKind) ? (c.kind as ChallengeKind) : 'won';
  const z = (c as { zone?: { x: number[]; depth: number[] } }).zone;
  return {
    id: c.id, name: c.name, desc: c.desc, kind, drill, balls: c.balls,
    targets: ((c as { targets?: Target[] }).targets ?? []).map((t) => ({ ...t })),
    zone: z ? { x: [z.x[0]!, z.x[1]!], depth: [z.depth[0]!, z.depth[1]!] } : null,
    medals: [c.medals[0]!, c.medals[1]!, c.medals[2]!],
    shot: -1, vision: 0, ownTiming: false, lesson: false,
  };
});

/** The academy's lessons, in order (data/academy.json). */
export const LESSONS: readonly ChallengeDef[] = academy.lessons.map((c) => {
  const drill = practiceData.drills.findIndex((d) => d.name === c.drill);
  if (drill < 0) throw new Error(`lesson ${c.id}: no drill ${c.drill}`);
  const kind = KINDS.includes(c.kind as ChallengeKind) ? (c.kind as ChallengeKind) : 'shot';
  const x = c as { shot?: string; vision?: number; autoTiming?: boolean };
  const shot = x.shot ? (SHOT_KEYS as readonly string[]).indexOf(x.shot) : -1;
  if (x.shot && shot < 0) throw new Error(`lesson ${c.id}: no shot ${x.shot}`);
  return {
    id: `lesson-${c.id}`, name: c.name, desc: c.desc, kind, drill, balls: c.balls, targets: [], zone: null,
    medals: [c.medals[0]!, c.medals[1]!, c.medals[2]!],
    shot, vision: x.vision ?? 0, ownTiming: x.autoTiming === false, lesson: true,
  };
});

/** A date as the daily challenge's key (the player's own calendar day): 20261109. */
export function dayKey(d: Date): number {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/** The day's challenge: one of them by the date, its rings moved up to half a metre (inside the court), and the seed its feeds come from. */
export function daily(day: number): { def: ChallengeDef; seed: number } {
  let h = (day * 0x9e3779b1) >>> 0;
  const next = (): number => { h = (Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0; return h / 4294967296; };
  const base = CHALLENGES[Math.floor(next() * CHALLENGES.length)]!;
  const targets = base.targets.map((t) => ({
    ...t,
    x: clamp(t.x + (next() - 0.5), -4.4 + t.r * 0.5, 4.4 - t.r * 0.5),
    depth: clamp(t.depth + (next() - 0.5), 1.5 + t.r * 0.5, 9.6 - t.r * 0.5),
  }));
  return { def: { ...base, id: `daily-${day}`, name: `Daily: ${base.name}`, targets }, seed: (day * 2654435761) >>> 0 };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** The medal a score earns: 0 none, 1 bronze, 2 silver, 3 gold. */
export function medal(def: ChallengeDef, score: number): number {
  return score >= def.medals[2] ? 3 : score >= def.medals[1] ? 2 : score >= def.medals[0] ? 1 : 0;
}

export const MEDAL_NAMES = ['No medal', 'Bronze', 'Silver', 'Gold'];

/** What one ball scored, where its first bounce was (for the marks on court). */
export interface BallMark { x: number; z: number; points: number }

/**
 * A run's score as it happens: each ball (a feed, played out to its point) scored by the challenge's kind. The player is
 * player 0 (team 0), the coach player 1. Read after the frame's sim steps, like MatchStats.
 */
export class ChallengeRun {
  readonly def: ChallengeDef;
  score = 0;
  /** Balls played out. */
  balls = 0;
  /** Where each of the player's shots first came down on the coach's side, and what it scored (the last ones kept). */
  readonly marks: BallMark[] = [];
  private seen = 0;
  /** The player hit the ball and it hasn't come down yet (a wall first: no score). */
  private flying = false;
  private scoredThisBall = false;
  /** The ball in flight is the shot a 'shot' lesson asks for, or was played after coming off the player's own glass. */
  private rightShot = false;
  private offGlass = false;
  /** The coach's ball has touched the player's glass since the coach hit it. */
  private ownGlass = false;

  constructor(def: ChallengeDef) {
    this.def = def;
  }

  get done(): boolean {
    return this.balls >= this.def.balls;
  }

  update(sim: MatchSim): void {
    const ring = eventsOf(sim);
    if (ring.eventSeq - this.seen > ring.events.length) this.seen = ring.eventSeq - ring.events.length;
    while (this.seen < ring.eventSeq && !this.done) {
      const e = ring.events[this.seen % ring.events.length]!;
      this.seen++;
      if (e.seq < 0) continue;
      if (e.kind === E_HIT) {
        this.flying = e.player === 0;
        if (e.player === 0) {
          this.rightShot = this.def.shot < 0 || e.a === this.def.shot;
          this.offGlass = this.ownGlass;
          if (this.def.kind === 'timing' && !this.scoredThisBall && (e.b === G_GOOD || e.b === G_PERFECT)) { this.score++; this.scoredThisBall = true; }
        } else this.ownGlass = false;
      } else if (e.kind === E_WALL && !this.flying && Math.sign(e.z) === sim.side(0)) {
        this.ownGlass = true;
      } else if (e.kind === E_WALL && this.flying) {
        // Into the glass or the mesh before the floor: out (rules), so it scores nothing.
        this.flying = false;
      } else if (e.kind === E_FLOOR && this.flying) {
        this.flying = false;
        // On the coach's side?
        if (Math.sign(e.z) === sim.side(1) && !this.scoredThisBall) this.landed(e.x, Math.abs(e.z));
      } else if (e.kind === E_POINT) {
        if (this.def.kind === 'exits' && e.team === 0 && e.a === WHY_EXIT_AFTER_BOUNCE) this.score++;
        if (this.def.kind === 'won' && e.team === 0) this.score++;
        this.balls++;
        this.flying = false;
        this.scoredThisBall = false;
        this.ownGlass = false;
      }
    }
  }

  /** The player's shot came down at (x, depth from the net) on the coach's side. x is the court's, which is the
   * player's own left and right: practice keeps them at the camera's end, where +x is their right. */
  private landed(x: number, depth: number): void {
    let pts = 0;
    if (this.def.kind === 'targets') {
      for (const t of this.def.targets) if (Math.hypot(x - t.x, depth - t.depth) <= t.r && t.points > pts) pts = t.points;
    } else if (this.def.kind === 'zone' && this.def.zone) {
      const z = this.def.zone;
      if (x >= z.x[0] && x <= z.x[1] && depth >= z.depth[0] && depth <= z.depth[1]) pts = 1;
    }
    if (this.def.kind === 'shot') pts = this.rightShot ? 1 : 0;
    if (this.def.kind === 'glass') pts = this.offGlass ? 1 : 0;
    if (this.def.kind !== 'exits' && this.def.kind !== 'won' && this.def.kind !== 'timing') {
      this.score += pts;
      this.scoredThisBall = true;
      this.marks.push({ x, z: depth, points: pts });
      if (this.marks.length > 24) this.marks.shift();
    }
  }

}

/** A run's result as the challenge screens keep it. */
export interface ChallengeBest {
  score: number;
  /** When (ms since 1970) it was set. */
  at: number;
}
