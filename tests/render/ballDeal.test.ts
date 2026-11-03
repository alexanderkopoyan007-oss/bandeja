// The last ball goes small as the dead time ends, and stays gone until the next is dealt: at a change of ends the dead time's end moves 2.4 s
// on, and the ball came back full size in a frame, rolled on, and went small a second time (review round 26).
import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { MatchSim, PH_DEAD } from '../../src/sim/match.ts';
import { BallView } from '../../src/render/views.ts';

describe('the last ball between points', () => {
  it('goes small once', () => {
    const m = new MatchSim({ seed: 5120001, doubles: true, human: [false, false, false, false], aiLevel: [0.8, 0.8], aiStyle: [] });
    const view = new BallView(new THREE.Scene(), m.world.spec.radius);
    const felt = (view as unknown as { felt: THREE.Mesh }).felt;
    let deads = 0, back = 0, // frames back at full size after going small, inside one dead time
       wasDead = false, least = 1;
    for (let t = 0; t < 120 * 600; t++) {
      m.step([null, null, null, null]);
      view.update(m, 0, 0);
      const dead = m.phase === PH_DEAD, k = felt.scale.x;
      if (dead && !wasDead) { deads++; least = 1; }
      if (dead) { if (k > least + 0.2) back++; least = Math.min(least, k); }
      wasDead = dead;
    }
    expect(deads).toBeGreaterThan(20);
    // (845 frames in 28 dead times before, one return per change of ends)
    expect(back).toBe(0);
  }, 120000);
});
