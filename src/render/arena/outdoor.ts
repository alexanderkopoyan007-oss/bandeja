// An outdoor club court (day-framed, day-panoramic, day-hyde, day-lights, night in reference/photos.json): a
// sky with its sun or night, grass and a path round the court, a neighbour's timber fence, trees, and the
// floodlight poles that stand on the side mesh near each end with two LED heads aimed into the court. At night
// those heads are the light: spot lights from where they stand, a dark sky, darkness past the fences.
import * as THREE from 'three/webgpu';
import type { Court } from '../../sim/court/court.ts';
import type { ArenaDef, ArenaPart } from './arena.ts';
import { pooledLight } from './lights.ts';
import { BoxBatch, mergeGeometries } from './stadium.ts';
import { floorMaterial } from '../turf.ts';

/** Sky as an equirectangular canvas: zenith-to-horizon gradient, the sun and its glow, broken cloud. */
function skyTexture(def: NonNullable<ArenaDef['sky']>, night: boolean): THREE.CanvasTexture {
  const W = 1024, H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, def.zenith);
  grad.addColorStop(0.47, def.horizon);
  grad.addColorStop(0.5, def.horizon);
  grad.addColorStop(0.53, def.ground);
  grad.addColorStop(1, def.ground);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  const sd = new THREE.Vector3().fromArray(def.sunDir).normalize();
  const su = (0.5 + Math.atan2(sd.x, -sd.z) / (2 * Math.PI)) * W;
  const sv = (0.5 - Math.asin(sd.y) / Math.PI) * H;
  if (!night) {
    // Cloud: soft blobs in the upper sky, thinner towards the horizon.
    let s = 99;
    const r = (): number => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < 220; i++) {
      const u = r() * W, v = (0.06 + 0.4 * Math.pow(r(), 0.8)) * H;
      const rad = (10 + r() * 40) * (1 - (v / H) * 0.9);
      const a = 0.06 + r() * 0.1;
      const cg = g.createRadialGradient(u, v, 0, u, v, rad * 2);
      cg.addColorStop(0, `rgba(255,255,255,${a})`);
      cg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = cg;
      g.fillRect(u - rad * 2, v - rad * 2, rad * 4, rad * 4);
    }
    const sg = g.createRadialGradient(su, sv, 0, su, sv, 90);
    sg.addColorStop(0, 'rgba(255,250,235,1)');
    sg.addColorStop(0.08, 'rgba(255,246,225,0.9)');
    sg.addColorStop(1, 'rgba(255,240,210,0)');
    g.fillStyle = sg;
    g.fillRect(su - 90, sv - 90, 180, 180);
  } else {
    let s = 5;
    const r = (): number => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < 400; i++) {
      g.fillStyle = `rgba(255,255,255,${0.2 + r() * 0.5})`;
      g.fillRect(r() * W, r() * H * 0.45, 1, 1);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}

/**
 * A tree's crown: clumps of foliage (jittered spheres) round a centre, lit with normals pointing out from the
 * crown's centre (foliage scatters light as a volume, not as facets), darker underneath and inside where less
 * light gets in. Unit size; instances scale it.
 */
function crownGeometry(): THREE.BufferGeometry {
  let seed = 4242;
  const rnd = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const clumps: THREE.BufferGeometry[] = [];
  const N = 9;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + rnd() * 0.6, up = i === 0 ? 0.35 : -0.25 + rnd() * 0.75;
    const r = i === 0 ? 0 : 0.45 + rnd() * 0.25;
    const sz = i === 0 ? 0.75 : 0.42 + rnd() * 0.25;
    clumps.push(new THREE.IcosahedronGeometry(sz, 1).translate(Math.cos(a) * r, up, Math.sin(a) * r));
  }
  const g = mergeGeometries(clumps);
  const pos = g.attributes.position!.array as Float32Array;
  const nor = g.attributes.normal!.array as Float32Array;
  const col = new Float32Array(pos.length);
  // Jitter by a hash of the position, so the corners triangles share move together (no cracks).
  const h = (x: number, y: number, z: number): number => {
    const v = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
    return v - Math.floor(v) - 0.5;
  };
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i]!, y = pos[i + 1]!, z = pos[i + 2]!;
    const j = 0.12;
    pos[i] = x + h(x, y, z) * j;
    pos[i + 1] = y + h(y, z, x) * j;
    pos[i + 2] = z + h(z, x, y) * j;
    const l = Math.hypot(pos[i]!, pos[i + 1]! - 0.1, pos[i + 2]!) || 1;
    nor[i] = pos[i]! / l; nor[i + 1] = (pos[i + 1]! - 0.1) / l; nor[i + 2] = pos[i + 2]! / l;
    // Light falls off underneath and into the crown.
    const shade = Math.min(1, Math.max(0.35, 0.62 + 0.4 * pos[i + 1]! + 0.25 * (l - 0.6)));
    col[i] = col[i + 1] = col[i + 2] = shade * (0.9 + h(x * 3, y * 3, z * 3) * 0.2);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/**
 * Sky, grass and trees round a club (outdoor, or seen past a covered hall's open sides). Their ambient light and
 * reflections come from the sky alone: the arena's probe sits on the court and sees it floodlit, which lit the trees
 * bright green from below at night.
 */
export function buildScenery(root: THREE.Group, def: ArenaDef): THREE.Texture {
  const night = (def.poles?.lit ?? false) === true;
  const sky = skyTexture(def.sky!, night);
  // The sky is a dome mesh, not the scene background, so the environment bake sees it with the trees in front.
  // Radius well inside the camera's far plane (300 m) from wherever a camera stands (the broadcast camera is 25 m
  // from the centre; at 300 m the far side of the dome was clipped to the background).
  const dome = new THREE.Mesh(new THREE.SphereGeometry(240, 48, 24), new THREE.MeshBasicMaterial({ map: sky, side: THREE.BackSide, depthWrite: false, fog: false }));
  dome.renderOrder = -1;
  root.add(dome);

  // Grass beyond the surround: the turf shader without lines, a grass colour and soil for the "sand".
  const grassMat = floorMaterial({ kind: 'turf', color: def.hallFloor, sand: '#6b5b3e', sandAmount: 0.25, line: null, roll: 0, roughness: 0.95 }, null);
  grassMat.envMap = sky;
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), grassMat);
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -0.005;
  grass.receiveShadow = true;
  root.add(grass);

  // Trees: trunks and crowns, instanced, in a ring round the club.
  const tr = def.trees!;
  const rnd = (() => { let a = 1234; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; })();
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 1, 6);
  trunkGeo.translate(0, 0.5, 0);
  const crownGeo = crownGeometry();
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x4a3b2c, roughness: 0.9, envMap: sky }), tr.count);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.95, envMap: sky }), tr.count);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < tr.count; i++) {
    const a = rnd() * Math.PI * 2;
    const r = tr.inner + (tr.outer - tr.inner) * Math.pow(rnd(), 0.7);
    const h = tr.height[0]! + (tr.height[1]! - tr.height[0]!) * rnd();
    p.set(Math.sin(a) * r, 0, Math.cos(a) * r * 1.2);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28);
    m4.compose(p, q, s.set(1, h * 0.45, 1));
    trunks.setMatrixAt(i, m4);
    const cw = h * (0.28 + rnd() * 0.12);
    m4.compose(p.clone().setY(h * 0.62), q, s.set(cw, h * 0.32, cw));
    crowns.setMatrixAt(i, m4);
    crowns.setColorAt(i, c.setHSL(0.24 + rnd() * 0.08, 0.28 + rnd() * 0.15, 0.16 + rnd() * 0.09));
  }
  trunks.castShadow = crowns.castShadow = true;
  root.add(trunks, crowns);
  return sky;
}

export function buildOutdoor(root: THREE.Group, def: ArenaDef, court: Court, scene: THREE.Scene): ArenaPart {
  const night = (def.poles?.lit ?? false) === true;
  const sky = buildScenery(root, def);
  void scene;

  // A timber fence round the club.
  const fence = new BoxBatch();
  const fx = def.surround.x + 3, fz = def.surround.z + 3;
  for (const s of [1, -1]) {
    for (let z = -fz; z < fz; z += 0.15) fence.box(s * fx, 0.95, z + 0.07, 0.03, 1.9 + ((z * 7.3) % 0.06), 0.13, (Math.round(z / 0.15) % 3) ? '#8a7356' : '#7c664b');
    for (let x = -fx; x < fx; x += 0.15) fence.box(x + 0.07, 0.95, s * fz, 0.13, 1.9, 0.03, (Math.round(x / 0.15) % 3) ? '#8a7356' : '#7c664b');
  }
  const fenceMesh = fence.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, envMap: sky }));
  fenceMesh.receiveShadow = true;
  fenceMesh.castShadow = true;
  root.add(fenceMesh);

  // Floodlight poles on the side mesh near each end, two LED heads each aimed into the court.
  const po = def.poles!;
  const poles = new BoxBatch();
  const heads: Array<{ at: THREE.Vector3; aim: THREE.Vector3; ours: boolean }> = [];
  for (const ox of [0, ...(def.neighbours ?? [])]) for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      const x = ox + sx * (court.halfW + 0.12), z = sz * (court.halfL - 1.0);
      poles.box(x, po.height / 2, z, 0.1, po.height, 0.1, po.color);
      poles.box(x - sx * 0.25, po.height - 0.05, z, 0.5, 0.06, 0.06, po.color);
      for (let k = 0; k < po.heads; k++) {
        const at = new THREE.Vector3(x - sx * 0.45, po.height - 0.15, z + (k - (po.heads - 1) / 2) * 0.55);
        // Aimed across the court and towards the middle, like the heads in the night reference.
        const aim = new THREE.Vector3(ox - sx * 2.5, 0, sz * (court.halfL - 6.5) * (k === 0 ? 1 : 0.4));
        heads.push({ at, aim, ours: ox === 0 });
      }
    }
  }
  const poleMesh = poles.mesh();
  poleMesh.castShadow = true;
  root.add(poleMesh);
  const headGeo = new THREE.BoxGeometry(0.5, 0.06, 0.38);
  const headMat = new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.5, metalness: 0.4 });
  // Lit, a lens is far brighter than white (HDR, linear): it blooms as a camera sees it (render/post.ts).
  const lensMat = new THREE.MeshBasicMaterial({ color: night ? new THREE.Color(0xfff8ee).multiplyScalar(14) : 0x6c7278 });
  const lensGeo = new THREE.PlaneGeometry(0.44, 0.32);
  const fl = def.light.floods;
  let shadows = fl?.shadow ?? 0;
  let spots = 0;
  for (const hd of heads) {
    const g = new THREE.Group();
    g.position.copy(hd.at);
    g.lookAt(hd.aim);
    g.rotateX(-Math.PI / 2);
    const box = new THREE.Mesh(headGeo, headMat);
    const lens = new THREE.Mesh(lensGeo, lensMat);
    lens.rotation.x = Math.PI / 2;
    lens.position.y = -0.032;
    g.add(box, lens);
    root.add(g);
    if (night && fl && hd.ours) {
      const sp = pooledLight(`spot${spots++}`, () => new THREE.SpotLight());
      sp.color.set(def.poles?.color2 ?? '#ffffff');
      sp.intensity = fl.intensity;
      sp.distance = 45;
      sp.angle = fl.angle;
      sp.penumbra = fl.penumbra;
      sp.decay = fl.decay;
      sp.castShadow = false;
      sp.position.copy(hd.at);
      sp.target.position.copy(hd.aim);
      if (shadows > 0) {
        sp.castShadow = true;
        sp.shadow.mapSize.set(1024, 1024);
        sp.shadow.bias = -0.0005;
        sp.shadow.radius = 4;
        shadows--;
      }
      root.add(sp, sp.target);
    }
  }
  return { sky };
}
