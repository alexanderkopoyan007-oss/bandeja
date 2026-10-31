// Phase 7's animation fixes (docs/qa/REPORT.md #12-19), held on the animation army's configurations that showed
// them worst: seed0 1, configurations 55 (a monkey: 137° in a frame), 12 (a bot: a 117° flip), 25 (AI doubles: 101°)
// and 38 (AI singles: legs through each other 5.2%), each 90 s with the bodies, as `node tools/qa/anim-army.ts
// --only N` plays them. After the fixes the fastest one-frame turn was 49°, 44°, 37° and 40°.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parsePlayerAsset } from '../../src/render/avatar/asset.ts';
import { runAnimQa } from '../../src/render/avatar/animQa.ts';
import { InputFrame } from '../../src/sim/input.ts';
import { makeConfig, matchConfig } from '../../tools/qa/config.ts';
import { BotHuman, MonkeyHuman, type Driver } from '../../tools/qa/humans.ts';

function asset() {
  const gz = readFileSync(new URL('../../public/assets/player.bnz', import.meta.url));
  const raw = gunzipSync(gz);
  return parsePlayerAsset(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
}

describe('animation army configurations that showed Phase 7\'s flips', () => {
  const a = asset();
  for (const idx of [55, 12, 25, 38]) {
    it(`configuration ${idx}`, () => {
      const c = makeConfig(1, idx);
      const n = c.doubles ? 4 : 2;
      const drivers: Array<Driver | null> = [];
      const frames: Array<InputFrame | null> = [];
      for (let i = 0; i < n; i++) {
        const h = c.humans[i];
        drivers.push(h === 'bot' ? new BotHuman(i, c.seed + 31 * i) : h === 'monkey' ? new MonkeyHuman(i, c.seed + 37 * i) : null);
        frames.push(h === 'ai' ? null : new InputFrame());
      }
      const r = runAnimQa(a, {
        seed: c.seed, seconds: 90, doubles: c.doubles, lefty: c.lefty, repeatEvery: 7, match: matchConfig(c),
        inputs: (m) => { for (let i = 0; i < n; i++) drivers[i]?.act(m, frames[i]!); return frames; },
      });
      let fastest = 0;
      for (const p of Object.values(r.pops.peaks)) fastest = Math.max(fastest, p.max / 120);
      // The army's limit is 105°; these reached 37-49° after the fixes.
      expect(fastest).toBeLessThan(75);
      expect(r.pops.worst.filter((e) => e.value >= 105).length).toBe(0);
      expect(r.pops.kneeSpins.length).toBe(0);
      expect(r.clip.legs).toBeLessThan(0.08);
    }, 120000);
  }
});
