// M5 phase D: a character's tattoos (src/render/avatar/tattoo.ts) are drawn on the limb they belong to: each person's
// forearms and calves fitted from their own vertices, the racket arm's side chosen, nothing on any other part of the body.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { PEOPLE, type PlayerAsset } from '../../src/render/avatar/asset.ts';
import { reproportion } from '../../src/render/avatar/proportions.ts';
import { setTattoos, tattooLimbs, TATTOO_DESIGNS, type Limb, type TattooState } from '../../src/render/avatar/tattoo.ts';
import { hasTattoo } from '../../src/render/avatar/kit.ts';
import { TATTOOS, defaultCharacter } from '../../src/app/character.ts';
import { selfLookOf } from '../../src/app/options.ts';
import { mannequinWithPeople } from './people.ts';

const base = mannequinWithPeople();
const person = (n: string): PlayerAsset => base.people.find((p) => p.look!.name === n)!;

/** The share of the skin a limb's design can reach (its stretch, within 1.6 radii of its axis) that is skinned mostly to
 * bones of that limb. */
function onLimb(p: PlayerAsset, limb: Limb, bones: string[]): { reach: number; own: number } {
  const g = p.geometry, pos = g.getAttribute('position'), si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight');
  const A = g.getAttribute('bodyA');
  const ids = new Set(bones.map((b) => p.bone(b)));
  const v = new THREE.Vector3();
  let reach = 0, own = 0;
  for (let i = 0; i < pos.count; i++) {
    if (A.getZ(i) < 0.5) continue;
    v.fromBufferAttribute(pos, i).sub(limb.o);
    const s = v.dot(limb.a);
    if (Math.abs(s) > limb.half + 0.01) continue;
    if (v.addScaledVector(limb.a, -s).length() > limb.radius * 1.9) continue;
    reach++;
    let w = 0;
    for (let k = 0; k < 4; k++) if (ids.has(si.getComponent(i, k))) w += sw.getComponent(i, k);
    if (w >= 0.5) own++;
  }
  return { reach, own };
}

describe('tattoos', () => {
  it('the designs are the character’s, and a look has a tattoo only with a design on', () => {
    expect([...TATTOO_DESIGNS]).toEqual([...TATTOOS]);
    const c = defaultCharacter();
    expect(selfLookOf(c)).toBeNull();
    expect(hasTattoo(selfLookOf({ ...c, tattoos: { arm: 'star', calf: null } }))).toBe(true);
    expect(selfLookOf({ ...c, hand: 'left', tattoos: { arm: 'band', calf: 'dots' } })!.tattoos).toEqual({ arm: 1, calf: 5, left: true });
    expect(hasTattoo({ skin: 0, hair: null, tattoos: { arm: 0, calf: 0, left: false } })).toBe(false);
  });

  it('every person’s forearms and calves are found where they are, and a design reaches only them', () => {
    for (const n of PEOPLE) {
      const p = person(n);
      const L = tattooLimbs(p);
      for (const [k, limb] of Object.entries(L)) {
        expect(limb, `${n} ${k}`).not.toBeNull();
        const l = limb!;
        // left limbs on +x (the model's left), right on -x; the axis across `out`
        expect(Math.sign(l.o.x), `${n} ${k}`).toBe(k.endsWith('L') ? 1 : -1);
        expect(Math.abs(l.a.dot(l.out)), `${n} ${k}`).toBeLessThan(1e-6);
        const arm = k.startsWith('arm');
        expect(l.radius, `${n} ${k} radius`).toBeGreaterThan(arm ? 0.02 : 0.03);
        expect(l.radius, `${n} ${k} radius`).toBeLessThan(arm ? 0.055 : 0.07);
        expect(l.half, `${n} ${k} half`).toBeGreaterThan(0.04);
        expect(l.half, `${n} ${k} half`).toBeLessThan(0.18);
        if (!arm) expect(Math.abs(l.a.y), `${n} ${k} shin upright`).toBeGreaterThan(0.9);
        const side = k.endsWith('L') ? 'Left' : 'Right';
        const r = onLimb(p, l, arm ? [`${side}ForeArm`, `${side}Hand`, `${side}Arm`] : [`${side}Leg`, `${side}Foot`, `${side}UpLeg`]);
        expect(r.reach, `${n} ${k}`).toBeGreaterThan(50);
        expect(r.own / r.reach, `${n} ${k}: skin of other limbs in reach`).toBeGreaterThan(0.99);
      }
    }
  });

  it('a reshaped body is fitted as it is built: longer arms, a longer forearm stretch', () => {
    const p = person(PEOPLE[0]!);
    const long = reproportion(p, { height: 1, legs: 1, arms: 1.5, torso: 1, neck: 1, shoulders: 1, head: 1, hands: 1, feet: 1, build: 1 });
    expect(tattooLimbs(long).armR!.half).toBeGreaterThan(tattooLimbs(p).armR!.half * 1.3);
  });

  it('the arm’s design goes on the racket hand’s side and the calf’s on the other; none clears both', () => {
    const p = person(PEOPLE[0]!);
    const u = (): { value: THREE.Vector4 } => ({ value: new THREE.Vector4() });
    const st = { arm: { o: u(), a: u(), out: u() }, calf: { o: u(), a: u(), out: u() }, limbs: tattooLimbs(p) } as unknown as TattooState;
    setTattoos(st, { arm: 4, calf: 3, left: false });
    expect(st.arm.o.value.x).toBeLessThan(0);
    expect(st.calf.o.value.x).toBeGreaterThan(0);
    expect([st.arm.out.value.w, st.calf.out.value.w]).toEqual([4, 3]);
    setTattoos(st, { arm: 4, calf: 3, left: true });
    expect(st.arm.o.value.x).toBeGreaterThan(0);
    expect(st.calf.o.value.x).toBeLessThan(0);
    setTattoos(st, null);
    expect([st.arm.out.value.w, st.calf.out.value.w]).toEqual([0, 0]);
  });
});
