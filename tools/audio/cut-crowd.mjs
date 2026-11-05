// node tools/audio/cut-crowd.mjs: cuts the stadium's applause takes out of a CC0 recording of a tennis crowd
// (Freesound 819358 by treytatum3, its HQ preview converted to 24 kHz stereo WAV at
// assets-src/crowd-819358/stereo24.wav, not in the repo) into public/assets/audio/crowd-applause.wav, and prints the
// manifest for data/audio.json "takes". Only stretches of applause were taken, chosen where no single voice stands
// out (no announcer, no calls): see DECISIONS.md, "Real applause for the stadium".
import fs from 'node:fs';
const SRC = 'assets-src/crowd-819358/stereo24.wav', OUT = 'public/assets/audio/crowd-applause.wav';
// [start s in the recording, length s, fade-in s]: big points' applause (onset to before the next voice) and ordinary ones.
const BIG = [[805.0, 4.25, 0.02], [455.0, 4.5, 0.02], [625.25, 4.25, 0.02], [507.0, 4.2, 0.02]];
const SMALL = [[169.0, 2.2, 0.02], [391.25, 2.2, 0.02], [626.0, 2.2, 0.12], [273.25, 2.2, 0.12]];
const FADE_OUT = { big: 0.6, small: 0.5 };
const b = fs.readFileSync(SRC);
let off = 12, sr = 0, chn = 0, data = 0, len = 0;
while (off < b.length) {
  const id = b.toString('ascii', off, off + 4), sz = b.readUInt32LE(off + 4);
  if (id === 'fmt ') { chn = b.readUInt16LE(off + 10); sr = b.readUInt32LE(off + 12); }
  if (id === 'data') { data = off + 8; len = sz; break; }
  off += 8 + sz;
}
if (chn !== 2 || sr !== 24000) throw new Error(`want 24 kHz stereo, got ${sr} Hz ${chn} ch`);
const frames = [], manifest = { big: [], small: [] };
let at = 0;
for (const [kind, list] of [['big', BIG], ['small', SMALL]]) {
  for (const [start, secs, fin] of list) {
    const n = Math.round(secs * sr), s0 = Math.round(start * sr), fo = Math.round(FADE_OUT[kind] * sr), fi = Math.round(fin * sr);
    const out = Buffer.alloc(n * 4);
    for (let i = 0; i < n; i++) {
      const g = Math.min(1, i / fi) * Math.min(1, (n - 1 - i) / fo) ** 2;
      for (let c = 0; c < 2; c++) out.writeInt16LE(Math.round(b.readInt16LE(data + ((s0 + i) * 2 + c) * 2) * g), (i * 2 + c) * 2);
    }
    frames.push(out);
    manifest[kind].push([+(at / sr).toFixed(4), secs]);
    at += n;
  }
}
const pcm = Buffer.concat(frames), h = Buffer.alloc(44);
h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20);
h.writeUInt16LE(2, 22); h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34);
h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
fs.writeFileSync(OUT, Buffer.concat([h, pcm]));
console.log(JSON.stringify({ file: 'assets/audio/crowd-applause.wav', ...manifest }));
