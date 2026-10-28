import * as THREE from 'three/webgpu';
import { Game } from './game/game.ts';
import { MODE_ADVANTAGE, MODE_GOLDEN, MODE_STAR, FINAL_NORMAL } from './sim/rules/score.ts';
import type { FloorName } from './sim/setup.ts';
import { Rng } from './sim/core/rng.ts';
import { STYLE_KEYS } from './sim/ai/styles.ts';
import { loadPlayerAsset, type PlayerAsset } from './render/avatar/asset.ts';
import { findPhoto, PhotoOverlay } from './game/photoMatch.ts';

const params = new URLSearchParams(location.search);
const num = (k: string, d: number): number => {
  const v = params.get(k);
  return v === null || Number.isNaN(Number(v)) ? d : Number(v);
};

async function start(): Promise<void> {
  // Photo-match mode: the photo's court and arena unless the URL says otherwise; AI play (or ?still=1).
  const photo = params.get('photo') ? findPhoto(params.get('photo')!) : null;
  if (photo) {
    for (const k of ['court', 'floor', 'arena'] as const) if (photo[k] && !params.has(k)) params.set(k, photo[k]!);
    if (!params.has('autoplay')) params.set('autoplay', '1');
  }
  const autoplay = params.get('autoplay') === '1';
  // Doubles is padel; ?mode=singles plays one against one (not a FIP format).
  const doubles = params.get('mode') !== 'singles';
  const n = doubles ? 4 : 2;
  const seed = num('seed', (Math.random() * 2 ** 31) | 0);
  // AI playing styles: ?styles=muro,martillo,... by player number, else dealt from the seed.
  const deal = new Rng(seed ^ 0x2545f491);
  const styles = params.get('styles')?.split(',')
    ?? Array.from({ length: n }, () => STYLE_KEYS[Math.floor(deal.next() * STYLE_KEYS.length)]!);
  const mode = params.get('scoring');
  const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: params.get('backend') === 'webgl' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, num('dpr', 2)));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // Tone mapping: Khronos PBR Neutral keeps hue and saturation (the reference photos' saturated court blues and
  // surround reds came out salmon and periwinkle under AgX); ?tone=agx|aces compares.
  const tone = params.get('tone');
  renderer.toneMapping = tone === 'agx' ? THREE.AgXToneMapping : tone === 'aces' ? THREE.ACESFilmicToneMapping : THREE.NeutralToneMapping;
  document.body.appendChild(renderer.domElement);
  // The player body loads alongside the renderer; ?avatar=0 (or a failed load) plays with the M1 capsules.
  const avatar = params.get('avatar') === '0' ? Promise.resolve(null)
    : loadPlayerAsset(new URL('assets/player.bnz', document.baseURI).href).catch((err: unknown): PlayerAsset | null => {
      console.warn('player body not loaded, using capsules:', err);
      return null;
    });
  await renderer.init();
  if (params.get('lab') === 'ball') {
    // The ball test lab (src/game/ballLabScene.ts) instead of a match.
    const { startBallLab } = await import('./game/ballLabScene.ts');
    await startBallLab(renderer, document.getElementById('hud')!);
    return;
  }

  const game = new Game({
    match: {
      seed,
      world: {
        court: params.get('court') ?? 'standard',
        floor: (params.get('floor') as FloorName | null) ?? 'turf',
        env: { temperatureC: num('temp', 20), altitudeM: num('alt', 0), windX: num('windx', 0), windZ: num('windz', 0) },
      },
      format: {
        mode: mode === 'golden' ? MODE_GOLDEN : mode === 'advantage' ? MODE_ADVANTAGE : MODE_STAR,
        setsToWin: num('sets', 2),
        gamesPerSet: num('games', 6),
        finalSet: FINAL_NORMAL,
      },
      doubles,
      human: Array.from({ length: n }, (_, i) => !autoplay && i === 0),
      aiLevel: [num('ai', 0.55), num('ai', 0.55)],
      aiStyle: styles,
      // Left-handers by player number: ?lefty=0,3
      lefty: Array.from({ length: n }, (_, i) => (params.get('lefty') ?? '').split(',').includes(String(i))),
      // Defaults are forgiving; ?timing=1 is the strict "pro" window, ?autotime=1 fires a held swing for you.
      timingScale: num('timing', 1.5),
      assist: num('assist', 0.45),
      autoTiming: params.get('autotime') === '1',
      firstServer: num('server', 0),
    },
    human: 0,
    autoplay,
    forceWebGL: params.get('backend') === 'webgl',
    pro: params.get('pro') === '1',
    gfx: params.get('gfx') ?? undefined,
    bloom: params.get('bloom') !== '0',
    mouseAim: params.get('aim') === 'mouse',
    runAhead: params.get('runahead') !== '0',
    sound: params.get('sound') !== '0',
    arena: params.get('arena') ?? 'stadium',
    avatar: await avatar,
  }, renderer, document.getElementById('hud')!);
  // Exposed before the warm-up: tools that step the game themselves don't need it (and a hidden tab stalls it).
  (window as unknown as { __bandeja: Game }).__bandeja = game;
  // Tools driving a hidden tab (no animation frames there): step the game by hand, `secs` of 60 Hz frames.
  (window as unknown as { __step: unknown }).__step = async (secs: number) => {
    renderer.setAnimationLoop(null);
    const g = game as unknown as { epoch: number; tick(): void };
    for (let i = 0, n = Math.round(secs * 60); i < n; i++) {
      g.epoch -= 1000 / 60;
      g.tick();
      if (i % 30 === 29) await new Promise((r) => setTimeout(r, 0));
    }
    return game.sim.time;
  };
  // Captures for tools (any page): render one frame at a width and post it, or a photo-match composite, to a local
  // receiver. Stops the animation loop.
  (window as unknown as { __snap: unknown }).__snap = async (name: string, kind: 'game' | 'wipe' | 'blend' | 'lines' = 'game', at = 0.5, w = 1600, to = 'http://127.0.0.1:5198/save') => {
    renderer.setAnimationLoop(null);
    const aspect = game.photo ? game.photo.aspect : 16 / 9;
    renderer.setSize(w, Math.round(w / aspect), false);
    if (!game.photo) {
      game.cam.camera.aspect = aspect;
      game.cam.camera.updateProjectionMatrix();
    }
    game.renderOnce();
    const c = game.photo ? game.photo.composite(renderer.domElement, kind, at) : renderer.domElement;
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.88));
    return (await fetch(`${to}?name=${encodeURIComponent(name)}`, { method: 'POST', body: blob })).text();
  };
  if (photo) {
    game.photo = new PhotoOverlay(photo, renderer.domElement, params);
    game.paused = params.get('still') === '1';
    game.resize();
  }
  await game.warmUp();
  game.start();
}

start().catch((err: unknown) => {
  document.body.style.color = '#fff';
  document.body.textContent = `Failed to start: ${String(err)}`;
  console.error(err);
});
