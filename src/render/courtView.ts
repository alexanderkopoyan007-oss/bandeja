// Grey-box court built from the sim's Court geometry. Rendering only reads the sim.
import * as THREE from 'three/webgpu';
import {
  Court, SURF_GLASS, SURF_MESH,
  WALL_BACK_NEAR, WALL_BACK_FAR, WALL_SIDE_LEFT,
} from '../sim/court/court.ts';

const LINE_Y = 0.002;

export function buildCourtView(court: Court): THREE.Group {
  const g = new THREE.Group();
  g.name = 'court';
  const { halfW, halfL, def } = court;

  // Surroundings and playing surface.
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(def.width + 16, def.length + 16),
    new THREE.MeshStandardMaterial({ color: 0x3d4247, roughness: 0.95 }),
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.005;
  apron.receiveShadow = true;
  g.add(apron);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(def.width, def.length),
    new THREE.MeshStandardMaterial({ color: 0x2a5d9c, roughness: 0.9 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  g.add(floor);

  // Lines: service lines and the centre service line (extends 20 cm past each service line).
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xf2f2f2 });
  const lw = def.lineWidth;
  const sl = def.serviceLineFromNet;
  for (const s of [1, -1]) {
    g.add(flatRect(def.width, lw, 0, s * sl, lineMat));
    const len = sl + def.centreLineExtension;
    g.add(flatRect(lw, len, 0, (s * len) / 2, lineMat));
  }

  // Walls from the court's panel list.
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xbfe3ef, transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const meshMat = new THREE.MeshStandardMaterial({
    color: 0x1b1d20, transparent: true, opacity: 0.38, roughness: 0.8,
    side: THREE.DoubleSide, depthWrite: false,
  });
  for (const p of court.panels) {
    if (p.kind !== SURF_GLASS && p.kind !== SURF_MESH) continue;
    const w = p.u1 - p.u0;
    const h = p.y1 - p.y0;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), p.kind === SURF_GLASS ? glassMat : meshMat);
    const uc = (p.u0 + p.u1) / 2;
    const yc = (p.y0 + p.y1) / 2;
    if (p.wall === WALL_BACK_NEAR || p.wall === WALL_BACK_FAR) {
      m.position.set(uc, yc, p.wall === WALL_BACK_NEAR ? halfL : -halfL);
    } else {
      m.rotation.y = Math.PI / 2;
      m.position.set(p.wall === WALL_SIDE_LEFT ? -halfW : halfW, yc, uc);
    }
    m.renderOrder = 2;
    g.add(m);
  }

  // Frame: posts at seams and corners, rails along the glass tops and enclosure tops.
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x23272b, roughness: 0.6, metalness: 0.4 });
  const post = (x: number, z: number, h: number): void => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, h, 0.06), frameMat);
    b.position.set(x, h / 2, z);
    b.castShadow = true;
    g.add(b);
  };
  const framed = def.frame === 'posts';
  for (const s of [1, -1]) {
    if (framed) for (const x of [-halfW, halfW]) post(x, s * halfL, def.backWall.top);
    if (framed) for (const x of court.seams[WALL_BACK_NEAR]!) post(x, s * halfL, def.backWall.top);
    for (const x of [-halfW, halfW]) {
      for (const z of court.seams[WALL_SIDE_LEFT]!) {
        const fromBack = halfL - Math.abs(z);
        if (!framed && fromBack < 4.01) continue;
        post(x, z, sideTopAt(court, fromBack));
      }
      for (const o of court.openings) {
        const zs = o.z0 > 0 ? [o.z0, o.z1] : [o.z1];
        for (const zz of zs) post(x, s * zz, sideTopAt(court, halfL - zz));
      }
    }
  }

  // Net with its sagging top and posts.
  const segs = 40;
  const pos: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const x = -halfW + (i / segs) * def.width;
    pos.push(x, 0, 0, x, court.netHeightAt(x), 0);
  }
  const idx: number[] = [];
  for (let i = 0; i < segs; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const netGeo = new THREE.BufferGeometry();
  netGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  netGeo.setIndex(idx);
  netGeo.computeVertexNormals();
  const net = new THREE.Mesh(netGeo, new THREE.MeshStandardMaterial({
    color: 0x111111, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false,
  }));
  net.renderOrder = 3;
  g.add(net);
  const bandPts: THREE.Vector3[] = [];
  for (let i = 0; i <= segs; i++) {
    const x = -halfW + (i / segs) * def.width;
    bandPts.push(new THREE.Vector3(x, court.netHeightAt(x) - 0.028, 0));
  }
  const band = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(bandPts), 64, 0.028, 6, false),
    new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.7 }),
  );
  band.castShadow = true;
  g.add(band);
  for (const x of [-halfW, halfW]) {
    const ps = def.net.postSize;
    const b = new THREE.Mesh(new THREE.BoxGeometry(ps, def.net.postHeight, ps), frameMat);
    b.position.set(x, def.net.postHeight / 2, 0);
    b.castShadow = true;
    g.add(b);
  }
  return g;
}

/** Enclosure height at a distance from the back wall; at a segment boundary the taller side wins. */
function sideTopAt(court: Court, fromBack: number): number {
  let top = 0;
  for (const s of court.def.sideWall.segments) {
    if (fromBack >= s.from - 1e-6 && fromBack <= s.to + 1e-6) top = Math.max(top, s.top);
  }
  return top;
}

function flatRect(w: number, l: number, x: number, z: number, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, LINE_Y, z);
  return m;
}
