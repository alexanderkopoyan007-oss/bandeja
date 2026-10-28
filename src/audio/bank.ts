// The sound bank (Phase 6): which renders of which recipe the game needs (data/audio.json `variants`), on what
// parameter bins, and at what level. Pure TypeScript: the game renders it in a worker (`bankWorker.ts`) so loading
// never stalls a frame, the tests render it directly. Each family is rendered whole and then scaled so its loudest
// render sits at the family's level (peak or rms, data/audio.json); bins keep their levels relative to each other.
import spec from '../../data/audio.json' with { type: 'json' };
import { Rng, SR, peak, rms } from './dsp.ts';
import * as V from './voices.ts';

export const AUDIO = spec;
export type ArenaAudio = typeof spec.arenas.stadium & { room: V.RoomSpec };

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
export const LOOPS = ['murmur', 'wind', 'birds', 'crickets', 'hum', 'hall'] as const;

export function racketBin(kind: number, power: number, quality: number): number {
  return kind * 9 + power * 3 + quality;
}

interface FamilyDef {
  name: string;
  bins: number;
  variants: number;
  render(rng: Rng, bin: number, env: BankEnv): Float32Array | Float32Array[];
  sr: number;
  peak?: number;
  rms?: number;
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
  const out: FamilyDef[] = [
    {
      name: 'racket', bins: 45, variants: va.racket!, sr: SR, peak: pk.racket,
      render: (r, b) => V.racket(r, Math.floor(b / 9), RACKET_POWER[Math.floor(b / 3) % 3]!, [0.05, 0.75, 0.5][b % 3]!, b % 3 === RQ_FRAME),
    },
    { name: 'bounce', bins: BOUNCE_V.length, variants: va.bounce!, sr: SR, peak: pk.bounce, render: (r, b, e) => V.bounce(r, e.floor, BOUNCE_V[b]!) },
    { name: 'glass', bins: GLASS_V.length, variants: va.glass!, sr: SR, peak: pk.glass, render: (r, b) => V.glass(r, GLASS_V[b]!) },
    { name: 'mesh', bins: MESH_V.length, variants: va.mesh!, sr: SR, peak: pk.mesh, render: (r, b) => V.mesh(r, MESH_V[b]!) },
    { name: 'net', bins: 4, variants: va.net!, sr: SR, peak: pk.net, render: (r, b) => V.net(r, b >= 2, NET_V[b % 2]!) },
    { name: 'metal', bins: 4, variants: va.metal!, sr: SR, peak: pk.metal, render: (r, b) => V.metal(r, b >= 2 ? V.MT_NETPOST : V.MT_POST, METAL_V[b % 2]!) },
    { name: 'whoosh', bins: WHOOSH_S.length, variants: va.whoosh!, sr: SR, peak: pk.whoosh, render: (r, b) => V.whoosh(r, WHOOSH_S[b]!) },
    { name: 'step', bins: STEP_F.length, variants: va.step!, sr: SR, peak: pk.step, render: (r, b, e) => V.step(r, e.floor, STEP_F[b]!) },
    { name: 'scuff', bins: 1, variants: va.scuff!, sr: SR, peak: pk.scuff, render: (r, _b, e) => V.scuff(r, e.floor, r.range(0.5, 1)) },
    {
      name: 'grunt', bins: 12, variants: va.grunt!, sr: V.LO_SR, peak: pk.grunt,
      render: (r, b) => V.grunt(r, V.PLAYER_VOICES[Math.floor(b / 3)]!, GRUNT_E[b % 3]!),
    },
    {
      name: 'applause', bins: 2, variants: va.applause!, sr: V.LO_SR, rms: rm.applause,
      render: (r, b) => V.applause(r, a.crowd, b === APPLAUSE_BIG ? 4.5 : 2.2, b === APPLAUSE_BIG),
    },
    { name: 'murmur', bins: 1, variants: 1, sr: V.LO_SR, rms: rm.murmur, render: (r) => V.murmur(r, a.talkers, 8) },
  ];
  for (const k of a.ambience) {
    out.push({ name: k, bins: 1, variants: 1, sr: V.LO_SR, rms: rm[k], render: (r) => V.ambience(r, k as 'wind', 10) });
  }
  if (a.crowd >= spec.crowd.big) {
    out.push(
      { name: 'ooh', bins: 1, variants: va.ooh!, sr: V.LO_SR, rms: rm.ooh, render: (r) => V.crowdVoice(r, a.crowd, 'ooh', 1.6) },
      { name: 'aah', bins: 1, variants: va.aah!, sr: V.LO_SR, rms: rm.aah, render: (r) => V.crowdVoice(r, a.crowd, 'aah', 1.8) },
      { name: 'cheer', bins: 1, variants: va.cheer!, sr: V.LO_SR, rms: rm.cheer, render: (r) => V.crowdVoice(r, a.crowd, 'cheer', 2.4) },
    );
  }
  return out;
}

function seed(name: string, bin: number, variant: number, env: BankEnv): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return (h ^ Math.imul(bin + 1, 7919) ^ Math.imul(variant + 1, 104729) ^ Math.imul(env.floor + 1, 13)) >>> 0;
}

/** Render a whole family ([bin][variant]) at its level. */
export function renderFamily(def: FamilyDef, env: BankEnv): Sample[][] {
  const out: Sample[][] = [];
  let top = 0;
  for (let b = 0; b < def.bins; b++) {
    const row: Sample[] = [];
    for (let v = 0; v < def.variants; v++) {
      const r = def.render(new Rng(seed(def.name, b, v, env)), b, env);
      const ch = Array.isArray(r) ? r : [r];
      let m = 0;
      for (const c of ch) m = Math.max(m, def.rms !== undefined ? rms(c) : peak(c));
      top = Math.max(top, m);
      row.push({ sr: def.sr, ch });
    }
    out.push(row);
  }
  const target = Math.pow(10, (def.rms ?? def.peak ?? -20) / 20);
  const k = top > 0 ? target / top : 1;
  for (const row of out) for (const s of row) for (const c of s.ch) for (let i = 0; i < c.length; i++) c[i] = c[i]! * k;
  return out;
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
  out.gain = Math.max(0.05, Math.min(1.6, x / values[b]!));
  return out;
}
/** binFor's result, reused (read it before the next call). */
const BIN = { bin: 0, gain: 1 };
