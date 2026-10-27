// Minimal mutable 3-vector. Methods write into `this` so hot loops never allocate.
export class V3 {
  x: number;
  y: number;
  z: number;

  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  set(x: number, y: number, z: number): this {
    this.x = x; this.y = y; this.z = z;
    return this;
  }

  copy(v: V3): this {
    this.x = v.x; this.y = v.y; this.z = v.z;
    return this;
  }

  add(v: V3): this {
    this.x += v.x; this.y += v.y; this.z += v.z;
    return this;
  }

  addScaled(v: V3, s: number): this {
    this.x += v.x * s; this.y += v.y * s; this.z += v.z * s;
    return this;
  }

  scale(s: number): this {
    this.x *= s; this.y *= s; this.z *= s;
    return this;
  }

  dot(v: V3): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  lengthSq(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  length(): number {
    return Math.sqrt(this.lengthSq());
  }

  /** this = a × b (a, b must not alias this). */
  crossOf(a: V3, b: V3): this {
    return this.set(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
  }

  lerpOf(a: V3, b: V3, t: number): this {
    return this.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
  }
}
