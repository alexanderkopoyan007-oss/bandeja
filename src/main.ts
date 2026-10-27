import * as THREE from 'three/webgpu';
import { Game } from './game/game.ts';
import { MODE_ADVANTAGE, MODE_GOLDEN, MODE_STAR, FINAL_NORMAL } from './sim/rules/score.ts';
import type { FloorName } from './sim/setup.ts';
import { Rng } from './sim/core/rng.ts';
import { STYLE_KEYS } from './sim/ai/styles.ts';
import { loadPlayerAsset, type PlayerAsset } from './render/avatar/asset.ts';

const params = new URLSearchParams(location.search);
const num = (k: string, d: number): number => {
  const v = params.get(k);
  return v === null || Number.isNaN(Number(v)) ? d : Number(v);
};

async function start(): Promise<void> {
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
  renderer.toneMapping = THREE.AgXToneMapping;
  document.body.appendChild(renderer.domElement);
  // The player body loads alongside the renderer; ?avatar=0 (or a failed load) plays with the M1 capsules.
  const avatar = params.get('avatar') === '0' ? Promise.resolve(null)
    : loadPlayerAsset(new URL('assets/player.bnz', document.baseURI).href).catch((err: unknown): PlayerAsset | null => {
      console.warn('player body not loaded, using capsules:', err);
      return null;
    });
  await renderer.init();

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
    mouseAim: params.get('aim') === 'mouse',
    avatar: await avatar,
  }, renderer, document.getElementById('hud')!);
  // Exposed before the warm-up: tools that step the game themselves don't need it (and a hidden tab stalls it).
  (window as unknown as { __bandeja: Game }).__bandeja = game;
  await game.warmUp();
  game.start();
}

start().catch((err: unknown) => {
  document.body.style.color = '#fff';
  document.body.textContent = `Failed to start: ${String(err)}`;
  console.error(err);
});
