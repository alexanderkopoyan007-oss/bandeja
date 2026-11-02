import { execSync } from 'node:child_process';
import { defineConfig } from 'vitest/config';

// Online players must be on one build: their sims have to be identical (src/net/config.ts).
function build(): string {
  try {
    return process.env.GITHUB_SHA?.slice(0, 12) ?? execSync('git rev-parse --short=12 HEAD').toString().trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  // Relative base so the same build works at / locally and at /bandeja/ on GitHub Pages.
  base: './',
  define: { 'import.meta.env.VITE_BUILD': JSON.stringify(build()) },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Sim tests fly whole matches; CI runners are a few times slower than a desktop.
    testTimeout: 60_000,
  },
});
