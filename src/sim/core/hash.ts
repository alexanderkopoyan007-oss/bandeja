// FNV-1a over the raw bytes of numbers: a cheap exact fingerprint of sim state for determinism checks.
const buf = new Float64Array(1);
const bytes = new Uint8Array(buf.buffer);

export class Hasher {
  h = 0x811c9dc5;

  reset(): this {
    this.h = 0x811c9dc5;
    return this;
  }

  num(v: number): this {
    buf[0] = v;
    let h = this.h;
    for (let i = 0; i < 8; i++) {
      h ^= bytes[i]!;
      h = Math.imul(h, 0x01000193);
    }
    this.h = h >>> 0;
    return this;
  }
}
