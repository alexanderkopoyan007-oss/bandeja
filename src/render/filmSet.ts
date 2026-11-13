// The look pass's set (`?look=2`, render/post.ts FilmLook), until the owner has seen it: what a pro final's hall has in
// the air and over the court that the game's hall does not. Haze (the air is never clear under show lights: far things
// lift a little toward the hall's own glow), a square truss over the court with a row of lamps on it, and each lamp's
// beam drawn through the haze: a cone of light, additive, brightest at the lamp and gone before the floor, so the
// playing height stays clear and the ball reads against the court as before.
//
// The beams are one mesh (one draw), the rig another; nothing moves and nothing is allocated per frame. The court's
// light itself is the arena's (arena/lights.ts): the lamps here are seen, they do not light.
import * as THREE from 'three/webgpu';
import { cameraPosition, float, fog, normalView, positionView, positionWorld, smoothstep, uv, vec3 } from 'three/tsl';
import { BoxBatch } from './arena/stadium.ts';

export interface FilmSetLook {
  /** The haze: its colour (linear) and how fast it thickens (per metre). */
  haze: [number, number, number];
  hazeDensity: number;
  /** The rig: its height (m), how far outside the court's lines it hangs (m), lamps a long side and a short side. */
  height: number;
  out: number;
  lampsLong: number;
  lampsShort: number;
  /** A lamp's face (HDR, it blooms) and its beam at the lamp (HDR), the beam's colour. */
  lamp: number;
  beam: number;
  tint: [number, number, number];
}

export const FILM_SET: FilmSetLook = {
  haze: [0.022, 0.027, 0.04], hazeDensity: 0.005, height: 11.5, out: 2.6, lampsLong: 5, lampsShort: 2, lamp: 9, beam: 0.07, tint: [1, 0.95, 0.86],
};

/** A beam: from the lamp's lens (this wide, m) to this wide where it would meet the floor. */
const BEAM_R0 = 0.16, BEAM_R1 = 1.45;
const SIDES = 20;

/** The haze on everything drawn (a scene's fog; the beams and the sky leave it off). */
export function addHaze(scene: THREE.Scene, L: FilmSetLook = FILM_SET): void {
  const d = positionView.z.negate().max(0);
  scene.fogNode = fog(vec3(...L.haze), float(1).sub(d.mul(-L.hazeDensity).exp()));
}

/**
 * The rig and its beams over a court `halfW` by `halfL`, into `group`. Each lamp points at the court, a little past
 * the middle of its own side, as a show's wash lights are set.
 */
export function addFilmRig(group: THREE.Group, halfW: number, halfL: number, L: FilmSetLook = FILM_SET, beamsToo = true): void {
  const x = halfW + L.out, z = halfL + L.out, y = L.height;
  const steel = new BoxBatch();
  for (const s of [1, -1]) {
    steel.box(s * x, y + 0.2, 0, 0.3, 0.3, z * 2 + 0.3, '#16181c');
    steel.box(0, y + 0.2, s * z, x * 2 + 0.3, 0.3, 0.3, '#16181c');
  }
  // (the hangers: thin, up into the dark)
  for (const sx of [1, -1]) for (const sz of [1, -1]) steel.box(sx * x, y + 3.2, sz * z, 0.04, 6, 0.04, '#0e0f12');
  const lamps: Array<[number, number, number, number, number]> = []; // x, z, and where it points (x, z), spread
  for (let i = 0; i < L.lampsLong; i++) {
    const lz = -z + ((i + 0.5) / L.lampsLong) * 2 * z;
    for (const s of [1, -1]) lamps.push([s * x, lz, s * halfW * 0.3, lz * 0.72, 1]);
  }
  for (let i = 0; i < L.lampsShort; i++) {
    const lx = -x + ((i + 0.5) / L.lampsShort) * 2 * x;
    for (const s of [1, -1]) lamps.push([lx, s * z, lx * 0.6, s * halfL * 0.55, 1]);
  }
  const faces = new BoxBatch();
  for (const [lx, lz] of lamps) {
    steel.box(lx, y - 0.02, lz, 0.34, 0.3, 0.34, '#0c0d10');
    faces.box(lx, y - 0.18, lz, 0.24, 0.02, 0.24, '#ffffff');
  }
  group.add(steel.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.3 })));
  const face = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(...L.tint).multiplyScalar(L.lamp), fog: false });
  group.add(faces.mesh(face));
  // (clear air shows no beam: the detail pass hangs the rig without the haze)
  if (!beamsToo) return;

  // The beams: open cones, lamp to floor, one geometry. uv.y runs 0 at the lamp to 1 at the floor.
  const n = lamps.length, ring = SIDES + 1;
  const pos = new Float32Array(n * ring * 2 * 3), nor = new Float32Array(n * ring * 2 * 3), tex = new Float32Array(n * ring * 2 * 2);
  const idx: number[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), ax = new THREE.Vector3(), u = new THREE.Vector3(), w = new THREE.Vector3(), r = new THREE.Vector3();
  lamps.forEach(([lx, lz, tx, tz], k) => {
    a.set(lx, y - 0.2, lz);
    b.set(tx, 0, tz);
    ax.subVectors(b, a).normalize();
    u.set(1, 0, 0).addScaledVector(ax, -ax.x).normalize();
    w.crossVectors(ax, u);
    const base = k * ring * 2;
    for (let i = 0; i < ring; i++) {
      const t = (i / SIDES) * Math.PI * 2;
      r.copy(u).multiplyScalar(Math.cos(t)).addScaledVector(w, Math.sin(t));
      for (let e = 0; e < 2; e++) {
        const at = (base + i * 2 + e) * 3, c = e === 0 ? a : b, rad = e === 0 ? BEAM_R0 : BEAM_R1;
        pos[at] = c.x + r.x * rad; pos[at + 1] = c.y + r.y * rad; pos[at + 2] = c.z + r.z * rad;
        nor[at] = r.x; nor[at + 1] = r.y; nor[at + 2] = r.z;
        tex[(base + i * 2 + e) * 2] = i / SIDES; tex[(base + i * 2 + e) * 2 + 1] = e;
      }
      if (i < SIDES) { const p = base + i * 2; idx.push(p, p + 1, p + 2, p + 2, p + 1, p + 3); }
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(tex, 2));
  geo.setIndex(idx);
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false });
  // Seen through its middle a cone of lit haze is deepest, at its rim there is none: bright where its side faces the
  // eye. Along it the light thins as the cone widens, and it is gone before the floor (and close to the lens of a
  // camera flying through it).
  const along = uv().y;
  const facing = normalView.z.abs().pow(1.6);
  const thin = float(1).div(float(1).add(along.mul(9))).mul(float(1).sub(smoothstep(0.55, 0.9, along)));
  const near = smoothstep(1.5, 5, positionWorld.sub(cameraPosition).length());
  mat.colorNode = vec3(...L.tint).mul(facing).mul(thin).mul(near).mul(L.beam);
  const beams = new THREE.Mesh(geo, mat);
  beams.frustumCulled = false;
  beams.renderOrder = 5;
  beams.name = 'beams';
  group.add(beams);
}
