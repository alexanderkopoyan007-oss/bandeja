import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { runAnimQa } from '../../src/render/avatar/animQa.ts';
import { E_HIT } from '../../src/sim/match.ts';
import { SHOT_BANDEJA, SHOT_SERVE, SHOT_SLICE } from '../../src/sim/contact/shots.ts';
import { mannequinWithPeople } from './people.ts';

// Round 10's two bugs, on the people as they play. A racket that takes the long way back to ready, and an arm folded at
// the serve, both pass every limit on speed and pops.
describe('after the ball and at it', () => {
  const p = mannequinWithPeople().people[0]!;
  const ratios: number[] = [], elbows: number[] = [];
  const q = new THREE.Quaternion(), S = new THREE.Vector3(), E = new THREE.Vector3(), W = new THREE.Vector3();
  const fade = [0, 1, 2, 3].map(() => ({ on: false, was: new THREE.Quaternion(), from: new THREE.Quaternion(), path: 0, cut: false }));
  let seq = 0, pastEnd = 0, held: unknown = null;
  const past = new THREE.Vector3();
  // The racket elbow through time, each player, and the balls to read it round.
  const bends: { t: number; e: number }[][] = [[], [], [], []], struck: { p: number; t: number; a: number }[] = [];
  runAnimQa(p, { seed: 3, seconds: 420, lefty: [], onFrame: (m, av) => {
    held = av[1];
    (held as { predAt(s: unknown, t: number, o: THREE.Vector3): void }).predAt(m, m.pred.start + 99, past);
    pastEnd += Number.isNaN(past.x + past.y + past.z) ? 1 : 0;
    av.forEach((raw, i) => {
      const a = raw as unknown as { st: number; racket: THREE.Object3D; mesh: THREE.SkinnedMesh };
      const f = fade[i]!;
      const bone = a.mesh.skeleton;
      bone.getBoneByName('RightArm')!.getWorldPosition(S);
      bone.getBoneByName('RightForeArm')!.getWorldPosition(E);
      bone.getBoneByName('RightHand')!.getWorldPosition(W);
      bends[i]!.push({ t: m.time, e: 180 - (180 / Math.PI) * S.sub(E).angleTo(W.sub(E)) });
      a.racket.updateWorldMatrix(true, false);
      a.racket.getWorldQuaternion(q);
      if (a.st === 3) {
        if (!f.on) { f.on = true; f.path = 0; f.from.copy(q); } else f.path += q.angleTo(f.was);
      } else if (f.on) {
        f.on = false;
        // (only one that got all the way back: a new stroke cuts it short)
        if (a.st === 0) { const d = q.angleTo(f.from); if (d > 1) ratios.push(f.path / d); }
      }
      f.was.copy(q);
    });
    for (; seq < m.eventSeq; seq++) {
      const e = m.events[seq % m.events.length]!;
      if (e.kind === E_HIT) struck.push({ p: e.player, t: m.time, a: e.a });
      if (e.kind !== E_HIT || e.a !== SHOT_SERVE) continue;
      const sk = (av[e.player] as unknown as { mesh: THREE.SkinnedMesh }).mesh.skeleton;
      sk.getBoneByName('RightArm')!.getWorldPosition(S);
      sk.getBoneByName('RightForeArm')!.getWorldPosition(E);
      sk.getBoneByName('RightHand')!.getWorldPosition(W);
      // (flexion: 0 is a straight arm)
      elbows.push(180 - (180 / Math.PI) * S.sub(E).angleTo(W.sub(E)));
    }
  } });

  it('a time past the end of the ball\'s path is its last sample', () => {
    // (it was NaN, and the bones it reached stayed NaN: one player gone from the picture for the rest of the match)
    expect(pastEnd).toBe(0);
  });

  it('a held swing runs at full speed up to the moment and brakes only after it', () => {
    // (slowing from 12% of the swing before the moment, a Perfect serve fell to 3.4 m/s and then snapped at 23)
    const a = held as unknown as { hover(s: number): number };
    expect(a.hover(0.99) - a.hover(0.95)).toBeCloseTo(0.04, 6);
    expect(a.hover(1.3)).toBeGreaterThan(a.hover(1.1));
    expect(a.hover(9)).toBeLessThan(1);
  });

  it('the racket goes back to ready the short way', () => {
    expect(ratios.length).toBeGreaterThan(20);
    ratios.sort((a, b) => a - b);
    // (with the bug back 3.8, now 1.7; the body's own turn adds a little to any)
    expect(ratios[Math.floor(ratios.length * 0.9)]!).toBeLessThan(1.8);
  });

  /** The most the racket elbow bends from `a` to `b` s around each `shot`, the median stroke's. */
  const bendRound = (shot: number, a: number, b: number): number => {
    const most: number[] = [];
    for (const k of struck) {
      if (k.a !== shot) continue;
      let e = 0;
      for (const f of bends[k.p]!) if (f.t >= k.t + a && f.t <= k.t + b && f.e > e) e = f.e;
      most.push(e);
    }
    expect(most.length).toBeGreaterThan(2);
    return most.sort((x, y) => x - y)[most.length >> 1]!;
  };

  it('a bandeja goes on through the ball on a long arm, no jab back at the shoulder', () => {
    // (the racket's centre was drawn and the racket's turn pulled the hand back: 125 at +110 ms; 31-62 on video)
    expect(bendRound(SHOT_BANDEJA, 0.05, 0.25)).toBeLessThan(90);
  });

  it('a slice opens steadily into the ball, the arm never shut against the shoulder', () => {
    // (the same pull on the way in: 122 at -70 ms, 50 at the ball, on 60-70% of slices)
    expect(bendRound(SHOT_SLICE, -0.12, -0.03)).toBeLessThan(85);
  });

  it('a serve is met with a long arm', () => {
    expect(elbows.length).toBeGreaterThan(5);
    elbows.sort((a, b) => a - b);
    // (99 when the reach and the weight both took the hips to the ball, 50 now; a coach 44-52, video 39)
    expect(elbows[elbows.length >> 1]!).toBeLessThan(65);
  });
});
