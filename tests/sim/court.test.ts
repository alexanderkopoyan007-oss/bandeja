import { describe, expect, it } from 'vitest';
import { Court, SURF_GLASS, SURF_MESH, SURF_OPEN, type CourtDef, type ZoneHit } from '../../src/sim/court/court.ts';
import standard from '../../data/courts/standard.json' with { type: 'json' };
import panoramic from '../../data/courts/panoramic.json' with { type: 'json' };
import singles from '../../data/courts/singles-narrow.json' with { type: 'json' };

const hit: ZoneHit = { kind: 0, seamDist: 0 };

describe('standard court (FIP variant 1)', () => {
  const c = new Court(standard as CourtDef);

  it('has FIP dimensions', () => {
    expect(c.def.width).toBe(10);
    expect(c.def.length).toBe(20);
    expect(c.def.serviceLineFromNet).toBe(6.95);
  });

  it('net is 0.88 m in the centre and 0.92 m at the posts', () => {
    expect(c.netHeightAt(0)).toBeCloseTo(0.88, 6);
    expect(c.netHeightAt(5)).toBeCloseTo(0.92, 6);
    expect(c.netHeightAt(-5)).toBeCloseTo(0.92, 6);
    expect(c.netHeightAt(2.5)).toBeGreaterThan(0.88);
  });

  it('back wall is 3 m glass then 1 m mesh', () => {
    expect(c.backZone(0, 2.9, hit).kind).toBe(SURF_GLASS);
    expect(c.backZone(0, 3.1, hit).kind).toBe(SURF_MESH);
    expect(c.backZone(0, 3.9, hit).kind).toBe(SURF_MESH);
    expect(c.backZone(0, 4.1, hit).kind).toBe(SURF_OPEN);
  });

  it('side wall steps: 3 m glass for 2 m, 2 m glass for the next 2 m, then mesh', () => {
    expect(c.sideZone(9.5, 2.9, hit).kind).toBe(SURF_GLASS);
    expect(c.sideZone(7.5, 2.5, hit).kind).toBe(SURF_MESH);
    expect(c.sideZone(7.5, 1.9, hit).kind).toBe(SURF_GLASS);
    expect(c.sideZone(5.0, 1.0, hit).kind).toBe(SURF_MESH);
    expect(c.sideZone(5.0, 3.1, hit).kind).toBe(SURF_OPEN);
    expect(c.sideZone(-9.5, 3.5, hit).kind).toBe(SURF_MESH);
  });

  it('openings flank the net post below 2 m, mesh above', () => {
    expect(c.sideZone(0.6, 1.0, hit).kind).toBe(SURF_OPEN);
    expect(c.sideZone(-0.6, 1.0, hit).kind).toBe(SURF_OPEN);
    expect(c.sideZone(0.6, 2.5, hit).kind).toBe(SURF_MESH);
    expect(c.sideZone(2.0, 1.0, hit).kind).toBe(SURF_MESH);
  });

  it('reports seams near glass joins and corners', () => {
    expect(c.backZone(-3.01, 1.5, hit).seamDist).toBeLessThan(0.02);
    expect(c.backZone(4.99, 1.5, hit).seamDist).toBeLessThan(0.02);
    expect(c.sideZone(8.0, 1.0, hit).seamDist).toBeLessThan(0.01);
    expect(c.backZone(0, 1.5, hit).seamDist).toBeGreaterThan(0.9);
  });
});

describe('panoramic court (FIP variant 2)', () => {
  const c = new Court(panoramic as CourtDef);
  it('has one 3 m x 4 m glass panel per end with no step', () => {
    expect(c.sideZone(7.5, 2.9, hit).kind).toBe(SURF_GLASS);
    expect(c.sideZone(6.1, 2.9, hit).kind).toBe(SURF_GLASS);
    expect(c.sideZone(7.5, 3.1, hit).kind).toBe(SURF_OPEN);
    expect(c.sideZone(9.0, 3.5, hit).kind).toBe(SURF_MESH);
  });
});

describe('narrow singles court', () => {
  const c = new Court(singles as CourtDef);
  it('is 20 x 6 m with one centred opening per side', () => {
    expect(c.halfW).toBe(3);
    expect(c.sideZone(0, 1, hit).kind).toBe(SURF_OPEN);
    expect(c.sideZone(1.0, 1, hit).kind).toBe(SURF_MESH);
  });
});
