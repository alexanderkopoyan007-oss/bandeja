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
 * The match's net as cloth, hung in this world's court and air (and wind). The first one built also runs a ball
 * into itself and is put back at rest, so the solver is compiled before play (no JIT stalls on the first net).
 */
export function makeNetCloth(world: BallWorld): NetCloth {
  const net = new NetCloth(world.court, netClothSpec, world.rho);
  if (!warmed) {
    warmed = true;
    const b = new Ball();
    b.cloth = net;
    // Into the body at three speeds, onto the cable, a clip of the tape from the far side, a slow roll.
    for (let k = 0; k < 6; k++) {
      const s = k === 4 ? -1 : 1;
      const y = k < 3 ? 0.3 + 0.25 * k : k === 5 ? 0.0328 : 0.88;
      b.pos.set(-1 + 0.5 * k, y, 1.5 * s);
      b.vel.set(0, k === 3 ? 0.5 : 0, -s * (k < 3 ? 12 + 8 * k : k === 5 ? 3 : 20));
      b.spin.set(k === 4 ? 200 : 0, 0, 0);
      b.clearNet();
      b.rolling = false;
      b.ahead = 0;
      for (let i = 0; i < 90; i++) {
        net.beginTick();
        b.step(world, DT, null);
        if (!b.coupled && net.awake) net.freeTick();
      }
    }
    net.reset();
  }
  net.windX = world.env.windX;
  net.windZ = world.env.windZ;
  return net;
}
