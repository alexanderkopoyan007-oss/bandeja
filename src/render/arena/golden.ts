// The golden club's sky (data/arenas.json `club-golden`, `hdri`): a photographed CC0 sky instead of the drawn one, its sun
// taken out and measured by tools/assets/golden/sky.py, so the arena's key light is that sun (with its shadows) and the
// sky's own light keeps the ratio to it the photograph had (about 11 to 1 on the ground). The WebP holds v = x / (1 + x),
// x = radiance / unit, rows from the zenith down, columns by azimuth atan2(z, x) as three's `equirectUV` reads them; `scale`
// is one x in the game's light units.
import * as THREE from 'three/webgpu';
import { equirectUV, float, normalize, positionLocal, smoothstep, texture, vec3, dot, max, pow } from 'three/tsl';

export interface HdriDef {
  /** The encoded sky (public/, relative to the page). */
  src: string;
  /** Radiance of one x, in the game's light units. */
  scale: number;
  /** The sun as the dome draws it: its disc's angular radius (deg) and radiance (in the game's light units). */
  disc: number;
  discRadiance: number;
}

export interface HdriSky {
  /** The dome's 8-bit encoded texture (decoded in its shader), full size. */
  dome: THREE.DataTexture;
  /** The decoded sky, half size, half float: the scenery's own envMap (filtered before the bake, as the drawn sky is). */
  env: THREE.DataTexture;
  /** Resolves when both hold the sky. */
  ready: Promise<void>;
}

const ENV_W = 1024, ENV_H = 512;

/** A float to its half-float bits (round to nearest; no NaN here, values clamp at 65504). */
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
export function half(v: number): number {
  f32[0] = v;
  const x = u32[0]!;
  const s = (x >>> 16) & 0x8000, e = ((x >>> 23) & 0xff) - 112, m = x & 0x7fffff;
  if (e <= 0) return s; // under half's normal range: the sky never goes there
  if (e >= 31) return s | 0x7bff;
  // (added, not ORed: a mantissa that rounds up to 0x400 carries into the exponent)
  return s | Math.min((e << 10) + ((m + 0x1000) >>> 13), 0x7bff);
}

/** Loads and decodes the sky; the textures exist at once (empty until `ready`). */
export function loadHdriSky(def: HdriDef): HdriSky {
  const dome = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  dome.colorSpace = THREE.NoColorSpace;
  dome.magFilter = dome.minFilter = THREE.LinearFilter;
  dome.wrapS = THREE.RepeatWrapping;
  dome.generateMipmaps = false;
  const env = new THREE.DataTexture(new Uint16Array(ENV_W * ENV_H * 4), ENV_W, ENV_H, THREE.RGBAFormat, THREE.HalfFloatType);
  env.mapping = THREE.EquirectangularReflectionMapping;
  env.colorSpace = THREE.LinearSRGBColorSpace;
  env.magFilter = env.minFilter = THREE.LinearFilter;
  env.generateMipmaps = false;
  const ready = (async () => {
    const url = typeof document !== 'undefined' ? new URL(def.src, document.baseURI).href : def.src;
    const blob = await (await fetch(url)).blob();
    const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const W = bmp.width, H = bmp.height;
    const cv = new OffscreenCanvas(W, H);
    const g = cv.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(bmp, 0, 0);
    bmp.close();
    const src = g.getImageData(0, 0, W, H).data;
    // DataTextures run bottom-up (row 0 is v = 0, the nadir): the image's rows reversed.
    const px = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) px.set(src.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    dome.image = { data: px, width: W, height: H } as unknown as typeof dome.image;
    dome.needsUpdate = true;
    // The env: box-averaged to ENV_W x ENV_H in radiance (decoded first: averaging the encoding would darken the glow).
    const fx = W / ENV_W, fy = H / ENV_H, out = env.image.data as Uint16Array;
    const dec = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const v = Math.min(i, 254) / 255; dec[i] = (v / (1 - v)) * def.scale; }
    for (let y = 0; y < ENV_H; y++) for (let x = 0; x < ENV_W; x++) {
      let r = 0, gg = 0, b = 0;
      for (let j = 0; j < fy; j++) for (let i = 0; i < fx; i++) {
        const k = ((y * fy + j) * W + x * fx + i) * 4;
        r += dec[px[k]!]!; gg += dec[px[k + 1]!]!; b += dec[px[k + 2]!]!;
      }
      const n = fx * fy, o = (y * ENV_W + x) * 4;
      out[o] = half(r / n); out[o + 1] = half(gg / n); out[o + 2] = half(b / n); out[o + 3] = half(1);
    }
    env.needsUpdate = true;
  })();
  return { dome, env, ready };
}

/**
 * The dome's material: the photographed sky decoded to radiance, and the sun's disc put back (`sunDir`), bright enough to
 * bloom and to show in the glass, but not lighting anything (the bake sees it: a disc of 0.27 deg can't move its irradiance).
 */
export function hdriDomeMaterial(sky: HdriSky, def: HdriDef, sunDir: THREE.Vector3): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
  const dir = normalize(positionLocal);
  const v = texture(sky.dome, equirectUV(dir)).rgb.min(254 / 255);
  const rad = v.div(float(1).sub(v)).mul(def.scale);
  const c = dot(dir, vec3(sunDir.x, sunDir.y, sunDir.z));
  const cd = Math.cos((def.disc * Math.PI) / 180);
  // the disc with a soft limb, and a tight glow round it (the photograph's own glow starts outside the filled degree)
  const disc = smoothstep(cd - 2e-5, cd + 2e-5, c).mul(def.discRadiance);
  const glow = pow(max(c, 0), 4000).mul(def.discRadiance * 0.004);
  m.colorNode = rad.add(disc).add(glow);
  return m;
}
