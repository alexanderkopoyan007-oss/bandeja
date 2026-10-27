# Credits

Every third-party asset and library used by BANDEJA, with its source and licence.

## Libraries
| Library | Licence | Use |
|---|---|---|
| [three.js](https://threejs.org) 0.186.1 | MIT | Rendering (WebGPU with WebGL2 fallback) |
| [Vite](https://vite.dev) | MIT | Build and dev server |
| [Vitest](https://vitest.dev) | MIT | Tests |
| [TypeScript](https://www.typescriptlang.org) | Apache-2.0 | Language |
| [Puppeteer](https://pptr.dev) (core) | Apache-2.0 | Dev-only screenshots and performance runs |
| fdlibm (Sun Microsystems, 1993), via [musl](https://musl.libc.org) | fdlibm notice (free use, notice kept in the file) / MIT | `src/sim/core/fdlibm.ts`: bit-exact sin, cos, atan, atan2, exp, log ported to TypeScript |

## Reference
- Court, ball and rules figures: FIP *Rules of Padel*, application 01.01.2026 (padelfip.com). Referenced, not redistributed.

## Assets
| Asset | Source | Licence | Use |
|---|---|---|---|
| Y Bot character and 10 animation clips (idle, run, run back, strafes, jog, jump, side step, fist pump, defeated) | [Mixamo](https://www.mixamo.com) (Adobe) | Mixamo terms: free to use in games; raw files not redistributed | `public/assets/player.bnz`, processed and packed by `tools/assets/build-player.mjs` from `assets-src/mixamo/` (gitignored); clip list in `docs/mixamo.md` |

The court is generated in code. Every stroke (groundstrokes, volleys, overheads, the serve, the ready position) is our own, authored in `src/render/avatar/strokes.ts`.
