// M5 phase C step 3: what a player chooses for their suit (src/render/avatar/paint.ts): patterns and shoes painted by the person's
// shader, the overgrip on the racket (the cuts are garments: wardrobe.test.ts). The catalogue's paint items, the URL that chooses them, and a
// material for every choice on everyone.
import { describe, expect, it } from 'vitest';
import { mannequinWithPeople } from './people.ts';
import { Avatar } from '../../src/render/avatar/avatar.ts';
import { kitFor } from '../../src/render/avatar/kit.ts';
import { PAINT_PATTERNS, PAINT_SOCKS, PAINT_TOPS, type Paint } from '../../src/render/avatar/paint.ts';
import { COSMETICS, paintOf } from '../../src/app/unlocks.ts';
import { wearParam } from '../../src/app/options.ts';

const people = mannequinWithPeople().people;

describe('paint', () => {
  it('turns every paint item into a choice the game knows, and the grips into colours', () => {
    for (const c of COSMETICS.filter((x) => x.kind === 'paint')) {
      const { paint, grip } = paintOf([c.id]);
      if (c.slot === 'top') expect(PAINT_TOPS, c.id).toContain(paint.top);
      else if (c.slot === 'pattern') expect(PAINT_PATTERNS, c.id).toContain(paint.pattern);
      else if (c.slot === 'bottom') expect(['shorts', 'tights'], c.id).toContain(paint.bottom);
      else if (c.slot === 'socks') expect(PAINT_SOCKS, c.id).toContain(paint.socks);
      else if (c.slot === 'shoes') for (const k of ['upper', 'sole', 'accent'] as const) expect(paint.shoes![k], c.id).toMatch(/^#[0-9a-f]{6}$/);
      else if (c.slot === 'grip') expect(grip, c.id).toMatch(/^#[0-9a-f]{6}$/);
      else throw new Error(`unexpected paint slot ${c.slot}`);
    }
    // (the polo, the skirts and the dress are garments of their own: step 5)
    expect(paintOf(['top-polo', 'bot-pleated', 'top-dress']).paint).toEqual({});
  });

  it('reads the paint and the grip from the URL', () => {
    const w = wearParam(new URLSearchParams('wear=top-tank+pat-hoops+socks-knee+bot-tights+shoes-volt+grip-coral+head-cap,,pat-dots'))!;
    expect(w[0]).toEqual({ head: 'head-cap', grip: '#ff6f5e', paint: { top: 'tank', pattern: 'hoops', socks: 'knee', bottom: 'tights', shoes: { upper: '#d8f23a', sole: '#1b1b1d', accent: '#1b1b1d' } } });
    expect(w[1]).toBeUndefined();
    expect(w[2]).toEqual({ paint: { pattern: 'dots' } });
  });

  it('builds the material for every pattern and pair of shoes on everyone', () => {
    const all: Paint[] = [...PAINT_PATTERNS.map((pattern) => ({ pattern })), { shoes: { upper: '#d8f23a', sole: '#1b1b1d', accent: '#1b1b1d' } }];
    for (const p of people) for (const paint of all) expect(() => new Avatar(p, kitFor(1), paint), `${p.look!.name} ${JSON.stringify(paint)}`).not.toThrow();
  });
});
