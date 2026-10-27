import * as THREE from 'three/webgpu';
import { Game } from './game/game.ts';
import { MODE_ADVANTAGE, MODE_GOLDEN, MODE_STAR, FINAL_NORMAL } from './sim/rules/score.ts';
import type { FloorName } from './sim/setup.ts';

const params = new URLSearchParams(location.search);
const num = (k: string, d: number): number => {
  const v = params.get(k);
  return v === null || Number.isNaN(Number(v)) ? d : Number(v);
};

async function start(): Promise<void> {
  const autoplay = params.get('autoplay') === '1';
  const mode = params.get('scoring');
  const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: params.get('backend') === 'webgl' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, num('dpr', 2)));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.AgXToneMapping;
  document.body.appendChild(renderer.domElement);
  await renderer.init();

  const game = new Game({
    match: {
      seed: num('seed', (Math.random() * 2 ** 31) | 0),
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
      human: autoplay ? [false, false] : [true, false],
      aiLevel: [num('ai', 0.55), num('ai', 0.55)],
      // Defaults are forgiving; ?timing=1 is the strict "pro" window, ?autotime=1 fires a held swing for you.
      timingScale: num('timing', 1.5),
      assist: num('assist', 0.45),
      autoTiming: params.get('autotime') === '1',
      firstServer: num('server', 0),
    },
    humanTeam: 0,
    autoplay,
    forceWebGL: params.get('backend') === 'webgl',
    pro: params.get('pro') === '1',
    mouseAim: params.get('aim') === 'mouse',
  }, renderer, document.getElementById('hud')!);
  await game.warmUp();
  game.start();
  (window as unknown as { __bandeja: Game }).__bandeja = game;
}

start().catch((err: unknown) => {
  document.body.style.color = '#fff';
  document.body.textContent = `Failed to start: ${String(err)}`;
  console.error(err);
});
