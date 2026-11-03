// What crosses the wire. An input packet holds one seat's frames, runs of identical ones as one, plus who heard what: `ack`
// is the newest of the receiver's frames the sender holds, `tick` the sender's clock, and hashTick/hash a confirmed state to
// compare. Little-endian, as DataView is told to be on every machine.
import { evTime, TIME_GRID, type Frame, type Packet } from './rollback.ts';

export const P_INPUT = 1;
export const P_PING = 2;
export const P_PONG = 3;
/** A seat given to the AI, on the data channels as well as through the room: an input packet whose `tick` is the tick it happens. */
export const P_SEAT = 4;

export interface InputPacket extends Packet { tick: number; hashTick: number; hash: number }

const HEADER = 24;
const buf = new ArrayBuffer(8192), W = new DataView(buf);
const F_AIM = 1;
const F_EV = 2;

const sameFrame = (a: Frame, b: Frame): boolean => a === b
  || (a.x === b.x && a.y === b.y && a.held === b.held && a.aim === b.aim && a.tx === b.tx && a.tz === b.tz && a.ev.length === 0 && b.ev.length === 0);

export function encodeInput(p: InputPacket, kind = P_INPUT): ArrayBuffer {
  W.setUint8(0, kind);
  W.setUint8(1, p.seat);
  W.setUint16(2, p.frames.length, true);
  W.setUint32(4, p.first, true);
  W.setUint32(8, p.ack + 1, true);
  W.setUint32(12, p.tick, true);
  W.setUint32(16, p.hashTick, true);
  W.setUint32(20, p.hash >>> 0, true);
  let o = HEADER;
  for (let i = 0; i < p.frames.length;) {
    const f = p.frames[i]!, ev = f.ev.length;
    let run = 1;
    if (ev === 0) while (run < 255 && i + run < p.frames.length && sameFrame(f, p.frames[i + run]!)) run++;
    if (o + 64 + 7 * ev > buf.byteLength) throw new Error('packet too long');
    W.setUint8(o, run);
    W.setInt8(o + 1, Math.round(f.x * 127));
    W.setInt8(o + 2, Math.round(f.y * 127));
    W.setUint8(o + 3, (f.aim ? F_AIM : 0) | (ev > 0 ? F_EV : 0));
    W.setUint16(o + 4, f.held, true);
    o += 6;
    if (f.aim) { W.setFloat32(o, f.tx, true); W.setFloat32(o + 4, f.tz, true); o += 8; }
    if (ev > 0) {
      W.setUint8(o++, ev);
      for (const e of f.ev) {
        W.setUint16(o, e[1] | (e[0] ? 0x8000 : 0), true);
        W.setInt32(o + 2, Math.round((e[2] - evTime(p.first + i, 0)) * TIME_GRID), true);
        o += 6;
      }
    }
    i += run;
  }
  return buf.slice(0, o);
}

/** The most frames a packet carries. Runs would let 1.5 KB claim 65,535 of them. */
export const MAX_FRAMES = 256;

export function decodeInput(b: ArrayBuffer): InputPacket {
  const R = new DataView(b), count = R.getUint16(2, true), first = R.getUint32(4, true), frames: Frame[] = [];
  if (count > MAX_FRAMES) throw new Error('packet too long');
  let o = HEADER;
  while (frames.length < count) {
    const run = R.getUint8(o), x = R.getInt8(o + 1) / 127, y = R.getInt8(o + 2) / 127, fl = R.getUint8(o + 3), held = R.getUint16(o + 4, true);
    o += 6;
    let tx = 0, tz = 0;
    if ((fl & F_AIM) !== 0) { tx = R.getFloat32(o, true); tz = R.getFloat32(o + 4, true); o += 8; }
    const ev: Frame['ev'] = [];
    if ((fl & F_EV) !== 0) {
      const n = R.getUint8(o++);
      for (let i = 0; i < n; i++) {
        const v = R.getUint16(o, true);
        ev.push([(v & 0x8000) !== 0, v & 0x7fff, evTime(first + frames.length, R.getInt32(o + 2, true) / TIME_GRID)]);
        o += 6;
      }
    }
    const f: Frame = { x, y, held, ev, aim: (fl & F_AIM) !== 0, tx, tz };
    for (let i = 0; i < run; i++) frames.push(f);
  }
  return { seat: R.getUint8(1), first, frames, ack: R.getUint32(8, true) - 1, tick: R.getUint32(12, true), hashTick: R.getUint32(16, true), hash: R.getUint32(20, true) };
}

export const encodeClock = (kind: number, a: number, b = 0): ArrayBuffer => {
  W.setUint8(0, kind);
  W.setFloat64(8, a, true);
  W.setFloat64(16, b, true);
  return buf.slice(0, 24);
};
