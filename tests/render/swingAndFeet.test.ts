// Review round 9's faults in how the body moves, held. The overheads were hit before the swing (racket 1 m/s 0.1 s out,
// 0.5 m of path before the ball); every stroke's racket fell by a quarter on the frame of the ball; and a player
// standing tall tapped on the spot six times a second.
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
  const FRAMES = 24;

  it('plays', () => {
    const a = asset();
    for (const seed of [301, 302, 303]) {
      const rings: number[][][] = [[], [], [], []];
      const open: Array<{ pl: number; shot: number; at: number }> = [];
      const up = [false, false, false, false], still = [0, 0, 0, 0];
      let seen = 0, frame = 0;
      runAnimQa(a, {
        seed, seconds: 150,
        onFrame: (m, av) => {
          frame++;
          for (let i = 0; i < 4; i++) {
            const x = av[i] as unknown as { racket: THREE.Object3D; root: THREE.Object3D; feet: Float64Array; lockOn: Uint8Array };
            x.root.updateMatrixWorld(true);
            v.set(0, 0, 0).applyMatrix4(x.racket.matrixWorld);
            const r = rings[i]!;
            r.push([v.x, v.y, v.z]);
            if (r.length > FRAMES + 12) r.shift();
            // Standing between points: a foot up off the floor, and down again.
            const pl = m.players[i]!;
            still[i] = Math.hypot(pl.vel.x, pl.vel.z) < 0.3 ? still[i]! + 1 / 120 : 0;
            if (m.walking > 0 && still[i]! > 0.35) {
              standing += 1 / 120;
              const lifted = x.lockOn[0] === 0 || x.lockOn[1] === 0;
              if (lifted && !up[i]) lifts++;
              up[i] = lifted;
            } else up[i] = false;
          }
          while (seen < m.eventSeq) {
            const e = m.events[seen % m.events.length]!;
            seen++;
            if (e.kind === E_HIT) open.push({ pl: e.player, shot: e.a, at: frame });
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
      expect(at(s, 0)).toBeGreaterThan(0.7 * at(s, 2));
    }
  });

  it('stands still between points', () => {
    expect(standing).toBeGreaterThan(30);
    // Each of a player's real steps; it was 6.2 lifts a second.
    expect(lifts / standing).toBeLessThan(2.5);
  });
});
