// The bodies under rollback: the real avatars drawn from a client's sim while rewinds happen under them, against the same
// hands with no lag. runAnimQa builds its own MatchSim, so that sim's step is caught and handed to a RollbackClient.
//   node tools/net/anim-rewind.ts
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { MatchSim, PH_SETUP, PH_TOSS, type MatchConfig } from '../../src/sim/match.ts';
import { parsePlayerAsset } from '../../src/render/avatar/asset.ts';
import { runAnimQa } from '../../src/render/avatar/animQa.ts';
import { DT } from '../../src/sim/core/constants.ts';
import { Hands } from './hash-core.ts';
import { RollbackClient, type Packet } from './rollback.ts';

const gz = readFileSync('public/assets/player.bnz');
const raw = gunzipSync(gz);
const asset = parsePlayerAsset(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
const realStep = MatchSim.prototype.step;

function run(seed: number, ms: number, delay: number, seconds: number) {
  const match = { human: [true, true, false, false], aiLevel: [0.8, 1], aiStyle: [], timingScale: 1.5, assist: 0.45, autoTiming: false } as Partial<MatchConfig>;
  const cfg = { seed, doubles: true, ...match } as MatchConfig;
  let view: MatchSim | null = null, me: RollbackClient | null = null, peer: RollbackClient | null = null, busy = false, r = seed | 0, w = 0;
  const hands = [new Hands(seed), new Hands(seed + 977)];
  for (const h of hands) h.timed = 0.045;
  const toMe: Array<{ at: number; p: Packet }> = [], toPeer: Array<{ at: number; p: Packet }> = [];
  const lost = () => { r = (Math.imul(r, 1664525) + 1013904223) | 0; return ms > 0 && (r >>> 8) / (1 << 24) < 0.02; };
  const go = (m: MatchSim, c: RollbackClient, s: number) => {
    const M = m as never as { score: { serverPlayer(): number } };
    return c.local(s, hands[s]!.frame(m, s, m.tick, (m.phase === PH_SETUP || m.phase === PH_TOSS) && M.score.serverPlayer() === s));
  };
  MatchSim.prototype.step = function step(this: MatchSim, inputs: never): void {
    if (busy || (view && this !== view)) { realStep.call(this, inputs); return; }
    if (!view) { view = this; busy = true; me = new RollbackClient(cfg, [0], { delay }, this); peer = new RollbackClient(cfg, [1], { delay }); busy = false; }
    busy = true;
    const now = w++ * DT;
    for (const [q, c] of [[toMe, me!], [toPeer, peer!]] as const) for (let i = q.length - 1; i >= 0; i--) if (q[i]!.at <= now) { const p = q.splice(i, 1)[0]!.p; c.receive(p); }
    const a = go(view, me!, 0), b = go(peer!.sim, peer!, 1);
    if (!lost()) toPeer.push({ at: now + ms / 1000, p: a });
    if (!lost()) toMe.push({ at: now + ms / 1000, p: b });
    if (ms === 0) { peer!.receive(a); me!.receive(b); }
    me!.advance();
    peer!.advance();
    busy = false;
  };
  try {
    const q = runAnimQa(asset, { seed, seconds, match: match as never, lefty: [], repeatEvery: 7 } as never);
    return { pops: q.pops.perMinute, byDoing: q.pops.byDoing, byJoint: q.pops.byJoint, rewinds: me!.rollbacks / seconds, agree: [...me!.hashes].filter(([t, h]) => peer!.hashes.get(t) === h).length, all: me!.hashes.size, off: [...me!.hashes].filter(([t, h]) => peer!.hashes.has(t) && peer!.hashes.get(t) !== h).map(([t]) => t), last: me!.sim.tick };
  } finally {
    MatchSim.prototype.step = realStep;
  }
}

const tops = (o: Record<string, number>) => Object.entries(o).sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k, v]) => `${k} ${v}`).join(', ');
for (const [ms, delay] of (process.env.LINKS ? JSON.parse(process.env.LINKS) : [[0, 3], [40, 3], [80, 3], [80, 6], [150, 6], [150, 9]]) as Array<[number, number]>) {
  const R = [71, 72, 73, 74, 75, 76].map((s) => run(s, ms, delay, 60));
  const mean = R.reduce((p, c) => p + c.pops, 0) / R.length;
  const D: Record<string, number> = {}, J: Record<string, number> = {};
  for (const x of R) { for (const [k, v] of Object.entries(x.byDoing as Record<string, number>)) D[k] = (D[k] ?? 0) + v; for (const [k, v] of Object.entries(x.byJoint as Record<string, number>)) J[k] = (J[k] ?? 0) + v; }
  console.log(`${ms} ms, delay ${delay}t: pops/min ${mean.toFixed(1)} (${R.map((x) => x.pops.toFixed(0)).join(' ')}), rewinds/s ${(R.reduce((p, c) => p + c.rewinds, 0) / R.length).toFixed(1)}, hashes agree ${R.reduce((p, c) => p + c.agree, 0)}/${R.reduce((p, c) => p + c.all, 0)}`);
  for (const x of R) if (x.off.length) console.log(`   differ at ${x.off.join(' ')} of ${x.last}`);
  console.log(`   doing: ${tops(D)}\n   joints: ${tops(J)}`);
}
