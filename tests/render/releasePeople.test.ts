// The people's textures off the GPU between matches (asset.ts releasePeople): everyone not in the next match lets theirs
// go, the next match's people keep theirs, and the suits' normal maps (everybody's) are never let go.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { releasePeople, type PlayerAsset } from '../../src/render/avatar/asset.ts';

const MAPS = ['opaqueMap', 'alphaMap', 'skinNormal', 'handsMap', 'handsNormal'] as const;

function person(name: string, suit: THREE.Texture): PlayerAsset {
  const look: Record<string, unknown> = { name, clothNormal: suit };
  for (const k of MAPS) look[k] = new THREE.Texture();
  return { look } as unknown as PlayerAsset;
}

/** How many times each texture was disposed. */
function counting(ts: THREE.Texture[]): Map<THREE.Texture, number> {
  const n = new Map<THREE.Texture, number>();
  for (const t of ts) {
    n.set(t, 0);
    t.addEventListener('dispose', () => n.set(t, n.get(t)! + 1));
  }
  return n;
}

describe('the people between matches', () => {
  it('lets go of the textures of everyone not in the next match, and only theirs', () => {
    const suit = new THREE.Texture();
    const base = { people: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map((n) => person(n, suit)) } as unknown as PlayerAsset;
    const all = base.people.flatMap((p) => MAPS.map((k) => p.look![k]!));
    const n = counting([...all, suit]);
    // the title's four were p1-p4; the match deals p3-p6
    releasePeople(base, ['p3', 'p4', 'p5', 'p6']);
    for (const p of base.people) {
      const gone = p.look!.name === 'p1' || p.look!.name === 'p2';
      for (const k of MAPS) expect(n.get(p.look![k]!), `${p.look!.name} ${k}`).toBe(gone ? 1 : 0);
    }
    expect(n.get(suit)).toBe(0);
    // no match's people (the mannequin): everyone's go
    releasePeople(base, []);
    for (const p of base.people) for (const k of MAPS) expect(n.get(p.look![k]!)).toBeGreaterThanOrEqual(1);
    expect(n.get(suit)).toBe(0);
  });
});
