// A person's header read as their file streams in (asset.ts readHeader): the loader asks for their textures from it
// before the rest of the file has come.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { bodyHeader, PEOPLE, readHeader } from '../../src/render/avatar/asset.ts';

/** `bytes` as a stream of `size`-byte chunks. */
function chunked(bytes: Uint8Array, size: number): ReadableStream<Uint8Array> {
  let at = 0;
  return new ReadableStream({
    pull(ctl) {
      if (at >= bytes.length) { ctl.close(); return; }
      ctl.enqueue(bytes.slice(at, at + size));
      at += size;
    },
  });
}

describe('a person header from the stream', () => {
  it('is the whole file\'s header, whatever the chunks, without reading the rest', async () => {
    for (const name of [PEOPLE[0]!, PEOPLE[9]!, 'meshy']) {
      const raw = gunzipSync(readFileSync(new URL(`../../public/assets/people/${name}.bnz`, import.meta.url)));
      const bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
      const whole = bodyHeader(bytes.slice().buffer);
      for (const size of [5, 12, 13, 4096, 65536]) {
        let pulled = 0;
        const s = chunked(bytes, size).pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(c, ctl) { pulled += c.byteLength; ctl.enqueue(c); } }));
        const h = await readHeader(s);
        expect(h, `${name} in ${size}-byte chunks`).toEqual(whole);
        // (it stopped near the header's end, not at the file's)
        expect(pulled, `${name} in ${size}-byte chunks`).toBeLessThan(bytes.length / 4);
      }
      expect(whole.textures.opaque, name).toMatch(/\.webp$/);
    }
  });

  it('a file that ends before its header gives none', async () => {
    expect(await readHeader(chunked(new Uint8Array([0x42, 0x4e, 0x44]), 2))).toBe(null);
  });
});
