// Review round 9's faults in how the body moves, held. The overheads were hit before the swing (racket 1 m/s 0.1 s out,
// 0.5 m of path before the ball); every stroke's racket fell by a quarter on the frame of the ball; and a player
// standing tall tapped on the spot six times a second. And the drawn run (round 10): the clips had both feet off 55-77%
// of the time and each down a tenth of a second.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parsePlayerAsset } from '../../src/render/avatar/asset.ts';
import { runAnimQa } from '../../src/render/avatar/animQa.ts';
import { E_HIT } from '../../src/sim/match.ts';
import { SHOT_BANDEJA, SHOT_DRIVE, SHOT_SLICE, SHOT_SMASH } from '../../src/sim/contact/shots.ts';

function asset() {
  const gz = readFileSync(new URL('../../public/assets/player.bnz', import.meta.url));
  const raw = gunzipSync(gz);
  return parsePlayerAsset(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
}

const med = (a: number[]): number => a.slice().sort((x, y) => x - y)[a.length >> 1]!;

describe('swings and feet', () => {
  const v = new THREE.Vector3();
  /** Per shot, racket speed (m/s) by frame from the ball, -12..+6, medians. */
  const speed: Record<number, number[][]> = {};
  let standing = 0, lifts = 0;
  let running = 0, bothOff = 0;
  const FRAMES = 24;
  /** Each planted foot in a run: seconds down, and how far its toe went (m). */
  const down: number[] = [], slid: number[] = [];
  /** Hips against the feet towards the net at a forehand's contact (m). */
  const into: number[] = [];
  /** Frames with a stroke holding the arm; of those, the wrist folded, and either arm raised and behind the chest. */
  let held = 0, folded = 0, freeBack = 0, racketBack = 0;
  /** An overhead's forward swing: frames, the hand or the elbow fallen under the shoulder; shoulders' tilt at the ball (degrees), trunk's lean after it. */
  let thrown = 0, handLow = 0, elbowLow = 0;
  const tilts: number[] = [], after: number[] = [];
  const P = (o: THREE.Object3D): THREE.Vector3 => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
  /** How far behind the chest's plane an arm's point is (degrees, by elevation), from the shoulders and the hips. */
  const behind = (S: THREE.Vector3, other: THREE.Vector3, hips: THREE.Vector3, to: THREE.Vector3, side: number): number => {
    const out = S.clone().sub(other).normalize();
    const up = S.clone().add(other).multiplyScalar(0.5).sub(hips);
    up.addScaledVector(out, -up.dot(out)).normalize();
    const fwd = out.clone().multiplyScalar(side).cross(up);
    const u = to.clone().sub(S).normalize();
    const elev = Math.acos(Math.max(-1, Math.min(1, -u.dot(up)))) * 57.3;
    return elev < 92 ? 0 : -Math.atan2(u.dot(fwd), u.dot(out)) * 57.3;
  };

  it('plays', () => {
    const a = asset();
    const legs = [a.bone('LeftUpLeg'), a.bone('RightUpLeg'), a.bone('LeftFoot'), a.bone('RightFoot')];
    for (const seed of [301, 302, 303]) {
      const rings: number[][][] = [[], [], [], []];
      const open: Array<{ pl: number; shot: number; at: number }> = [];
      const up = [false, false, false, false], still = [0, 0, 0, 0];
      const plant = Array.from({ length: 8 }, () => ({ on: false, x: 0, z: 0, far: 0, n: 0 }));
      let seen = 0, frame = 0;
      runAnimQa(a, {
        seed, seconds: 150,
        onFrame: (m, av) => {
          frame++;
          for (let i = 0; i < 4; i++) {
            const x = av[i] as unknown as {
              racket: THREE.Object3D; root: THREE.Object3D; feet: Float64Array; lockOn: Uint8Array;
              vx: number; vz: number; gaitRun: number; gaitW: number; gaitSwing: Float64Array; toes: THREE.Object3D[];
              lowY: Float64Array; measureSoles(): void; bones: THREE.Object3D[];
            };
            x.root.updateMatrixWorld(true);
            v.set(0, 0, 0).applyMatrix4(x.racket.matrixWorld);
            const r = rings[i]!;
            r.push([v.x, v.y, v.z]);
            if (r.length > FRAMES + 12) r.shift();
            // The arms against a person's joints, the racket's point being the hand's line on.
            const arm = av[i] as unknown as { w: number; armRacket: THREE.Object3D[]; armFree: THREE.Object3D[]; hips: THREE.Object3D };
            if (arm.w > 0.5) {
              held++;
              const S = P(arm.armRacket[0]!), E = P(arm.armRacket[1]!), W = P(arm.armRacket[2]!), Sf = P(arm.armFree[0]!), Ef = P(arm.armFree[1]!);
              const ang = 180 - W.clone().sub(E).angleTo(v.clone().sub(W)) * 57.3;
              if (ang < 90) folded++;
              const hips = P(arm.hips), lefty = (av[i] as unknown as { handed: number }).handed < 0 ? -1 : 1;
              if (behind(Sf, S, hips, Ef, lefty) > 50) freeBack++;
              if (behind(S, Sf, hips, E, -lefty) > 50) racketBack++;
            }
            // An overhead is a throw, not a windmill.
            const o = av[i] as unknown as { st: number; keyS: number; tCon: number; fam?: { name: string; over?: unknown }; handed: number; armRacket: THREE.Object3D[]; armFree: THREE.Object3D[]; hips: THREE.Object3D };
            if (o.fam?.over && o.handed > 0) {
              const S = P(o.armRacket[0]!), E = P(o.armRacket[1]!), W = P(o.armRacket[2]!), Sf = P(o.armFree[0]!), H = P(o.hips);
              if ((o.st === 1 || (o.st === 2 && m.time < o.tCon)) && o.keyS > 0.3 && o.keyS < 0.8) {
                thrown++;
                if (W.y - S.y < -0.12) handLow++;
                if (E.y - S.y < -0.1) elbowLow++;
              }
              if (o.st === 2 && m.time > o.tCon + 0.1) {
                const mid = S.clone().add(Sf).multiplyScalar(0.5).sub(H);
                after.push(Math.atan2(Math.hypot(mid.x, mid.z), mid.y) * 57.3);
              }
            }
            // Standing between points: a foot up off the floor, and down again.
            const pl = m.players[i]!;
            still[i] = Math.hypot(pl.vel.x, pl.vel.z) < 0.3 ? still[i]! + 1 / 120 : 0;
            if (m.walking > 0 && still[i]! > 0.35) {
              standing += 1 / 120;
              const lifted = x.lockOn[0] === 0 || x.lockOn[1] === 0;
              if (lifted && !up[i]) lifts++;
              up[i] = lifted;
            } else up[i] = false;
            // The run.
            const sp = Math.hypot(x.vx, x.vz);
            const inRun = x.gaitRun > 0 && x.gaitW >= 1 && m.walking === 0;
            if (inRun && sp > 1.5 && sp < 4) {
              running += 1 / 120;
              x.measureSoles();
              if (x.lowY[0]! > 0.02 && x.lowY[1]! > 0.02) bothOff += 1 / 120;
            }
            for (let f = 0; f < 2; f++) {
              const p = plant[i * 2 + f]!;
              if (inRun && sp > 1.5 && x.gaitSwing[f]! < 0) {
                v.setFromMatrixPosition(x.toes[f]!.matrixWorld);
                if (!p.on) { p.on = true; p.x = v.x; p.z = v.z; p.far = 0; p.n = 0; }
                p.far = Math.max(p.far, Math.hypot(v.x - p.x, v.z - p.z));
                p.n++;
              } else if (p.on) {
                p.on = false;
                if (p.n > 6) { down.push(p.n / 120); slid.push(p.far); }
              }
            }
          }
          while (seen < m.eventSeq) {
            const e = m.events[seen % m.events.length]!;
            seen++;
            if (e.kind !== E_HIT) continue;
            open.push({ pl: e.player, shot: e.a, at: frame });
            const x = av[e.player] as unknown as { bones: THREE.Object3D[]; fam: { name: string }; armRacket: THREE.Object3D[]; armFree: THREE.Object3D[]; handed: number };
            if (x.fam.name === 'smash') {
              const S = P(x.armRacket[0]!), Sf = P(x.armFree[0]!);
              tilts.push(Math.atan2(S.y - Sf.y, Math.hypot(S.x - Sf.x, S.z - Sf.z)) * 57.3);
            }
            if (x.fam.name.startsWith('forehand') && !x.fam.name.endsWith('contra')) {
              const z = (k: number): number => v.setFromMatrixPosition(x.bones[legs[k]!]!.matrixWorld).z;
              into.push((z(0) + z(1) - z(2) - z(3)) * 0.5 * (m.players[e.player]!.pos.z > 0 ? -1 : 1));
            }
          }
          for (let q = open.length - 1; q >= 0; q--) {
            const h = open[q]!;
            if (frame < h.at + 8) continue;
            open.splice(q, 1);
            const r = rings[h.pl]!;
            if (r.length < 24) continue;
            const c = r.length - 1 - (frame - h.at), out: number[] = [];
            for (let o = -12; o <= 6; o++) {
              const A = r[c + o - 1], B = r[c + o];
              out.push(A && B ? Math.hypot(B[0]! - A[0]!, B[1]! - A[1]!, B[2]! - A[2]!) * 120 : NaN);
            }
            (speed[h.shot] ??= []).push(out);
          }
        },
      });
    }
    expect(Object.keys(speed).length).toBeGreaterThan(3);
  }, 300000);

  const at = (shot: number, o: number): number => med(speed[shot]!.map((s) => s[o + 12]!).filter(Number.isFinite));

  it('has the racket going through the ball, not stopping at it', () => {
    for (const s of [SHOT_DRIVE, SHOT_SLICE]) {
      // The frame of the ball against the slower of the frames round it (it was 0.75).
      expect(at(s, 0)).toBeGreaterThan(0.9 * Math.min(at(s, -1), at(s, 1)));
    }
  });

  it('swings an overhead before the ball, not after it', () => {
    for (const s of [SHOT_BANDEJA, SHOT_SMASH]) {
      if (!speed[s]) continue;
      // 40 ms out it was 3-4 m/s and it reached 15 only after the ball.
      expect(at(s, -5)).toBeGreaterThan(s === SHOT_SMASH ? 9 : 6);
      // And it's at its fastest at the ball, not after it: the swing used to come in going straight up, and turn round.
      expect(at(s, 0)).toBeGreaterThan(0.95 * at(s, 2));
    }
  });

  it('stands still between points', () => {
    expect(standing).toBeGreaterThan(30);
    // Each of a player's real steps; it was 6.2 lifts a second.
    expect(lifts / standing).toBeLessThan(2.5);
  });

  it('hits into the ball, not from behind the feet', () => {
    expect(into.length).toBeGreaterThan(20);
    // It was 13 cm behind them.
    expect(med(into)).toBeGreaterThan(-0.06);
  });

  it('keeps its arms inside a person\'s joints', () => {
    expect(held).toBeGreaterThan(5000);
        // The wrist goes back about 95 degrees from the forearm's line: the keys had it at 42-57 in the volleys, the serve and
    // the overheads' drop, and the free arm 55-60 degrees behind the chest at 125 degrees of elevation.
    expect(folded / held).toBeLessThan(0.03);
    expect(freeBack / held).toBeLessThan(0.01);
    expect(racketBack / held).toBeLessThan(0.01);
  });

  it('throws an overhead, it doesn\'t windmill it', () => {
    expect(thrown).toBeGreaterThan(100);
    // Drawn in the court's frame the arm went round the shoulder at full length: the hand 18 cm under the shoulder on the
    // way down, the upper arm at 25 degrees, the shoulders level at the ball, and the trunk 38-53 degrees over after it.
    expect(handLow / thrown).toBeLessThan(0.05);
    expect(elbowLow / thrown).toBeLessThan(0.05);
    expect(tilts.length).toBeGreaterThan(2);
    expect(med(tilts)).toBeGreaterThan(12);
    expect(after.slice().sort((x, y) => x - y)[(after.length * 0.95) | 0]!).toBeLessThan(35);
  });

  it('runs on the ground, not over it', () => {
    expect(running).toBeGreaterThan(40);
    expect(down.length).toBeGreaterThan(300);
    // Both feet off 25-35% in real running (the clips: 55-77); a foot down 0.2-0.25 s (the clips: 0.11).
    expect(bothOff / running).toBeLessThan(0.45);
    expect(bothOff / running).toBeGreaterThan(0.08);
    expect(med(down)).toBeGreaterThan(0.15);
    // And where it was put.
    expect(med(slid)).toBeLessThan(0.05);
  });
});
