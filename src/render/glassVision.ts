// Glass vision (M6 phase D, the academy's wall-reading lessons): the path of a ball coming at the player drawn from the
// sim's own noise-free look-ahead (sim.pred, the one the AI plans from), so they can learn where a ball comes out of
// the glass. Level 2 draws the path as a line of dots; level 1 only where it meets the glass and where it comes down
// after; 0 nothing. Redrawn only when the prediction is made again (after each contact); nothing allocated per frame.
import * as THREE from 'three/webgpu';
import { PH_RALLY, type MatchSim } from '../sim/match.ts';
import { PF_FLOOR, PF_WALL, PF_EXIT } from '../sim/ball/predict.ts';

const DOTS = 72;
/** Every this many samples of the prediction (120 Hz): a dot every 25 ms. */
const STEP = 3;

export class GlassVision {
  /** 0 off, 1 the glass and the landing, 2 the whole path. */
  level = 0;
  private readonly dots: THREE.InstancedMesh;
  private readonly wallMark: THREE.Mesh;
  private readonly floorMark: THREE.Mesh;
  private readonly m = new THREE.Matrix4();
  private readonly hide = new THREE.Matrix4().makeScale(0, 0, 0);
  private version = -1;
  /** The team whose balls are drawn as they come (the player's opponents: the coach). */
  private readonly from: number;

  constructor(scene: THREE.Scene, from = 1) {
    this.from = from;
    const mat = new THREE.MeshBasicMaterial({ color: 0x56b4e9, transparent: true, opacity: 0.75, depthWrite: false });
    this.dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.03, 8, 6), mat, DOTS);
    this.dots.frustumCulled = false;
    for (let i = 0; i < DOTS; i++) this.dots.setMatrixAt(i, this.hide);
    this.wallMark = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), new THREE.MeshBasicMaterial({ color: 0xf0e442, transparent: true, opacity: 0.9, depthWrite: false }));
    this.floorMark = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.24, 32), new THREE.MeshBasicMaterial({ color: 0xf0e442, transparent: true, opacity: 0.9, depthWrite: false }));
    this.floorMark.rotation.x = -Math.PI / 2;
    this.wallMark.visible = false;
    this.floorMark.visible = false;
    scene.add(this.dots, this.wallMark, this.floorMark);
  }

  update(sim: MatchSim): void {
    const on = this.level > 0 && sim.phase === PH_RALLY && sim.rally.hitter === this.from;
    this.dots.visible = on && this.level >= 2;
    if (!on) {
      this.wallMark.visible = false;
      this.floorMark.visible = false;
      return;
    }
    const p = sim.pred;
    if (p.version === this.version) return;
    this.version = p.version;
    let dot = 0, wall = -1, floorAfterWall = -1, walls = 0;
    for (let i = 0; i < p.n; i++) {
      const f = p.flags[i]!;
      if (f & PF_WALL) { if (wall < 0) wall = i; walls++; }
      if ((f & PF_FLOOR) && walls > 0 && floorAfterWall < 0) floorAfterWall = i;
      if (i % STEP === 0 && dot < DOTS) this.dots.setMatrixAt(dot++, this.m.makeTranslation(p.x[i]!, p.y[i]!, p.z[i]!));
      // (up to the second bounce, or out)
      if ((f & PF_EXIT) || p.bounces[i]! >= 2) break;
    }
    for (let i = dot; i < DOTS; i++) this.dots.setMatrixAt(i, this.hide);
    this.dots.instanceMatrix.needsUpdate = true;
    this.wallMark.visible = wall >= 0;
    if (wall >= 0) this.wallMark.position.set(p.x[wall]!, p.y[wall]!, p.z[wall]!);
    this.floorMark.visible = floorAfterWall >= 0;
    if (floorAfterWall >= 0) this.floorMark.position.set(p.x[floorAfterWall]!, 0.008, p.z[floorAfterWall]!);
  }
}
