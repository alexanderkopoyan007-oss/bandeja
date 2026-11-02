// The engine's signal chain worked out sample by sample without a browser (tools and tests only; the game uses
// engine.ts). Same pool, same distance law, air filter, equal-power panner, sends, buses, convolution, master gain, and
// a model of the limiter and the soft clip. Keep it in step with engine.ts. The limiter is a model of a
// DynamicsCompressorNode (a 6 ms look-ahead as in Chromium, the node's attack and release on the linked peak), not the
// node itself: read its gain reduction as an estimate.
import { AUDIO, AMB_SEND, BED_SEND, CROWD_SEND, arenaAudio, renderFamily, renderRoom, families, type BankEnv, type Sample } from './bank.ts';
import { Biquad, resample, SR } from './dsp.ts';
import { fft, pow2 } from './measure.ts';
import { BUS_CROWD, BUS_AMB, type AudioSink } from './sink.ts';

const db = (x: number): number => Math.pow(10, x / 20);
const POOL = 32;

/** One thing the sink was asked to play (for the audit). */
export interface PlayLog { t: number; family: string; bin: number; variant: number; x: number; y: number; z: number; gain: number; flat: boolean; heardDb: number }

interface Scheduled { at: number; family: string; bin: number; variant: number; x: number; y: number; z: number; gain: number; rate: number; offset: number; bus: number; flat: boolean }

export interface Listener { x: number; y: number; z: number; fx: number; fy: number; fz: number }

export interface OfflineOpts {
  env: BankEnv;
  secs: number;
  listener: Listener;
  /** Prebuilt bank (a run over the same floor and arena reuses it). */
  bank?: Map<string, Sample[][]>;
  /** master gain in dB; default what the engine uses. */
  masterDb?: number;
  /** Families left out of the mix, to hear or measure the rest. */
  mute?: Set<string>;
}

export interface OfflineResult {
  L: Float32Array; R: Float32Array;
  /** Before the limiter and clip (for the gain reduction). */
  preL: Float32Array; preR: Float32Array;
  /** Limiter gain reduction in dB per sample (0 or negative). */
  gr: Float32Array;
  /** The dry (bus) signal before the reverb and master, left and right, by family group. */
  log: PlayLog[];
}

/** Build a bank for the sink. */
export function offlineBank(env: BankEnv): Map<string, Sample[][]> {
  const m = new Map<string, Sample[][]>();
  for (const d of families(env)) m.set(d.name, renderFamily(d, env));
  return m;
}

export class OfflineEngine implements AudioSink {
  readonly live = true;
  now = 0;
  private readonly o: OfflineOpts;
  private readonly bank: Map<string, Sample[][]>;
  private readonly n: number;
  private readonly sched: Scheduled[] = [];
  private seed = 12345;
  private readonly lastVariant = new Map<string, Int32Array>();
  private readonly loops = new Map<string, Array<{ t: number; gain: number; tc: number }>>();
  private readonly voiceUntil = new Float64Array(POOL);
  private nextVoice = 0;
  readonly log: PlayLog[] = [];

  constructor(o: OfflineOpts) {
    this.o = o;
    this.bank = o.bank ?? offlineBank(o.env);
    this.n = Math.round(o.secs * SR);
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  private pick(family: string, bin: number, n: number): number {
    let lv = this.lastVariant.get(family);
    if (!lv) { lv = new Int32Array(this.bank.get(family)?.length ?? 1).fill(-1); this.lastVariant.set(family, lv); }
    const last = lv[bin]!;
    let v = Math.floor(this.rand() * n);
    if (n > 1 && v === last) v = (v + 1 + Math.floor(this.rand() * (n - 1))) % n;
    lv[bin] = v;
    return v;
  }

  play(family: string, bin: number, x: number, y: number, z: number, gain: number, rate: number, delay: number, bus: number, offset = 0): void {
    const row = this.bank.get(family)?.[bin];
    if (!row || row.length === 0) return;
    const variant = this.pick(family, bin, row.length);
    const r = 1 + (this.rand() - 0.5) * 0.06;
    const g = gain * db((this.rand() - 0.5) * 3);
    const at = this.now + Math.max(0, delay);
    this.sched.push({ at, family, bin, variant, x, y, z, gain: g, rate: rate * r, offset, bus, flat: false });
  }

  playFlat(family: string, bin: number, gain: number, delay: number, bus: number): void {
    const row = this.bank.get(family)?.[bin];
    if (!row || row.length === 0) return;
    const variant = this.pick(family, bin, row.length);
    const r = 1 + (this.rand() - 0.5) * 0.04;
    this.sched.push({ at: this.now + Math.max(0, delay), family, bin, variant, x: 0, y: 0, z: 0, gain, rate: r, offset: 0, bus, flat: true });
  }

  loop(name: string, gain: number, tc: number): void {
    let l = this.loops.get(name);
    if (!l) { l = []; this.loops.set(name, l); }
    l.push({ t: this.now, gain, tc });
  }

  /** Equal-power panner gains for a source, as the WebAudio spec works them out (listener up is about +y). */
  private pan(x: number, y: number, z: number): { l: number; r: number; d: number } {
    const L = this.o.listener;
    const dx = x - L.x, dy = y - L.y, dz = z - L.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    // right = forward x up
    let rx = -L.fz, rz = L.fx;
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl; rz /= rl;
    const fl = Math.hypot(L.fx, L.fy, L.fz) || 1;
    const fx = L.fx / fl, fy = L.fy / fl, fz = L.fz / fl;
    // up = right x forward
    const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
    const dn = d || 1;
    const sx = dx / dn, sy = dy / dn, sz = dz / dn;
    // project onto the listener's horizontal plane
    const up = sx * ux + sy * uy + sz * uz;
    const px = sx - up * ux, py = sy - up * uy, pz = sz - up * uz;
    const pl = Math.hypot(px, py, pz) || 1;
    let az = (Math.acos(Math.max(-1, Math.min(1, (px * rx + pz * rz) / pl))) * 180) / Math.PI;
    az = (px * fx + py * fy + pz * fz) >= 0 ? 90 - az : az - 90 + 0; // front: azimuth from straight ahead, right positive
    if (az > 90) az = 180 - az;
    if (az < -90) az = -180 - az;
    const u = (az + 90) / 180;
    const distGain = AUDIO.distance.ref / (AUDIO.distance.ref + AUDIO.distance.rolloff * (Math.max(AUDIO.distance.ref, Math.min(d, AUDIO.distance.max)) - AUDIO.distance.ref));
    return { l: Math.cos((u * Math.PI) / 2) * distGain, r: Math.sin((u * Math.PI) / 2) * distGain, d };
  }

  /** Work the chain out. `only`: just these families (loops included), to measure each on its own. */
  render(only?: Set<string>): OfflineResult {
    const n = this.n;
    this.log.length = 0;
    this.voiceUntil.fill(0);
    this.nextVoice = 0;
    const dryL = new Float32Array(n), dryR = new Float32Array(n), wetL = new Float32Array(n), wetR = new Float32Array(n);
    const a = arenaAudio(this.o.env.arena);
    const wetGain = db(a.wet);
    const mute = this.o.mute;
    this.sched.sort((p, q) => p.at - q.at);
    const air = new Biquad(SR);
    for (const s of this.sched) {
      if (s.at >= this.o.secs) continue;
      if (mute?.has(s.family) || (only && !only.has(s.family))) continue;
      const sample = this.bank.get(s.family)![s.bin]![s.variant]!;
      // Each voice is taken until its sound ends (engine.voice).
      const dur = (sample.ch[0]!.length / sample.sr - s.offset) / s.rate;
      if (!s.flat) {
        let v = -1;
        for (let i = 0; i < POOL; i++) { const k = (this.nextVoice + i) % POOL; if (this.voiceUntil[k]! <= s.at) { v = k; this.nextVoice = (k + 1) % POOL; break; } }
        if (v < 0) { v = 0; for (let k = 1; k < POOL; k++) if (this.voiceUntil[k]! < this.voiceUntil[v]!) v = k; }
        this.voiceUntil[v] = s.at + dur;
      }
      const pos = s.flat ? { l: 1, r: 1, d: 0 } : this.pan(s.x, s.y, s.z);
      const stepSr = (sample.sr * s.rate) / SR;
      const cL = sample.ch[0]!, cR = sample.ch[1] ?? cL;
      if (!s.flat) { air.set('lp', Math.min(20000, AUDIO.distance.airHz / (1 + pos.d / AUDIO.distance.airM)), Math.SQRT1_2); air.reset(); }
      const send = s.flat ? (a.crowdSend ?? CROWD_SEND) : s.bus === BUS_AMB ? AMB_SEND : 0.5 + pos.d / 40;
      const start = Math.round(s.at * SR);
      const count = Math.floor((cL.length / stepSr) - s.offset * SR / s.rate);
      let peakAbs = 0;
      for (let i = 0; i < count && start + i < n; i++) {
        const t = i * stepSr + s.offset * sample.sr;
        const i0 = Math.floor(t), f = t - i0;
        let xl = ((cL[i0] ?? 0) * (1 - f) + (cL[i0 + 1] ?? 0) * f) * s.gain;
        let xr = ((cR[i0] ?? 0) * (1 - f) + (cR[i0 + 1] ?? 0) * f) * s.gain;
        if (!s.flat) { const y = air.run(xl); xl = y * pos.l; xr = y * pos.r; }
        peakAbs = Math.max(peakAbs, Math.abs(xl), Math.abs(xr));
        dryL[start + i] = dryL[start + i]! + xl;
        dryR[start + i] = dryR[start + i]! + xr;
        wetL[start + i] = wetL[start + i]! + xl * send;
        wetR[start + i] = wetR[start + i]! + xr * send;
      }
      this.log.push({ t: s.at, family: s.family, bin: s.bin, variant: s.variant, x: s.x, y: s.y, z: s.z, gain: s.gain, flat: s.flat, heardDb: 20 * Math.log10(peakAbs + 1e-12) });
    }
    // Loops.
    for (const [name, reqs] of this.loops) {
      if (mute?.has(name) || (only && !only.has(name))) continue;
      const s = this.bank.get(name)?.[0]?.[0];
      if (!s) continue;
      const cL = s.ch[0]!, cR = s.ch[1] ?? cL;
      const step = s.sr / SR;
      const send = a.bedSend ?? BED_SEND;
      let g = 0, target = 0, tc = 1, ri = 0;
      let phase = this.rand() * cL.length;
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        while (ri < reqs.length && reqs[ri]!.t <= t) { target = reqs[ri]!.gain; tc = Math.max(0.01, reqs[ri]!.tc); ri++; }
        g += (target - g) * (1 - Math.exp(-1 / (tc * SR)));
        phase += step;
        if (phase >= cL.length) phase -= cL.length;
        const i0 = Math.floor(phase), f = phase - i0, i1 = (i0 + 1) % cL.length;
        const xl = (cL[i0]! * (1 - f) + cL[i1]! * f) * g, xr = (cR[i0]! * (1 - f) + cR[i1]! * f) * g;
        dryL[i] = dryL[i]! + xl; dryR[i] = dryR[i]! + xr;
        wetL[i] = wetL[i]! + xl * send; wetR[i] = wetR[i]! + xr * send;
      }
    }
    // The room.
    const room = renderRoom(this.o.env.arena);
    const irL = resample(room.ch[0]!, room.sr, SR), irR = resample(room.ch[1]!, room.sr, SR);
    const revL = convolve(wetL, irL, n), revR = convolve(wetR, irR, n);
    // Master, limiter, clip.
    const m = db(this.o.masterDb ?? AUDIO.master + (AUDIO as { lift?: number }).lift! + (arenaAudio(this.o.env.arena).trim ?? 0));
    const preL = new Float32Array(n), preR = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      preL[i] = (dryL[i]! + revL[i]! * wetGain) * m;
      preR[i] = (dryR[i]! + revR[i]! * wetGain) * m;
    }
    const lim = limiter(preL, preR);
    return { L: lim.L, R: lim.R, preL, preR, gr: lim.gr, log: this.log };
  }
}

/** A DynamicsCompressor as a limiter: linked peak in dB, attack and release on the gain, look-ahead, then the clip curve. */
export function limiter(preL: Float32Array, preR: Float32Array): { L: Float32Array; R: Float32Array; gr: Float32Array } {
  const n = preL.length;
  const T = AUDIO.limiter.threshold, R = AUDIO.limiter.ratio;
  const look = Math.round(0.006 * SR);
  const at = Math.exp(-1 / (0.003 * SR)), rl = Math.exp(-1 / (0.12 * SR));
  const L = new Float32Array(n), Rr = new Float32Array(n), gr = new Float32Array(n);
  let g = 0;
  for (let i = 0; i < n; i++) {
    const p = Math.max(Math.abs(preL[i]!), Math.abs(preR[i]!));
    const lvl = p > 1e-9 ? 20 * Math.log10(p) : -200;
    const over = lvl - T;
    const want = over > 0 ? over / R - over : 0;
    g = want < g ? at * g + (1 - at) * want : rl * g + (1 - rl) * want;
    gr[i] = g;
    const j = i - look;
    if (j >= 0) {
      const k = db(g);
      L[i] = clip(preL[j]! * k);
      Rr[i] = clip(preR[j]! * k);
    }
  }
  return { L, R: Rr, gr };
}

function clip(x: number): number {
  const a = Math.abs(x), k = 0.8, w = 1 - k;
  return Math.sign(x) * (a <= k ? a : k + w * Math.tanh((a - k) / w));
}

/** Convolution by one big FFT (a whole render at once). */
export function convolve(x: Float32Array, ir: Float32Array, n: number): Float32Array {
  const N = pow2(x.length + ir.length);
  const xr = new Float64Array(N), xi = new Float64Array(N), hr = new Float64Array(N), hi = new Float64Array(N);
  xr.set(x); hr.set(ir);
  fft(xr, xi); fft(hr, hi);
  for (let k = 0; k < N; k++) {
    const r = xr[k]! * hr[k]! - xi[k]! * hi[k]!, i = xr[k]! * hi[k]! + xi[k]! * hr[k]!;
    xr[k] = r; xi[k] = i;
  }
  fft(xr, xi, true);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = xr[i]!;
  return out;
}

export { BUS_CROWD, BUS_AMB };
