// The look pass (`?look=2`: render/post.ts FilmLook, render/filmSet.ts, render/sand.ts), until the owner has seen it:
// off unless asked for, its camera the one on the court unless another is named, sand where the ball lands and under running
// feet (and none under a walk), and a rig that hangs outside the court's lines with every beam ending on the court.
import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { optionsFromSetup, optionsFromUrl } from '../../src/app/options.ts';
import { defaultSettings } from '../../src/app/settings.ts';
import { addFilmRig, addHaze, FILM_SET } from '../../src/render/filmSet.ts';
import { SandPuffs } from '../../src/render/sand.ts';
import { E_FLOOR, E_HIT, type MatchEvent, type MatchSim } from '../../src/sim/match.ts';

function fakeSim(): { sim: MatchSim; emit: (kind: number, t: number, x: number, y: number, z: number, speed: number) => void; players: Array<{ pos: THREE.Vector3; vel: THREE.Vector3 }> } {
  const events: MatchEvent[] = Array.from({ length: 64 }, () => ({ seq: -1, kind: 0, time: 0, team: 0, player: -1, a: 0, b: 0, c: 0, x: 0, y: 0, z: 0, d: 0, q: 0 }));
  const players = Array.from({ length: 4 }, () => ({ pos: new THREE.Vector3(), vel: new THREE.Vector3() }));
  const s = { events, eventSeq: 0, players };
  return {
    sim: s as unknown as MatchSim, players,
    emit(kind, t, x, y, z, speed) { Object.assign(events[s.eventSeq % 64]!, { kind, time: t, x, y, z, c: speed }); s.eventSeq++; },
  };
}
/** The puffs alive at `t`: [x, z, born, size, strength]. */
function alive(p: SandPuffs, t: number): number[][] {
  const A = (p as unknown as { at: THREE.InstancedBufferAttribute }).at.array as Float32Array;
  const G = (p as unknown as { go: THREE.InstancedBufferAttribute }).go.array as Float32Array;
  const out: number[][] = [];
  for (let i = 0; i < A.length; i += 4) if (t - A[i + 3]! > -0.1 && t - A[i + 3]! < 0.85) out.push([A[i]!, A[i + 2]!, A[i + 3]!, G[i + 2]!, G[i + 3]!]);
  return out;
}

describe('the look pass', () => {
  it('is off unless asked for, and brings the court camera unless another is named', () => {
    expect(optionsFromUrl(new URLSearchParams('autoplay=1'), null)).toMatchObject({ look: 0, camera: 'tv' });
    expect(optionsFromUrl(new URLSearchParams('look=2'), null)).toMatchObject({ look: 2, camera: 'court' });
    expect(optionsFromUrl(new URLSearchParams('look=2&camera=court'), null)).toMatchObject({ look: 2, camera: 'court' });
    const s = defaultSettings();
    expect(optionsFromSetup(s.setup, s, 1, null, false, new URLSearchParams())).toMatchObject({ look: 0, camera: 'tv' });
    expect(optionsFromSetup(s.setup, s, 1, null, false, new URLSearchParams('look=2'))).toMatchObject({ look: 2, camera: 'court' });
    expect(optionsFromSetup(s.setup, { ...s, camera: 'near' }, 1, null, false, new URLSearchParams('look=2'))).toMatchObject({ look: 2, camera: 'near' });
  });

  it('raises sand where the ball lands, harder for a harder landing, and none for a hit or a ball on the wall', () => {
    const f = fakeSim();
    const sand = new SandPuffs(new THREE.Scene(), '#7d86b8');
    sand.update(f.sim, 1, []);
    f.emit(E_HIT, 1.1, 0, 1, 0, 30);
    f.emit(E_FLOOR, 1.2, 2, 0.033, -4, 6);
    f.emit(E_FLOOR, 1.25, 0, 3, 10, 20); // (a surface off the floor)
    sand.update(f.sim, 1.2, []);
    const soft = alive(sand, 1.25);
    expect(soft.length).toBe(3);
    for (const p of soft) { expect(Math.hypot(p[0]! - 2, p[1]! + 4)).toBeLessThan(0.1); expect(p[2]).toBeGreaterThanOrEqual(1.2); }
    f.emit(E_FLOOR, 3, -1, 0.033, 5, 22);
    sand.update(f.sim, 3, []);
    const hard = alive(sand, 3.02);
    expect(hard.length).toBe(3);
    expect(Math.max(...hard.map((p) => p[4]!))).toBeGreaterThan(Math.max(...soft.map((p) => p[4]!)));
  });

  it('raises sand under a foot that lands at a run and where a player brakes, not under a walk', () => {
    const f = fakeSim();
    const sand = new SandPuffs(new THREE.Scene(), '#7d86b8');
    const feet = [{ feet: new Float64Array([1, 0.1, 2, 1.3, 0, 2]) }];
    const step = (t: number, y: number): void => { feet[0]!.feet[1] = y; sand.update(f.sim, t, feet); };
    // A walk: the foot comes down, nothing rises.
    f.players[0]!.vel.set(1, 0, 0);
    step(0, 0.1); step(0.02, 0.1); step(0.04, 0);
    expect(alive(sand, 0.05).length).toBe(0);
    // A run: it does, at the foot.
    f.players[0]!.vel.set(5, 0, 0);
    step(0.3, 0.1); step(0.32, 0);
    const run = alive(sand, 0.33);
    expect(run.length).toBe(1);
    expect(Math.hypot(run[0]![0]! - 1, run[0]![1]! - 2)).toBeLessThan(0.1);
    // Braking from a run: a bigger burst at the player.
    f.players[0]!.pos.set(3, 0, 2);
    for (let k = 0; k < 6; k++) { f.players[0]!.vel.set(5 - k, 0, 0); step(2 + k / 60, 0); }
    const brake = alive(sand, 2.1).filter((p) => p[2]! >= 2);
    expect(brake.length).toBe(4);
    expect(Math.min(...brake.map((p) => p[3]!))).toBeGreaterThan(run[0]![3]! * 0.9);
    // Another match's sand is not this one's.
    sand.update(fakeSim().sim, 2.1, feet);
    expect(alive(sand, 2.1).length).toBe(0);
  });

  it('hangs the rig outside the court and ends every beam on the court, with the haze on the scene', () => {
    const scene = new THREE.Scene();
    const g = new THREE.Group();
    addHaze(scene);
    expect(scene.fogNode).toBeTruthy();
    addFilmRig(g, 5, 10);
    const beams = g.getObjectByName('beams') as THREE.Mesh;
    const pos = beams.geometry.getAttribute('position'), uv = beams.geometry.getAttribute('uv');
    let lamps = 0;
    for (let i = 0; i < pos.count; i++) {
      if (uv.getY(i) === 0) {
        // (the lamp's end: up on the rig, outside the lines)
        expect(pos.getY(i)).toBeGreaterThan(FILM_SET.height - 0.6);
        expect(Math.max(Math.abs(pos.getX(i)) - 5, Math.abs(pos.getZ(i)) - 10)).toBeGreaterThan(FILM_SET.out - 0.3);
        lamps++;
      } else {
        expect(Math.abs(pos.getY(i))).toBeLessThan(1.3);
        expect(Math.abs(pos.getX(i))).toBeLessThan(5 + 1.5);
        expect(Math.abs(pos.getZ(i))).toBeLessThan(10 + 1.5);
      }
    }
    expect(lamps).toBe((FILM_SET.lampsLong + FILM_SET.lampsShort) * 2 * 21);
    expect((beams.material as THREE.Material).depthWrite).toBe(false);
  });
});
