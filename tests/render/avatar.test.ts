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

function play(seed: number, seconds: number) {
  const a = asset();
  const m = new MatchSim({ seed, doubles: true, human: [false, false, false, false] });
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

describe('avatar', () => {
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
    expect(q(0.5)).toBeLessThan(0.08);
    expect(q(0.9)).toBeLessThan(0.25);
    expect(lq(0.5)).toBeLessThan(0.02);
    expect(lq(0.9)).toBeLessThan(0.05);
  });
});
