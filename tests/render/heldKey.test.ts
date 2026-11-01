import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { runAnimQa } from '../../src/render/avatar/animQa.ts';
import { PH_RALLY, PH_SETUP, PH_TOSS, type MatchSim } from '../../src/sim/match.ts';
import { BTN_DRIVE, InputFrame } from '../../src/sim/input.ts';
import { mannequinWithPeople } from './people.ts';

// Round 13's two, on the people as they play: a key held from the moment the ball is ours, as the game asks for, and a
// foot that wound a whole turn round the hips and stayed 65 degrees off them.
describe('with a key held, and over a long match', () => {
  const p = mannequinWithPeople().people[0]!;
  const f = new InputFrame();
  let held = 0;
  const inputs = (m: MatchSim): Array<InputFrame | null> => {
    f.clear();
    const st = m.stand[0]!, on = st.valid && m.phase === PH_RALLY;
    const serve = (m.phase === PH_SETUP || m.phase === PH_TOSS) && m.score.serverPlayer() === 0;
    // (a press in the set-up does nothing until the server is ready: let go and try again)
    if (held && m.phase === PH_SETUP) { f.push(false, held, m.time); held = 0; }
    else if (!held && (serve ? m.tick % 30 === 0 : on && st.t - m.time > 0.7)) { f.push(true, BTN_DRIVE, m.time); held = BTN_DRIVE; }
    else if (held) {
      const ideal = m.focusIdeal(0);
      if ((!on && !serve) || (ideal > 0 && m.time >= ideal)) { f.push(false, held, m.time); held = 0; }
    }
    f.held = held;
    return [f, null, null, null];
  };
  const bows: number[] = [], stretch: number[] = [], feet: number[] = [];
  const hips = new THREE.Vector3(), neck = new THREE.Vector3(), S = new THREE.Vector3(), E = new THREE.Vector3(), W = new THREE.Vector3();
  runAnimQa(p, { seed: 11, seconds: 120, lefty: [], match: { human: [true, false, false, false], assist: 0.45, autoTiming: false }, inputs, onFrame: (m, av) => {
    const a = av[0] as unknown as { st: number; hasCon: boolean; tPlan: number; mesh: THREE.SkinnedMesh; footOff: number[] };
    av.forEach((raw) => feet.push(...(raw as unknown as { footOff: number[] }).footOff));
    if (a.st !== 1 || !a.hasCon || a.tPlan - m.time < 0.55) return;
    const bone = a.mesh.skeleton;
    bone.getBoneByName('Hips')!.getWorldPosition(hips);
    bone.getBoneByName('Neck')!.getWorldPosition(neck);
    bows.push((180 / Math.PI) * neck.sub(hips).angleTo(THREE.Object3D.DEFAULT_UP));
    bone.getBoneByName('RightArm')!.getWorldPosition(S);
    bone.getBoneByName('RightForeArm')!.getWorldPosition(E);
    bone.getBoneByName('RightHand')!.getWorldPosition(W);
    stretch.push(W.distanceTo(S) / (W.distanceTo(E) + E.distanceTo(S)));
  } });
  const q = (a: number[], u: number) => [...a].sort((x, y) => x - y)[Math.floor(a.length * u)]!;

  it('the racket is carried until the ball is near: upright, the arm bent', () => {
    expect(bows.length).toBeGreaterThan(100);
    // (it was 35 at -500 ms and the arm at 0.96 of its length; running free is about 17 and 0.71)
    expect(q(bows, 0.5)).toBeLessThan(24);
    expect(q(stretch, 0.5)).toBeLessThan(0.86);
  });

  it('no foot goes past the hip\'s limit, and none can wind round it', () => {
    expect(Math.max(...feet.map(Math.abs))).toBeLessThanOrEqual((65 * Math.PI) / 180 + 1e-6);
  });
});
