// Strokes drawn by a clip's track (src/render/avatar/clipStroke.ts, ?motion=3): the file's checks, the other hand's
// mirror, the sampling, and that a stroke drawn by a track still meets the ball where the sim struck it. The real
// tracks are not in the repository (public/assets/mocap-local/), so these are made from each family's own coded keys.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import * as THREE from 'three/webgpu';
import { MatchSim, E_HIT } from '../../src/sim/match.ts';
import { parsePlayerAsset } from '../../src/render/avatar/asset.ts';
import { Avatar } from '../../src/render/avatar/avatar.ts';
import { FOREHAND, OVERHEAD, VIBORA, leftFamily, type Family, type Key } from '../../src/render/avatar/strokes.ts';
import { TS, TRACK_FILES, applyStrokeTrack, mirrorTrack, parseTrack, sampleTrack, type TrackJson } from '../../src/render/avatar/clipStroke.ts';

const FPS = 60;

/** A family's three keys as a track: back to contact over `lead`, contact to finish over `follow`, the shoulder where a standing player's is. */
function trackOf(name: string, f: Family, lead: number, follow: number): TrackJson {
  const a = Math.round(lead * FPS), b = Math.round(follow * FPS), n = a + b + 1;
  const j: TrackJson = { name, fps: FPS, frames: n, lead: a / FPS, follow: b / FPS, p: [], q: [], pole: [], sh: [], off: [], yaw: [], tilt: [], bow: [], hipsY: [] };
  let last: THREE.Quaternion | null = null;
  for (let i = 0; i < n; i++) {
    const [k0, k1, u]: [Key, Key, number] = i <= a ? [f.back, f.contact, i / a] : [f.contact, f.finish, (i - a) / b];
    const s = u * u * (3 - 2 * u);
    const q = k0.q.clone().slerp(k1.q, s);
    if (last && last.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
    last = q;
    j.p.push(...k0.p.clone().lerp(k1.p, s).toArray());
    j.q.push(q.x, q.y, q.z, q.w);
    j.pole.push(...k0.pole.clone().lerp(k1.pole, s).toArray());
    j.off.push(...k0.off.clone().lerp(k1.off, s).toArray());
    j.sh.push(-0.19, 1.42, 0);
    j.yaw.push(k0.yaw + (k1.yaw - k0.yaw) * s);
    j.tilt.push(0); j.bow.push(0); j.hipsY.push(0.95);
  }
  return j;
}

function asset() {
  const gz = readFileSync(new URL('../../public/assets/player.bnz', import.meta.url));
  const raw = gunzipSync(gz);
  return parsePlayerAsset(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
}

describe('a stroke drawn by a clip', () => {
  const fh = trackOf('forehand', FOREHAND, 0.3, 0.33);

  it('turns down a file whose channels or times do not add up', () => {
    expect(() => parseTrack({ ...fh, p: fh.p.slice(3) })).toThrow();
    expect(() => parseTrack({ ...fh, lead: fh.lead + 0.1 })).toThrow();
    expect(() => parseTrack({ ...fh, yaw: fh.yaw.map((v, i) => (i === 4 ? NaN : v)) })).toThrow();
    expect(() => applyStrokeTrack('no-such-stroke', fh)).toThrow();
    const t = parseTrack(fh);
    expect(t.n).toBe(fh.frames);
    // (the racket's centre from the shoulder at the ball)
    expect(t.c0.distanceTo(FOREHAND.contact.p.clone().sub(new THREE.Vector3(-0.19, 1.42, 0)))).toBeLessThan(1e-4);
  });

  it('samples between frames and holds at its ends', () => {
    const t = parseTrack(fh);
    sampleTrack(t, 0);
    expect(TS.p.distanceTo(FOREHAND.contact.p)).toBeLessThan(1e-4);
    expect(TS.q.angleTo(FOREHAND.contact.q)).toBeLessThan(1e-3);
    sampleTrack(t, -9);
    expect(TS.p.distanceTo(FOREHAND.back.p)).toBeLessThan(1e-4);
    sampleTrack(t, 9);
    expect(TS.p.distanceTo(FOREHAND.finish.p)).toBeLessThan(1e-4);
    expect(TS.yaw).toBeCloseTo(FOREHAND.finish.yaw, 4);
    // half-way between two frames is half-way between their values
    const i = 5, at = (i + 0.5) / FPS - t.lead;
    sampleTrack(t, at);
    expect(TS.p.x).toBeCloseTo((t.p[i * 3]! + t.p[i * 3 + 3]!) / 2, 5);
    expect(Math.hypot(TS.q.x, TS.q.y, TS.q.z, TS.q.w)).toBeCloseTo(1, 6);
  });

  it("is the other hand's seen in a mirror", () => {
    const t = parseTrack(fh), m = mirrorTrack(t);
    sampleTrack(t, -0.1);
    const p = TS.p.clone(), q = TS.q.clone(), yaw = TS.yaw, sh = TS.sh.clone();
    sampleTrack(m, -0.1);
    expect(TS.p.distanceTo(new THREE.Vector3(-p.x, p.y, p.z))).toBeLessThan(1e-6);
    expect(TS.sh.distanceTo(new THREE.Vector3(-sh.x, sh.y, sh.z))).toBeLessThan(1e-6);
    expect(TS.q.angleTo(new THREE.Quaternion(q.x, -q.y, -q.z, q.w))).toBeLessThan(1e-4);
    expect(TS.yaw).toBeCloseTo(-yaw, 6);
    expect(m.c0.x).toBeCloseTo(-t.c0.x, 6);
  });

  it('still meets the ball where the sim struck it, either hand', () => {
    expect(TRACK_FILES).toEqual(['forehand', 'backhand', 'vibora', 'bandeja']);
    applyStrokeTrack('forehand', fh);
    applyStrokeTrack('vibora', trackOf('vibora', VIBORA, 0.32, 0.45));
    applyStrokeTrack('bandeja', trackOf('bandeja', OVERHEAD, 0.32, 0.45));
    for (const f of [FOREHAND, VIBORA, OVERHEAD]) {
      expect(f.track).toBeDefined();
      expect(leftFamily(f).track).toBeDefined();
      expect(f.over).toBeUndefined();
    }
    expect(OVERHEAD.high).toBe(true);
    expect(FOREHAND.high).toBe(false);
    const a = asset();
    const lefty = [false, true, true, false];
    const m = new MatchSim({ seed: 4, doubles: true, human: [false, false, false, false], lefty });
    const av = [0, 1, 2, 3].map((i) => new Avatar(a, 0xffffff * (i / 4)));
    const scene = new THREE.Scene();
    for (const v of av) scene.add(v.root);
    const NONE = [null, null, null, null];
    const racket = new THREE.Vector3(), was = av.map(() => new THREE.Vector3());
    const drawn: number[] = [];
    let seen = 0, nan = 0;
    for (let k = 0; k < 120 * 150; k++) {
      m.step(NONE);
      while (seen < m.eventSeq) {
        const e = m.events[seen % m.events.length]!;
        seen++;
        if (e.kind !== E_HIT) continue;
        const who = av[e.player]! as unknown as { fam: Family };
        if (!who.fam.track) continue;
        const p = m.players[e.player]!;
        // (the event comes a tick after the contact, so the frame that met the ball is the one before)
        drawn.push(was[e.player]!.distanceTo(new THREE.Vector3(p.lastContact.x, p.lastContact.y, p.lastContact.z)));
      }
      for (let i = 0; i < 4; i++) av[i]!.update(m, m.players[i]!, i, 1, m.time);
      for (let i = 0; i < 4; i++) was[i]!.copy(racket.setFromMatrixPosition(av[i]!.racket.matrixWorld));
      if (k % 60 === 0) for (const v of av) v.root.traverse((o) => { if (!Number.isFinite(o.quaternion.w) || !Number.isFinite(o.position.x)) nan++; });
    }
    drawn.sort((x, y) => x - y);
    const q = (f: number) => drawn[Math.floor(f * (drawn.length - 1))]!;
    process.stderr.write(`track-drawn strokes: ${drawn.length} hits, racket to ball median ${q(0.5).toFixed(3)} p90 ${q(0.9).toFixed(3)} m\n`);
    expect(nan).toBe(0);
    expect(drawn.length).toBeGreaterThan(4);
    expect(q(0.5)).toBeLessThan(0.04);
    expect(q(0.9)).toBeLessThan(0.2);
  }, 120000);
});
