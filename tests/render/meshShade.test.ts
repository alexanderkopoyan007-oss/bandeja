// The cage's mesh in the sun (render/meshShade.ts): the strip the floor reads must say where the mesh is on each wall.
import { describe, expect, it } from 'vitest';
import { panelStrip } from '../../src/render/meshShade.ts';
import { Court, WALL_BACK_FAR, WALL_SIDE_RIGHT } from '../../src/sim/court/court.ts';
import { COURTS } from '../../src/sim/setup.ts';

/** The mesh band (y0, y1 in metres; null where none) the strip holds at `u` along wall `w`. */
function band(court: Court, w: number, u: number): [number, number] | null {
  const t = panelStrip(court);
  const data = t.image.data as Uint8Array, width = t.image.width;
  const range = w <= WALL_BACK_FAR ? court.halfW : court.halfL;
  const i = Math.min(width - 1, Math.floor(((u + range) / (2 * range)) * width));
  const o = (w * width + i) * 4;
  return data[o]! === 255 ? null : [data[o]! / 50, data[o + 1]! / 50];
}

describe('the mesh strip', () => {
  it('holds every wall\'s mesh where the court has it', () => {
    const c = new Court(COURTS.standard!);
    expect(band(c, WALL_BACK_FAR, 0)).toEqual([3, 4]);
    expect(band(c, WALL_SIDE_RIGHT, 3)).toEqual([0, 3]); // the side's middle, mesh to the floor
    expect(band(c, WALL_SIDE_RIGHT, 0.6)).toEqual([2, 3]); // over the door
    expect(band(c, WALL_SIDE_RIGHT, 7)).toEqual([2, 4]); // over the stepped glass
    expect(band(c, WALL_SIDE_RIGHT, 9)).toEqual([3, 4]);
  });
  it('leaves out what is glass all the way up', () => {
    const c = new Court(COURTS.panoramic!);
    expect(band(c, WALL_SIDE_RIGHT, -7)).toBeNull();
    expect(band(c, WALL_SIDE_RIGHT, 0.6)).toEqual([2.2, 3]);
  });
});
