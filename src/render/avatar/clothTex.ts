// Materials for what is worn and what lies courtside (costume.ts, props.ts), with textures drawn here once (no files,
// nothing downloaded): the weave of cotton twill, terry loops, ripstop nylon, webbing ribs, vinyl grain, wood grain,
// stitch rows and a printed bandana. Normal maps come from height fields; UVs are metres (geom.ts), so each texture
// repeats at its real size. Without a document (Node tests) the materials come plain.
import * as THREE from 'three/webgpu';

const canDraw = typeof document !== 'undefined';

// ---- noise -------------------------------------------------------------------------------------------------

function hash(x: number, y: number, s: number): number {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Tileable value noise over a `period`-cell grid, at (x, y) in [0, 1). */
function vnoise(x: number, y: number, period: number, seed: number): number {
  const fx = x * period, fy = y * period;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const w = (a: number, b: number): number => hash(((a % period) + period) % period, ((b % period) + period) % period, seed);
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  return (w(x0, y0) * (1 - sx) + w(x0 + 1, y0) * sx) * (1 - sy) + (w(x0, y0 + 1) * (1 - sx) + w(x0 + 1, y0 + 1) * sx) * sy;
}

// ---- textures from fields ----------------------------------------------------------------------------------

/** A tangent-space normal map from a tileable height field h(x, y), x, y in [0, 1). */
function normalMap(size: number, h: (x: number, y: number) => number, strength: number): THREE.Texture {
  const H = new Float32Array(size * size);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) H[j * size + i] = h(i / size, j / size);
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const cx = cv.getContext('2d')!;
  const img = cx.createImageData(size, size);
  const at = (i: number, j: number): number => H[((j + size) % size) * size + ((i + size) % size)]!;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const dx = (at(i + 1, j) - at(i - 1, j)) * strength, dy = (at(i, j + 1) - at(i, j - 1)) * strength;
    const l = Math.hypot(dx, dy, 1);
    const k = (j * size + i) * 4;
    img.data[k] = Math.round((-dx / l * 0.5 + 0.5) * 255);
    img.data[k + 1] = Math.round((-dy / l * 0.5 + 0.5) * 255);
    img.data[k + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
    img.data[k + 3] = 255;
  }
  cx.putImageData(img, 0, 0);
  return finish(new THREE.CanvasTexture(cv), false);
}

/** A colour texture from a field c(x, y) -> [r, g, b] in 0..1. */
function colourMap(size: number, c: (x: number, y: number) => [number, number, number]): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const cx = cv.getContext('2d')!;
  const img = cx.createImageData(size, size);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const [r, g, b] = c(i / size, j / size);
    const k = (j * size + i) * 4;
    img.data[k] = r * 255; img.data[k + 1] = g * 255; img.data[k + 2] = b * 255; img.data[k + 3] = 255;
  }
  cx.putImageData(img, 0, 0);
  return finish(new THREE.CanvasTexture(cv), true);
}

function finish(t: THREE.Texture, srgb: boolean): THREE.Texture {
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** A texture shared by every material that uses it, at `tile` metres (repeat set on a clone per material). */
const cache = new Map<string, THREE.Texture>();
function tex(key: string, make: () => THREE.Texture, tileU: number, tileV = tileU): THREE.Texture {
  let t = cache.get(key);
  if (!t) { t = make(); cache.set(key, t); }
  const c = t.clone();
  c.repeat.set(1 / tileU, 1 / tileV);
  c.needsUpdate = true;
  return c;
}

// ---- the weaves --------------------------------------------------------------------------------------------

/** Cotton twill (caps, hats): diagonal ribs, 4 to the 6 mm tile, slubby threads. */
const twill = (): THREE.Texture => normalMap(256, (x, y) => {
  const rib = 0.5 + 0.5 * Math.sin(2 * Math.PI * (x + y) * 4);
  return rib * 0.8 + vnoise(x, y, 32, 3) * 0.35 + vnoise(x, y, 8, 5) * 0.2;
}, 2.2);

/** Terry towelling (headbands, wristbands, towels): a mat of little loops. */
const terry = (): THREE.Texture => {
  const N = 260, pts: Array<[number, number, number]> = [];
  for (let k = 0; k < N; k++) pts.push([hash(k, 1, 7), hash(k, 2, 7), 0.018 + hash(k, 3, 7) * 0.02]);
  return normalMap(256, (x, y) => {
    let h = 0;
    for (const [px, py, r] of pts) {
      let dx = Math.abs(x - px), dy = Math.abs(y - py);
      dx = Math.min(dx, 1 - dx); dy = Math.min(dy, 1 - dy);
      const d = Math.hypot(dx, dy) / r;
      // A loop: a ring, high round its edge.
      if (d < 1.3) h = Math.max(h, Math.exp(-((d - 0.75) ** 2) * 18));
    }
    return h + vnoise(x, y, 16, 9) * 0.3;
  }, 3.2);
};

/** Ripstop nylon (bags): a fine plain weave with a heavier thread every quarter tile. */
const ripstop = (): THREE.Texture => normalMap(256, (x, y) => {
  const fine = 0.5 + 0.25 * (Math.sin(2 * Math.PI * x * 32) * Math.sin(2 * Math.PI * y * 32));
  const gx = Math.exp(-((((x * 4) % 1) - 0.5) ** 2) * 900), gy = Math.exp(-((((y * 4) % 1) - 0.5) ** 2) * 900);
  return fine * 0.6 + Math.max(gx, gy) * 0.8 + vnoise(x, y, 16, 11) * 0.15;
}, 1.6);

/** Webbing (straps, handles): ribs along the strap (v runs along it in a tube). */
const webbing = (): THREE.Texture => normalMap(128, (x, y) => 0.5 + 0.5 * Math.sin(2 * Math.PI * x * 8) + 0.25 * Math.sin(2 * Math.PI * y * 16) + vnoise(x, y, 8, 13) * 0.2, 2);

/** Vinyl or rubber grain (the stadium bench's seat, bag bases). */
const grain = (): THREE.Texture => normalMap(256, (x, y) => vnoise(x, y, 64, 17) * 0.6 + vnoise(x, y, 24, 19) * 0.4, 1.6);

/** Wood: grain lines along v (a slat's length) with darker latewood and a slow wobble. */
const wood = (): THREE.Texture => colourMap(256, (x, y) => {
  const wob = vnoise(x, y, 4, 21) * 0.08 + vnoise(x, y, 2, 23) * 0.05;
  const ring = Math.sin(2 * Math.PI * (x * 14 + wob * 6)) * 0.5 + 0.5;
  const t = 0.75 + 0.25 * ring ** 3 - vnoise(x, y, 48, 25) * 0.08;
  return [0.62 * t, 0.43 * t, 0.27 * t];
});

/** Stitch rows (a cap's bill, a bucket hat's brim): a dashed line every 7 mm, the dashes 3 mm with 1 mm gaps. */
const stitches = (): THREE.Texture => colourMap(128, (x, y) => {
  const row = Math.abs(y - 0.5) < 0.07 && (x % 0.25) < 0.19 ? 1 : 0;
  const v = 1 - row * 0.32;
  return [v, v, v];
});
const stitchNormal = (): THREE.Texture => normalMap(128, (x, y) => (Math.abs(y - 0.5) < 0.09 && (x % 0.25) < 0.19 ? 1 : 0) + vnoise(x, y, 16, 27) * 0.2, 1.4);

/** A printed bandana (our own motif): teardrop swirls ringed with dots, in `ink` on the `ground` colour. */
const print = (ground: number, ink: number) => (): THREE.Texture => {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#' + new THREE.Color(ground).getHexString();
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = g.fillStyle = '#' + new THREE.Color(ink).getHexString();
  const drop = (x: number, y: number, s: number, a: number): void => {
    for (const ox of [-256, 0, 256]) for (const oy of [-256, 0, 256]) {
      g.save();
      g.translate(x + ox, y + oy);
      g.rotate(a);
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(0, -s);
      g.bezierCurveTo(s * 0.9, -s * 0.4, s * 0.7, s * 0.8, 0, s * 0.7);
      g.bezierCurveTo(-s * 0.8, s * 0.6, -s * 0.5, -s * 0.2, s * 0.25, -s * 0.15);
      g.stroke();
      g.beginPath();
      g.arc(s * 0.1, s * 0.2, s * 0.18, 0, Math.PI * 2);
      g.fill();
      for (let k = 0; k < 7; k++) {
        const t = (k / 7) * Math.PI * 2;
        g.beginPath();
        g.arc(Math.cos(t) * s * 1.25, Math.sin(t) * s * 1.25, 2.2, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
    }
  };
  drop(64, 64, 26, 0.4);
  drop(192, 180, 26, 2.6);
  drop(190, 60, 14, 1.2);
  drop(60, 190, 14, 4.0);
  return finish(new THREE.CanvasTexture(cv), true);
};

// ---- materials ---------------------------------------------------------------------------------------------

export type Weave = 'twill' | 'terry' | 'ripstop' | 'webbing' | 'grain';
const WEAVES: Record<Weave, { make: () => THREE.Texture; tile: number; scale: number; rough: number; sheen: number }> = {
  twill: { make: twill, tile: 0.006, scale: 0.55, rough: 0.88, sheen: 0.55 },
  terry: { make: terry, tile: 0.016, scale: 1.0, rough: 1, sheen: 0.9 },
  ripstop: { make: ripstop, tile: 0.024, scale: 0.55, rough: 0.6, sheen: 0.3 },
  webbing: { make: webbing, tile: 0.012, scale: 0.7, rough: 0.75, sheen: 0.4 },
  grain: { make: grain, tile: 0.05, scale: 0.4, rough: 0.5, sheen: 0 },
};

/** Cloth of a weave in a colour: the weave as a normal map, a sheen of the colour lifted towards white. */
export function fabric(weave: Weave, colour: number, side: THREE.Side = THREE.FrontSide): THREE.MeshPhysicalMaterial {
  const w = WEAVES[weave];
  const c = new THREE.Color(colour);
  const m = new THREE.MeshPhysicalMaterial({ color: c, roughness: w.rough, metalness: 0, side });
  if (w.sheen) {
    m.sheen = w.sheen;
    m.sheenRoughness = 0.55;
    m.sheenColor = c.clone().lerp(new THREE.Color(1, 1, 1), 0.35);
  }
  if (canDraw) {
    m.normalMap = tex(weave, w.make, w.tile);
    m.normalScale.set(w.scale, w.scale);
  }
  return m;
}

/** Twill with stitch rows across it (a bill, a brim): rows every 7 mm along v (a real bill has about eight). */
export function stitched(colour: number, side: THREE.Side = THREE.DoubleSide): THREE.MeshPhysicalMaterial {
  const m = fabric('twill', colour, side);
  if (canDraw) {
    m.map = tex('stitch', stitches, 0.004, 0.007);
    m.normalMap = tex('stitchN', stitchNormal, 0.004, 0.007);
    m.normalScale.set(0.8, 0.8);
  }
  return m;
}

/** Printed cotton: `ink` motifs on the colour. */
export function printed(colour: number, ink: number): THREE.MeshPhysicalMaterial {
  const m = fabric('twill', colour, THREE.DoubleSide);
  if (canDraw) {
    m.map = tex(`print-${colour}-${ink}`, print(colour, ink), 0.09);
    m.color.set(0xffffff);
  }
  return m;
}

/** Moulded plastic (frames, buckles): glossy with a clear coat. */
export function plastic(colour: number, rough = 0.32): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ color: colour, roughness: rough, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.25 });
}

/** Metal (zips, clips, hinges, bench frames). */
export function metal(colour = 0xc9ccd1, rough = 0.32): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ color: colour, roughness: rough, metalness: 1 });
}

/** A sunglass lens: a dark tint you can just see the eyes through, a clear coat, and for a sport lens a mirror's
 * thin-film colours. */
export function lens(tint: number, mirror: boolean): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    color: tint, roughness: 0.04, metalness: mirror ? 0.25 : 0, clearcoat: 1, clearcoatRoughness: 0.02,
    transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: true,
  });
  if (mirror) {
    m.iridescence = 1;
    m.iridescenceIOR = 1.8;
    m.iridescenceThicknessRange = [250, 650];
  }
  return m;
}

/** Wood with its grain (bench slats). */
export function woodMaterial(): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({ color: canDraw ? 0xffffff : 0x9c6c44, roughness: 0.62, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.4 });
  if (canDraw) m.map = tex('wood', wood, 0.12, 0.6);
  return m;
}
