// tools/audio-dump.ts [outDir] [--no-wav] [--mix secs] [--arena club-day] [--floor 1]
// Renders every sound in the bank at its strengths to WAV and prints what a noise survey would read off it: peak
// frequency (third-octave smoothed), spectral centroid (flat and A-weighted), energy by octave band, attack, time to
// -20 and -40 dB, length, peak and LAFmax re full scale. With --mix it plays a simulated AI match through a model of
// the engine's chain (src/audio/offline.ts) and prints what the mix does: hits per second, repeats, levels by family,
// the limiter's work, the whole match's A-weighted third-octave spectrum against Piana et al.'s Fig. 6.
import { mkdirSync, writeFileSync } from 'node:fs';
import REF from '../data/audio-reference.json' with { type: 'json' };
import { AUDIO, arenaAudio, families, racketBin, renderFamily, renderRoom, type BankEnv, type FamilyDef, type Sample } from '../src/audio/bank.ts';
import { resample, SR } from '../src/audio/dsp.ts';
import { bands, lafmax, mono, OCTAVES, octaveBands, peakAndCentroid, thirdBands, THIRDS, times, wavBytes, aWeight, fastMax, sel } from '../src/audio/measure.ts';
import { OfflineEngine, convolve, offlineBank, type Listener } from '../src/audio/offline.ts';
import { Soundscape, type FeetSource } from '../src/audio/soundscape.ts';
import { FLOOR_NAMES, FL_TURF } from '../src/audio/voices.ts';
import * as Shots from '../src/sim/contact/shots.ts';
import { MatchSim, PH_TOSS, E_HIT, E_WALL, E_FLOOR } from '../src/sim/match.ts';
import { SURF_GLASS, SURF_MESH, WALL_BACK_NEAR, WALL_BACK_FAR } from '../src/sim/court/court.ts';

const SHOT_NAMES: Record<number, string> = {};
for (const [k, v] of Object.entries(Shots)) if (k.startsWith('SHOT_') && typeof v === 'number') SHOT_NAMES[v] = k.slice(5).toLowerCase();

const args = process.argv.slice(2);
const flag = (k: string, d: string): string => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
const has = (k: string): boolean => args.includes(k);
const out = args[0] && !args[0].startsWith('--') ? args[0] : 'sound-out';
const arena = flag('--arena', 'stadium');
const floor = Number(flag('--floor', String(FL_TURF)));
const env: BankEnv = { floor, arena };
const wavs = !has('--no-wav');
const dbl = (x: number): number => 20 * Math.log10(x + 1e-12);
const pad = (s: string | number, n: number): string => String(s).padStart(n);
mkdirSync(out, { recursive: true });

function at48(s: Sample): Float32Array[] {
  return s.ch.map((c) => (s.sr === SR ? c : resample(c, s.sr, SR)));
}

function binName(def: FamilyDef, b: number): string {
  if (def.name === 'racket') {
    const kind = ['drive', 'volley', 'over', 'slice', 'touch'][Math.floor(b / 9)];
    const pw = ['p.25', 'p.60', 'p.95'][Math.floor(b / 3) % 3];
    const q = ['clean', 'off', 'frame'][b % 3];
    return `${kind}-${pw}-${q}`;
  }
  return String(b);
}

function dumpFamilies(): void {
  const head = `${'sound'.padEnd(26)} ${pad('pk dB', 6)} ${pad('LAF', 6)} ${pad('peakHz', 7)} ${pad('centr', 6)} ${pad('Acent', 6)} ${pad('att ms', 6)} ${pad('t-20', 6)} ${pad('t-40', 6)} ${pad('len', 5)} | ` + OCTAVES.map((f) => pad(f >= 1000 ? `${f / 1000}k` : f, 5)).join('');
  console.log(`# bank: floor ${FLOOR_NAMES[floor]}, arena ${arena}; octave bands in dB re the sound's loudest band`);
  console.log(head);
  for (const def of families(env)) {
    const rows = renderFamily(def, env);
    rows.forEach((row, b) => {
      // Measure every variant, print the mean, write the first.
      const m = row.map((s) => {
        const x = mono(at48(s));
        const pc = peakAndCentroid(x), t = times(x), oct = octaveBands(x);
        let pk = 0; for (const c of s.ch) for (let i = 0; i < c.length; i++) pk = Math.max(pk, Math.abs(c[i]!));
        return { pk: dbl(pk), laf: lafmax(x), ...pc, ...t, oct };
      });
      const avg = (f: (v: (typeof m)[0]) => number): number => m.reduce((a, v) => a + f(v), 0) / m.length;
      const oct = OCTAVES.map((_, i) => 10 * Math.log10(m.reduce((a, v) => a + 10 ** (v.oct[i]! / 10), 0) / m.length));
      const top = Math.max(...oct);
      const name = `${def.name}-${binName(def, b)}`;
      console.log(`${name.padEnd(26)} ${pad(avg((v) => v.pk).toFixed(1), 6)} ${pad(avg((v) => v.laf).toFixed(1), 6)} ${pad(avg((v) => v.peak).toFixed(0), 7)} ${pad(avg((v) => v.centroid).toFixed(0), 6)} ${pad(avg((v) => v.aCentroid).toFixed(0), 6)} ${pad((avg((v) => v.attack) * 1000).toFixed(1), 6)} ${pad(avg((v) => v.t20).toFixed(3), 6)} ${pad(avg((v) => v.t40).toFixed(3), 6)} ${pad(avg((v) => v.len).toFixed(2), 5)} | ` + oct.map((d) => pad((d - top).toFixed(0), 5)).join(''));
      if (wavs) writeFileSync(`${out}/${name}.wav`, wavBytes(at48(row[0]!), SR));
    });
  }
}

// The broadcast camera behind the near back glass (render/views.ts: CAM_BACK behind the back wall, CAM_HEIGHT up,
// looking at the court's middle).
const LISTENER: Listener = { x: 0, y: 7.6, z: 25.5, fx: 0, fy: -0.25, fz: -1 };

/** Everything played in a match at 60 fps, avatars' soles as tests/audio/soundscape.test.ts draws them. */
function mix(secs: number): void {
  const bank = offlineBank(env);
  const mute = new Set(flag('--mute', '').split(',').filter(Boolean));
  const eng = new OfflineEngine({ env, secs, listener: LISTENER, bank, mute });
  const m = new MatchSim({ seed: 4242, doubles: true, human: [false, false, false, false], aiLevel: [1, 1] });
  const ss = new Soundscape(eng, arena, [-12.5, 12.5]);
  const feet: FeetSource[] = [0, 1, 2, 3].map(() => ({ feet: new Float64Array(6) }));
  const NONE = [null, null, null, null];
  const heard = new AuditSim();
  const phase = [0, 0.3, 0.6, 0.9];
  const fps = 60, dt = 1 / fps;
  let simT = 0, last = -1;
  for (let f = 0; f < secs * fps; f++) {
    simT += dt;
    eng.now = simT;
    while (m.time < simT) m.step(NONE as never);
    if (m.phase === PH_TOSS && last !== PH_TOSS) ss.routineBounce(0.5, 9.5);
    last = m.phase;
    for (let i = 0; i < 4; i++) {
      const p = m.players[i]!;
      const v = Math.hypot(p.vel.x, p.vel.z);
      phase[i] = phase[i]! + (v > 0.5 ? (1.6 + 0.48 * v) / 2 : 0.6) * dt;
      const f3 = feet[i]!.feet!;
      for (let k = 0; k < 2; k++) {
        f3[k * 3] = p.pos.x + (k ? 0.15 : -0.15);
        f3[k * 3 + 1] = Math.max(0, 0.08 * Math.sin(2 * Math.PI * (phase[i]! + 0.5 * k)));
        f3[k * 3 + 2] = p.pos.z;
      }
    }
    ss.update(m, simT, feet, dt);
    heard.read(m);
  }
  heard.print(secs);
  const r = eng.render();
  const name = `mix-${arena}-${FLOOR_NAMES[floor]}`;
  if (wavs) writeFileSync(`${out}/${name}.wav`, wavBytes([r.L, r.R], SR));
  // Sounds a second, by family; the identical sample again within 2 s.
  const count = new Map<string, number>();
  const lastSame = new Map<string, number>();
  let repeats = 0, nearby = 0;
  for (const p of r.log) {
    count.set(p.family, (count.get(p.family) ?? 0) + 1);
    const k = `${p.family}/${p.bin}/${p.variant}`;
    const l = lastSame.get(k);
    if (['racket', 'bounce', 'glass', 'mesh'].includes(p.family)) { nearby++; if (l !== undefined && p.t - l < 4) repeats++; }
    lastSame.set(k, p.t);
  }
  console.log(`\n# mix: ${name}, ${secs} s, master ${AUDIO.master + (AUDIO as { lift?: number }).lift!} dB`);
  console.log('plays by family (per second):', [...count].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n} (${(n / secs).toFixed(2)})`).join(', '));
  console.log(`same family/bin/variant again within 4 s: ${repeats} of ${nearby} impacts`);
  // Levels heard: peak (dB re full scale, before master) per family.
  const lv = new Map<string, number[]>();
  for (const p of r.log) { const a = lv.get(p.family) ?? []; a.push(p.heardDb); lv.set(p.family, a); }
  for (const [k, a] of lv) {
    a.sort((p, q) => p - q);
    console.log(`  heard peak before master ${k.padEnd(10)} median ${a[a.length >> 1]!.toFixed(1)}  top ${a[a.length - 1]!.toFixed(1)}`);
  }
  // The limiter.
  let grMin = 0, over = 0;
  for (let i = 0; i < r.gr.length; i++) { grMin = Math.min(grMin, r.gr[i]!); if (r.gr[i]! < -0.5) over++; }
  const peakPost = (ch: Float32Array): number => { let p = 0; for (let i = 0; i < ch.length; i++) p = Math.max(p, Math.abs(ch[i]!)); return dbl(p); };
  console.log(`limiter model: max reduction ${grMin.toFixed(1)} dB, working (more than 0.5 dB) ${(100 * over / r.gr.length).toFixed(1)}% of the time; peak before ${peakPost(r.preL).toFixed(1)} after ${peakPost(r.L).toFixed(1)} dBFS`);
  // Levels of the whole mix.
  const left = r.L;
  const a = aWeight(left);
  let e = 0; for (let i = 0; i < a.length; i++) e += a[i]! * a[i]!;
  console.log(`LAeq ${(10 * Math.log10(e / a.length)).toFixed(1)} dBFS  LAFmax ${fastMax(a).toFixed(1)} dBFS  (real court, Wadman et al.: LAeq 69.4, LAFmax 88.9 dBA, a gap of 19.5 dB)`);
  // A-weighted third octaves over the match against the shape of Piana et al. Fig. 6 (read off the figure, dB(A)).
  const piana = [40, 45, 50, 54, 58, 61, 62, 63, 64, 66, 69, 72, 74, 73.5, 75, 76, 79, 79, 78.5, 78, 75, 75.5, 75, 70, 66, 67, 64, 57];
  const t = thirdBands(r.L);
  const ta = t.map((d, i) => d + aDbAt(THIRDS[i]!));
  const top = Math.max(...ta), ptop = Math.max(...piana);
  console.log('third octave  ' + THIRDS.map((f) => pad(f >= 1000 ? `${(f / 1000).toFixed(1)}k` : Math.round(f), 5)).join(''));
  console.log('ours dB(A)    ' + ta.map((d) => pad((d - top).toFixed(0), 5)).join(''));
  console.log('Piana Fig. 6  ' + piana.map((d) => pad((d - ptop).toFixed(0), 5)).join(''));
  void sel;
  if (has('--solo')) {
    console.log('\neach family on its own in the mix, through the whole chain (left ear):');
    console.log(`${'family'.padEnd(10)} ${pad('LAeq', 7)} ${pad('LAFmax', 7)} ${pad('Acentroid', 9)}`);
    for (const k of ['racket', 'bounce', 'glass', 'mesh', 'metal', 'net', 'whoosh', 'step', 'scuff', 'grunt', 'applause', 'cheer', 'ooh', 'aah', 'murmur', 'hall', 'wind', 'bird', 'crickets', 'hum']) {
      if (!bank.has(k)) continue;
      const s = eng.render(new Set([k]));
      const aw = aWeight(s.L);
      let en = 0; for (let i = 0; i < aw.length; i++) en += aw[i]! * aw[i]!;
      if (en === 0) continue;
      console.log(`${k.padEnd(10)} ${pad((10 * Math.log10(en / aw.length)).toFixed(1), 7)} ${pad(fastMax(aw).toFixed(1), 7)} ${pad(peakAndCentroid(s.L).aCentroid.toFixed(0), 9)}`);
    }
  }
}

/** What the sim did, against what plays for it: racket contacts by kind, power and quality; walls by surface. */
class AuditSim {
  private seen = 0;
  private readonly rk = new Map<string, number>();
  private readonly wall = new Map<string, number>();
  private readonly speeds: Record<string, number[]> = { glass: [], mesh: [], floor: [], racket: [] };
  read(m: MatchSim): void {
    if (this.seen === 0) this.seen = Math.max(0, m.eventSeq - 1);
    while (this.seen < m.eventSeq) {
      const e = m.events[this.seen % m.events.length]!;
      this.seen++;
      if (e.kind === E_HIT) {
        const power = e.d > 0 ? Math.max(0, Math.min(1, (e.d - 4) / 36)) : Math.max(0, Math.min(1, (e.c - 5) / 35));
        const q = e.q >= 2 ? 'frame' : e.q > 0.55 ? 'off' : 'clean';
        const key = `${SHOT_NAMES[e.a] ?? e.a} ${q}`;
        this.rk.set(key, (this.rk.get(key) ?? 0) + 1);
        this.speeds.racket!.push(power);
      } else if (e.kind === E_WALL) {
        const court = m.world.court;
        const z = { kind: 0, seamDist: 0, joinDist: 0 };
        const zn = e.b === WALL_BACK_NEAR || e.b === WALL_BACK_FAR ? court.backZone(e.x, e.y, z) : court.sideZone(e.z, e.y, z);
        const s = e.a === SURF_GLASS ? 'glass' : e.a === SURF_MESH ? 'mesh' : 'other';
        const key = `${s}${zn.seamDist < 0.04 ? '+frame' : ''}`;
        this.wall.set(key, (this.wall.get(key) ?? 0) + 1);
        this.speeds[s]?.push(e.c);
      } else if (e.kind === E_FLOOR) this.speeds.floor!.push(e.c);
    }
  }
  print(secs: number): void {
    const med = (a: number[]): string => { const b = [...a].sort((x, y) => x - y); return b.length ? `median ${b[b.length >> 1]!.toFixed(2)} max ${b[b.length - 1]!.toFixed(2)} n ${b.length}` : 'none'; };
    console.log(`\n# sim over ${secs} s`);
    console.log('racket contacts:', [...this.rk].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', '));
    console.log('walls:', [...this.wall].map(([k, n]) => `${k} ${n}`).join(', '));
    for (const k of Object.keys(this.speeds)) console.log(`  ${k}: ${med(this.speeds[k]!)}${k === 'racket' ? ' (power 0..1)' : ' m/s'}`);
  }
}
function aDbAt(f: number): number {
  const f2 = f * f;
  return 20 * Math.log10((12194 ** 2 * f2 * f2) / ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2))) + 2;
}

/** The top bins against Wadman et al.'s spectra: dB per Hz over a third of an octave, against each curve's own top. */
function refCompare(): void {
  const bk = offlineBank(env);
  const avgPsd = (row: Sample[], fs: number[]): number[] => {
    const e = fs.map(() => 0);
    for (const s of row) {
      const b = bands(mono(at48(s)), fs, 2 ** (1 / 6));
      b.forEach((d, i) => { e[i] = e[i]! + 10 ** (d / 10); });
    }
    return e.map((x, i) => 10 * Math.log10(x / row.length / (fs[i]! * 0.2316)));
  };
  const show = (name: string, row: Sample[], ref: number[][]): void => {
    const fs = ref.map((p) => p[0]!), want = ref.map((p) => p[1]!);
    const got = avgPsd(row, fs);
    const off = got.reduce((a, d, i) => a + d - want[i]!, 0) / got.length;
    let rms = 0; for (let i = 0; i < got.length; i++) rms += (got[i]! - off - want[i]!) ** 2;
    console.log(`${name.padEnd(9)} f    ` + fs.map((f) => pad(f >= 1000 ? `${(f / 1000).toFixed(1)}k` : f, 6)).join(''));
    console.log(`          real ` + want.map((d) => pad(d, 6)).join(''));
    console.log(`          ours ` + got.map((d) => pad((d - off).toFixed(0), 6)).join('') + `   rms ${Math.sqrt(rms / got.length).toFixed(1)} dB`);
  };
  console.log('# against Wadman et al. Fig. 4.3.2 (dry renders, best level fit)');
  const R = REF.psd;
  show('racket', bk.get('racket')![racketBin(0, 2, 0)]!, R.racket);
  show('racket.6', bk.get('racket')![racketBin(0, 1, 0)]!, R.racket);
  show('glass', bk.get('glass')![3]!, R.glass);
  show('mesh', bk.get('mesh')![2]!, R.mesh);
  const laf = (s: Sample[]): number => s.reduce((a, x) => a + lafmax(mono(at48(x))), 0) / s.length;
  const r = laf(bk.get('racket')![racketBin(0, 2, 0)]!), g = laf(bk.get('glass')![3]!), m = laf(bk.get('mesh')![2]!);
  console.log(`LAFmax: racket ${r.toFixed(1)}  glass ${g.toFixed(1)} (${(g - r).toFixed(1)}, real +${(95.4 - 92.5).toFixed(1)})  mesh ${m.toFixed(1)} (${(m - r).toFixed(1)}, real ${(87.6 - 2.5 - 92.5).toFixed(1)} at equal distance)`);
  // A hard hit through the arena's room: the tail's peak envelope against the hit's peak, as read off Fig. 4.3.1.
  const a = arenaAudio(arena), hit = at48(bk.get('racket')![racketBin(0, 2, 0)]![0]!)[0]!;
  const room = renderRoom(arena);
  const x = new Float32Array(Math.round(1.2 * SR)); x.set(hit);
  const wet = convolve(x, room.ch[0]!, x.length);
  const wg = 10 ** (a.wet / 20);
  for (let i = 0; i < x.length; i++) x[i] = x[i]! + wet[i]! * wg;
  const pk = (t0: number, t1: number): number => { let p = 0; for (let i = Math.round(t0 * SR); i < t1 * SR; i++) p = Math.max(p, Math.abs(x[i]!)); return p; };
  const top = pk(0, 0.02);
  console.log(`hit's tail in ${arena}, peak in 10 ms against the hit (dB): ` + REF.hitTail.map(([t, d]) => `+${t! * 1000}ms real ${d} ours ${dbl(pk(t!, t! + 0.01) / top).toFixed(1)}`).join('  '));
  // The glass's 20 dB fall read the same way as Fig. 4.3.1 (about 0.2-0.4 s, in a cage), dry and through the room.
  const gl = at48(bk.get('glass')![3]![0]!)[0]!;
  const gx = new Float32Array(Math.round(1.2 * SR)); gx.set(gl);
  const gdry = gx.slice();
  const gw = convolve(gx, room.ch[0]!, gx.length);
  for (let i = 0; i < gx.length; i++) gx[i] = gx[i]! + gw[i]! * wg;
  const fall = (b: Float32Array): number => {
    let top20 = 0; for (let i = 0; i < b.length; i++) top20 = Math.max(top20, Math.abs(b[i]!));
    for (let i = b.length - 1; i >= 0; i--) if (Math.abs(b[i]!) >= top20 * 0.1) return i / SR;
    return 0;
  };
  console.log(`glass: last peak within 20 dB of the top, dry ${fall(gdry).toFixed(2)} s, through ${arena} ${fall(gx).toFixed(2)} s (real about 0.2-0.4)`);
  const mt = times(mono(at48(bk.get('mesh')![2]![0]!)));
  console.log(`mesh: attack ${(mt.attack * 1000).toFixed(0)} ms, t-20 ${mt.t20.toFixed(2)} s (real about 0.85), t-40 ${mt.t40.toFixed(2)}`);
}

if (has('--ref')) refCompare();
else if (!has('--mix-only')) dumpFamilies();
if (has('--mix') || has('--mix-only')) mix(Number(flag('--mix', flag('--mix-only', '120'))));
