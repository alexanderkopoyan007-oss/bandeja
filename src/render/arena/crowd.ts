// The stadium's crowd: MakeHuman spectators (tools/assets/crowd/, CC0 assets) drawn as sprites. Each seat is one
// quad that turns to face the camera and shows the frame rendered from the nearest of 7 angles round the person's
// front (mirrored for half the seats), seated, clapping or on their feet as the rally's excitement rises; each seat
// tints its own shirt (the atlas keeps the light on the shirt apart from the rest: B + tint x light). Two triangles
// a person, one draw call a stand.
import * as THREE from 'three/webgpu';
import {
  attribute, cameraPosition, texture, uv, vec2, vec3, vec4, float, floor, fract, abs, atan, clamp, round, select, sin,
  cos, time, hash, instanceIndex, uniform, varying, positionLocal, PI,
} from 'three/tsl';
import layout from '../../../data/crowd-atlas.json' with { type: 'json' };

/** A spectator's place: their seat (x, z), the floor of their row (y, where their feet are), the way they face. */
export interface Spectator {
  x: number;
  y: number;
  z: number;
  /** Facing (sin yaw, cos yaw), three's rotation.y. */
  yaw: number;
}

/** Seat surface above the row's floor (stadium.ts seats are 0.42 m boxes) plus the hips' joint above it. */
const HIPS_ON_SEAT = 0.52;
/** Beyond this angle from their front (radians) a spectator is seen from behind, which the renders don't cover. */
const BEHIND = 1.85;
/** The share of the crowd that stands for the biggest moments (the rest clap seated). */
const STANDERS = 0.55;
/** A spectator on their feet stands this far in front of the seat. */
const STAND_FORWARD = 0.25;

// What a crowd wears, by share (arena-wide-2: mostly dark and neutral, a few bright tops; a uniform rainbow read as
// toys): black and charcoal, navy, white, greys, denim, then the colours. sRGB; tints are applied in linear light.
const SHIRT = [
  0x141414, 0x1e1f22, 0x26282c, 0x141414, 0x2a2d33, 0x1a2340, 0x1d2a55, 0x22304f, 0xe9e9e6, 0xd9dad6, 0xf2f2ef,
  0x6d7077, 0x8b8e94, 0x55585e, 0x3f5878, 0x4a6488, 0xb33a32, 0x2f6fd1, 0x3c6b4a, 0xd8c9a8, 0x7a3346, 0xe0b23a,
];

export interface CrowdLook {
  /** The crowd's brightness (the stands are lit far less than the court). */
  light: number;
  /** One shirt for all (sRGB), instead of the crowd's mix: the umpire's. */
  shirt?: number;
}

/**
 * Build the crowd for each stand (one instanced mesh each, so a stand behind the camera can be hidden). `mood`:
 * (the rally's tension 0..1, the share clapping 0..1, the share of would-be standers on their feet 0..1; arena.ts
 * CrowdState); `rnd` the seat-by-seat variety.
 */
export function buildCrowd(stands: Spectator[][], mood: THREE.UniformNode<'vec3', THREE.Vector3>, rnd: () => number, look: CrowdLook): THREE.InstancedMesh[] {
  const base = loadAtlas('assets/crowd/base.webp', THREE.SRGBColorSpace);
  const shirt = loadAtlas('assets/crowd/shirt.webp', THREE.NoColorSpace);
  const L = layout as unknown as { cell: number[]; cols: number; rows: number; size: number[]; views: number[]; poses: string[]; people: { seat: number }[] };
  const nViews = L.views.length, nPoses = L.poses.length, nPeople = L.people.length;
  const viewStep = ((L.views[1]! - L.views[0]!) * Math.PI) / 180;
  const W = L.size[0]!, H = L.size[1]!;

  // Per seat: where (x, floor y, z, yaw), who (person, scale, how far below the floor the sprite's bottom sits
  // seated, mirrored), and the shirt's tint (linear).
  const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  mat.alphaTest = 0.45;
  mat.toneMapped = true;
  const meshes: THREE.InstancedMesh[] = [];
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.translate(0, 0.5, 0);
  const c = new THREE.Color();
  const lightU = uniform(look.light);
  for (const list of stands) {
    const n = list.length;
    const where = new Float32Array(n * 4), who = new Float32Array(n * 4), tint = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const s = list[i]!;
      where.set([s.x, s.y, s.z, s.yaw], i * 4);
      const person = Math.floor(rnd() * nPeople);
      const scale = 0.96 + rnd() * 0.08;
      const drop = (L.people[person]!.seat - HIPS_ON_SEAT) * scale;
      who.set([person, scale, drop, rnd() < 0.5 ? 1 : -1], i * 4);
      c.setHex(look.shirt ?? SHIRT[Math.floor(rnd() * SHIRT.length)]!, THREE.SRGBColorSpace).offsetHSL(0, -0.05, (rnd() - 0.6) * 0.06);
      tint.set([c.r, c.g, c.b], i * 3);
    }
    const g = geo.clone();
    // Attribute names become WGSL identifiers: a reserved word ('where' was the first name here) fails the
    // pipeline on WebGPU alone, and the game never starts (tests/render/attributeNames.test.ts).
    g.setAttribute('seatAt', new THREE.InstancedBufferAttribute(where, 4));
    g.setAttribute('seatWho', new THREE.InstancedBufferAttribute(who, 4));
    g.setAttribute('shirtTint', new THREE.InstancedBufferAttribute(tint, 3));
    const im = new THREE.InstancedMesh(g, mat, n);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < n; i++) im.setMatrixAt(i, m4.makeTranslation(list[i]!.x, list[i]!.y, list[i]!.z));
    im.computeBoundingSphere();
    im.castShadow = false;
    im.receiveShadow = false;
    meshes.push(im);
  }

  // ---- vertex: turn to the camera, pick the pose and the angle --------------------------------------------------
  const where = attribute<'vec4'>('seatAt');
  const who = attribute<'vec4'>('seatWho');
  const person = who.x, scale = who.y, drop = who.z, mirror = who.w;
  const toCam = cameraPosition.xz.sub(where.xz);
  const b = atan(toCam.x, toCam.y); // the camera's bearing from the seat, as a yaw
  // The camera's angle from the person's front, towards their left positive (the renders' view angles), mirrored.
  const rel0 = b.sub(where.w);
  const relW = rel0.sub(floor(rel0.add(PI).div(PI.mul(2))).mul(PI.mul(2)));
  const rel = relW.mul(mirror);
  // Seen from behind (the stand under a camera that looks over it): there is no back view; not drawn.
  const shown = select(abs(relW).greaterThan(BEHIND), float(0), float(1));
  const view = clamp(round(rel.div(viewStep)).add((nViews - 1) / 2), 0, nViews - 1);
  // Pose by the crowd's mood, seat by seat: quiet through the point, clapping after it, up to STANDERS of them on
  // their feet at the big moments.
  const h1 = hash(instanceIndex.add(11)), h2 = hash(instanceIndex.add(29)), h3 = hash(instanceIndex.add(47));
  const excite = mood.x;
  const standing = h1.lessThan(mood.z.mul(STANDERS));
  const clapping = h2.lessThan(mood.y);
  const beat = fract(time.mul(float(2.6).add(h3.mul(1.4))).add(h3)).lessThan(0.5);
  const pose = select(standing, float(3), select(clapping, select(beat, float(1), float(2)), float(0)));
  const cell = person.mul(nPoses).add(pose).mul(nViews).add(view);
  const row = floor(cell.div(L.cols));
  const col = cell.sub(row.mul(L.cols));
  // The quad: W x H metres times the seat's scale, its bottom on the row's floor (seated: lowered so the hips sit on
  // the seat), turned to face the camera; a standing spectator a step in front of the seat.
  const right = vec3(cos(b), 0, sin(b).negate());
  const fwd = vec3(sin(where.w), 0, cos(where.w));
  const lift = select(standing, float(0), drop.negate());
  const size = scale.mul(shown);
  const ahead = select(standing, float(STAND_FORWARD), float(0));
  // (three applies the instance matrix, the seat's translation, before positionNode: take the quad's corner back out)
  const q = positionLocal.sub(where.xyz);
  mat.positionNode = where.xyz.add(right.mul(q.x.mul(W).mul(size)))
    .add(vec3(0, q.y.mul(H).mul(size).add(lift.mul(shown)), 0))
    .add(fwd.mul(ahead))
    // A little sway, more in a long rally (leaning to follow it), and a bounce on their feet.
    .add(vec3(sin(time.mul(float(1.3).add(h3.mul(0.9))).add(h1.mul(6.28))).mul(float(0.012).add(excite.mul(0.02))),
      sin(time.mul(5.2).add(h2.mul(6.28))).mul(select(standing, float(0.04), float(0))), 0));
  // Atlas coordinates (the image's top row is v = 1): the quad's u mirrored for mirrored seats.
  const u = select(mirror.lessThan(0), float(1).sub(uv().x), uv().x);
  const auv = varying(vec2(col.add(u).div(L.cols), float(1).sub(row.add(float(1).sub(uv().y)).div(L.rows))));
  const tintV = varying(attribute<'vec3'>('shirtTint'));

  // ---- fragment: the person, their shirt tinted -------------------------------------------------------------------
  const px = texture(base, auv);
  const li = texture(shirt, auv).x;
  const shirtLight = li.mul(li).mul(2);
  mat.colorNode = vec4(px.rgb.add(tintV.mul(shirtLight)).mul(lightU), 1);
  mat.opacityNode = px.a;
  return meshes;
}

const atlases = new Map<string, THREE.Texture>();

function loadAtlas(path: string, space: THREE.ColorSpace): THREE.Texture {
  const had = atlases.get(path);
  if (had) return had;
  const t = new THREE.TextureLoader().load(new URL(path, document.baseURI).href, undefined, undefined, (err) => {
    console.warn('crowd atlas failed to load:', path, err);
  });
  t.colorSpace = space;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  atlases.set(path, t);
  return t;
}
