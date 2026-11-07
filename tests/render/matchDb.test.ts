// Motion matching's library (src/render/avatar/matchDb.ts) on the clips the game has now: the search must find the clip
// that moves the way it's asked to, stay on the clip playing when another is only as good, and allocate nothing.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parsePlayerAsset } from '../../src/render/avatar/asset.ts';
import { F_DIR, F_FEET, F_FEET_V, F_HIPS_V, F_TRAJ, FEATURES, MatchDb, TRAJ_T, sourceOf } from '../../src/render/avatar/matchDb.ts';

const asset = (() => {
  const raw = gunzipSync(readFileSync(new URL('../../public/assets/player.bnz', import.meta.url)));
  return parsePlayerAsset(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
})();
const LOCO = ['idle', 'run', 'runBack', 'strafeLeft', 'strafeRight', 'jog'];
const db = new MatchDb(asset, LOCO.map((n) => sourceOf(asset.clip(n))));

/** A query for steady travel at (vx, vz) in the body's frame, feet copied from a row of the library. */
function steady(vx: number, vz: number, feetFrom: number): Float32Array {
  const q = new Float32Array(FEATURES);
  const r = feetFrom * FEATURES;
  // (the library's own feet, unscaled back to raw)
  for (let k = F_FEET; k < F_FEET_V; k++) q[k] = db.feat[r + k]! / db.scale[k]! + db.mean[k]!;
  for (let k = 0; k < 2; k++) { q[F_FEET_V + k * 2] = vx; q[F_FEET_V + k * 2 + 1] = vz; }
  q[F_HIPS_V] = vx; q[F_HIPS_V + 1] = vz;
  TRAJ_T.forEach((t, j) => { q[F_TRAJ + j * 2] = vx * t; q[F_TRAJ + j * 2 + 1] = vz * t; q[F_DIR + j * 2] = 0; q[F_DIR + j * 2 + 1] = 1; });
  return q;
}
const clipAt = (row: number): string => db.sources[db.sourceOf[row]!]!.clip.name;

describe('motion matching library', () => {
  it('has every frame of every clip, features finite', () => {
    let n = 0;
    for (const n0 of LOCO) { const c = asset.clip(n0); n += c.frames - (c.loop ? 1 : 0); }
    expect(db.n).toBe(n);
    for (const x of db.feat) expect(Number.isFinite(x)).toBe(true);
  });

  it('finds the clip that travels the way it is asked to', () => {
    const run = asset.clip('run'), back = asset.clip('runBack'), jog = asset.clip('jog');
    const left = asset.clip('strafeLeft'), right = asset.clip('strafeRight');
    const want: Array<[number, number, string]> = [
      [run.speed * run.dirX, run.speed * run.dirZ, 'run'],
      [back.speed * back.dirX, back.speed * back.dirZ, 'runBack'],
      [jog.speed * jog.dirX, jog.speed * jog.dirZ, 'jog'],
      [left.speed * left.dirX, left.speed * left.dirZ, 'strafeLeft'],
      [right.speed * right.dirX, right.speed * right.dirZ, 'strafeRight'],
      [0, 0, 'idle'],
    ];
    for (const [vx, vz, name] of want) {
      // whatever the feet were doing, travel decides
      for (const from of [0, Math.floor(db.n / 3), Math.floor((2 * db.n) / 3)]) expect(clipAt(db.search(steady(vx, vz, from)))).toBe(name);
    }
  });

  it('keeps the frame playing unless another is nearer by more than the slack', () => {
    const run = asset.clip('run');
    const q = steady(run.speed * run.dirX, run.speed * run.dirZ, 0);
    const best = db.search(q);
    let second = -1;
    for (let r = 0; r < db.n; r++) if (r !== best && (second < 0 || db.cost(r) < db.cost(second))) second = r;
    const gap = db.cost(second) - db.cost(best);
    expect(gap).toBeGreaterThan(0);
    expect(db.search(q, second, gap * 1.01)).toBe(second);
    expect(db.search(q, second, gap * 0.5)).toBe(best);
    // a standing frame is no near-tie for a run, whatever is playing
    const idle = Array.from({ length: db.n }, (_, r) => r).find((r) => clipAt(r) === 'idle')!;
    expect(db.search(q, idle, 2)).toBe(best);
  });

  it('searches without allocating', () => {
    const q = steady(1, 2, 0);
    // (warmed up first: compiling the search allocates code once)
    for (let i = 0; i < 5000; i++) db.search(q, i % db.n);
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 20000; i++) db.search(q, i % db.n);
    // A boxed double per library row would be 20000 x rows x 16 bytes, over 100 MB; V8's own bookkeeping is under 1 MB.
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(1_000_000);
  });
});
