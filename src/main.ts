import * as THREE from 'three/webgpu';
import { Court, type CourtDef } from './sim/court/court.ts';
import { buildCourtView } from './render/courtView.ts';
import standard from '../data/courts/standard.json' with { type: 'json' };
import panoramic from '../data/courts/panoramic.json' with { type: 'json' };
import singles from '../data/courts/singles-narrow.json' with { type: 'json' };

const COURTS: Record<string, CourtDef> = {
  standard: standard as CourtDef,
  panoramic: panoramic as CourtDef,
  'singles-narrow': singles as CourtDef,
};

async function start(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const court = new Court(COURTS[params.get('court') ?? 'standard'] ?? COURTS.standard!);

  const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: params.get('backend') === 'webgl' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = THREE.AgXToneMapping;
  document.body.appendChild(renderer.domElement);
  await renderer.init();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d0f12);
  scene.add(new THREE.HemisphereLight(0xdfe8f0, 0x30343a, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(6, 14, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 40 });
  scene.add(sun);
  scene.add(buildCourtView(court));

  // Broadcast view: high behind the near back glass.
  const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 200);
  camera.position.set(0, 6.4, court.halfL + 9.5);
  camera.lookAt(0, 0.4, -1.5);

  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  });

  const hud = document.getElementById('hud')!;
  hud.textContent = `BANDEJA (M0 placeholder): ${court.def.name}. Backend: ${
    (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL2'
  }`;
  hud.style.padding = '10px 12px';

  renderer.setAnimationLoop(() => renderer.render(scene, camera));
}

start().catch((err: unknown) => {
  document.body.textContent = `Failed to start: ${String(err)}`;
});
