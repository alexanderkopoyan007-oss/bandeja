// An arena (data/arenas.json): the floor and surround, the lights, the environment the glass and every material
// reflect, and what stands round the court (a stadium's stands and crowd, a club hall, an outdoor park).
// Everything here is built once and only reads the sim (the crowd's excitement follows the rally).
import * as THREE from 'three/webgpu';
import { cameraPosition, dot, fog, mix, positionView, positionWorld, vec3 } from 'three/tsl';
import arenas from '../../../data/arenas.json' with { type: 'json' };
import floorLooks from '../../../data/floor-looks.json' with { type: 'json' };
import type { Court } from '../../sim/court/court.ts';
import { floorMaterial, type FloorLook } from '../turf.ts';
import { meshShade, FENCE_CELL, FENCE_WIRE } from '../meshShade.ts';
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
  /** The glass's reflections of the baked environment; `env` when absent. A level `env` raises past 1 to lift the shade
   *  (the golden club's 3.2) is a fudge on the ambient only: a mirror shows the scene as it is, and at 3.2 the glass laid a
   *  pale haze over everything seen through it. */
  reflect?: number;
  key: { color: string; intensity: number; dir: number[]; shadow: boolean; radius: number;
    /** The shadow camera's half width and half height (m; default 14, 14): fitted to the court as the light sees it. */
    frustum?: number[] };
  hemi: { sky: string; ground: string; intensity: number };
  floods?: { intensity: number; angle: number; penumbra: number; decay: number; shadow: number };
  /** The TV floods along the long sides, on the players only (lights.ts `gantry`), in the key's colour. */
  gantry?: { intensity: number };
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
  /** A photographed sky (render/arena/golden.ts) in place of the drawn one; `light.key` is its sun. */
  hdri?: import('./golden.ts').HdriDef;
  /** Palms and an impostor wood close round the court (render/arena/grove.ts), instead of `trees`. */
  grove?: import('./grove.ts').GroveDef;
  /** The cage's wire mesh in the sun on the floor (render/meshShade.ts; with the key's shadow on). */
  meshShadow?: boolean;
  /** Haze over distance: its colour (sRGB), none nearer than `near` m, `amount` (0..1) at `far` m and beyond. */
  haze?: { color: string; near: number; far: number; amount: number; sun?: string; glow?: number };
  /** Fallen leaves on the surround and the court (render/arena/leaves.ts). */
  leaves?: import('./leaves.ts').LeavesDef;
  trees?: { count: number; inner: number; outer: number; height: number[] };
  poles?: { height: number; heads: number; color: string; lit?: boolean; color2?: string };
  /** Other courts beside ours (their centres along x, m): empty, static, lit like ours. */
  neighbours?: number[];
  light: LightDef;
  post?: { bloom?: { strength: number; radius: number; threshold: number }; grade?: import('../post.ts').Grade };
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
  /** What it still loads (the bake waits for it). */
  ready?: Promise<void>;
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
  /** Resolves when everything the arena loads is in (a photographed sky); `pending` until then. A bake before it sees an
   * empty sky: bakeEnvironmentAsync waits for it, and whoever bakes synchronously bakes again after it (Game). */
  ready: Promise<void> = Promise.resolve();
  /** The cage's mesh in the sun as a factor on a material's received shadow (`meshShadow` arenas; `shade`). */
  private received: ((shadow: THREE.Node) => THREE.Node) | null = null;
  pending = false;

  constructor(def: ArenaDef, court: Court, scene: THREE.Scene, renderer: THREE.WebGPURenderer) {
    this.def = def;
    this.group.name = 'arena';
    scene.add(this.group);
    scene.background = new THREE.Color(def.background);
    // The air between the camera and the far trees (`haze`, the golden club): nothing up to `near`, rising to `amount` at `far`.
    if (def.haze) {
      const hz = def.haze, c = new THREE.Color(hz.color);
      const d = positionView.z.negate().sub(hz.near).div(hz.far - hz.near).clamp(0, 1);
      let col: THREE.Node<'vec3'> = vec3(c.r, c.g, c.b);
      // Air scatters forward: looking towards a low sun the haze is its warm light, away from it the sky's (`sun`, `glow`:
      // the power of the cosine to the sun, how narrow the warm glow is).
      if (hz.sun) {
        const sc = new THREE.Color(hz.sun), L = def.light.key.dir;
        const Ln = new THREE.Vector3(L[0], L[1], L[2]).normalize();
        const view = positionWorld.sub(cameraPosition).normalize();
        const toSun = dot(view, vec3(Ln.x, Ln.y, Ln.z)).max(0).pow(hz.glow ?? 4);
        col = mix(col, vec3(sc.r, sc.g, sc.b), toSun);
      }
      scene.fogNode = fog(col, d.mul(hz.amount));
    } else scene.fogNode = null;
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
    const shade = def.meshShadow ? meshShade(court, def.light.key.dir, FENCE_CELL, FENCE_WIRE) : null;
    if (shade) this.baked.push(shade.strip);
    this.received = shade?.received ?? null;
    const rs = this.received;
    plane(cd.width, cd.length, floorMaterial(def.floor, look, 0, rig, rs), 0);
    plane(cd.width + 0.7, cd.length + 0.7, floorMaterial({ ...def.floor, color: def.rim, line: null }, null, 0, rig, rs), -0.002);
    plane(def.surround.x * 2, def.surround.z * 2, floorMaterial(def.surround, null, 0, rig, rs), -0.004);
    // (the detail pass: the hall's floor beyond the surround is sealed concrete, surface.ts)
    const hf = arenaDetail.on && def.kind !== 'outdoor' ? surfaceMaterial({ set: 'concrete', color: def.hallFloor, tile: 3 }) : new THREE.MeshStandardMaterial({ color: def.hallFloor, roughness: 0.9 });
    plane(400, 400, hf, -0.006);

    // Lights: a key light (the sun, or the roof's main lights) for the shadows, a hemisphere fill; the rest of the
    // light, and every reflection, comes from the environment map baked from the arena itself (bakeEnvironment).
    this.keys = addArenaLights(this.group, def.light, arenaDetail.on && def.kind === 'stadium');

    if (def.kind === 'stadium') this.parts.push(buildStadium(this.group, def, court));
    else if (def.kind === 'hall') this.parts.push(buildHall(this.group, def, court));
    else this.parts.push(buildOutdoor(this.group, def, court, scene));
    const waits = this.parts.map((p) => p.ready).filter((r): r is Promise<void> => !!r);
    if (waits.length) {
      this.pending = true;
      this.ready = Promise.all(waits).then(() => { this.pending = false; this.shade(this.group); });
    }
    // The benches by the net outside the side glass: the stadium's padded with a backrest, a club's or a hall's
    // slatted wood (render/props.ts).
    const bx = court.halfW + (def.kind === 'stadium' ? 1.6 : 1.3);
    for (const z of BENCH_Z) {
      this.benches.push(new THREE.Vector3(-bx, BENCH_TOP, z));
      const b = makeBench(def.kind === 'stadium' ? 'stadium' : 'club', BENCH_TOP, def.kind === 'stadium' ? 2.2 : 2.0);
      b.position.set(-bx, 0, z);
      this.group.add(b);
    }
    this.shade(this.group);
  }

  /**
   * Put the cage's mesh in the sun (render/meshShade.ts) on everything under `root` that takes shadows and has no
   * received-shadow node of its own: the leaves, benches, palms and wood, and the game's bags and bottles. A leaf lying on
   * the gridded turf was otherwise brighter than the turf under it. Only materials built for this arena (all of these are
   * made per build: a material shared with other arenas must never carry this arena's strip). The players and the ball
   * have none: their materials outlive the arena.
   */
  shade(root: THREE.Object3D): void {
    const rs = this.received;
    if (!rs) return;
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.receiveShadow) return;
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        const nm = mat as THREE.NodeMaterial;
        if (nm.receivedShadowNode == null) { nm.receivedShadowNode = rs as unknown as () => THREE.Node; nm.needsUpdate = true; }
      }
    });
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
    await this.ready;
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
      // (a photographed sky, by day: the scenery lights the bake with its own sky, at the arena's level as it will be drawn
      // (or the probe saw the shade a third as bright as the frame shows it), then is lit by the bake as the court is
      // (scene.environment, at the arena's level; bakeEnd),
      // which has the sunlit ground in it. By the sky alone the shaded side of a trunk or the fence was navy: the sky's blue
      // and nothing of the green and brown round it. The drawn skies keep their own (at night the probe sees a floodlit court.)
      const byBake = !!this.def.hdri;
      this.group.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (m && m.envMap === sky) { m.envMap = filtered; if (byBake) { m.userData.byBake = true; m.envMapIntensity = this.def.light.env; } }
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
    // (the photographed sky's scenery: lit by the bake from now on, having lit the bake with its own sky; bakeBegin)
    this.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m?.userData?.byBake) { m.envMap = null; m.envMapIntensity = 1; m.needsUpdate = true; delete m.userData.byBake; }
    });
    // The box reflections are projected onto: the hall's walls and roof, or round an outdoor club its fence line out
    // to the trees.
    const h = this.def.hall;
    const half = h ? new THREE.Vector3(h.x, h.height + 2, h.z) : new THREE.Vector3(40, 25, 45);
    return { texture: rt.texture, at: BAKE_AT.clone(), min: new THREE.Vector3(-half.x, -0.05, -half.z), max: half, intensity: this.def.light.reflect ?? this.def.light.env };
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
