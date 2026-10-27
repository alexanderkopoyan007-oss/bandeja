// Builds the fixed world for a match from the JSON data files.
import { Court, type CourtDef } from './court/court.ts';
import { BallWorld, type BallSpec, type Environment, type SurfaceSpec, type SurfaceTable } from './ball/ball.ts';
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

const surfaces = surfaceData as unknown as Record<string, SurfaceSpec> & { seamWidth: number };

export function surfaceTable(): SurfaceTable {
  return {
    glass: surfaces.glass!,
    mesh: surfaces.mesh!,
    seam: surfaces.seam!,
    net: surfaces.net!,
    seamWidth: surfaces.seamWidth,
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
