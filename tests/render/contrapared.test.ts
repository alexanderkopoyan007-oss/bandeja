// The contrapared on the body: the stance turns round to the player's own back glass and the racket meets the ball
// there. Measured 2026-10-28 over 300 s of AI doubles on seeds 1-6 (left-handers on 2, 3, 5): 18 contraparedes,
// face centre to ball p50 0.01-1 cm, the stance square to the glass at every contact.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parsePlayerAsset } from '../../src/render/avatar/asset.ts';
import { runAnimQa } from '../../src/render/avatar/animQa.ts';
import { E_HIT } from '../../src/sim/match.ts';
import { SHOT_CONTRAPARED } from '../../src/sim/contact/shots.ts';

function asset() {
  const gz = readFileSync(new URL('../../public/assets/player.bnz', import.meta.url));
  const raw = gunzipSync(gz);
  return parsePlayerAsset(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
}

describe('contrapared stroke', () => {
  it('faces the glass and meets the ball', () => {
    const a = asset();
    const L = [false, true, true, false];
    const facing: number[] = [];
    let n = 0;
    for (const [seed, lefty] of [[3, L], [6, []], [9, []], [12, []], [15, []], [18, []]] as Array<[number, boolean[]]>) {
      let seen = 0;
      const r = runAnimQa(a, {
        seed, seconds: 240, lefty,
        onFrame: (m, av) => {
          while (seen < m.eventSeq) {
            const e = m.events[seen % m.events.length]!;
            seen++;
            if (e.kind !== E_HIT || e.a !== SHOT_CONTRAPARED) continue;
            // The stance's forward is (sin, cos) of its yaw; the glass is the player's own half's way.
            const x = av[e.player] as unknown as { stanceC: number };
            facing.push(x.stanceC * m.side(m.players[e.player]!.team));
          }
        },
      });
      const c = r.contact.byShot.contrapared;
      if (c) {
        n += c.n;
        expect(c.p90).toBeLessThan(0.08);
      }
      expect(r.pops.perMinute).toBeLessThan(30);
    }
    expect(n).toBeGreaterThanOrEqual(2);
    expect(facing.length).toBe(n);
    // (a call made in the last moments is met still turning: 1 of 8 here)
    expect(facing.filter((f) => f > 0.9).length / facing.length).toBeGreaterThan(0.8);
  }, 300000);
});
