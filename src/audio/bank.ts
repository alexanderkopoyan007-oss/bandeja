// The sound bank (Phase 6): which renders of which recipe the game needs (data/audio.json `variants`), on what
// parameter bins, and at what level. Pure TypeScript: the game renders it in a worker (`bankWorker.ts`) so loading
// never stalls a frame, the tests render it directly. Each family is rendered whole and then scaled so its loudest
// render sits at the family's level (peak or rms, data/audio.json); bins keep their levels relative to each other.
import spec from '../../data/audio.json' with { type: 'json' };
import { Rng, SR, peak, rms } from './dsp.ts';
import * as V from './voices.ts';

export const AUDIO = spec;
export type ArenaAudio = typeof spec.arenas.stadium & { room: V.RoomSpec; birds?: boolean };

export interface BankEnv {
  /** Floor kind (voices.ts FL_*): bounces and feet. */
  floor: number;
  /** data/audio.json arenas key. */
  arena: string;
}

/** One render: sample rate and one or two channels. */
export interface Sample { sr: number; ch: Float32Array[] }

/** Parameter bins. */
export const RACKET_POWER = [0.25, 0.6, 0.95];
/** Racket contact bins: clean, off-centre, on the frame. */
export const RQ_CLEAN = 0, RQ_OFF = 1, RQ_FRAME = 2;
export const BOUNCE_V = [2, 5, 10, 18];
export const GLASS_V = [4, 9, 16, 26];
export const MESH_V = [3, 8, 16];
export const METAL_V = [6, 18];
export const NET_V = [6, 18];
export const WHOOSH_S = [0.3, 0.65, 1];
export const STEP_F = [0.3, 0.8];
export const GRUNT_E = [0.25, 0.6, 0.95];
export const APPLAUSE_SMALL = 0, APPLAUSE_BIG = 1;
export const LOOPS = ['murmur', 'wind', 'crickets', 'hum', 'hall'] as const;

export function racketBin(kind: number, power: number, quality: number): number {
  return kind * 9 + power * 3 + quality;
}

export interface FamilyDef {
  name: string;
  bins: number;
  variants: number;
  render(rng: Rng, bin: number, env: BankEnv): Float32Array | Float32Array[];
  sr: number;
  peak?: number;
  rms?: number;
  /**
   * Impacts: each bin's level set by the law level = top x (x / x_top) along its ladder (bins of one sound that
   * differ only by speed or force), whatever the recipe gave it. The recipes shape the timbre with speed and
   * saturate at the top (glass at 16 and 26 m/s peaked the same); with the law and binFor's gain x / x_bin, the
   * heard level is continuous in x and goes with the impact speed (sound pressure of an impact ~ its speed).
   */
  law?: { x(bin: number): number; ladder(bin: number): number };
  /** Bounces, steps and scuffs: levelled against the turf's renders, so a hard floor is louder than sand. */
  floorRef?: boolean;
  /** Level by the rms of the part that sounds (claps end before the buffer does). */
  active?: boolean;
  /** No render may peak above this (dBFS): a sparse crowd is very peaky for its rms. */
  peakCap?: number;
}

/** A crowd's level against the stadium's 4,600: power goes with headcount (10 log10 N); a club's few watchers sit
 * close to the court, about 6 dB nearer than a stand. */
function crowdDb(people: number): number {
  const big = 4600;
  return people >= big ? 0 : 10 * Math.log10(Math.max(1, people) / big) + (people < spec.crowd.big ? 6 : 0);
}

export function arenaAudio(arena: string): ArenaAudio {
  return ((spec.arenas as Record<string, unknown>)[arena] ?? spec.arenas.stadium) as ArenaAudio;
}

/** The families to render for this floor and arena, most needed first (the racket before the crowd). */
export function families(env: BankEnv): FamilyDef[] {
  const va = spec.variants as Record<string, number>;
  const pk = spec.peak as Record<string, number>;
  const rm = spec.rms as Record<string, number>;
  const a = arenaAudio(env.arena);
  const ladder0 = (): number => 0;
  const out: FamilyDef[] = [
    {
      name: 'racket', bins: 45, variants: va.racket!, sr: SR, peak: pk.racket,
      render: (r, b) => V.racket(r, Math.floor(b / 9), RACKET_POWER[Math.floor(b / 3) % 3]!, [0.05, 0.75, 0.5][b % 3]!, b % 3 === RQ_FRAME),
      // One ladder per kind and contact (clean, off-centre, frame), up the power bins.
      law: { x: (b) => RACKET_POWER[Math.floor(b / 3) % 3]!, ladder: (b) => Math.floor(b / 9) * 3 + (b % 3) },
    },
    {
      name: 'bounce', bins: BOUNCE_V.length, variants: va.bounce!, sr: SR, peak: pk.bounce, render: (r, b, e) => V.bounce(r, e.floor, BOUNCE_V[b]!),
      law: { x: (b) => BOUNCE_V[b]!, ladder: ladder0 }, floorRef: true,
    },
    { name: 'glass', bins: GLASS_V.length, variants: va.glass!, sr: SR, peak: pk.glass, render: (r, b) => V.glass(r, GLASS_V[b]!), law: { x: (b) => GLASS_V[b]!, ladder: ladder0 } },
    { name: 'mesh', bins: MESH_V.length, variants: va.mesh!, sr: SR, peak: pk.mesh, render: (r, b) => V.mesh(r, MESH_V[b]!), law: { x: (b) => MESH_V[b]!, ladder: ladder0 } },
    {
      name: 'net', bins: 4, variants: va.net!, sr: SR, peak: pk.net, render: (r, b) => V.net(r, b >= 2, NET_V[b % 2]!),
      law: { x: (b) => NET_V[b % 2]!, ladder: (b) => (b >= 2 ? 1 : 0) },
    },
    {
      name: 'metal', bins: 4, variants: va.metal!, sr: SR, peak: pk.metal, render: (r, b) => V.metal(r, b >= 2 ? V.MT_NETPOST : V.MT_POST, METAL_V[b % 2]!),
      law: { x: (b) => METAL_V[b % 2]!, ladder: (b) => (b >= 2 ? 1 : 0) },
    },
    // (the whoosh's recipe already makes its level from the swing speed, aerodynamic noise ~ v^3 in pressure)
    { name: 'whoosh', bins: WHOOSH_S.length, variants: va.whoosh!, sr: SR, peak: pk.whoosh, render: (r, b) => V.whoosh(r, WHOOSH_S[b]!) },
    {
      name: 'step', bins: STEP_F.length, variants: va.step!, sr: SR, peak: pk.step, render: (r, b, e) => V.step(r, e.floor, STEP_F[b]!),
      law: { x: (b) => STEP_F[b]!, ladder: ladder0 }, floorRef: true,
    },
    { name: 'scuff', bins: 1, variants: va.scuff!, sr: SR, peak: pk.scuff, render: (r, _b, e) => V.scuff(r, e.floor, r.range(0.5, 1)), floorRef: true },
    {
      name: 'grunt', bins: 12, variants: va.grunt!, sr: V.LO_SR, peak: pk.grunt,
      render: (r, b) => V.grunt(r, V.PLAYER_VOICES[Math.floor(b / 3)]!, GRUNT_E[b % 3]!),
    },
    {
      name: 'applause', bins: 2, variants: va.applause!, sr: V.LO_SR, rms: rm.applause! + crowdDb(a.crowd), active: true, peakCap: -9,
      render: (r, b) => V.applause(r, a.crowd, b === APPLAUSE_BIG ? 4.5 : 2.2, b === APPLAUSE_BIG),
    },
    { name: 'murmur', bins: 1, variants: 1, sr: V.LO_SR, rms: rm.murmur, render: (r) => V.murmur(r, a.talkers, 12) },
  ];
  for (const k of a.ambience) {
    out.push({ name: k, bins: 1, variants: 1, sr: V.LO_SR, rms: rm[k], render: (r) => V.ambience(r, k as 'wind', k === 'wind' ? 17 : 10) });
  }
  if (a.birds) out.push({ name: 'bird', bins: 1, variants: va.bird!, sr: V.LO_SR, peak: pk.bird, render: (r) => V.birdCall(r) });
  if (a.crowd >= spec.crowd.big) {
    out.push(
      { name: 'ooh', bins: 1, variants: va.ooh!, sr: V.LO_SR, rms: rm.ooh, active: true, peakCap: -9, render: (r) => V.crowdVoice(r, a.crowd, 'ooh', 1.6) },
      { name: 'aah', bins: 1, variants: va.aah!, sr: V.LO_SR, rms: rm.aah, active: true, peakCap: -9, render: (r) => V.crowdVoice(r, a.crowd, 'aah', 1.8) },
      { name: 'cheer', bins: 1, variants: va.cheer!, sr: V.LO_SR, rms: rm.cheer, active: true, peakCap: -9, render: (r) => V.crowdVoice(r, a.crowd, 'cheer', 2.4) },
    );
  }
  return out;
}

function seed(name: string, bin: number, variant: number, env: BankEnv): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return (h ^ Math.imul(bin + 1, 7919) ^ Math.imul(variant + 1, 104729) ^ Math.imul(env.floor + 1, 13)) >>> 0;
}

function renderRows(def: FamilyDef, env: BankEnv): Sample[][] {
  const out: Sample[][] = [];
  for (let b = 0; b < def.bins; b++) {
    const row: Sample[] = [];
    for (let v = 0; v < def.variants; v++) {
      const r = def.render(new Rng(seed(def.name, b, v, env)), b, env);
      row.push({ sr: def.sr, ch: Array.isArray(r) ? r : [r] });
    }
    out.push(row);
  }
  return out;
}

function scale(rows: Sample[][], k: number): void {
  for (const row of rows) for (const s of row) for (const c of s.ch) for (let i = 0; i < c.length; i++) c[i] = c[i]! * k;
}

function peakOf(s: Sample): number {
  let m = 0;
  for (const c of s.ch) m = Math.max(m, peak(c));
  return m;
}

/** RMS of the part that sounds: from the first to the last sample within 40 dB of the peak. */
export function activeRms(c: Float32Array): number {
  const p = peak(c), th = p * 0.01;
  let a = 0, b = c.length - 1;
  while (a < b && Math.abs(c[a]!) < th) a++;
  while (b > a && Math.abs(c[b]!) < th) b--;
  return rms(c, a, b + 1);
}

/** Set every bin's level (mean peak over its variants) to the law along its ladder. */
function levelLaw(rows: Sample[][], law: NonNullable<FamilyDef['law']>): void {
  const lvl = rows.map((row) => row.reduce((m, s) => m + peakOf(s), 0) / Math.max(1, row.length));
  const top = new Map<number, number>();
  for (let b = 0; b < rows.length; b++) {
    const l = law.ladder(b), t = top.get(l);
    if (t === undefined || law.x(b) > law.x(t)) top.set(l, b);
  }
  for (let b = 0; b < rows.length; b++) {
    const t = top.get(law.ladder(b))!;
    const want = lvl[t]! * (law.x(b) / law.x(t));
    if (lvl[b]! > 0) scale([rows[b]!], want / lvl[b]!);
  }
}

function topLevel(def: FamilyDef, rows: Sample[][]): number {
  let top = 0;
  for (const row of rows) for (const s of row) for (const c of s.ch) {
    top = Math.max(top, def.rms !== undefined ? (def.active ? activeRms(c) : rms(c)) : peak(c));
  }
  return top;
}

/** Render a whole family ([bin][variant]) at its level. */
export function renderFamily(def: FamilyDef, env: BankEnv): Sample[][] {
  const rows = renderRows(def, env);
  if (def.law) levelLaw(rows, def.law);
  let top = topLevel(def, rows);
  if (def.floorRef && env.floor !== V.FL_TURF) {
    // The level is the turf's: this floor keeps its own loudness against it.
    const ref = renderRows(def, { ...env, floor: V.FL_TURF });
    if (def.law) levelLaw(ref, def.law);
    top = topLevel(def, ref);
  }
  const target = Math.pow(10, (def.rms ?? def.peak ?? -20) / 20);
  let k = top > 0 ? target / top : 1;
  if (def.peakCap !== undefined) {
    let pk = 0;
    for (const row of rows) for (const s of row) pk = Math.max(pk, peakOf(s));
    const cap = Math.pow(10, def.peakCap / 20);
    if (pk * k > cap) k = cap / pk;
  }
  scale(rows, k);
  return rows;
}

/** The whole bank at once (tests, and the fallback without workers). */
export function buildBank(env: BankEnv): Map<string, Sample[][]> {
  const m = new Map<string, Sample[][]>();
  for (const def of families(env)) m.set(def.name, renderFamily(def, env));
  return m;
}

/** The arena's reverb impulse response (stereo, 48 kHz). */
export function renderRoom(arena: string): Sample {
  return { sr: SR, ch: V.impulseResponse(new Rng(seed('room', 0, 0, { floor: 0, arena })), arenaAudio(arena).room) };
}

/**
 * A continuous parameter onto bins: the bin below or above, picked with a probability by where x falls between them
 * (so the level and timbre slide smoothly over many plays), and the gain that brings that bin's render to x
 * (an impact's sound pressure goes about with its speed). `u` is a uniform random number.
 */
export function binFor(values: readonly number[], x: number, u: number): { bin: number; gain: number } {
  const out = BIN;
  let b = 0;
  if (x <= values[0]!) b = 0;
  else if (x >= values[values.length - 1]!) b = values.length - 1;
  else {
    while (b < values.length - 2 && x > values[b + 1]!) b++;
    const f = (x - values[b]!) / (values[b + 1]! - values[b]!);
    if (u < f) b++;
  }
  out.bin = b;
  // Within the bins the gain is whatever brings the bin to x (at most the ratio to the next bin); past the top bin
  // it is capped, below the bottom floored.
  const g = x / values[b]!;
  out.gain = x > values[values.length - 1]! ? Math.min(1.6, g) : Math.max(0.05, g);
  return out;
}
/** binFor's result, reused (read it before the next call). */
const BIN = { bin: 0, gain: 1 };
