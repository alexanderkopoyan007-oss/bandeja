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
    const src = readFileSync(f, 'utf8');
    const imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);
    for (const i of imports) {
      expect(i, `${f} imports ${i}`).not.toMatch(/^(three|node:|fs|path)|\/(render|game|ui|audio|anim)\//);
    }
    expect(src).not.toMatch(/\bMath\.random\b|\bDate\.now\b|\bperformance\.now\b|\bwindow\.|\bdocument\./);
  });
});
