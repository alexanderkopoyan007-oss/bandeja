// Copying one match's state into another built the same way (MatchSim.copyFrom: replays re-run a point from where it
// started). Pure data walking: nothing here knows the sim's classes.

type Obj = Record<string, unknown>;

/**
 * Copy the state of the object graph `src` into `dst`, a graph built the same way (the same constructor and
 * config). Numbers, booleans and strings are copied over; typed arrays are copied into the destination's own (made
 * anew if the length differs); arrays and objects are walked into, so the destination keeps its objects and their
 * shapes (the sim's code stays monomorphic). A reference `src` shares (a ball's cloth is the match's net) becomes
 * the destination's counterpart, shared the same way; one where the two graphs hold the very same object (data
 * tables) is left alone. Functions stay the destination's (their closures are its own). Where the destination has
 * nothing of the kind (an array grown during play), a copy is made.
 *
 * `seen` maps source objects to their counterparts; pass a new or cleared Map.
 */
export function copyState(dst: object, src: object, seen: Map<object, object>): void {
  seen.set(src, dst);
  if (Array.isArray(src)) {
    const d = dst as unknown[];
    if (d.length > src.length) d.length = src.length;
    for (let i = 0; i < src.length; i++) d[i] = value(d[i], src[i], seen);
    return;
  }
  const d = dst as Obj;
  const s = src as Obj;
  for (const k of Object.keys(s)) d[k] = value(d[k], s[k], seen);
}

function value(t: unknown, v: unknown, seen: Map<object, object>): unknown {
  if (v === null || typeof v !== 'object') return typeof v === 'function' ? t : v;
  if (t === v) { seen.set(v, t); return t; }
  const mapped = seen.get(v);
  if (mapped !== undefined) return mapped;
  if (ArrayBuffer.isView(v)) {
    const a = v as unknown as Float64Array;
    const ta = t as Float64Array | undefined;
    if (ta && ta.constructor === a.constructor && ta.length === a.length) ta.set(a);
    else t = a.slice();
    seen.set(v, t as object);
    return t;
  }
  if (t !== null && typeof t === 'object' && Object.getPrototypeOf(t) === Object.getPrototypeOf(v) && !(v instanceof Map) && !(v instanceof Set)) {
    copyState(t, v, seen);
    return t;
  }
  return clone(v, seen);
}

/** A deep copy of `v` (its prototype kept), for where the destination has no counterpart. */
function clone(v: object, seen: Map<object, object>): object {
  if (v instanceof Map) {
    const m = new Map();
    seen.set(v, m);
    for (const [k, x] of v) m.set(k, x !== null && typeof x === 'object' ? (seen.get(x) ?? clone(x, seen)) : x);
    return m;
  }
  if (v instanceof Set) {
    const m = new Set();
    seen.set(v, m);
    for (const x of v) m.add(x !== null && typeof x === 'object' ? (seen.get(x) ?? clone(x, seen)) : x);
    return m;
  }
  const c = (Array.isArray(v) ? [] : Object.create(Object.getPrototypeOf(v))) as object;
  copyState(c, v, seen);
  return c;
}
