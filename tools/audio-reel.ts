// tools/audio-reel.ts <dir>: a listening reel of the sound bank (reel-impacts.wav, reel-crowd.wav) and spectrograms
// (spec-*.png, log frequency 40 Hz - 16 kHz, 70 dB range), for checking the synthesis by eye and by ear (Phase 6).
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { buildBank, racketBin, RQ_CLEAN, RQ_OFF, RQ_FRAME, APPLAUSE_BIG, APPLAUSE_SMALL } from '../src/audio/bank.ts';
import { resample, SR } from '../src/audio/dsp.ts';
import { FL_TURF, FL_HARD } from '../src/audio/voices.ts';
const out = process.argv[2]!;
const turf = buildBank({ floor: FL_TURF, arena: 'stadium' });
const hard = buildBank({ floor: FL_HARD, arena: 'club-night' });
const day = buildBank({ floor: FL_TURF, arena: 'club-day' });
type B = typeof turf;
const parts: Array<[string, Float32Array]> = [];
const add = (label: string, b: B, fam: string, bin = 0, v = 0, gain = 1, secs = 0): void => {
  const s = b.get(fam)![bin]![v]!;
  let c = resample(s.ch[0]!, s.sr, SR);
  if (s.ch[1]) { const r = resample(s.ch[1]!, s.sr, SR); c = c.map((x, i) => 0.5 * (x + r[i]!)); }
  if (secs) c = c.slice(0, Math.round(secs * SR));
  parts.push([label, c.map((x) => x * gain)]);
};
const impacts: Array<[string, Float32Array]> = [];
// Impacts reel
for (const [l, k, p, q] of [['soft drive', 0, 0, RQ_CLEAN], ['hard drive', 0, 2, RQ_CLEAN], ['off-centre', 0, 1, RQ_OFF], ['frame', 0, 1, RQ_FRAME], ['slice', 3, 1, RQ_CLEAN], ['volley', 1, 1, RQ_CLEAN], ['smash', 2, 2, RQ_CLEAN], ['drop', 4, 0, RQ_CLEAN]] as const) add(l, turf, 'racket', racketBin(k, p, q));
for (let b = 0; b < 4; b++) add('bounce turf ' + b, turf, 'bounce', b);
for (let b = 0; b < 4; b++) add('bounce hard ' + b, hard, 'bounce', b);
for (let b = 0; b < 4; b++) add('glass ' + b, turf, 'glass', b);
for (let b = 0; b < 3; b++) add('mesh ' + b, turf, 'mesh', b);
add('post', turf, 'metal', 1); add('net post', turf, 'metal', 3); add('net body', turf, 'net', 1); add('net cord', turf, 'net', 3);
for (let v = 0; v < 3; v++) add('whoosh', turf, 'whoosh', v);
for (let v = 0; v < 4; v++) add('step turf', turf, 'step', 1, v, 8);
add('scuff turf', turf, 'scuff', 0, 0, 6); add('step hard', hard, 'step', 1, 0, 8); add('squeak', hard, 'scuff', 0, 0, 6);
for (let p = 0; p < 4; p++) add('grunt ' + p, turf, 'grunt', p * 3 + 2);
add('grunt light', turf, 'grunt', 1);
impacts.push(...parts.splice(0));
add('applause small', turf, 'applause', APPLAUSE_SMALL, 0, 1);
add('applause big', turf, 'applause', APPLAUSE_BIG);
add('cheer', turf, 'cheer'); add('ooh', turf, 'ooh'); add('aah', turf, 'aah');
add('murmur', turf, 'murmur', 0, 0, 3, 4);
add('club applause', day, 'applause', APPLAUSE_BIG);
add('wind', day, 'wind', 0, 0, 3, 3);
{
  // Birds as the game plays them: calls at random from the trees over the wind.
  const w = resample(day.get('wind')![0]![0]!.ch[0]!, 24000, SR).slice(0, 4 * SR).map((x) => x * 3);
  let t = 0.2;
  for (let k = 0; t < 3.5; k++) {
    const c = resample(day.get('bird')![0]![k % 6]!.ch[0]!, 24000, SR);
    const o = Math.round(t * SR);
    for (let i = 0; i < c.length && o + i < w.length; i++) w[o + i] = w[o + i]! + c[i]! * 0.5;
    t += 0.6 + ((k * 0.37) % 1) * 1.2;
  }
  parts.push(['wind+birds', w]);
}
add('crickets', hard, 'crickets', 0, 0, 4, 3);
const crowd = parts.splice(0);
function join(list: Array<[string, Float32Array]>, gap: number): { x: Float32Array; marks: Array<[string, number]> } {
  const n = list.reduce((a, [, c]) => a + c.length + Math.round(gap * SR), 0);
  const x = new Float32Array(n); const marks: Array<[string, number]> = [];
  let o = 0;
  for (const [l, c] of list) { marks.push([l, o / SR]); x.set(c, o); o += c.length + Math.round(gap * SR); }
  return { x, marks };
}
function wav(path: string, x: Float32Array): void {
  const n = x.length, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(x[i]! * 32767))), 44 + i * 2);
  writeFileSync(path, buf);
}
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j]!, re[i]!]; [im[i], im[j]] = [im[j]!, im[i]!]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) {
      const ur = re[i + k]!, ui = im[i + k]!, vr = re[i + k + len / 2]! * cr - im[i + k + len / 2]! * ci, vi = re[i + k + len / 2]! * ci + im[i + k + len / 2]! * cr;
      re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
      const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
  }
}
function png(path: string, x: Float32Array, hop: number): void {
  const N = 1024, H = 320, W = Math.floor((x.length - N) / hop);
  const img = Buffer.alloc((W * 3 + 1) * H);
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let c = 0; c < W; c++) {
    for (let i = 0; i < N; i++) { re[i] = x[c * hop + i]! * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1))); im[i] = 0; }
    fft(re, im);
    for (let r = 0; r < H; r++) {
      // Log frequency 40 Hz - 16 kHz, bottom to top.
      const f = 40 * Math.pow(16000 / 40, r / (H - 1)), k = Math.min(N / 2 - 1, Math.round(f / SR * N));
      const db = 10 * Math.log10(re[k]! ** 2 + im[k]! ** 2 + 1e-12);
      const v = Math.max(0, Math.min(1, (db + 40) / 70));
      const o = (H - 1 - r) * (W * 3 + 1) + 1 + c * 3;
      img[o] = Math.round(255 * Math.min(1, v * 1.8)); img[o + 1] = Math.round(255 * Math.max(0, v * 1.6 - 0.5)); img[o + 2] = Math.round(255 * Math.max(0, 1 - Math.abs(v - 0.35) * 3) * 0.8);
    }
  }
  for (let r = 0; r < H; r++) img[r * (W * 3 + 1)] = 0;
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const chunk = (t: string, d: Buffer): Buffer => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); let c = -1; for (const b of td) c = crcT[(c ^ b) & 255]! ^ (c >>> 8); const crc = Buffer.alloc(4); crc.writeInt32BE(~c); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(img)), chunk('IEND', Buffer.alloc(0))]));
}
const a = join(impacts, 0.25), b = join(crowd, 0.4);
wav(out + '/reel-impacts.wav', a.x); wav(out + '/reel-crowd.wav', b.x);
png(out + '/spec-impacts.png', a.x, 240); png(out + '/spec-crowd.png', b.x, 480);
console.log('impacts', (a.x.length / SR).toFixed(1), 's'); for (const [l, t] of a.marks) console.log(t.toFixed(2), l);
console.log('crowd', (b.x.length / SR).toFixed(1), 's'); for (const [l, t] of b.marks) console.log(t.toFixed(2), l);
png(out + '/spec-racket.png', a.x.slice(0, Math.round(3.6 * SR)), 96);
png(out + '/spec-walls.png', a.x.slice(Math.round(3.6 * SR), Math.round(16.5 * SR)), 300);
