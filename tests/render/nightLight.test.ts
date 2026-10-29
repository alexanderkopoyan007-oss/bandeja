// The night club's floodlights against the day: the light they put on the court, computed as three lights it (the
// spot's distance and cone falloff, the cosine at the turf), so a change to the floods' data can't blow the court out
// again (review round 3, critic #5: at intensity 95 the turf rendered at luminance 234, more than twice the day's
// 125, and the centre line stood out by 7%; at 16, real Chrome on WebGPU measured the turf at 119-123 near the
// camera, the line at 222, against the day's 125 and 233). The renders themselves need a GPU: this checks the light.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { arenaDef } from '../../src/render/arena/arena.ts';
import { floodHeads } from '../../src/render/arena/outdoor.ts';

const HALF_W = 5, HALF_L = 10;

/** Light falling on the floor at (x, z) from the night floods: three's punctual spot (physically based falloff). */
function floods(key: string, x: number, z: number): number {
  const def = arenaDef(key);
  const fl = def.light.floods!;
  const p = new THREE.Vector3(x, 0, z);
  let e = 0;
  for (const h of floodHeads(def, HALF_W, HALF_L)) {
    if (!h.ours) continue;
    const toLight = h.at.clone().sub(p);
    const d = toLight.length();
    const l = toLight.normalize();
    const axis = h.aim.clone().sub(h.at).normalize();
    const cosA = -l.dot(axis);
    const cone = Math.cos(fl.angle), pen = Math.cos(fl.angle * (1 - fl.penumbra));
    const t = Math.min(1, Math.max(0, (cosA - cone) / (pen - cone)));
    const spot = t * t * (3 - 2 * t);
    const cutoff = 45;
    const fall = (1 / Math.max(Math.pow(d, fl.decay), 0.01)) * Math.pow(Math.min(1, Math.max(0, 1 - Math.pow(d / cutoff, 4))), 2);
    e += fl.intensity * fall * spot * Math.max(0, l.y);
  }
  return e;
}

/** The day's sun on the floor (the key light: intensity x the cosine at the turf). */
function sun(key: string): number {
  const k = arenaDef(key).light.key;
  const [dx, dy, dz] = k.dir;
  return k.intensity * (dy / Math.hypot(dx, dy, dz));
}

describe('night floodlights', () => {
  it('light the court about as the sun does by day, not several times over', () => {
    const night = floods('club-night', 0, 4), day = sun('club-day');
    // (at 16 the floods give 2.15x the sun's direct light on the near court, and the two renders came out alike: by
    // day the sky adds most of the rest, at night there is none; at 95 it was 12.8x)
    expect(night / day).toBeGreaterThan(1.3);
    expect(night / day).toBeLessThan(3.5);
  });

  it('bright in the middle, darker towards the glass but still lit', () => {
    const mid = floods('club-night', 0, 4);
    for (const [x, z] of [[4.5, 9.5], [-4.5, 9.5], [4.5, 0.5], [0, 9.5]]) {
      const r = floods('club-night', x!, z!) / mid;
      expect(r).toBeGreaterThan(0.4);
      expect(r).toBeLessThan(1.15);
    }
  });
});
