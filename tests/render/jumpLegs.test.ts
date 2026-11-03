import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { runAnimQa } from '../../src/render/avatar/animQa.ts';
import { E_HIT } from '../../src/sim/match.ts';
import { SHOT_SMASH } from '../../src/sim/contact/shots.ts';
import { mannequinWithPeople } from './people.ts';

// A jump smash is hit with the legs long under the body: knees 27 and 23 at the ball on the footage (MediaPipe on WPT smashes, as
// avatar.ts's scissor says), where they were tucked to 54-59 on p1 and meshy (review round 33, #11).
describe('the jump smash legs', () => {
  const people = mannequinWithPeople().people;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const knees: number[] = [];
  const bend = (leg: THREE.Bone[]): number => {
    leg[0]!.getWorldPosition(a); leg[1]!.getWorldPosition(b); leg[2]!.getWorldPosition(c);
    const u = b.clone().sub(a).normalize(), v = c.clone().sub(b).normalize();
    return Math.acos(Math.min(1, u.dot(v))) * 180 / Math.PI;
  };
  for (const [pi, seed] of [[0, 5], [1, 6]] as const) {
  let seq = 0;
  runAnimQa(people[pi]!, { seed, seconds: 360, lefty: [], onFrame: (m, av) => {
    for (; seq < m.eventSeq; seq++) {
      const e = m.events[seq % m.events.length]!;
      if (e.kind !== E_HIT || e.a !== SHOT_SMASH) continue;
      const t = av[e.player] as unknown as { legL: THREE.Bone[]; legR: THREE.Bone[]; jumpT0: number; root: THREE.Object3D };
      if (t.jumpT0 < 0 || t.root.position.y < 0.05) continue;
      t.legL[0]!.updateWorldMatrix(true, true);
      t.legR[0]!.updateWorldMatrix(true, true);
      knees.push(bend(t.legL), bend(t.legR));
    }
  } });
  }

  it('has the knees under 40 degrees at the ball', () => {
    knees.sort((x, y) => x - y);
    // (18 knees here: p50 30, p90 33 degrees; with the clip's crouch carried up, 42 and 51)
    expect(knees.length).toBeGreaterThan(12);
    expect(knees[knees.length >> 1]!).toBeLessThan(40);
  });
});
