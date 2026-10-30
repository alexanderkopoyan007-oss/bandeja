// The animated players against the real sim, with no browser: four avatars follow an AI doubles match and the
// racket has to meet the ball where the sim says it was struck.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import * as THREE from 'three/webgpu';
import { MatchSim, E_HIT } from '../../src/sim/match.ts';
import { SHOT_KEYS } from '../../src/sim/contact/shots.ts';
import { parsePlayerAsset } from '../../src/render/avatar/asset.ts';
import { Avatar } from '../../src/render/avatar/avatar.ts';

const NONE = [null, null, null, null];

function asset() {
  const gz = readFileSync(new URL('../../public/assets/player.bnz', import.meta.url));
  const raw = gunzipSync(gz);
  return parsePlayerAsset(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
}

interface Hit { player: number; shot: string; t: number; ball: THREE.Vector3; best: number; at: number }

function play(seed: number, seconds: number, lefty: boolean[] = []) {
  const a = asset();
  const m = new MatchSim({ seed, doubles: true, human: [false, false, false, false], lefty });
  const av = [0, 1, 2, 3].map((i) => new Avatar(a, 0xffffff * (i / 4)));
  const scene = new THREE.Scene();
  for (const v of av) scene.add(v.root);
  const hits: Hit[] = [];
  const racket = new THREE.Vector3();
  let seen = 0;
  let nan = 0;
  for (let k = 0; k < 120 * seconds; k++) {
    m.step(NONE);
    while (seen < m.eventSeq) {
      const e = m.events[seen % m.events.length]!;
      seen++;
      if (e.kind === E_HIT) {
        const p = m.players[e.player]!;
        hits.push({ player: e.player, shot: SHOT_KEYS[e.a]!, t: m.time, ball: new THREE.Vector3(p.lastContact.x, p.lastContact.y, p.lastContact.z), best: Infinity, at: 0 });
      }
    }
    for (let i = 0; i < 4; i++) av[i]!.update(m, m.players[i]!, i, 1, m.time);
    for (const h of hits) {
      if (m.time > h.t + 0.15 || m.time < h.t - 0.05) continue;
      racket.setFromMatrixPosition(av[h.player]!.racket.matrixWorld);
      const d = racket.distanceTo(h.ball);
      if (d < h.best) { h.best = d; h.at = m.time - h.t; }
    }
    if (k % 60 === 0) {
      for (const v of av) v.root.traverse((o) => { if (!Number.isFinite(o.quaternion.w) || !Number.isFinite(o.position.x)) nan++; });
    }
  }
  return { hits, nan };
}

function report(label: string, hits: Hit[]) {
  const d = hits.map((h) => h.best).sort((x, y) => x - y);
  const q = (f: number) => d[Math.floor(f * (d.length - 1))]!;
  const lag = hits.map((h) => Math.abs(h.at)).sort((x, y) => x - y);
  const lq = (f: number) => lag[Math.floor(f * (lag.length - 1))]!;
  process.stderr.write(`${label}: racket to ball median ${q(0.5).toFixed(3)} p90 ${q(0.9).toFixed(3)} m, visual contact median ${lq(0.5).toFixed(3)} p90 ${lq(0.9).toFixed(3)} s, ${hits.length} hits\n`);
  return { q, lq };
}

describe('avatar', () => {
  it("holds the racket in the left hand as the mirror image of the right", () => {
    const a = asset();
    interface GripView { hand: THREE.Bone; pos: THREE.Vector3; q: THREE.Quaternion; bones: number[]; quats: Float32Array }
    const av = new Avatar(a, 0xffffff) as unknown as { root: THREE.Object3D; bones: THREE.Bone[]; grips: GripView[] };
    for (const g of av.grips) for (let k = 0; k < g.bones.length; k++) av.bones[g.bones[k]!]!.quaternion.fromArray(g.quats, k * 4);
    av.root.updateMatrixWorld(true);
    const at = (n: string) => new THREE.Vector3().setFromMatrixPosition(av.bones[a.bone(n)]!.matrixWorld);
    // Curled fingertips: the left hand's are the right hand's seen in a mirror (model x -> -x).
    for (const f of ['Index3', 'Middle3', 'Ring3', 'Pinky3', 'Thumb3']) {
      const r = at('RightHand' + f), l = at('LeftHand' + f);
      expect(Math.hypot(r.x + l.x, r.y - l.y, r.z - l.z)).toBeLessThan(0.01);
    }
    const racket = (g: GripView) => {
      const m = g.hand.matrixWorld.clone().multiply(new THREE.Matrix4().compose(g.pos, g.q, new THREE.Vector3(1, 1, 1)));
      const p = new THREE.Vector3(), q = new THREE.Quaternion();
      m.decompose(p, q, new THREE.Vector3());
      return { p, q };
    };
    const r = racket(av.grips[0]!), l = racket(av.grips[1]!);
    expect(Math.hypot(r.p.x + l.p.x, r.p.y - l.p.y, r.p.z - l.p.z)).toBeLessThan(0.005);
    expect(new THREE.Quaternion(r.q.x, -r.q.y, -r.q.z, r.q.w).angleTo(l.q)).toBeLessThan(0.01);
  });

  it('mirrors for left-handers', () => {
    const lefty = [false, true, true, false];
    // (120 s: since players walk back between points, 90 s held 12 of their hits)
    const { hits, nan } = play(11, 120, lefty);
    expect(nan).toBe(0);
    const left = hits.filter((h) => lefty[h.player]);
    expect(left.length).toBeGreaterThan(12);
    const { q, lq } = report('left-handers', left);
    const right = report('right-handers', hits.filter((h) => !lefty[h.player]));
    // As close as the right-handers in the same match.
    expect(q(0.5)).toBeLessThan(Math.max(0.05, right.q(0.5) + 0.03));
    expect(q(0.9)).toBeLessThan(0.25);
    expect(lq(0.5)).toBeLessThan(0.02);
  });

  it('meets the ball with the racket and never goes NaN', () => {
    const { hits, nan } = play(7, 120);
    expect(nan).toBe(0);
    expect(hits.length).toBeGreaterThan(40);
    const d = hits.map((h) => h.best).sort((x, y) => x - y);
    const q = (f: number) => d[Math.floor(f * (d.length - 1))]!;
    const by: Record<string, number[]> = {};
    for (const h of hits) (by[h.shot] ??= []).push(h.best);
    const summary = Object.entries(by).map(([k, v]) => `${k} ${v.length} med ${v.sort((x, y) => x - y)[v.length >> 1]!.toFixed(2)}`);
    process.stderr.write(`racket to ball at contact (m): median ${q(0.5).toFixed(3)} p90 ${q(0.9).toFixed(3)} max ${q(1).toFixed(3)} | ${summary.join(" | ")}\n`);
    // When: the racket is closest to the contact point within a frame or two of the sim's contact moment.
    const lag = hits.map((h) => Math.abs(h.at)).sort((x, y) => x - y);
    const lq = (f: number) => lag[Math.floor(f * (lag.length - 1))]!;
    process.stderr.write(`visual contact vs sim contact (s): median ${lq(0.5).toFixed(3)} p90 ${lq(0.9).toFixed(3)} max ${lq(1).toFixed(3)}\n`);
    expect(q(0.5)).toBeLessThan(0.03);
    expect(q(0.9)).toBeLessThan(0.15);
    expect(lq(0.5)).toBeLessThan(0.02);
    expect(lq(0.9)).toBeLessThan(0.035);
  });
});
