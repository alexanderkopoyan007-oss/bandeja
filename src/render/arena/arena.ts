// An arena (data/arenas.json): the floor and surround, the lights, the environment the glass and every material
// reflect, and what stands round the court (a stadium's stands and crowd, a club hall, an outdoor park).
// Everything here is built once and only reads the sim (the crowd's excitement follows the rally).
import * as THREE from 'three/webgpu';
import arenas from '../../../data/arenas.json' with { type: 'json' };
import floorLooks from '../../../data/floor-looks.json' with { type: 'json' };
import type { Court } from '../../sim/court/court.ts';
import { floorMaterial, type FloorLook } from '../turf.ts';
import type { EnvProbe } from '../courtView.ts';
import { BENCH_TOP, BENCH_Z, buildStadium } from './stadium.ts';
import { makeBench } from '../props.ts';
import { buildOutdoor } from './outdoor.ts';
import { buildHall } from './hall.ts';
import { addArenaLights } from './lights.ts';
import { arenaDetail, surfaceMaterial } from './surface.ts';

/** The environment bake: where its cube camera stands (head height over the court's middle), its planes and its size. */
const BAKE_AT = new THREE.Vector3(0, 1.6, 0);
const BAKE_NEAR = 0.1, BAKE_FAR = 400, BAKE_SIZE = 256;
/** The cube's six faces as PMREMGenerator turns its camera: [up, the way it looks]. */
const CUBE_FACES: Array<[[number, number, number], [number, number, number]]> = [
  [[0, 1, 0], [1, 0, 0]], [[0, 0, 1], [0, -1, 0]], [[0, 1, 0], [0, 0, 1]],
  [[0, 1, 0], [-1, 0, 0]], [[0, 0, -1], [0, 1, 0]], [[0, 1, 0], [0, 0, -1]],
];

export interface LightDef {
  env: number;
  key: { color: string; intensity: number; dir: number[]; shadow: boolean; radius: number };
  hemi: { sky: string; ground: string; intensity: number };
  floods?: { intensity: number; angle: number; penumbra: number; decay: number; shadow: number };
}

export interface ArenaDef {
  name: string;
  /** The broadcast camera's climb (m) at the middle of the change-of-ends swing (default 0). */
  camera?: { swingRise?: number };
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
  stands?: { rows: number; rise: number; depth: number; from: number; fill: number; seat: string; riser: string; light: number; crowdLight: number };
  hall?: {
    x: number; z: number; height: number; wall: string; roof: string; open?: boolean;
    /** The stadium's: the roof's own light, the lamps' brightness (over white), the high band and the trusses' colours. */
    roofGlow?: number; lamps?: number; windows?: string; steel?: string;
  };
  sky?: { zenith: string; horizon: string; ground: string; sunDir: number[]; sun: string };
  trees?: { count: number; inner: number; outer: number; height: number[] };
  poles?: { height: number; heads: number; color: string; lit?: boolean; color2?: string };
  /** Other courts beside ours (their centres along x, m): empty, static, lit like ours. */
  neighbours?: number[];
  light: LightDef;
  post?: { bloom?: { strength: number; radius: number; threshold: number } };
}

export const ARENA_KEYS = Object.keys(arenas).filter((k) => !k.startsWith('/'));

export function arenaDef(key: string, floor?: string): ArenaDef {
  const d = (arenas as unknown as Record<string, ArenaDef>)[key] ?? (arenas as unknown as Record<string, ArenaDef>)['stadium']!;
  // Played on another floor than the arena's (?floor=): that floor's look over the arena's (data/floor-looks.json).
  const o = floor ? (floorLooks as unknown as Record<string, Partial<FloorLook>>)[floor] : undefined;
  return o && Object.keys(o).length > 0 ? { ...d, floor: { ...d.floor, ...o } } : d;
}

/** The crowd's state (game/crowdMood.ts): the rally's tension, and after a point the applause and the standing. */
export interface CrowdState {
  /** 0 calm .. 1 a long rally. */
  excite: number;
  /** Share clapping, 0..1. */
  applause: number;
  /** Share of those who would stand who are on their feet, 0..1. */
  ovation: number;
}

/** What a kind-specific builder hands back: things to animate, and lights it added. */
export interface ArenaPart {
  update?(time: number, mood: CrowdState, cam?: THREE.Vector3): void;
  /** The sky texture the scenery's materials use as their own envMap (filtered before the bake: see there). */
  sky?: THREE.Texture;
}

export class Arena {
  readonly group = new THREE.Group();
  readonly def: ArenaDef;
  /** The key light, or (the detail pass, indoors) the two it comes from: they cast the shadows. */
  readonly keys: THREE.DirectionalLight[];
  /** The courtside benches' seats (the middle of each top), outside the side glass by the net: the bags go there. */
  readonly benches: THREE.Vector3[] = [];
  private readonly parts: ArenaPart[] = [];
  /** The crowd follows the rally (game.ts sets it each frame). */
  readonly mood: CrowdState = { excite: 0, applause: 0, ovation: 0 };
  /** The baked environment and filtered skies (not in the scene graph): freed by dispose(). */
  private readonly baked: Array<{ dispose(): void }> = [];

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
    const rig = def.kind === 'stadium';
    plane(cd.width, cd.length, floorMaterial(def.floor, look, 0, rig), 0);
    plane(cd.width + 0.7, cd.length + 0.7, floorMaterial({ ...def.floor, color: def.rim, line: null }, null, 0, rig), -0.002);
    plane(def.surround.x * 2, def.surround.z * 2, floorMaterial(def.surround, null, 0, rig), -0.004);
    // (the detail pass: the hall's floor beyond the surround is sealed concrete, surface.ts)
    const hf = arenaDetail.on && def.kind !== 'outdoor' ? surfaceMaterial({ set: 'concrete', color: def.hallFloor, tile: 3 }) : new THREE.MeshStandardMaterial({ color: def.hallFloor, roughness: 0.9 });
    plane(400, 400, hf, -0.006);

    // Lights: a key light (the sun, or the roof's main lights) for the shadows, a hemisphere fill; the rest of the
    // light, and every reflection, comes from the environment map baked from the arena itself (bakeEnvironment).
    this.keys = addArenaLights(this.group, def.light, arenaDetail.on && def.kind === 'stadium');

    if (def.kind === 'stadium') this.parts.push(buildStadium(this.group, def, court));
    else if (def.kind === 'hall') this.parts.push(buildHall(this.group, def, court));
    else this.parts.push(buildOutdoor(this.group, def, court, scene));
    // The benches by the net outside the side glass: the stadium's padded with a backrest, a club's or a hall's
    // slatted wood (render/props.ts).
    const bx = court.halfW + (def.kind === 'stadium' ? 1.6 : 1.3);
    for (const z of BENCH_Z) {
      this.benches.push(new THREE.Vector3(-bx, BENCH_TOP, z));
      const b = makeBench(def.kind === 'stadium' ? 'stadium' : 'club', BENCH_TOP, def.kind === 'stadium' ? 2.2 : 2.0);
      b.position.set(-bx, 0, z);
      this.group.add(b);
    }
  }

  /**
   * Render the arena round the court into a filtered cube map and use it for every material's ambient light and
   * reflections (the glass shows the stands, the roof lights, the sky). Done once, before the first frame.
   */
  /** Free the baked environment (the arena's meshes go with the scene: render/dispose.ts). */
  dispose(): void {
    for (const b of this.baked) b.dispose();
    this.baked.length = 0;
  }

  bakeEnvironment(renderer: THREE.WebGPURenderer, scene: THREE.Scene, hide: THREE.Object3D[]): EnvProbe {
    const b = this.bakeBegin(renderer, hide);
    return this.bakeEnd(scene, hide, b, null);
  }

  /**
   * bakeEnvironment, its shaders first built by `compile` into the very target the bake draws into, through `camera` (a
   * cube face's; `whole`: the scene in one call, not in pieces): asynchronously (Game.bake), so the bake itself builds none. On a slow laptop the bake
   * was a second of the main thread in one piece, its 36 shaders built as it drew.
   */
  async bakeEnvironmentAsync(renderer: THREE.WebGPURenderer, scene: THREE.Scene, hide: THREE.Object3D[],
    compile: (camera: THREE.PerspectiveCamera, whole: boolean) => Promise<unknown>): Promise<EnvProbe> {
    const b = this.bakeBegin(renderer, hide);
    // (PMREMGenerator's own target, made as fromScene makes it: three keeps a shader's build per target)
    const pm = b.pmrem as unknown as { _setSize?(n: number): void; _allocateTarget?(depth: boolean): THREE.RenderTarget };
    let rt: THREE.RenderTarget | null = null;
    if (pm._setSize && pm._allocateTarget) {
      pm._setSize(BAKE_SIZE);
      rt = pm._allocateTarget(true);
      const cam = new THREE.PerspectiveCamera(90, 1, BAKE_NEAR, BAKE_FAR);
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(rt);
      try {
        // (through each of the cube's faces, as fromScene turns its camera: a compile leaves out what its camera can't see;
        // after the first, the whole scene in one call, which finds most of it built: every object a compile visits costs
        // a turn of the main thread, built or not)
        for (let k = 0; k < CUBE_FACES.length; k++) {
          const [up, at] = CUBE_FACES[k]!;
          cam.position.copy(BAKE_AT);
          cam.up.set(up[0], up[1], up[2]);
          cam.lookAt(BAKE_AT.x + at[0], BAKE_AT.y + at[1], BAKE_AT.z + at[2]);
          cam.updateMatrixWorld();
          await compile(cam, k > 0);
        }
      } finally {
        renderer.setRenderTarget(prev);
      }
    }
    return this.bakeEnd(scene, hide, b, rt);
  }

  private bakeBegin(renderer: THREE.WebGPURenderer, hide: THREE.Object3D[]): { pmrem: THREE.PMREMGenerator; was: boolean[] } {
    const was = hide.map((o) => o.visible);
    for (const o of hide) o.visible = false;
    const pmrem = new THREE.PMREMGenerator(renderer);
    // Materials lit by the sky alone (scenery) get the sky filtered now: left to filter itself lazily, it did so in
    // the middle of the bake below and formed a framebuffer feedback loop (WebGL: everything black).
    for (const part of this.parts) {
      const sky = part.sky;
      if (!sky) continue;
      const frt = pmrem.fromEquirectangular(sky);
      this.baked.push(frt);
      const filtered = frt.texture;
      this.group.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (m && m.envMap === sky) m.envMap = filtered;
      });
    }
    return { pmrem, was };
  }

  private bakeEnd(scene: THREE.Scene, hide: THREE.Object3D[], b: { pmrem: THREE.PMREMGenerator; was: boolean[] }, target: THREE.RenderTarget | null): EnvProbe {
    const rt = b.pmrem.fromScene(scene, 0.02, BAKE_NEAR, BAKE_FAR, { size: BAKE_SIZE, position: BAKE_AT, renderTarget: target });
    this.baked.push(rt);
    hide.forEach((o, i) => { o.visible = b.was[i]!; });
    b.pmrem.dispose();
    scene.environment = rt.texture;
    scene.environmentIntensity = this.def.light.env;
    // The box reflections are projected onto: the hall's walls and roof, or round an outdoor club its fence line out
    // to the trees.
    const h = this.def.hall;
    const half = h ? new THREE.Vector3(h.x, h.height + 2, h.z) : new THREE.Vector3(40, 25, 45);
    return { texture: rt.texture, at: BAKE_AT.clone(), min: new THREE.Vector3(-half.x, -0.05, -half.z), max: half, intensity: this.def.light.env };
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

  /** Each frame: `cam` is the camera's position (parts may skip what is behind it). */
  update(time: number, cam?: THREE.Vector3): void {
    for (const p of this.parts) p.update?.(time, this.mood, cam);
  }
}
