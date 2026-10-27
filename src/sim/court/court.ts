// Court geometry built from a JSON definition (data/courts/*.json).
// Axes: x across the width (left -, right +), y up, z along the length.
// The net is the plane z = 0. Team 0 plays the z > 0 half (nearest the broadcast camera).

export interface CourtSegment { from: number; to: number; glassHeight: number; top: number }

export interface CourtDef {
  id: string;
  name: string;
  width: number;
  length: number;
  lineWidth: number;
  serviceLineFromNet: number;
  centreLineExtension: number;
  net: { heightCentre: number; heightPost: number; postHeight: number; postSize: number };
  backWall: { glassHeight: number; top: number; glassPanelWidth: number };
  sideWall: { segments: CourtSegment[] };
  openings: { perSide: number; width: number; height: number; dividerWidth: number };
  frame: 'posts' | 'frameless';
  outOfCourtPlay: boolean;
}

export const SURF_OPEN = 0;
export const SURF_GLASS = 1;
export const SURF_MESH = 2;
export const SURF_FLOOR = 3;
export const SURF_NET = 4;

// Wall ids
export const WALL_BACK_NEAR = 0; // z = +halfL
export const WALL_BACK_FAR = 1; // z = -halfL
export const WALL_SIDE_LEFT = 2; // x = -halfW
export const WALL_SIDE_RIGHT = 3; // x = +halfW

/** Result of a wall lookup; reused by callers so lookups never allocate. */
export interface ZoneHit {
  kind: number;
  /** Distance (m) to the nearest seam, frame edge or corner on this wall. */
  seamDist: number;
}

export interface Panel {
  wall: number;
  kind: number;
  /** Along-wall range: x for back walls, z for side walls. */
  u0: number;
  u1: number;
  y0: number;
  y1: number;
}

interface Opening { z0: number; z1: number; height: number }

export class Court {
  readonly def: CourtDef;
  readonly halfW: number;
  readonly halfL: number;
  /** Absolute z ranges of side openings (same on both side walls). */
  readonly openings: Opening[];
  /** Vertical seam positions (along-wall coordinate) per wall. */
  readonly seams: number[][];
  readonly panels: Panel[];

  constructor(def: CourtDef) {
    this.def = def;
    this.halfW = def.width / 2;
    this.halfL = def.length / 2;
    this.openings = buildOpenings(def);
    this.seams = [[], [], [], []];
    this.panels = [];
    this.buildBack(WALL_BACK_NEAR);
    this.buildBack(WALL_BACK_FAR);
    this.buildSide(WALL_SIDE_LEFT);
    this.buildSide(WALL_SIDE_RIGHT);
  }

  /** Height of the top of the net at lateral position x (parabolic sag between the posts). */
  netHeightAt(x: number): number {
    const n = this.def.net;
    const t = x / this.halfW;
    return n.heightCentre + (n.heightPost - n.heightCentre) * t * t;
  }

  /** Material of a back wall at (x, y). */
  backZone(x: number, y: number, out: ZoneHit): ZoneHit {
    const bw = this.def.backWall;
    out.kind = y < bw.glassHeight ? SURF_GLASS : y < bw.top ? SURF_MESH : SURF_OPEN;
    let d = Math.abs(y - bw.glassHeight);
    d = Math.min(d, Math.abs(bw.top - y), this.halfW - Math.abs(x));
    const seams = this.seams[WALL_BACK_NEAR]!;
    for (let i = 0; i < seams.length; i++) d = Math.min(d, Math.abs(x - seams[i]!));
    out.seamDist = d;
    return out;
  }

  /** Material of a side wall at (z, y). Both side walls are identical. */
  sideZone(z: number, y: number, out: ZoneHit): ZoneHit {
    const fromBack = this.halfL - Math.abs(z);
    const segs = this.def.sideWall.segments;
    let seg = segs[segs.length - 1]!;
    for (let i = 0; i < segs.length; i++) {
      if (fromBack < segs[i]!.to) { seg = segs[i]!; break; }
    }
    let kind = y < seg.glassHeight ? SURF_GLASS : y < seg.top ? SURF_MESH : SURF_OPEN;
    let d = Math.min(Math.abs(y - seg.glassHeight), Math.abs(seg.top - y), fromBack);
    const az = Math.abs(z);
    for (let i = 0; i < this.openings.length; i++) {
      const o = this.openings[i]!;
      if (az >= o.z0 && az <= o.z1 && y < o.height) kind = SURF_OPEN;
      d = Math.min(d, Math.abs(az - o.z0), Math.abs(az - o.z1));
    }
    const seams = this.seams[WALL_SIDE_LEFT]!;
    for (let i = 0; i < seams.length; i++) d = Math.min(d, Math.abs(z - seams[i]!));
    out.kind = kind;
    out.seamDist = d;
    return out;
  }

  private buildBack(wall: number): void {
    const bw = this.def.backWall;
    const hw = this.halfW;
    this.panels.push({ wall, kind: SURF_GLASS, u0: -hw, u1: hw, y0: 0, y1: bw.glassHeight });
    this.panels.push({ wall, kind: SURF_MESH, u0: -hw, u1: hw, y0: bw.glassHeight, y1: bw.top });
    const seams = this.seams[wall]!;
    const n = Math.round(this.def.width / bw.glassPanelWidth);
    for (let i = 1; i < n; i++) seams.push(-hw + (i * this.def.width) / n);
  }

  private buildSide(wall: number): void {
    const hl = this.halfL;
    const seams = this.seams[wall]!;
    for (const sign of [1, -1]) {
      for (const s of this.def.sideWall.segments) {
        const zA = sign * (hl - s.from);
        const zB = sign * (hl - s.to);
        const u0 = Math.min(zA, zB);
        const u1 = Math.max(zA, zB);
        if (s.glassHeight > 0) this.panels.push({ wall, kind: SURF_GLASS, u0, u1, y0: 0, y1: s.glassHeight });
        // Mesh fills from the glass top to the enclosure top, minus the door openings.
        this.pushMesh(wall, u0, u1, s.glassHeight, s.top);
        if (s.from > 0) seams.push(zA);
      }
      // Mesh frame posts every 2 m along the mesh section on framed courts.
      if (this.def.frame === 'posts') {
        const last = this.def.sideWall.segments[this.def.sideWall.segments.length - 1]!;
        for (let d = last.from + 2; d < last.to - 0.01; d += 2) seams.push(sign * (hl - d));
      }
    }
  }

  private pushMesh(wall: number, u0: number, u1: number, y0: number, y1: number): void {
    if (y1 <= y0) return;
    // Split the mesh strip around any openings (which only exist below the opening height).
    const cuts: Array<[number, number]> = [];
    for (const o of this.openings) {
      for (const [a, b] of [[o.z0, o.z1], [-o.z1, -o.z0]] as const) {
        if (b > u0 && a < u1) cuts.push([Math.max(a, u0), Math.min(b, u1)]);
      }
    }
    if (cuts.length === 0 || y0 >= this.openings[0]!.height) {
      this.panels.push({ wall, kind: SURF_MESH, u0, u1, y0, y1 });
      return;
    }
    cuts.sort((p, q) => p[0] - q[0]);
    const oh = this.openings[0]!.height;
    let cur = u0;
    for (const [a, b] of cuts) {
      if (a > cur) this.panels.push({ wall, kind: SURF_MESH, u0: cur, u1: a, y0, y1 });
      this.panels.push({ wall, kind: SURF_OPEN, u0: a, u1: b, y0, y1: oh });
      if (y1 > oh) this.panels.push({ wall, kind: SURF_MESH, u0: a, u1: b, y0: oh, y1 });
      cur = b;
    }
    if (cur < u1) this.panels.push({ wall, kind: SURF_MESH, u0: cur, u1, y0, y1 });
  }
}

function buildOpenings(def: CourtDef): Opening[] {
  const o = def.openings;
  if (o.perSide <= 0) return [];
  if (o.perSide === 1) return [{ z0: 0, z1: o.width / 2, height: o.height }];
  // Two openings per side flank the net post, separated by a divider post (FIP rule 13.b's "dividing vertical post").
  const z0 = o.dividerWidth / 2;
  return [{ z0, z1: z0 + o.width, height: o.height }];
}
