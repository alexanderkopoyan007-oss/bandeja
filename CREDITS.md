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

| Base mesh, skins (young caucasian men and women, a second young caucasian man, young african men and women, middle-aged caucasian men and women, young asian men and women, middle-aged asian man), high-poly eyes (brown, brownlight and bluegreen eye textures; the cornea shell removed), teeth_base, tongue01, the expression units (MPFB's `data/targets/expression/units`, caucasian, african and asian), eyebrow001-010, eyelashes01/02, hair short01-04, afro01, ponytail01, braid01, bob02, long01, male_casualsuit06 and female_casualsuit01 (their meshes, ambient-occlusion and normal maps only; the normal maps give the cloth its folds, their printed diffuse textures are never used), shoes05 (its mesh only) | [MakeHuman](http://www.makehumancommunity.org) system assets and asset packs | CC0 (each asset file says so: "explicitly released as CC0 in september 2020"; holders at release Data Collection AB, Joel Palmius, Jonas Hauquier) | The ten people, `public/assets/people/`, built by `tools/assets/mpfb/` from `data/players/*.json` (sources in `assets-src/`, gitignored) |
| Base mesh, skins (young, middle-aged and old caucasian, african and asian men and women), low-poly eyes, eyebrows, eyelashes01, hair short01-04, afro01, bob01, long01, ponytail01, braid01, the casual, elegant, sport and work suits and shoes01/02 (their meshes only), fedora01 | [MakeHuman](http://www.makehumancommunity.org) system assets and asset packs | CC0 (as above) | The stadium's twelve spectators, `public/assets/crowd/`, rendered by `tools/assets/crowd/` from `data/crowd.json` (plain materials on the clothes; their textures are never used) |
| Skirts (pleated and A-line), headband, visor, polo collar | Generated from each body by `tools/assets/mpfb/person_kit.py` | Our own work, CC0 | The people, `public/assets/people/`, as above |
| Kit marks (the small marks and word blocks on shirts and shorts), seams, side panels | Drawn in the shader, `src/render/avatar/kit.ts` `kitDetail` | Our own work, CC0; invented, no real brand | Every person's kit |

Tools used to build assets (not shipped): [Blender](https://www.blender.org) 5.2 (GPL), [MPFB 2](https://static.makehumancommunity.org/mpfb.html) 2.0.18, MakeHuman's Blender add-on (GPL-3.0; its output, made from the CC0 assets, carries no GPL terms).

The court is generated in code. Every stroke (groundstrokes, volleys, overheads, the serve, the ready position) is our own, authored in `src/render/avatar/strokes.ts`.

Every sound (racket, ball, glass, mesh, posts, net, feet, voices, crowd, ambience, the arenas' reverb) is synthesised
in code at load, in `src/audio/voices.ts`; no recordings or samples are used. Published figures they are built
from are cited in DECISIONS.md (Phase 6); the hand-clap resonances come from the ClaPD model's table (Peltola et
al. 2007, as reported in Jylhä & Erkut, DAFx 2008), used as numbers, no code.
