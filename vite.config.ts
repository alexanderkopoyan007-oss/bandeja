import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the same build works at / locally and at /bandeja/ on GitHub Pages.
  base: './',
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
