// M5 phase C step 4: the novelty costumes (src/render/avatar/costumes.ts). Every costume is built on everyone; the catalogue
// and the costumes agree on what each covers; nothing they add goes into the body as drawn in them, and what lies on the
// trunk lies on it; the tail stays behind the legs; a hood presses the hair in under it.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { mannequinWithPeople, guestAsset, GUESTS, surfaceNear } from './people.ts';
import { Avatar } from '../../src/render/avatar/avatar.ts';
import { kitFor } from '../../src/render/avatar/kit.ts';
import type { PlayerAsset } from '../../src/render/avatar/asset.ts';
import { pressHair, type Piece } from '../../src/render/avatar/costume.ts';
import { COSTUMES, costumed, drawnTriangles, dressFor } from '../../src/render/avatar/costumes.ts';
import { COSMETICS } from '../../src/app/unlocks.ts';

const base = mannequinWithPeople();
const people = base.people;
const guests = GUESTS.map((g) => guestAsset(g, base));
const IDS = Object.keys(COSTUMES);

/** The drawn body in a costume (bind pose), for how far a point is outside it. */
function bodyGrid(p: PlayerAsset, id: string): { near: (q: THREE.Vector3) => { d: number; along: number } } {
  return { near: surfaceNear(p, drawnTriangles(p, COSTUMES[id]!.paint, COSTUMES[id]!.covers.head)) };
}

/** A piece's vertices in the bind pose (model space). */
function verts(pc: Piece): THREE.Vector3[] {
  const pos = (pc.mesh as THREE.Mesh).geometry.getAttribute('position');
  return Array.from({ length: pos.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(pos, i));
}

/** The middle of a tail's root, sewn into the suit: its vertices within 4 cm of the furthest forward. */
function rootOf(vs: THREE.Vector3[]): THREE.Vector3 {
  const z = Math.max(...vs.map((v) => v.z)), near = vs.filter((v) => v.z > z - 0.04);
  return near.reduce((m, v) => m.add(v), new THREE.Vector3()).divideScalar(near.length);
}

const dressed = (p: PlayerAsset, id: string): Piece[] => {
  const { look, wear } = costumed(kitFor(0), { costume: id });
  return dressFor(p, wear!, look, null).pieces;
};

describe('costumes', () => {
  it('agree with the catalogue on what each covers', () => {
    const items = COSMETICS.filter((c) => c.slot === 'costume');
    expect(items.map((c) => c.id).sort()).toEqual([...IDS].sort());
    for (const c of items) {
      const k = COSTUMES[c.id]!;
      expect(c.covers?.includes('head') ?? false, c.id).toBe(k.covers.head);
      expect(c.covers?.includes('eyes') ?? false, c.id).toBe(k.covers.eyes);
      // (the shirt, its pattern and the bottom are the costume's own suit)
      expect(c.covers, c.id).toEqual(expect.arrayContaining(['top', 'pattern', 'bottom']));
    }
  });

  it('puts on its colours and suit, and takes off what it covers', () => {
    const { look, wear } = costumed(kitFor(0), { costume: 'costume-astronaut', head: 'head-cap', eyes: 'eyes-wrap', grip: '#ff0000', paint: { pattern: 'dots' } });
    expect(look.shirt).toBe(COSTUMES['costume-astronaut']!.look.shirt);
    expect(wear).toMatchObject({ head: null, eyes: null, grip: '#ff0000' });
    expect(wear!.paint).toEqual(COSTUMES['costume-astronaut']!.paint);
    expect(costumed(kitFor(0), { costume: 'costume-banana', head: 'head-cap' }).wear!.head).toBe('head-cap');
    const none = { head: 'head-cap' };
    expect(costumed(kitFor(1), none)).toEqual({ look: kitFor(1), wear: none });
  });

  it('builds every costume on everyone', () => {
    for (const p of [...people, ...guests]) for (const id of IDS) {
      const { look, wear } = costumed(kitFor(1), { costume: id });
      const a = new Avatar(p, look, wear!.paint);
      const d = dressFor(p, wear!, look, a.mesh.geometry.index);
      expect(d.pieces.length, `${p.look!.name} ${id}`).toBeGreaterThan(0);
      a.wear(d);
    }
  });

  it('adds nothing that goes into the body as drawn in it, and lays what is on the trunk on it', () => {
    for (const p of people) for (const id of IDS) {
      const grid = bodyGrid(p, id);
      for (const pc of dressed(p, id)) {
        const vs = verts(pc);
        let worst = Infinity, gap = Infinity;
        // (the tail's root is sewn into the suit, a couple of centimetres in)
        const root = pc.bone === 'Hips' ? rootOf(vs) : null;
        for (const v of vs) {
          if (root && v.distanceTo(root) < 0.1) continue;
          const n = grid.near(v);
          if (n.d < 0.02) worst = Math.min(worst, n.along);
          gap = Math.min(gap, n.d);
        }
        expect(worst, `${p.look!.name} ${id} ${pc.bone} in the body`).toBeGreaterThan(-0.002);
        if (pc.skinned) expect(gap, `${p.look!.name} ${id} on the body`).toBeLessThan(0.008);
      }
    }
  });

  it('keeps the tail behind the legs and off the floor', () => {
    for (const p of people) {
      const tail = dressed(p, 'costume-dino').find((x) => x.bone === 'Hips')!;
      const hips = new THREE.Vector3().setFromMatrixPosition(p.restWorld[p.bone('Hips')]!);
      const foot = new THREE.Vector3().setFromMatrixPosition(p.restWorld[p.bone('LeftFoot')]!);
      for (const v of verts(tail)) {
        expect(v.z, p.look!.name).toBeLessThan(hips.z);
        expect(v.y, p.look!.name).toBeGreaterThan(foot.y + 0.3);
      }
    }
  });

  it('presses the hair in under a hood and a toque', () => {
    for (const p of people) for (const id of ['costume-dino', 'costume-chef']) {
      expect(pressHair(p, COSTUMES[id]!.head!), `${p.look!.name} ${id}`).not.toBeNull();
    }
  });
});
