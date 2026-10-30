// A volley is punched from a bent arm with the racket's head up: mid-height net volleys against the footage
// (docs/research/footage-pose.md: elbow 63, 53-79). Before round 7 the head hung 62 degrees below level from a straight arm.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { mannequinWithPeople } from './people.ts';
import { runAnimQa } from '../../src/render/avatar/animQa.ts';
import { E_HIT } from '../../src/sim/match.ts';
import { SHOT_KEYS } from '../../src/sim/contact/shots.ts';

const median = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1]!;
const flex = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => 180 - (a.clone().sub(b).angleTo(c.clone().sub(b)) * 180) / Math.PI;

describe('volley', () => {
  it('keeps the head up and the elbow bent', () => {
    const base = mannequinWithPeople();
    const p = base.people.find((x) => x.look!.name === 'p1')!;
    const bones = [p.bone('RightArm'), p.bone('RightForeArm'), p.bone('RightHand')];
    const lean: number[] = [], elbow: number[] = [];
    for (const seed of [71, 72, 73, 74, 75, 76]) {
      let seq = 0;
      runAnimQa(p, { seed, seconds: 120, onFrame: (m, av) => {
        for (; seq < m.eventSeq; seq++) {
          const e = m.events[seq % m.events.length]!;
          if (e.kind !== E_HIT || SHOT_KEYS[e.a] !== 'volley' || Math.abs(e.z) > 4.6 || e.y < 0.5 || e.y > 1.25) continue;
          const pl = m.players[e.player]!;
          if (pl.handed < 0) continue;
          const fh = (e.x - pl.pos.x) * m.side(pl.team) >= 0;
          const a = av[e.player] as unknown as { root: THREE.Object3D; racket: THREE.Object3D; bones: THREE.Bone[] };
          a.root.updateMatrixWorld(true);
          const w = bones.map((b) => new THREE.Vector3().setFromMatrixPosition(a.bones[b]!.matrixWorld));
          a.racket.updateMatrixWorld(true);
          const head = new THREE.Vector3().setFromMatrixPosition(a.racket.matrixWorld).sub(w[2]!);
          if (fh) lean.push((Math.asin(head.y / head.length()) * 180) / Math.PI);
          if (e.y >= 0.75) elbow.push(flex(w[0]!, w[1]!, w[2]!));
        }
      } });
    }
    expect(lean.length).toBeGreaterThan(8);
    expect(elbow.length).toBeGreaterThan(6);
    expect(median(lean)).toBeGreaterThan(-40);
    expect(median(elbow)).toBeGreaterThan(45);
  }, 300000);
});
