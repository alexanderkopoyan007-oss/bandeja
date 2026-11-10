// Builds the fixed world for a match from the JSON data files.
import { Court, type CourtDef } from './court/court.ts';
import { BallWorld, type BallSpec, type Environment, type JunctionSpec, type NetGiveSpec, type SurfaceSpec, type SurfaceTable } from './ball/ball.ts';
import { NetCloth, type NetClothSpec } from './court/netCloth.ts';
import { Ball } from './ball/ball.ts';
import { DT } from './core/constants.ts';
import standard from '../../data/courts/standard.json' with { type: 'json' };
import panoramic from '../../data/courts/panoramic.json' with { type: 'json' };
import singles from '../../data/courts/singles-narrow.json' with { type: 'json' };
import ballData from '../../data/ball.json' with { type: 'json' };
import surfaceData from '../../data/surfaces.json' with { type: 'json' };

export const COURTS: Record<string, CourtDef> = {
  standard: standard as CourtDef,
  panoramic: panoramic as CourtDef,
  'singles-narrow': singles as CourtDef,
};

export type FloorName = 'hard' | 'turf' | 'carpet' | 'clay';
export type BallName = 'standard' | 'altitude';

export interface WorldOptions {
  court?: string;
  floor?: FloorName;
  ball?: BallName;
  env?: Partial<Environment>;
}

const surfaces = surfaceData as unknown as Record<string, SurfaceSpec>;
const netGive = (surfaceData as unknown as { netGive: NetGiveSpec }).netGive;
const seamWidth = (surfaceData as unknown as { seamWidth: number }).seamWidth;
const joinWidth = (surfaceData as unknown as { joinWidth: number }).joinWidth;
const junction = (surfaceData as unknown as { junction: JunctionSpec }).junction;
const netClothSpec = (surfaceData as unknown as { netCloth: NetClothSpec }).netCloth;

export function surfaceTable(): SurfaceTable {
  return {
    glass: surfaces.glass!,
    mesh: surfaces.mesh!,
    seam: surfaces.seam!,
    glassJoin: surfaces.glassJoin!,
    net: surfaces.net!,
    post: surfaces.post!,
    netGive,
    seamWidth,
    joinWidth,
    junction,
  };
}

export function floorSpec(name: FloorName): SurfaceSpec {
  return surfaces[name]!;
}

export function makeWorld(o: WorldOptions = {}): BallWorld {
  const court = new Court(COURTS[o.court ?? 'standard'] ?? COURTS.standard!);
  const ball = (ballData as unknown as Record<string, BallSpec>)[o.ball ?? 'standard']!;
  const env: Environment = { temperatureC: 20, altitudeM: 0, windX: 0, windZ: 0, ...o.env };
  return new BallWorld(ball, court, floorSpec(o.floor ?? 'turf'), surfaceTable(), env);
}

let warmed = false;

/**
 * The match's net as cloth, hung in this world's court and air (and wind). The first call also runs a ball into a net
 * of its own, so the solver is compiled before play (no JIT stalls on the first net). Never the match's own: its
 * scratch fields would stay as the throws left them, and the first match of a page would differ from every later one.
 */
export function makeNetCloth(world: BallWorld): NetCloth {
  if (!warmed && !warmByCaller) {
    warmed = true;
    warmCloth(world);
  }
  const net = new NetCloth(world.court, netClothSpec, world.rho);
  net.windX = world.env.windX;
  net.windZ = world.env.windZ;
  return net;
}

/** The net solver's warm-up ahead of the first match (the app runs it while the players download); makeNetCloth then
 * skips it. It throws balls into a net of its own in a world of its own, so it touches nothing a match uses. */
export function prewarmNet(): void {
  if (warmed) return;
  warmed = true;
  warmCloth(makeWorld());
}

/**
 * prewarmNet in pieces of WARM_PIECE ticks, awaiting `pause` between them (a throw was a seventh of a second of a slow
 * laptop's main thread): the same throws in the same order. While one runs, every call gets the same promise, and the
 * latest caller's `pause` paces the rest (a match waiting on it takes over from the title's idle moments).
 */
export function prewarmNetAsync(pause: () => Promise<void>): Promise<void> {
  warmPause = pause;
  if (warming) return warming;
  if (warmed) return Promise.resolve();
  warmed = true;
  warming = (async (): Promise<void> => {
    const world = makeWorld(), net = new NetCloth(world.court, netClothSpec, world.rho), b = new Ball();
    b.cloth = net;
    for (let k = 0; k < WARM_THROWS; k++) {
      throwFrom(b, k);
      for (let i = 0; i < WARM_TICKS; i += WARM_PIECE) {
        warmTicks(world, net, b, Math.min(WARM_PIECE, WARM_TICKS - i));
        await warmPause();
      }
    }
  })();
  return warming;
}

let warmPause: () => Promise<void> = () => Promise.resolve();

let warming: Promise<void> | null = null;
let warmByCaller = false;

/** The caller runs the net solver's warm-up itself (prewarmNetAsync, the app: in the background once the title is up, or
 * before a player's match): makeNetCloth no longer runs it inside the first match's build (0.8 s of a slow laptop's
 * main thread on the way to the title). */
export function warmNetLater(): void {
  warmByCaller = true;
}
const WARM_THROWS = 6, WARM_TICKS = 90, WARM_PIECE = 15;

function warmCloth(world: BallWorld): void {
  const net = new NetCloth(world.court, netClothSpec, world.rho);
  const b = new Ball();
  b.cloth = net;
  for (let k = 0; k < WARM_THROWS; k++) warmThrow(world, net, b, k);
}

function warmThrow(world: BallWorld, net: NetCloth, b: Ball, k: number): void {
  throwFrom(b, k);
  warmTicks(world, net, b, WARM_TICKS);
}

/** Throw k: into the body at three speeds, onto the cable, a clip of the tape from the far side, a slow roll. */
function throwFrom(b: Ball, k: number): void {
  const s = k === 4 ? -1 : 1;
  const y = k < 3 ? 0.3 + 0.25 * k : k === 5 ? 0.0328 : 0.88;
  b.pos.set(-1 + 0.5 * k, y, 1.5 * s);
  b.vel.set(0, k === 3 ? 0.5 : 0, -s * (k < 3 ? 12 + 8 * k : k === 5 ? 3 : 20));
  b.spin.set(k === 4 ? 200 : 0, 0, 0);
  b.clearNet();
  b.rolling = false;
  b.ahead = 0;
}

function warmTicks(world: BallWorld, net: NetCloth, b: Ball, n: number): void {
  for (let i = 0; i < n; i++) {
    net.beginTick();
    b.step(world, DT, null);
    if (!b.coupled && net.awake) net.freeTick();
  }
}
