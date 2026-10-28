// An arena (data/arenas.json): the floor and surround, the lights, the environment the glass and every material
// reflect, and what stands round the court (a stadium's stands and crowd, a club hall, an outdoor park).
// Everything here is built once and only reads the sim (the crowd's excitement follows the rally).
import * as THREE from 'three/webgpu';
import arenas from '../../../data/arenas.json' with { type: 'json' };
import type { Court } from '../../sim/court/court.ts';
import { floorMaterial, type FloorLook } from '../turf.ts';
import type { EnvProbe } from '../courtView.ts';
import { buildStadium } from './stadium.ts';
import { buildOutdoor } from './outdoor.ts';
import { buildHall } from './hall.ts';

export interface LightDef {
  env: number;
  key: { color: string; intensity: number; dir: number[]; shadow: boolean; radius: number };
  hemi: { sky: string; ground: string; intensity: number };
  floods?: { intensity: number; angle: number; penumbra: number; decay: number; shadow: number };
}

export interface ArenaDef {
  name: string;
  kind: 'stadium' | 'hall' | 'outdoor';
  exposure: number;
  background: string;
  floor: FloorLook;
  surround: FloorLook & { x: number; z: number };
  rim: string;
  hallFloor: string;
  frame: string;
  base: string;
  boards?: { x: number; z: number; height: number; color: string };
  stands?: { rows: number; rise: number; depth: number; from: number; fill: number; seat: string; riser: string };
  hall?: { x: number; z: number; height: number; wall: string; roof: string; open?: boolean };
  sky?: { zenith: string; horizon: string; ground: string; sunDir: number[]; sun: string };
  trees?: { count: number; inner: number; outer: number; height: number[] };
  poles?: { height: number; heads: number; color: string; lit?: boolean; color2?: string };
  /** Other courts beside ours (their centres along x, m): empty, static, lit like ours. */
  neighbours?: number[];
  light: LightDef;
}

export const ARENA_KEYS = Object.keys(arenas).filter((k) => !k.startsWith('/'));

export function arenaDef(key: string): ArenaDef {
  const d = (arenas as unknown as Record<string, ArenaDef>)[key];
  return d ?? (arenas as unknown as Record<string, ArenaDef>)['stadium']!;
}

/** What a kind-specific builder hands back: things to animate, and lights it added. */
export interface ArenaPart {
  update?(time: number, excite: number): void;
  /** The sky texture the scenery's materials use as their own envMap (filtered before the bake: see there). */
  sky?: THREE.Texture;
}

export class Arena {
  readonly group = new THREE.Group();
  readonly def: ArenaDef;
  readonly key: THREE.DirectionalLight;
  private readonly parts: ArenaPart[] = [];
  /** 0 calm .. 1 on its feet: the crowd (and later the sound) follow the rally. */
  excite = 0;

  constructor(def: ArenaDef, court: Court, scene: THREE.Scene, renderer: THREE.WebGPURenderer) {
    this.def = def;
    this.group.name = 'arena';
    scene.add(this.group);
    scene.background = new THREE.Color(def.background);
    renderer.toneMappingExposure = def.exposure;

    // Floor: the court (with its lines), the rim just outside the glass, the surround, the hall's floor.
    const { halfW, halfL, def: cd } = court;
    const look = { halfW, halfL, serviceZ: cd.serviceLineFromNet, centreExt: cd.centreLineExtension, lineW: cd.lineWidth };
    const plane = (w: number, l: number, mat: THREE.Material, y: number, shadow = true): THREE.Mesh => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.y = y;
      m.receiveShadow = shadow;
      this.group.add(m);
      return m;
    };
    plane(cd.width, cd.length, floorMaterial(def.floor, look), 0);
    plane(cd.width + 0.7, cd.length + 0.7, floorMaterial({ ...def.floor, color: def.rim, line: null }, null), -0.002);
    plane(def.surround.x * 2, def.surround.z * 2, floorMaterial(def.surround, null), -0.004);
    const hf = new THREE.MeshStandardMaterial({ color: def.hallFloor, roughness: 0.9 });
    plane(400, 400, hf, -0.006);

    // Lights: a key light (the sun, or the roof's main lights) for the shadows, a hemisphere fill; the rest of the
    // light, and every reflection, comes from the environment map baked from the arena itself (bakeEnvironment).
    const L = def.light;
    const hemi = new THREE.HemisphereLight(L.hemi.sky, L.hemi.ground, L.hemi.intensity);
    this.group.add(hemi);
    this.key = new THREE.DirectionalLight(L.key.color, L.key.intensity);
    const kd = new THREE.Vector3().fromArray(L.key.dir).normalize();
    this.key.position.copy(kd).multiplyScalar(30);
    this.key.castShadow = L.key.shadow && L.key.intensity > 0;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.02;
    this.key.shadow.radius = L.key.radius;
    Object.assign(this.key.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 2, far: 70 });
    this.group.add(this.key);
    this.group.add(this.key.target);

    if (def.kind === 'stadium') this.parts.push(buildStadium(this.group, def, court));
    else if (def.kind === 'hall') this.parts.push(buildHall(this.group, def, court));
    else this.parts.push(buildOutdoor(this.group, def, court, scene));
  }

  /**
   * Render the arena round the court into a filtered cube map and use it for every material's ambient light and
   * reflections (the glass shows the stands, the roof lights, the sky). Done once, before the first frame.
   */
  bakeEnvironment(renderer: THREE.WebGPURenderer, scene: THREE.Scene, hide: THREE.Object3D[]): EnvProbe {
    const was = hide.map((o) => o.visible);
    for (const o of hide) o.visible = false;
    const pmrem = new THREE.PMREMGenerator(renderer);
    // Materials lit by the sky alone (scenery) get the sky filtered now: left to filter itself lazily, it did so in
    // the middle of the bake below and formed a framebuffer feedback loop (WebGL: everything black).
    for (const part of this.parts) {
      const sky = part.sky;
      if (!sky) continue;
      const filtered = pmrem.fromEquirectangular(sky).texture;
      this.group.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (m && m.envMap === sky) m.envMap = filtered;
      });
    }
    const at = new THREE.Vector3(0, 1.6, 0);
    const rt = pmrem.fromScene(scene, 0.02, 0.1, 400, { size: 256, position: at });
    hide.forEach((o, i) => { o.visible = was[i]!; });
    pmrem.dispose();
    scene.environment = rt.texture;
    scene.environmentIntensity = this.def.light.env;
    // The box reflections are projected onto: the hall's walls and roof, or round an outdoor club its fence line out
    // to the trees.
    const h = this.def.hall;
    const half = h ? new THREE.Vector3(h.x, h.height + 2, h.z) : new THREE.Vector3(40, 25, 45);
    return { texture: rt.texture, at, min: new THREE.Vector3(-half.x, -0.05, -half.z), max: half, intensity: this.def.light.env };
  }

  /**
   * The courts beside ours: the same cage (shared geometry and materials), their own floor and lines, a still net.
   * Under floodlights only our court has real lights (each spot light costs on every lit pixel); a neighbour's turf
   * glows by the light it would get instead.
   */
  addNeighbours(cage: THREE.Group, court: Court): void {
    const { halfW, halfL, def: cd } = court;
    const look = { halfW, halfL, serviceZ: cd.serviceLineFromNet, centreExt: cd.centreLineExtension, lineW: cd.lineWidth };
    const night = this.def.poles?.lit === true;
    const netMat = new THREE.MeshBasicMaterial({ color: 0x15171a, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
    const tapeMat = new THREE.MeshStandardMaterial({ color: 0xf2f3f4, roughness: 0.6 });
    for (const ox of this.def.neighbours ?? []) {
      const c = cage.clone();
      c.position.x = ox;
      this.group.add(c);
      const fm = floorMaterial(this.def.floor, look, ox);
      if (night) fm.emissiveNode = (fm.colorNode as THREE.Node<'vec3'>).mul(0.55);
      const f = new THREE.Mesh(new THREE.PlaneGeometry(cd.width, cd.length), fm);
      f.rotation.x = -Math.PI / 2;
      f.position.set(ox, 0, 0);
      f.receiveShadow = true;
      this.group.add(f);
      const net = new THREE.Mesh(new THREE.PlaneGeometry(cd.width, cd.net.heightCentre - 0.05), netMat);
      net.position.set(ox, (cd.net.heightCentre - 0.05) / 2 + 0.02, 0);
      const tape = new THREE.Mesh(new THREE.BoxGeometry(cd.width, 0.05, 0.012), tapeMat);
      tape.position.set(ox, cd.net.heightCentre - 0.01, 0);
      this.group.add(net, tape);
    }
  }

  update(time: number): void {
    for (const p of this.parts) p.update?.(time, this.excite);
  }
}
