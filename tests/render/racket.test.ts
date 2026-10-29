// The rackets as drawn (render/avatar/racket.ts, racketArt.ts, racketMaterial.ts; data/racket-looks/): every player's
// racket inside the FIP limits (Rules of Padel, Annex: 45.5 cm long, 26 cm wide, 38 mm thick, holes 9-13 mm), the
// frame the sim and the grip rely on, holes clear of the rim and of each other, the cost budget (3 draw calls,
// about 15k triangles a racket), the level of detail and disposal with a match.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
  CAP_TOP, FACE_T2, GRIP_PITCH, HANDLE_R, HANDLE_TOP, RACKET_BUTT, RACKET_LOOKS, RACKET_TIP, RacketLod,
  dressRacket, makeRacketModel, makeWristCord, racketCost, racketLookFor, racketShape,
} from '../../src/render/avatar/racket.ts';
import { disposeTree } from '../../src/render/dispose.ts';

function near(g: THREE.Object3D): THREE.BufferGeometry {
  return (g.getObjectByName('racketNear') as THREE.Mesh).geometry;
}

function inside(pl: Array<[number, number]>, x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = pl.length - 1; i < pl.length; j = i++) {
    const a = pl[i]!, b = pl[j]!;
    if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

function edgeDist(pl: Array<[number, number]>, x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i < pl.length; i++) {
    const a = pl[i]!, b = pl[(i + 1) % pl.length]!;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(a[0] + dx * t - x, a[1] + dy * t - y));
  }
  return best;
}

describe('rackets as drawn', () => {
  it('keeps the frame the sim and the grip use', () => {
    expect(RACKET_TIP).toBe(0.145);
    expect(RACKET_BUTT).toBe(-0.31);
    expect(HANDLE_R).toBe(0.0172);
    // One racket per player, as the people are (player number modulo the list).
    expect(RACKET_LOOKS).toHaveLength(4);
    expect(racketLookFor(0)).toBe(RACKET_LOOKS[0]);
    expect(racketLookFor(5)).toBe(RACKET_LOOKS[1]);
    expect(new Set(RACKET_LOOKS.map((l) => l.shape))).toEqual(new Set(['round', 'teardrop', 'diamond']));
  });

  for (const look of RACKET_LOOKS) {
    describe(`${look.name} (${look.model}, ${look.shape})`, () => {
      const g = makeRacketModel(look);
      const s = racketShape(look);

      it('is inside the FIP limits and keeps the tip and butt where the sim has them', () => {
        const box = new THREE.Box3().setFromObject(g);
        expect(box.max.y - box.min.y).toBeLessThanOrEqual(0.455 + 1e-6);
        expect(box.max.y).toBeCloseTo(RACKET_TIP, 3);
        expect(box.min.y).toBeCloseTo(RACKET_BUTT, 3);
        expect(box.max.x - box.min.x).toBeLessThanOrEqual(0.26 + 1e-6);
        // Thickness of the head (protector included); the handle may be up to 50 mm across.
        const P = near(g).getAttribute('position'), info = near(g).getAttribute('rkInfo');
        let z0 = 0, z1 = 0, r = 0;
        for (let i = 0; i < P.count; i++) {
          // Regions 4-7 are the handle (overgrip, tape, cap, its logo plate).
          const code = Math.round(info.getX(i));
          if (code < 4 || code > 7) { z0 = Math.min(z0, P.getZ(i)); z1 = Math.max(z1, P.getZ(i)); }
          else r = Math.max(r, Math.hypot(P.getX(i), P.getZ(i)));
        }
        expect(z1 - z0).toBeLessThanOrEqual(0.038 + 1e-6);
        expect(z1 - z0).toBeGreaterThan(2 * FACE_T2);
        expect(2 * r).toBeLessThanOrEqual(0.05);
        expect(look.holes.d).toBeGreaterThanOrEqual(0.009);
        expect(look.holes.d).toBeLessThanOrEqual(0.013);
      });

      it('has its face centre at the origin and its widest point where its shape puts it', () => {
        expect(inside(s.face, 0, 0)).toBe(true);
        let wy = 0, wx = 0;
        for (const p of s.outer) if (p[0] > wx) { wx = p[0]; wy = p[1]; }
        if (look.shape === 'round') expect(Math.abs(wy)).toBeLessThan(0.015);
        if (look.shape === 'teardrop') expect(wy).toBeGreaterThan(0.015);
        if (look.shape === 'diamond') expect(wy).toBeGreaterThan(0.035);
      });

      it('has a designed layout of holes clear of the rim, the blank zones and each other, the same both sides', () => {
        const H = s.holes, r = s.holeR;
        expect(H.length).toBeGreaterThan(45);
        expect(H.length).toBeLessThan(80);
        for (const [x, y] of H) {
          expect(inside(s.face, x, y)).toBe(true);
          // Hole edge (with its chamfer) at least the margin from the face's edge.
          expect(edgeDist(s.face, x, y) - r - 0.0007).toBeGreaterThan(look.holes.margin - 1e-4);
          for (const b of look.holes.blank) {
            const u = (Math.abs(x) - b.x) / b.a, v = (y - b.y) / b.b;
            if (b.x === 0) expect(u * u + v * v).toBeGreaterThan(1);
          }
          // Mirrored.
          expect(H.some(([x2, y2]) => Math.abs(x2 + x) < 1e-6 && Math.abs(y2 - y) < 1e-6)).toBe(true);
        }
        let minWall = Infinity;
        for (let i = 0; i < H.length; i++) for (let j = i + 1; j < H.length; j++) minWall = Math.min(minWall, Math.hypot(H[i]![0] - H[j]![0], H[i]![1] - H[j]![1]) - 2 * r);
        expect(minWall).toBeGreaterThan(0.0075);
        // Every through-hole's wall is in the mesh: front and back chamfers and the wall (3 strips of 12 quads).
        const info = near(g).getAttribute('rkInfo');
        const idx = near(g).index!;
        let wall = 0;
        for (let i = 0; i < idx.count; i += 3) if (Math.round(info.getX(idx.getX(i))) === 2) wall++;
        expect(wall).toBe(H.length * 72);
      });

      it('costs at most 3 draw calls and about 15k triangles, cord included', () => {
        const c = racketCost(g);
        const cord = makeWristCord(new THREE.Vector3(0, -0.33, 0.02), new THREE.Vector3(0, -1, 0), 0.03);
        const ct = cord.geometry.index!.count / 3;
        expect(c.drawCalls + 1).toBeLessThanOrEqual(3);
        expect(c.triangles + ct).toBeLessThanOrEqual(15000);
        expect(c.farTriangles).toBeLessThan(2500);
      });

      it('winds the overgrip round the handle at its radius', () => {
        // grip.ts closes the fingers on HANDLE_R: the overgrip's mean radius over the hand's length is that.
        const P = near(g).getAttribute('position'), info = near(g).getAttribute('rkInfo');
        let sum = 0, n = 0, lo = Infinity, hi = 0;
        for (let i = 0; i < P.count; i++) {
          const y = P.getY(i);
          if (Math.round(info.getX(i)) !== 4 || y > HANDLE_TOP - 0.03 || y < CAP_TOP + 0.01) continue;
          const rr = Math.hypot(P.getX(i), P.getZ(i)) - (HANDLE_R + ((HANDLE_TOP - y) / (HANDLE_TOP - CAP_TOP)) * 0.0006);
          sum += rr; n++; lo = Math.min(lo, rr); hi = Math.max(hi, rr);
        }
        expect(n).toBeGreaterThan(100);
        expect(Math.abs(sum / n)).toBeLessThan(0.0003);
        // The step at each turn is real geometry (0.7 mm).
        expect(hi - lo).toBeGreaterThan(0.0005);
        expect(GRIP_PITCH).toBeGreaterThan(0.01);
      });
    });
  }

  it('shows the far level when the racket is small on screen, judged through the lens', () => {
    const g = makeRacketModel(RACKET_LOOKS[1]);
    const lod = g.getObjectByName('racketBody') as RacketLod;
    const n = g.getObjectByName('racketNear')!, f = g.getObjectByName('racketFar')!;
    const cam = new THREE.PerspectiveCamera(26, 16 / 9, 0.1, 300);
    const at = (d: number, fov: number): void => {
      cam.fov = fov;
      cam.position.set(0, 0, d);
      cam.updateMatrixWorld();
      g.updateMatrixWorld(true);
      lod.update(cam);
    };
    at(1.4, 26);
    expect([n.visible, f.visible]).toEqual([true, false]);
    // The broadcast camera: 26 degrees from 17-30 m.
    at(18, 26);
    expect([n.visible, f.visible]).toEqual([false, true]);
    // A long lens from as far shows it large: the near level.
    at(18, 6);
    expect([n.visible, f.visible]).toEqual([true, false]);
    // A 45-degree lens: near up to about 6 m (with a little hysteresis).
    at(5.7, 45);
    expect(n.visible).toBe(true);
    at(6.3, 45);
    expect(f.visible).toBe(true);
    at(5.7, 45);
    expect(f.visible).toBe(true);
    at(5.2, 45);
    expect(n.visible).toBe(true);
    // A shadow camera (orthographic) leaves the view's choice alone.
    const sh = new THREE.OrthographicCamera();
    sh.position.set(0, 50, 0);
    sh.updateMatrixWorld();
    lod.update(sh);
    expect(n.visible).toBe(true);
    // A spotlight's shadow camera far away picks the far level for its pass, but the view's hysteresis is its own:
    // just inside the switch the view still gets the near level after it.
    at(5.8, 45);
    expect(n.visible).toBe(true);
    const spot = new THREE.PerspectiveCamera(60, 1, 0.5, 60);
    spot.position.set(0, 20, 0);
    spot.updateMatrixWorld();
    lod.update(spot);
    expect(f.visible).toBe(true);
    lod.update(cam);
    expect(n.visible).toBe(true);
  });

  it('dresses an avatar racket in another look and keeps its cord', () => {
    const g = makeRacketModel();
    const cord = makeWristCord(new THREE.Vector3(0, -0.33, 0.02), new THREE.Vector3(0, -1, 0), 0.03);
    g.add(cord);
    dressRacket(g, RACKET_LOOKS[3]!);
    expect(g.children.filter((c) => c.userData.racketBody)).toHaveLength(1);
    expect(g.children).toContain(cord);
    const m = (g.getObjectByName('racketNear') as THREE.Mesh).material as THREE.Material;
    // Looks share their geometry and material.
    expect((makeRacketModel(RACKET_LOOKS[3]).getObjectByName('racketNear') as THREE.Mesh).material).toBe(m);
  });

  it('frees its geometry, material and printed textures with the match', () => {
    const g = makeRacketModel(RACKET_LOOKS[2]);
    const m = (g.getObjectByName('racketNear') as THREE.Mesh).material as THREE.Material & { rkHeadMap: THREE.Texture; rkMaskMap: THREE.Texture };
    let tex = 0, mat = 0, geo = 0;
    m.rkHeadMap.addEventListener('dispose', () => tex++);
    m.rkMaskMap.addEventListener('dispose', () => tex++);
    m.addEventListener('dispose', () => mat++);
    near(g).addEventListener('dispose', () => geo++);
    (g.getObjectByName('racketFar') as THREE.Mesh).geometry.addEventListener('dispose', () => geo++);
    disposeTree(g);
    expect(tex).toBe(2);
    expect(mat).toBe(1);
    expect(geo).toBe(2);
  });
});
