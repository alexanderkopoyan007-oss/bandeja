// node tools/audio/cut-grunts.mjs: cuts the players' recorded grunts out of four CC0 Freesound recordings (their HQ
// previews as 24 kHz mono WAVs in assets-src/grunts-cc0/, not in the repo; CREDITS.md) into
// public/assets/audio/grunts.wav, and prints the manifest for data/audio.json "gruntTakes". Each voice (voices.ts
// PLAYER_VOICES) gets nine takes: effort bins 0.25, 0.6, 0.95 (bank.ts GRUNT_E) by three variants, quietest grunts for
// the lightest bin. Each take is peak-normalised; the bank sets its level by effort.
import fs from 'node:fs';
const DIR = 'assets-src/grunts-cc0/', OUT = 'public/assets/audio/grunts.wav', SR = 24000;
// [recording, onset s, grunt length s] per slot (bin * 3 + variant), found by tools in $SP/grunt/tools (events.mjs).
const FIGHT = '511023', GROAN = '803168', COURT = '803251', WOMAN = '507730';
const VOICES = {
  // a man's fight grunts, his longer ones (the held voice)
  0: [[FIGHT, 11.48, 0.52], [FIGHT, 7.26, 0.39], [FIGHT, 20.41, 0.42], [FIGHT, 0.54, 0.59], [FIGHT, 5.38, 0.54], [FIGHT, 18.29, 0.52], [FIGHT, 9.10, 0.54], [FIGHT, 26.32, 0.57], [FIGHT, 13.77, 0.56]],
  // the same man's short ones, pitched up (bank: gruntPitch) so the two don't read as one person
  1: [[FIGHT, 24.68, 0.33], [FIGHT, 27.54, 0.26], [FIGHT, 7.71, 0.37], [FIGHT, 16.68, 0.42], [FIGHT, 24.36, 0.28], [FIGHT, 17.16, 0.34], [FIGHT, 23.55, 0.34], [FIGHT, 22.29, 0.46], [FIGHT, 21.34, 0.35]],
  // grunts from a real tennis match (two men on a court; the pitches that are grunts, not talk)
  2: [[COURT, 21.55, 0.15], [COURT, 23.59, 0.18], [COURT, 124.83, 0.17], [COURT, 22.18, 0.25], [COURT, 25.0, 0.26], [COURT, 21.88, 0.18], [COURT, 128.82, 0.52], [COURT, 99.16, 0.46], [COURT, 125.53, 0.31]],
  // a man's short exertion groans, pitched down
  3: [[GROAN, 1.57, 0.44], [GROAN, 13.39, 0.5], [GROAN, 2.94, 0.43], [GROAN, 13.39, 0.5], [GROAN, 1.57, 0.44], [GROAN, 0.17, 0.48], [GROAN, 0.17, 0.48], [GROAN, 2.94, 0.43], [GROAN, 11.65, 0.5]],
  // a woman's effort grunt (the one CC0 recording found), its variants by pitch (bank)
  4: Array.from({ length: 9 }, () => [WOMAN, 0.0, 0.32]),
  6: Array.from({ length: 9 }, () => [WOMAN, 0.0, 0.32]),
};
// The court recording's grunts start on a ball hit: skip the hit (the game plays its own racket).
const SKIP = { [COURT]: 0.02 }, PRE = 0.01, TAIL = 0.08, FADE_IN = 0.005, FADE_OUT = 0.06;
const src = {};
function read(id) {
  if (src[id]) return src[id];
  const b = fs.readFileSync(DIR + id + '.wav');
  let off = 12, sr = 0, chn = 0, data = 0, len = 0;
  while (off < b.length) { const t = b.toString('ascii', off, off + 4), sz = b.readUInt32LE(off + 4); if (t === 'fmt ') { chn = b.readUInt16LE(off + 10); sr = b.readUInt32LE(off + 12); } if (t === 'data') { data = off + 8; len = sz; break; } off += 8 + sz; }
  if (sr !== SR || chn !== 1) throw new Error(`${id}: want ${SR} Hz mono`);
  const x = new Float32Array(len >> 1); for (let i = 0; i < x.length; i++) x[i] = b.readInt16LE(data + 2 * i) / 32768;
  return (src[id] = x);
}
const parts = [], manifest = {};
let at = 0;
for (const [v, slots] of Object.entries(VOICES)) {
  manifest[v] = [];
  for (const [id, t, l] of slots) {
    const x = read(id), s0 = Math.max(0, Math.round((t - PRE + (SKIP[id] ?? 0)) * SR)), n = Math.min(Math.round((l + TAIL) * SR), x.length - s0);
    const c = x.slice(s0, s0 + n), fi = Math.round(FADE_IN * SR), fo = Math.round(FADE_OUT * SR);
    let pk = 1e-9; for (let i = 0; i < n; i++) { c[i] *= Math.min(1, i / fi) * Math.min(1, (n - 1 - i) / fo) ** 2; pk = Math.max(pk, Math.abs(c[i])); }
    for (let i = 0; i < n; i++) c[i] = (c[i] / pk) * 0.9;
    parts.push(c);
    manifest[v].push([+(at / SR).toFixed(5), +(n / SR).toFixed(5)]);
    at += n;
  }
}
const pcm = Buffer.alloc(at * 2); let o = 0;
for (const c of parts) for (let i = 0; i < c.length; i++, o += 2) pcm.writeInt16LE(Math.round(c[i] * 32767), o);
const h = Buffer.alloc(44);
h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
fs.writeFileSync(OUT, Buffer.concat([h, pcm]));
console.log(JSON.stringify({ file: 'assets/audio/grunts.wav', voices: manifest }));
