// The playing surface and the surround: sand-filled artificial grass (or carpet, a hard court, clay), with the
// court's lines painted in the same shader so they carry the surface's texture and light, never z-fight, and stay
// anti-aliased at any distance.
//
// What a real turf court shows from a broadcast camera (reference/photos.json; DECISIONS.md, Phase 5):
// - fibre and sand detail below a pixel at most distances: it reads as a fine mottle, not as blades;
// - the sand infill: grazing views look paler and dustier, and the worn places (where servers, receivers and net
//   players stand) show more sand;
// - the rolls the carpet was laid in: faint stripes along the court where two rolls meet;
// - lines tufted in white fibre: bright, slightly speckled, with the court's sheen.
import * as THREE from 'three/webgpu';
import {
  positionWorld, cameraPosition, texture, vec2, float, abs, fract, floor, max, mix, smoothstep, fwidth,
  saturate, normalize, exp, pow, color,
} from 'three/tsl';

export interface FloorLook {
  /** Surface: 'turf' (sand-filled), 'carpet' (textile, no sand), 'hard' (painted concrete), 'clay'. */
  kind: string;
  /** Albedo of the fibre (sRGB hex). */
  color: string;
  /** Albedo of the sand / dust showing through (sRGB hex). */
  sand: string;
  /** How much sand shows on an unworn patch, 0-1. */
  sandAmount: number;
  /** Lines' albedo (sRGB hex); null: none (the surround). */
  line: string | null;
  /** Width of the turf rolls (m) for the faint stripes; 0: none. */
  roll: number;
  roughness: number;
}

/** Seeded value noise, tileable over `n` cells. */
function valueNoise(n: number, seed: number): (x: number, y: number) => number {
  const g = new Float32Array(n * n);
  let s = seed >>> 0;
  for (let i = 0; i < g.length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    g[i] = s / 4294967296;
  }
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const at = (a: number, b: number): number => g[(((a % n) + n) % n) + (((b % n) + n) % n) * n]!;
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };
}

function dataTexture(size: number, fill: (x: number, y: number, out: number[]) => void): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const px = [0, 0, 0, 0];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      fill(x, y, px);
      const k = (y * size + x) * 4;
      for (let c = 0; c < 4; c++) data[k + c] = Math.max(0, Math.min(255, Math.round(px[c]! * 255)));
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

let detailTex: THREE.DataTexture | null = null;
let macroTex: THREE.DataTexture | null = null;

/**
 * Fine detail, one tile = DETAIL m: R the fibres' brightness (tufts in rows, the brushing's lean, gaps), G sand
 * grains, B a short-wave height for the lines' speckle.
 */
const DETAIL = 0.32;
/** Large-scale variation, one tile = MACRO m: R mottling, G patchiness of the sand. */
const MACRO = 14;

function textures(): [THREE.DataTexture, THREE.DataTexture] {
  if (!detailTex) {
    const n1 = valueNoise(64, 11), n2 = valueNoise(128, 23), n3 = valueNoise(32, 5);
    detailTex = dataTexture(512, (x, y, o) => {
      const u = x / 512, v = y / 512;
      // Tufts: stitched in rows across the roll (gauge about 1 cm), each tuft a few fibres leaning the same way.
      const row = Math.abs(((v * DETAIL) / 0.01) % 1 - 0.5) * 2;
      const tuft = n2(u * 128, v * 128) * 0.6 + n1(u * 64, v * 64) * 0.4;
      const fibre = 0.55 + 0.45 * tuft - 0.12 * row;
      const grain = n2(u * 128 + 31, v * 128 + 17);
      const sand = Math.max(0, (grain - 0.55) * 2.6) * (0.6 + 0.4 * n3(u * 32, v * 32));
      o[0] = fibre; o[1] = sand; o[2] = n1(u * 64 + 7, v * 64 + 3); o[3] = 1;
    });
    const m1 = valueNoise(16, 41), m2 = valueNoise(32, 77), m3 = valueNoise(8, 3);
    macroTex = dataTexture(256, (x, y, o) => {
      const u = x / 256, v = y / 256;
      const mot = 0.5 * m1(u * 16, v * 16) + 0.3 * m2(u * 32, v * 32) + 0.2 * m3(u * 8, v * 8);
      o[0] = mot; o[1] = m2(u * 32 + 9, v * 32 + 4); o[2] = 0; o[3] = 1;
    });
  }
  return [detailTex, macroTex!];
}

type F = THREE.Node<'float'>;

/** Where the court wears: servers and receivers behind the service lines, the net players, the walk to the net. */
function wearAt(p: THREE.Node<'vec2'>): F {
  const spot = (x: number, z: number, rx: number, rz: number): F => {
    const dx = p.x.sub(x).div(rx), dz = p.y.sub(z).div(rz);
    return exp(dx.mul(dx).add(dz.mul(dz)).negate());
  };
  let w: F = float(0);
  for (const s of [1, -1]) {
    w = w.add(spot(2.5, s * 8.6, 1.6, 1.3)).add(spot(-2.5, s * 8.6, 1.6, 1.3));
    w = w.add(spot(2.6, s * 3.0, 1.5, 1.4).mul(0.7)).add(spot(-2.6, s * 3.0, 1.5, 1.4).mul(0.7));
  }
  return saturate(w);
}

/**
 * The floor's material. `lines`: the court (service lines and the centre line, `lineW` wide) or none (the
 * surround). Court geometry in metres, world space: the floor must be drawn in court coordinates.
 */
export function floorMaterial(look: FloorLook, court: { halfW: number; halfL: number; serviceZ: number; centreExt: number; lineW: number } | null, originX = 0): THREE.MeshStandardNodeMaterial {
  const [dTex, mTex] = textures();
  const m = new THREE.MeshStandardNodeMaterial();
  // Court coordinates (a neighbour court stands originX along x).
  const p = positionWorld.xz.sub(vec2(originX, 0));
  const d = texture(dTex, p.div(DETAIL));
  const mac = texture(mTex, p.div(MACRO));
  const view = normalize(cameraPosition.sub(positionWorld));
  // 1 looking straight down, 0 along the surface.
  const up = saturate(view.y);
  const graze = pow(float(1).sub(up), 3);

  const turf = look.kind === 'turf' || look.kind === 'carpet';
  const base = color(new THREE.Color(look.color));
  const sandC = color(new THREE.Color(look.sand));
  let col: THREE.Node<'vec3'> = base.mul(float(0.84).add(d.r.mul(turf ? 0.32 : 0.12))).mul(float(0.95).add(mac.r.mul(0.1)));
  if (look.roll > 0) {
    // Rolls laid along the court: a faint shade change from roll to roll, and a darker seam where two meet.
    const r = p.x.div(look.roll);
    const which = fract(floor(r).mul(0.618));
    const seam = float(1).sub(smoothstep(0, fwidth(r).mul(1.5).add(0.004), abs(fract(r).sub(0.5)).mul(-1).add(0.5)));
    col = col.mul(float(0.975).add(which.mul(0.05))).mul(float(1).sub(seam.mul(0.12)));
  }
  // Sand: a little everywhere, more where it wears and in patches; seen at a grazing angle the fibre tips hide
  // the colour and the sand on them shows (the paler far court in every reference photo).
  const wear = court ? wearAt(p) : float(0);
  const sandShow = saturate(
    float(look.sandAmount).mul(d.g.add(0.35)).mul(float(0.7).add(mac.g.mul(0.6)))
      .add(wear.mul(look.sandAmount * 0.9))
      .add(graze.mul(look.sandAmount * 0.8)),
  );
  col = mix(col, sandC, sandShow.mul(0.55));

  if (court && look.line) {
    // Lines: the two service lines across, the centre line between them (20 cm past each); anti-aliased by the
    // pixel's footprint, fading to their average coverage where a line is thinner than a pixel.
    const hw = court.lineW / 2;
    const ax = abs(p.x), az = abs(p.y);
    const fw = max(fwidth(p.x), fwidth(p.y)).add(1e-5);
    const band = (dist: F): F => float(1).sub(smoothstep(float(hw).sub(fw), float(hw).add(fw), dist));
    const service = band(abs(az.sub(court.serviceZ))).mul(float(1).sub(smoothstep(court.halfW - 0.002, court.halfW, ax)));
    const centre = band(ax).mul(float(1).sub(smoothstep(court.serviceZ + court.centreExt - 0.002, court.serviceZ + court.centreExt, az)));
    const line = max(service, centre);
    const lineC = color(new THREE.Color(look.line)).mul(float(0.86).add(d.b.mul(0.18)));
    col = mix(col, lineC, line);
  }
  m.colorNode = col;
  m.roughnessNode = float(look.roughness).sub(graze.mul(0.25));
  m.metalnessNode = float(0);
  return m;
}
