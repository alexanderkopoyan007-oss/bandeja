// The determinism check for online play: the same matches, the same scripted hands, every 120 ticks a state hash.
// Runs in Node (hash-run.mjs) and, bundled, in a browser's worker (hash-worker.ts). Everything here has to be as
// exact as the sim: integers and plain arithmetic only. The hands read the sim, so a divergence shows at once.
import { MatchSim, E_HIT, PH_OVER, PH_RALLY, PH_SETUP, PH_TOSS, type MatchConfig } from '../../src/sim/match.ts';
import { InputFrame, BTN_DRIVE, BTN_LOB, BTN_SLICE, BTN_TOPSPIN, BTN_OVERHEAD, BTN_VOLLEY, BTN_POWER, BTN_PRECISION } from '../../src/sim/input.ts';

export interface HashCase {
  label: string;
  cfg: MatchConfig;
}

const FORMAT = { mode: 1, setsToWin: 2, gamesPerSet: 6, finalSet: 0 };
const base = (seed: number, n: number, humans: number[]): MatchConfig => ({
  seed, doubles: n === 4, human: Array.from({ length: n }, (_, i) => humans.includes(i)), aiLevel: [0.8, 1], aiStyle: [],
  timingScale: 1.5, assist: 0.45, autoTiming: false, format: FORMAT,
} as never);

/** Twelve matches: one person and three AIs up to four people, singles, women, left-handers, an outdoor court in wind. */
export const CASES: HashCase[] = [
  { label: '1 human', cfg: base(5100001, 4, [0]) },
  { label: '1 human, level .55', cfg: { ...base(5100002, 4, [0]), aiLevel: [0.55, 0.55] } },
  { label: '2 humans, one each side', cfg: base(5100003, 4, [0, 1]) },
  { label: '2 humans, a pair', cfg: base(5100004, 4, [0, 2]) },
  { label: '4 humans', cfg: base(5100005, 4, [0, 1, 2, 3]) },
  { label: '4 humans again', cfg: base(5100006, 4, [0, 1, 2, 3]) },
  { label: 'singles', cfg: base(5100007, 2, [0, 1]) },
  { label: 'women', cfg: { ...base(5100008, 4, [0, 1]), women: true } },
  { label: 'left-handers', cfg: { ...base(5100009, 4, [0, 1]), lefty: [true, false, true, false] } },
  { label: 'all AI', cfg: base(5100010, 4, []) },
  { label: 'all AI, styles', cfg: { ...base(5100011, 4, []), aiStyle: ['reloj', 'muro', 'martillo', 'serpiente'] } },
  { label: 'windy, hot, 900 m, panoramic, hard floor', cfg: { ...base(5100012, 4, [0]), world: { court: 'panoramic', floor: 'hard', env: { temperatureC: 31, altitudeM: 900, windX: 3, windZ: -2 } } } },
];

const KEYS = [BTN_DRIVE, BTN_TOPSPIN, BTN_SLICE, BTN_LOB, BTN_OVERHEAD, BTN_VOLLEY];

/** One seat's scripted hands: moves about, presses a key for the ball coming its way, lets go on a clock or holds on. */
export class Hands {
  readonly f = new InputFrame();
  private r: number;
  private held = 0;
  private mods = 0;
  private until = 0;
  private strike = 0;
  private x = 0;
  private y = 0;
  /** Release at the plan's contact, within `timed` s either way, as a person lets go (0: on a clock, for the hash runs). */
  timed = 0;
  /** How much sooner they let go than they would (s): a player who has learnt the input delay. */
  lead = 0;
  private off = 0;
  constructor(seed: number) { this.r = seed | 0; }
  private next(n: number): number {
    this.r = (Math.imul(this.r, 1664525) + 1013904223) | 0;
    return ((this.r >>> 8) & 0xffff) % n;
  }
  frame(m: MatchSim, i: number, tick: number, toss: boolean): InputFrame {
    const f = this.f, M = m as never as { stand: Array<{ valid: boolean }>; tossIdeal: number };
    f.clear();
    if (tick % 40 === 0) { this.x = this.next(3) - 1; this.y = this.next(3) - 1; }
    f.moveX = this.x;
    f.moveY = this.y;
    if (toss) {
      if (m.phase === PH_SETUP && tick % 45 === 0) { f.push(this.held === 0, BTN_DRIVE, m.time); this.held = this.held ? 0 : BTN_DRIVE; }
      else if (m.phase === PH_TOSS && !this.held && m.time < M.tossIdeal - 0.1) { f.push(true, BTN_DRIVE, m.time); this.held = BTN_DRIVE; }
      else if (m.phase === PH_TOSS && this.held && m.time >= M.tossIdeal) { f.push(false, BTN_DRIVE, m.time); this.held = 0; }
    } else if (m.phase === PH_RALLY && M.stand[i]!.valid && (m.rally.hitter & 1) !== (i & 1)) {
      if (!this.held && tick > this.strike + 40) {
        this.held = KEYS[this.next(KEYS.length)]!;
        // (a third of the swings with Power or Precision down, a quarter held until they go by themselves)
        this.mods = [0, 0, 0, 0, BTN_POWER, BTN_PRECISION][this.next(6)]!;
        this.until = this.next(4) === 0 ? 1 << 30 : tick + 20 + this.next(70);
        if (this.timed) { this.until = 1 << 30; this.off = ((this.next(2001) - 1000) / 1000) * this.timed; }
        if (this.mods) f.push(true, this.mods, m.time);
        f.push(true, this.held, m.time);
      } else if (this.held && (tick >= this.until || (this.timed !== 0 && m.time >= (M.stand[i] as never as { t: number }).t + this.off - this.lead))) {
        f.push(false, this.held, m.time);
        this.held = 0;
        this.strike = tick;
      }
    } else if (this.held && m.phase !== PH_RALLY) {
      f.push(false, this.held, m.time);
      this.held = 0;
    }
    if (!this.held && this.mods) { f.push(false, this.mods, m.time); this.mods = 0; }
    f.held = this.held | this.mods;
    return f;
  }
  hit(tick: number): void {
    this.strike = tick;
  }
}

export interface HashResult {
  label: string;
  ticks: number;
  hits: number;
  points: number;
  score: string;
  /** The state hash every 120 ticks. */
  samples: number[];
}

export function runCase(c: HashCase, limit = 120 * 3600 * 3): HashResult {
  const m = new MatchSim(c.cfg);
  const n = c.cfg.human.length;
  const M = m as never as { score: { serverPlayer(): number; games: number[]; sets: number[] } };
  const hands = c.cfg.human.map((h, i) => (h ? new Hands(c.cfg.seed + i * 977) : null));
  const inputs: Array<InputFrame | null> = hands.map(() => null);
  const samples: number[] = [];
  let tick = 0, seen = 0, hits = 0, points = 0;
  for (; tick < limit && m.phase !== PH_OVER; tick++) {
    const srv = M.score.serverPlayer();
    for (let i = 0; i < n; i++) inputs[i] = hands[i] ? hands[i]!.frame(m, i, tick, (m.phase === PH_SETUP || m.phase === PH_TOSS) && srv === i) : null;
    m.step(inputs);
    while (seen < m.eventSeq) {
      const e = m.events[seen % m.events.length]!;
      seen++;
      if (e.kind === E_HIT) { hits++; if (e.player >= 0 && hands[e.player]) hands[e.player]!.hit(tick); }
      else if (e.kind === 5) points++;
    }
    if (tick % 120 === 0) samples.push(m.hash());
  }
  samples.push(m.hash());
  return { label: c.label, ticks: tick, hits, points, score: `${M.score.sets.join('-')} ${M.score.games.join('-')}`, samples };
}
