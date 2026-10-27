// The sim must stay pure TypeScript: no rendering, DOM or Node imports.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('sim purity', () => {
  const sim = files('src/sim');
  it('finds sim files', () => expect(sim.length).toBeGreaterThan(0));
  it.each(sim)('%s imports nothing from three, the DOM layer or Node', (f) => {
    // Code only: comments may mention words like "window." in prose.
    const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);
    for (const i of imports) {
      expect(i, `${f} imports ${i}`).not.toMatch(/^(three|node:|fs|path)|\/(render|game|ui|audio|anim)\//);
    }
    expect(src).not.toMatch(/\bMath\.random\b|\bDate\.now\b|\bperformance\.now\b|\bwindow\.\w|\bdocument\.\w/);
    // Engine Math transcendentals differ in their last bits between machines: use core/smath (fdlibm ports).
    expect(src, `${f} calls an engine Math transcendental`).not.toMatch(
      /\bMath\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|exp|expm1|log|log1p|log2|log10|pow|cbrt|hypot)\b/,
    );
  });
});
