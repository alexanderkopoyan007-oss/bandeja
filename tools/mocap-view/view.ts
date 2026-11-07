// Dev only: a converted capture (tools/assets/mocap/retarget.py -> public/assets/mocap-local/<clip>.json) played on a
// body, alone on a floor, the camera round it. Not in the game's build.
//   http://localhost:5190/tools/mocap-view/?clip=test[&who=p3mh][&t=2.5 frozen at a time][&az=deg][&speed=0.5]
import * as THREE from 'three/webgpu';
import { loadPlayerAsset } from '../../src/render/avatar/asset.ts';
import { Avatar } from '../../src/render/avatar/avatar.ts';

const q = new URLSearchParams(location.search);
const clipName = q.get('clip') ?? 'test';
const who = q.get('who');
const frozen = q.has('t') ? Number(q.get('t')) : null;
const speed = Number(q.get('speed') ?? 1);
const az0 = Number(q.get('az') ?? 30) * Math.PI / 180;

const renderer = new THREE.WebGPURenderer({ antialias: true });
await renderer.init();
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1d2026);
const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.05, 100);
scene.add(new THREE.HemisphereLight(0xdfe6f0, 0x2a2622, 0.9));
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(2, 5, 3);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3 });
scene.add(key);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshStandardMaterial({ color: 0x3a4a3c, roughness: 0.95 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
scene.add(new THREE.GridHelper(12, 24, 0x5a6a5c, 0x4a5a4c));

const base = await loadPlayerAsset('/assets/player.bnz', undefined, who ? [who] : []);
const person = who ? base.people.find((p) => p.look!.name === who) ?? base : base;
const av = new Avatar(person, 0xb8bcc4);
scene.add(av.root);
const bones = (av as unknown as { bones: THREE.Bone[] }).bones;
const clip = await (await fetch(`/assets/mocap-local/${clipName}.json`)).json() as { name: string; fps: number; frames: number; bones: string[]; quat: number[]; hips: number[] };
const order = clip.bones.map((n) => bones.findIndex((b) => b.name === n));
if (order.some((i) => i < 0)) throw new Error('clip bones not on this skeleton');
const NB = clip.bones.length;
const info = document.getElementById('info')!;
const t0 = performance.now();

function pose(t: number): void {
  const f = Math.min(clip.frames - 1, Math.max(0, Math.floor(t * clip.fps)));
  for (let i = 0; i < NB; i++) bones[order[i]!]!.quaternion.fromArray(clip.quat, (f * NB + i) * 4);
  bones[order[0]!]!.position.fromArray(clip.hips, f * 3);
  info.textContent = `${clip.name} on ${who ?? 'mannequin'}: frame ${f + 1}/${clip.frames} (${(f / clip.fps).toFixed(2)} s)`;
}

renderer.setAnimationLoop(() => {
  const dur = clip.frames / clip.fps;
  const t = frozen ?? (((performance.now() - t0) / 1000) * speed) % dur;
  pose(t);
  const az = frozen === null ? az0 + (performance.now() - t0) / 1000 * 0.25 : az0;
  const hx = bones[order[0]!]!.position.x, hz = bones[order[0]!]!.position.z;
  camera.position.set(hx + Math.sin(az) * 4.2, 1.3, hz + Math.cos(az) * 4.2);
  camera.lookAt(hx, 0.95, hz);
  renderer.render(scene, camera);
});
