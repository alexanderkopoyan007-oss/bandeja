import * as THREE from 'three/webgpu';
import { Game } from './game/game.ts';
import { loadPlayerAsset, type PlayerAsset } from './render/avatar/asset.ts';
import { findPhoto, PhotoOverlay } from './game/photoMatch.ts';
import { App } from './app/app.ts';
import { LoadingScreen } from './ui/loading.ts';
import { directLaunch, optionsFromUrl } from './app/options.ts';

const params = new URLSearchParams(location.search);
const num = (k: string, d: number): number => {
  const v = params.get(k);
  return v === null || Number.isNaN(Number(v)) ? d : Number(v);
};

async function makeRenderer(): Promise<THREE.WebGPURenderer> {
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
  await renderer.init();
  return renderer;
}

/** The plain page: the loading screen, then the menus over an AI match (Phase 8). */
async function startApp(): Promise<void> {
  const loading = new LoadingScreen();
  loading.stage('Starting the renderer', 0.03);
  const renderer = await makeRenderer();
  const app = new App(renderer, document.getElementById('hud')!, params, loading);
  try {
    await app.boot();
  } catch (err) {
    loading.fail(`The game could not start here: ${String(err)}. It needs a browser with WebGPU or WebGL 2 (a recent Chrome, Edge, Firefox or Safari).`);
    throw err;
  }
}

/** A URL that names a game (tools, test pages, links from before the menus): straight into it, as always. */
async function start(): Promise<void> {
  document.getElementById('loading')?.remove();
  // Photo-match mode: the photo's court and arena unless the URL says otherwise; AI play (or ?still=1).
  const photo = params.get('photo') ? findPhoto(params.get('photo')!) : null;
  if (photo) {
    for (const k of ['court', 'floor', 'arena'] as const) if (photo[k] && !params.has(k)) params.set(k, photo[k]!);
    if (!params.has('autoplay')) params.set('autoplay', '1');
  }
  // The player body loads alongside the renderer; ?avatar=0 (or a failed load) plays with the M1 capsules.
  const avatar = params.get('avatar') === '0' ? Promise.resolve(null)
    : loadPlayerAsset(new URL('assets/player.bnz', document.baseURI).href).catch((err: unknown): PlayerAsset | null => {
      console.warn('player body not loaded, using capsules:', err);
      return null;
    });
  const renderer = await makeRenderer();
  if (params.get('lab') === 'ball') {
    // The ball test lab (src/game/ballLabScene.ts) instead of a match.
    const { startBallLab } = await import('./game/ballLabScene.ts');
    await startBallLab(renderer, document.getElementById('hud')!);
    return;
  }

  const game = new Game(optionsFromUrl(params, await avatar), renderer, document.getElementById('hud')!);
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

(directLaunch(params) ? start() : startApp()).catch((err: unknown) => {
  console.error(err);
  if (!document.getElementById('loading')) {
    // Direct launches have no loading screen to say it on.
    const l = new LoadingScreen();
    l.fail(`The game could not start here: ${String(err)}.`);
  }
});
