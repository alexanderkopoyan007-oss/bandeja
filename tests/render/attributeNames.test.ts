// A geometry attribute's name becomes an identifier in the generated shader, so a reserved word breaks the pipeline
// on one backend only: the crowd's first attribute was 'where', which WGSL reserves, and on WebGPU (the default in
// Chrome) the stadium's pipeline failed and the game never started, while WebGL ran it. Every custom attribute name
// in src/ is checked against WGSL's keywords and reserved words and GLSL ES 3.0's.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const WGSL = `alias break case const const_assert continue continuing default diagnostic discard else enable false fn for
if let loop override requires return struct switch true var while NULL Self abstract active alignas alignof as asm
asm_fragment async attribute auto await become binding_array cast catch class co_await co_return co_yield coherent
column_major common compile compile_fragment concept const_cast consteval constexpr constinit crate debugger decltype
delete demote demote_to_helper do dynamic_cast enum explicit export extends extern external fallthrough filter final
finally friend from fxgroup get goto groupshared highp impl implements import inline instanceof interface layout lowp
macro macro_rules match mediump meta mod module move mut mutable namespace new nil noexcept noinline nointerpolation
noperspective null nullptr of operator package packoffset partition pass patch pixelfragment precise precision
premerge priv protected pub public readonly ref regardless register reinterpret_cast require resource restrict self
set shared sizeof smooth snorm static static_assert static_cast std subroutine super target template this
thread_local throw trait try type typedef typeid typename typeof union unless unorm unsafe unsized use using varying
virtual volatile wgsl where with writeonly yield bool f16 f32 i32 u32 vec2 vec3 vec4 mat2x2 mat3x3 mat4x4 array
atomic ptr sampler texture_2d`;
const GLSL = `attribute const uniform varying buffer shared coherent volatile restrict readonly writeonly atomic_uint layout
centroid flat smooth noperspective patch sample break continue do for while switch case default if else subroutine in
out inout float double int void bool true false invariant precise discard return lowp mediump highp precision struct
common partition active asm class union enum typedef template this resource goto inline noinline public static extern
external interface long short half fixed unsigned superp input output filter sizeof cast namespace using`;
const RESERVED = new Set(`${WGSL} ${GLSL}`.split(/\s+/).filter(Boolean));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('shader attribute names', () => {
  it('no geometry attribute is a WGSL or GLSL reserved word', () => {
    const bad: string[] = [];
    let seen = 0;
    for (const f of files('src')) {
      const src = readFileSync(f, 'utf8');
      // Geometry attributes (setAttribute on a BufferGeometry, not a DOM element's) and TSL's attribute() reads.
      const re = /(?:\.setAttribute\(\s*|\battribute(?:<[^>]*>)?\(\s*)'([A-Za-z_][A-Za-z0-9_]*)'\s*,?/g;
      for (const m of src.matchAll(re)) {
        const before = src.slice(Math.max(0, m.index! - 40), m.index!);
        if (/(el|button|input|root|node|div|svg|item|this\.\w+|document\.\w+)\s*$/.test(before) && !/geo|geometry|\bg\s*$/.test(before)) continue;
        seen++;
        if (RESERVED.has(m[1]!)) bad.push(`${f}: '${m[1]}'`);
      }
    }
    expect(seen).toBeGreaterThan(10);
    expect(bad).toEqual([]);
  });

  it('the check catches the name that broke the crowd', () => {
    expect(RESERVED.has('where')).toBe(true);
    expect(RESERVED.has('seatAt')).toBe(false);
  });
});
