// Sound recipes (Phase 6): each function renders one variation of one sound into a Float32Array (mono, or two for
// stereo crowd beds), from a seeded Rng, so `bank.ts` can build several of each at load and the tests can measure
// them. Physical models where there is something to model (modes struck by a contact pulse, sand as grains, a
// voice as a glottal source through formants, applause as many clappers); every number with a source says so,
// the rest is tuning by measurement (tests/audio) and by ear. DECISIONS.md (Phase 6) has the reasoning.
import {
  SR, Rng, Biquad, Formant, modal, contactPulse, grains, noiseBurst, removeDC, fadeTail, type Mode,
} from './dsp.ts';

export const LO_SR = 24000;

function buf(secs: number, sr = SR): Float32Array { return new Float32Array(Math.round(secs * sr)); }
function jit(rng: Rng, x: number, spread: number): number { return x * (1 + (rng.next() * 2 - 1) * spread); }
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

// ---- the ball ---------------------------------------------------------------------------------------------------
// A pressurised felt ball rings briefly when struck: the shell's first modes. The A-weighted spectrum of padel play
// peaks at 800-1000 Hz (Piana et al. 2025, padel court sound power), and a bounce on a hard floor is "1-2 cycles at
// about 1 kHz, then a decaying ~250 Hz" (line-calling patent US 9551572). So: a 1 kHz shell mode that dies within a
// couple of cycles, and a lower ring at 250 Hz.
//
// Two pulses drive the modes. The whole contact (4-6 ms) drives the slow parts (the 250 Hz ring, a racket's bending,
// a glass panel), and by itself it would barely reach 1 kHz (a 5 ms half-sine is 36 dB down there). The shell and a
// face's plate modes ring from the impact's sharp onset, the first fraction of a millisecond as the contact
// stiffens: ONSET of the contact time.
const ONSET = 0.17;
function ballShell(rng: Rng, out: Mode[], hard: number): void {
  out.push({ f: jit(rng, 1000, 0.04), t60: 0.0045, a: 0.9 * hard });
  out.push({ f: jit(rng, 1650, 0.05), t60: 0.008, a: 0.3 * hard });
}
function ballRing(rng: Rng, out: Mode[], ring: number, a = 0.55): void {
  out.push({ f: jit(rng, 250, 0.05), t60: jit(rng, 0.045, 0.15) * ring, a });
}

// ---- racket hits ------------------------------------------------------------------------------------------------
/** Racket hit kinds: how the stroke meets the ball. */
export const RK_DRIVE = 0, RK_VOLLEY = 1, RK_OVER = 2, RK_SLICE = 3, RK_TOUCH = 4;

/**
 * A padel racket hit. A padel racket is a solid paddle (carbon or glass-fibre skins on an EVA foam core, perforated),
 * so a hit is a dry, sharp "pock" with no strings' ring (Piana et al.: carbon faces sound drier, fibreglass less
 * sharp; a faster impact sharper). The ball is on the face about 5 ms (racket sports' dwell, Zienowicz et al., IOA
 * 2008); the direct sound is over within about 30 ms (Piana et al.'s ambisonic recordings). Parts:
 *  - the contact's own pressure pulse and the ball's shell modes;
 *  - the face's modes: its first bending mode (about 200 Hz; a tennis frame's is 146 Hz, Russell, and a padel
 *    racket is shorter and stiffer) is barely excited at the sweet spot, which is near its node, and rings longer
 *    off-centre ("thock", a sting in the hand); a torsion mode for hits off the long axis; plate modes higher up;
 *  - the "crack": broadband noise of the impact, brighter for harder and cleaner hits;
 *  - a slice brushes the ball across the face (a scrape of felt on the gritty face before the impact);
 *  - a frame hit: the hard rim clacks, the face's low mode rings, the ball's pop is half there.
 * `power` 0..1 (soft touch .. full smash), `off` 0 sweet spot .. 1 well off-centre, `frame` on the rim.
 */
export function racket(rng: Rng, kind: number, power: number, off: number, frame: boolean): Float32Array {
  const out = buf(0.2);
  const p = clamp01(power), q = clamp01(off);
  const soft = kind === RK_TOUCH ? 1 : 0;
  // Contact: about 5 ms, shorter as the impact gets harder; longer for a soft touch (the ball barely squashes).
  let contact = (5.6 - 1.8 * p) * 1e-3 * (1 + 0.25 * soft) * (kind === RK_VOLLEY ? 0.94 : 1);
  if (frame) contact *= 0.6;
  contact = jit(rng, contact, 0.07);
  const at = kind === RK_SLICE ? 0.006 : 0.001;
  if (kind === RK_SLICE) {
    // The brush: felt dragged across the face just before and through the hit.
    noiseBurst(out, rng, 0, 0.004, 0.012, 0.07 + 0.08 * p, [Biquad.make('hp', 2200, 0.7), Biquad.make('lp', 7000, 0.7)]);
  }
  const loud = 0.35 + 0.65 * p;
  contactPulse(out, at, contact, 0.15 * loud);
  // Slow: the ball's ring and the face's bending and torsion. Sweet spot: the first bending mode barely moves (its
  // node), more the further off.
  const low: Mode[] = [];
  ballRing(rng, low, frame ? 0.5 : 1, 0.2);
  const bend = 0.05 + 0.6 * q + (frame ? 0.5 : 0) + (kind === RK_OVER ? 0.1 * p : 0);
  low.push({ f: jit(rng, 205, 0.06), t60: 0.04 + 0.06 * q + (frame ? 0.06 : 0), a: bend });
  low.push({ f: jit(rng, 480, 0.06), t60: 0.03 + 0.02 * q, a: 0.04 + 0.35 * q * rng.next() });
  for (const m of low) m.a *= loud;
  modal(out, at, low, contact);
  // Fast: the shell and the face's plate modes (the stiff skin on foam: the "pock"), duller off-centre and soft.
  const high: Mode[] = [];
  ballShell(rng, high, (0.6 + 0.4 * p) * (frame ? 0.5 : 1));
  high.push({ f: jit(rng, 1050, 0.05), t60: 0.028, a: 0.55 * (1 - 0.45 * q) });
  high.push({ f: jit(rng, 1520, 0.05), t60: 0.02, a: 0.4 * (1 - 0.5 * q) * (1 - 0.4 * soft) });
  high.push({ f: jit(rng, 2650, 0.06), t60: 0.01, a: 0.25 * (1 - 0.6 * q) * (1 - 0.7 * soft) });
  if (frame) {
    // The rim's clack: short, high, hard.
    high.push({ f: jit(rng, 2300, 0.08), t60: 0.016, a: 0.5 });
    high.push({ f: jit(rng, 3500, 0.08), t60: 0.011, a: 0.35 });
    high.push({ f: jit(rng, 5200, 0.08), t60: 0.007, a: 0.25 });
  }
  for (const m of high) m.a *= loud;
  modal(out, at, high, contact * ONSET);
  // The crack: the impact's broadband noise; harder and cleaner is brighter, soft and off is dull.
  const bright = (2600 + 4200 * p) * (1 - 0.45 * q) * (1 - 0.5 * soft);
  noiseBurst(out, rng, at, 0.0003, jit(rng, 0.006 + 0.006 * q, 0.1), 0.3 * loud * (1 - 0.35 * q),
    [Biquad.make('hp', 700, 0.7), Biquad.make('lp', bright, 0.7)]);
  removeDC(out);
  return fadeTail(out, 0.02);
}

// ---- the ball on the floor ----------------------------------------------------------------------------------------
export const FL_HARD = 0, FL_TURF = 1, FL_CARPET = 2, FL_CLAY = 3;
export const FLOOR_NAMES = ['hard', 'turf', 'carpet', 'clay'] as const;

/**
 * A bounce at normal impact speed `v` (m/s). Hard court: the ball's own ring, loud (resin "does not absorb
 * vibrations effectively", Piana et al.). Sand-filled turf: damped (the porous fibres absorb, the sand softens the
 * bounce, ibid.), with the sand's grains scattering: a short crisp crunch that grows with the impact. Carpet:
 * muffled, no grit. Clay (fantasy): soft and gritty, coarser grains.
 */
export function bounce(rng: Rng, floor: number, v: number): Float32Array {
  const out = buf(0.14);
  const s = clamp01(v / 20);
  const base = [4.0, 5.0, 5.6, 6.0][floor]! * 1e-3;
  const contact = jit(rng, base * (1.15 - 0.3 * s), 0.06);
  const loud = 0.12 + 0.88 * s;
  const ring = [1, 0.55, 0.4, 0.5][floor]!;
  const hard = [1, 0.45, 0.25, 0.3][floor]!;
  contactPulse(out, 0.001, contact, 0.25 * loud * (floor === FL_HARD ? 1 : 0.8));
  const low: Mode[] = [], high: Mode[] = [];
  ballRing(rng, low, ring);
  ballShell(rng, high, hard);
  const g = loud * (floor === FL_HARD ? 1 : 0.7);
  for (const m of low) m.a *= g;
  for (const m of high) m.a *= g;
  modal(out, 0.001, low, contact);
  modal(out, 0.001, high, contact * ONSET);
  if (floor === FL_HARD) {
    // The acrylic's tick.
    noiseBurst(out, rng, 0.001, 0.0002, 0.003, 0.15 * loud, [Biquad.make('hp', 2000, 0.7)]);
  } else if (floor === FL_TURF || floor === FL_CLAY) {
    const turf = floor === FL_TURF;
    grains(out, rng, 0.0015, Math.round((turf ? 12 : 20) + (turf ? 34 : 45) * s), turf ? 0.008 : 0.012,
      turf ? 0.0005 : 0.0009, turf ? 2500 : 1100, turf ? 8000 : 4000, (turf ? 0.07 : 0.06) * (0.3 + 0.7 * s));
    // Fibres brushed aside.
    noiseBurst(out, rng, 0.001, 0.001, 0.02, 0.03 * loud, [Biquad.make('lp', 3000, 0.7)]);
  } else {
    // Carpet fibres take the highs.
    const lp = Biquad.make('lp', 1700, 0.6);
    lp.process(out);
  }
  removeDC(out);
  return fadeTail(out, 0.015);
}

// ---- glass ------------------------------------------------------------------------------------------------------
/**
 * The ball on a tempered glass panel. Padel walls are 10-12 mm toughened glass (UNI EN 12150-1) about 2 m x 3 m,
 * bolted to the steel frame; a hit is a "low frequency bang" (Higgins via The Padel Paper; tempered glass "louder and
 * sharper" than laminated, thicker louder, Piana et al.). The panel's bending modes, simply supported, are
 * f_mn = (pi/2) sqrt(D / rho h) ((m/a)^2 + (n/b)^2) with D = E h^3 / 12 (1 - nu^2): for 12 mm glass (E 70 GPa,
 * nu 0.22, rho 2500) sqrt(D / rho h) = 18.8 m^2/s, so f11 = 10.7 Hz and the modes crowd from about 50 Hz up: a
 * dense low boom, which the ball's 4 ms contact excites up to about 250 Hz. The mode shapes at the (random) impact
 * point set which ones sound; odd-odd modes radiate best (net volume flow), the others partly cancel. Loss factor
 * about 0.04 (glass in gaskets and clamps, an estimate): a 100 Hz mode rings about half a second. Above about 15 m/s
 * the panel clanks in its fixings, and the cage's steel hums.
 */
export function glass(rng: Rng, v: number): Float32Array {
  const out = buf(0.75);
  const s = clamp01(v / 25);
  const loud = 0.15 + 0.85 * s;
  const contact = jit(rng, 4.2e-3 * (1.1 - 0.25 * s), 0.06);
  const a = 2, b = 3, k = 29.5; // (pi/2) * 18.8
  const x0 = rng.range(0.25, 0.75) * a, y0 = rng.range(0.15, 0.6) * b;
  const modes: Mode[] = [];
  for (let m = 1; m <= 9; m++) {
    for (let n = 1; n <= 12; n++) {
      const f = k * ((m / a) ** 2 + (n / b) ** 2);
      if (f < 35 || f > 900) continue;
      const shape = Math.sin((m * Math.PI * x0) / a) * Math.sin((n * Math.PI * y0) / b);
      const rad = m % 2 === 1 && n % 2 === 1 ? 1 : m % 2 === 1 || n % 2 === 1 ? 0.4 : 0.15;
      const amp = shape * rad * (f < 60 ? f / 60 : 1);
      if (Math.abs(amp) < 0.05) continue;
      modes.push({ f: jit(rng, f, 0.015), t60: Math.min(0.9, 2.2 / (f * 0.04)), a: amp * 0.32 * loud });
    }
  }
  modal(out, 0.001, modes, contact);
  // The ball itself on a rigid face: its pop.
  contactPulse(out, 0.001, contact, 0.25 * loud);
  const ring: Mode[] = [], shell: Mode[] = [];
  ballRing(rng, ring, 0.8);
  ballShell(rng, shell, 1);
  for (const m of ring) m.a *= 0.8 * loud;
  for (const m of shell) m.a *= 1.1 * loud;
  modal(out, 0.001, ring, contact);
  modal(out, 0.001, shell, contact * ONSET);
  // The glass's own higher bending modes, struck by the onset: the "bang" has a hard edge.
  const edge: Mode[] = [];
  for (let i = 0; i < 6; i++) edge.push({ f: rng.range(900, 2600), t60: rng.range(0.03, 0.08), a: rng.range(0.05, 0.12) * loud });
  modal(out, 0.001, edge, contact * ONSET);
  // The frame's steel, struck through the clamps: a low hum.
  modal(out, 0.002, [{ f: jit(rng, 72, 0.1), t60: 0.4, a: 0.18 * loud }, { f: jit(rng, 118, 0.1), t60: 0.3, a: 0.1 * loud }], contact);
  if (v > 14) {
    // A hard ball rattles the panel in its fixings: a few metallic clicks just after.
    const clicks = 1 + Math.floor(rng.next() * 3 + 2 * clamp01((v - 14) / 15));
    for (let c = 0; c < clicks; c++) {
      const t = rng.range(0.006, 0.05);
      modal(out, t, [
        { f: jit(rng, 1850, 0.1), t60: 0.02, a: 0.12 * s },
        { f: jit(rng, 2950, 0.1), t60: 0.014, a: 0.09 * s },
        { f: jit(rng, 4300, 0.1), t60: 0.009, a: 0.06 * s },
      ], 0.0006);
    }
  }
  // Below about 40 Hz neither the panel nor a speaker radiates much.
  Biquad.make('hp', 45, 0.7).process(out);
  removeDC(out);
  return fadeTail(out, 0.12);
}

// ---- mesh -------------------------------------------------------------------------------------------------------
/**
 * The ball into the wire mesh (electro-welded steel, about 50 mm squares, in steel frames): "a higher frequency
 * ringing" (Higgins via The Padel Paper). The mesh gives (a softer, longer contact than glass); its wires ring at
 * many inharmonic frequencies; the panel rattles against its frame for a while after.
 */
export function mesh(rng: Rng, v: number): Float32Array {
  const out = buf(0.55);
  const s = clamp01(v / 22);
  const loud = 0.15 + 0.85 * s;
  const contact = jit(rng, 8e-3, 0.1);
  contactPulse(out, 0.001, contact, 0.2 * loud);
  const ring: Mode[] = [], shell: Mode[] = [];
  ballRing(rng, ring, 0.6);
  ballShell(rng, shell, 0.4);
  for (const m of ring) m.a *= 0.5 * loud;
  for (const m of shell) m.a *= 0.6 * loud;
  modal(out, 0.001, ring, contact);
  modal(out, 0.001, shell, 0.0012);
  // Wires: modes spread from 400 Hz to 7 kHz, struck through the ball's slow contact and by the rattle.
  const wires: Mode[] = [];
  for (let i = 0; i < 36; i++) {
    const f = 400 * Math.pow(7000 / 400, rng.next());
    wires.push({ f, t60: 0.3 * Math.pow(400 / f, 0.3) * rng.range(0.7, 1.3), a: rng.range(0.3, 1) * 0.1 * loud });
  }
  modal(out, 0.002, wires, 0.0015);
  // The rattle in the frame: clicks, close together at first, spreading out and fading.
  const n = Math.round(4 + 10 * s);
  let t = 0.004;
  for (let i = 0; i < n; i++) {
    t += rng.range(0.004, 0.012) * (1 + i * 0.35);
    if (t > 0.45) break;
    const amp = 0.12 * loud * Math.exp(-t / 0.12) * rng.range(0.5, 1);
    noiseBurst(out, rng, t, 0.0002, 0.004, amp, [Biquad.make('bp', rng.range(1800, 4800), 2)]);
    const sub: Mode[] = [];
    for (let j = 0; j < 4; j++) {
      const w = wires[Math.floor(rng.next() * wires.length)]!;
      sub.push({ f: w.f, t60: w.t60 * 0.6, a: w.a * 0.5 * Math.exp(-t / 0.12) });
    }
    modal(out, t, sub, 0.0006);
  }
  removeDC(out);
  return fadeTail(out, 0.08);
}

// ---- steel: posts, frames ---------------------------------------------------------------------------------------
export const MT_POST = 0, MT_NETPOST = 1;

/**
 * The ball on steel: a cage post or a frame (square tube, about 80 mm, kind MT_POST) or a net post (MT_NETPOST,
 * smaller). A tube rings as a free bar (mode ratios 1 : 2.756 : 5.404 : 8.933, Euler-Bernoulli free-free), bolted
 * down so it decays in under a second, plus its walls' higher modes.
 */
export function metal(rng: Rng, kind: number, v: number): Float32Array {
  const out = buf(0.9);
  const s = clamp01(v / 22);
  const loud = 0.15 + 0.85 * s;
  const contact = jit(rng, 3e-3, 0.08);
  contactPulse(out, 0.001, contact, 0.3 * loud);
  const f1 = jit(rng, kind === MT_POST ? 430 : 620, 0.08);
  const r = [1, 2.756, 5.404, 8.933];
  const modes: Mode[] = [];
  for (let i = 0; i < r.length; i++) modes.push({ f: f1 * r[i]!, t60: jit(rng, 0.7 / (1 + 0.5 * i), 0.15), a: (0.5 / (1 + 0.6 * i)) * loud });
  modes.push({ f: jit(rng, 2900, 0.1), t60: 0.08, a: 0.15 * loud }, { f: jit(rng, 4100, 0.1), t60: 0.05, a: 0.1 * loud });
  const ring: Mode[] = [];
  ballRing(rng, ring, 0.7, 0.3 * loud);
  ballShell(rng, modes, 0.6 * loud);
  modal(out, 0.001, ring, contact);
  // Steel is stiffer than a racket's face: a sharper onset reaches the tube's higher modes.
  modal(out, 0.001, modes, contact * ONSET * 0.6);
  removeDC(out);
  return fadeTail(out, 0.15);
}

// ---- the net ----------------------------------------------------------------------------------------------------
/**
 * The ball into the net (`cord` false): the netting catches it over 15-20 ms (the cloth sim's pocket), a soft low
 * "fwump" with the twine's swish; or over the tape (`cord` true): a short tick on the tape and the steel cable under
 * it, the netting shivering.
 */
export function net(rng: Rng, cord: boolean, v: number): Float32Array {
  const out = buf(0.3);
  const s = clamp01(v / 25);
  const loud = 0.2 + 0.8 * s;
  if (!cord) {
    contactPulse(out, 0.001, jit(rng, 0.016, 0.1), 0.35 * loud);
    noiseBurst(out, rng, 0.001, 0.005, 0.07, 0.12 * loud, [Biquad.make('bp', 420, 0.8)]);
    noiseBurst(out, rng, 0.003, 0.004, 0.05, 0.035 * loud, [Biquad.make('bp', 2600, 0.9)]);
  } else {
    const c = jit(rng, 3.2e-3, 0.08);
    contactPulse(out, 0.001, c, 0.35 * loud);
    modal(out, 0.001, [{ f: jit(rng, 125, 0.08), t60: 0.15, a: 0.2 * loud }], c);
    const high: Mode[] = [{ f: jit(rng, 720, 0.06), t60: 0.02, a: 0.4 * loud }];
    ballShell(rng, high, 0.6 * loud);
    modal(out, 0.001, high, c * ONSET * 1.5);
    noiseBurst(out, rng, 0.004, 0.006, 0.06, 0.03 * loud, [Biquad.make('bp', 2200, 0.8)]);
  }
  removeDC(out);
  return fadeTail(out, 0.05);
}

// ---- feet -------------------------------------------------------------------------------------------------------
/**
 * A foot landing (`force` 0..1). On sand-filled turf the shoe crunches the sand and brushes the fibres (no squeak:
 * padel shoes have herringbone/omni soles for sand); clay crunches coarser; carpet is a muffled pat; a hard court
 * gives the rubber sole's slap and, now and then, a short chirp.
 */
export function step(rng: Rng, floor: number, force: number): Float32Array {
  const out = buf(0.12);
  const f = clamp01(force);
  const loud = 0.3 + 0.7 * f;
  // The body's weight landing is felt more than heard (a 14 ms pulse, under 100 Hz).
  contactPulse(out, 0.001, jit(rng, 0.014, 0.15), 0.06 * loud);
  if (floor === FL_TURF || floor === FL_CLAY) {
    const turf = floor === FL_TURF;
    grains(out, rng, 0.002, Math.round((turf ? 24 : 32) + 50 * f), turf ? 0.014 : 0.02, turf ? 0.0006 : 0.001,
      turf ? 2200 : 900, turf ? 7500 : 3800, 0.2 * loud);
    noiseBurst(out, rng, 0.001, 0.003, 0.03, 0.05 * loud, [Biquad.make('bp', 1500, 0.6)]);
  } else if (floor === FL_CARPET) {
    noiseBurst(out, rng, 0.001, 0.002, 0.03, 0.1 * loud, [Biquad.make('bp', 900, 0.7)]);
  } else {
    noiseBurst(out, rng, 0.001, 0.0003, 0.008, 0.14 * loud, [Biquad.make('bp', 1800, 0.9)]);
    if (f > 0.5 && rng.next() < 0.45) chirp(out, rng, 0.008, rng.range(0.025, 0.045), 0.08 * f);
  }
  removeDC(out);
  return fadeTail(out, 0.02);
}

/** A rubber sole's squeak: stick-slip at 1-3 kHz, its pitch sliding, with harmonics. */
function chirp(out: Float32Array, rng: Rng, at: number, len: number, amp: number): void {
  const start = Math.round(at * SR), n = Math.round(len * SR);
  const f0 = rng.range(1300, 2500), glide = rng.range(-0.3, 0.35);
  let ph = 0;
  for (let i = 0; i < n && start + i < out.length; i++) {
    const u = i / n;
    const f = f0 * (1 + glide * u) * (1 + 0.02 * Math.sin(2 * Math.PI * 23 * u));
    ph += (2 * Math.PI * f) / SR;
    const env = Math.sin(Math.PI * u) ** 0.7 * (0.8 + 0.2 * rng.next());
    let x = 0;
    for (let h = 1; h <= 5; h++) x += Math.sin(h * ph) / (h * 1.3);
    out[start + i] = out[start + i]! + x * env * amp;
  }
}

/**
 * A shoe sliding or braking (`slide` 0..1): a granular drag through the sand (turf, clay), a brush (carpet), or the
 * squeak of rubber on a hard court.
 */
export function scuff(rng: Rng, floor: number, slide: number): Float32Array {
  const len = 0.12 + 0.18 * clamp01(slide);
  const out = buf(len + 0.05);
  const loud = 0.4 + 0.6 * clamp01(slide);
  if (floor === FL_HARD) {
    chirp(out, rng, 0.002, len * rng.range(0.6, 1), 0.12 * loud);
  } else {
    const turf = floor === FL_TURF, clay = floor === FL_CLAY;
    const n = Math.round(len * SR);
    const lp = Biquad.make('lp', clay ? 2500 : turf ? 3500 : 2000, 0.7), hp = Biquad.make('hp', 300, 0.7);
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const env = Math.min(1, u / 0.15) * Math.min(1, (1 - u) / 0.4) * (0.7 + 0.3 * Math.sin(2 * Math.PI * 9 * u + rng.next()));
      out[i] = out[i]! + lp.run(hp.run(rng.next() * 2 - 1)) * env * 0.08 * loud;
    }
    if (turf || clay) {
      const count = Math.round(len * (turf ? 900 : 1300));
      for (let gi = 0; gi < count; gi++) {
        const t = rng.next() * len;
        grains(out, rng, t, 1, 0.0001, turf ? 0.0005 : 0.0009, turf ? 2500 : 1000, turf ? 8000 : 4000, 0.06 * loud * Math.sin((Math.PI * t) / len));
      }
    }
  }
  removeDC(out);
  return fadeTail(out, 0.03);
}

// ---- the swing --------------------------------------------------------------------------------------------------
/**
 * A racket through the air (`speed` 0..1): turbulent noise off the frame and the holes, its band rising with the
 * racket's speed; aeolian sound pressure goes as about speed cubed, so a block volley is near silent and a smash
 * swishes. Peaks 60 ms in (the event is the release, about the contact).
 */
export function whoosh(rng: Rng, speed: number): Float32Array {
  const out = buf(0.28);
  const s = clamp01(speed);
  const amp = 0.05 + 0.2 * s * s * s;
  const n = out.length;
  const bp = new Biquad(SR), hi = Biquad.make('bp', 3000, 1.1);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const e = t < 0.06 ? (t / 0.06) ** 2 : Math.exp(-(t - 0.06) / 0.045);
    if (i % 32 === 0) bp.set('bp', 250 + 1300 * s * e, 1.3);
    const x = rng.next() * 2 - 1;
    out[i] = (bp.run(x) + 0.25 * s * hi.run(x)) * e * amp;
  }
  removeDC(out);
  return fadeTail(out, 0.03);
}

// ---- voices -----------------------------------------------------------------------------------------------------
/** A speaker: fundamental (Hz) and vocal tract scale (formants divide by it: 1 is an adult male's tract). */
export interface VoiceSpec { f0: number; tract: number }

/** Vowel formants (Hz) and bandwidths, adult male (Peterson & Barney 1952 averages; bandwidths after Klatt 1980). */
const VOWELS: Record<string, number[]> = {
  ah: [730, 1090, 2440, 3400, 3900],
  uh: [640, 1190, 2390, 3300, 3850],
  eh: [530, 1840, 2480, 3400, 3900],
  oo: [300, 870, 2240, 3300, 3850],
  ee: [270, 2290, 3010, 3600, 4000],
  aw: [570, 840, 2410, 3300, 3850],
};
const BW = [90, 110, 170, 250, 300];

/**
 * One vocal sound: a glottal source (a Rosenberg pulse train with jitter and shimmer, plus breath noise) through a
 * cascade of formant resonators (Klatt 1980) and the lips' radiation (a first difference), at LO_SR. `pitch` is a
 * contour (0..1 time to a multiple of f0), `vowel` a key of VOWELS or two to glide between, `breath` 0..1 how much
 * of the source is aspiration noise, `amp` the envelope's level.
 */
export function vocal(out: Float32Array, rng: Rng, at: number, len: number, v: VoiceSpec, vowel: string, vowel2: string,
  pitch: (u: number) => number, breath: number, amp: number, attack = 0.02, release = 0.08, sr = LO_SR): void {
  const start = Math.round(at * sr), n = Math.round(len * sr);
  const fa = VOWELS[vowel]!, fb = VOWELS[vowel2]!;
  const f0 = form5(sr);
  let phase = 0, jitter = 0, shimmer = 1, lastLip = 0, pf = 1;
  const ns = Biquad.make('hp', 400, 0.7, 0, sr);
  const nb = breath * 0.6, nv = 1 - breath;
  for (let i = 0; i < n && start + i < out.length; i++) {
    if ((i & 63) === 0) {
      // Formants, pitch and bandwidths move slowly: every 64 samples (2.7 ms) is plenty.
      const u = i / n;
      for (let k = 0; k < 5; k++) f0[k]!.set(Math.min((fa[k]! + (fb[k]! - fa[k]!) * u) / v.tract, sr * 0.45), BW[k]! * (1 + 0.5 * breath));
      pf = v.f0 * pitch(u);
    }
    phase += (pf * (1 + jitter)) / sr;
    if (phase >= 1) {
      phase -= 1;
      jitter = (rng.next() - 0.5) * 0.02;
      shimmer = 1 + (rng.next() - 0.5) * 0.12;
    }
    const g = GLOTTIS[(phase * GL_N) | 0]!;
    let x = g * shimmer * nv + ns.run(rng.next() * 2 - 1) * nb * (phase < 0.6 ? 1 : 0.3);
    for (let k = 0; k < 5; k++) x = f0[k]!.run(x);
    const lip = x - lastLip;
    lastLip = x;
    const t = i / sr;
    const env = Math.min(1, t / attack) * Math.min(1, (len - t) / release);
    out[start + i] = out[start + i]! + lip * env * amp;
  }
}

function form5(sr: number): Formant[] { return [new Formant(sr), new Formant(sr), new Formant(sr), new Formant(sr), new Formant(sr)]; }

/** Rosenberg (1971) glottal flow over one cycle: open 60% (rising two thirds of that, falling the rest), then shut. */
const GL_N = 512;
const GLOTTIS = (() => {
  const t = new Float32Array(GL_N);
  const op = 0.6;
  for (let i = 0; i < GL_N; i++) {
    const ph = i / GL_N;
    t[i] = ph < op * 0.66 ? 0.5 * (1 - Math.cos((Math.PI * ph) / (op * 0.66)))
      : ph < op ? Math.cos((Math.PI * (ph - op * 0.66)) / (2 * op * 0.34)) : 0;
  }
  return t;
})();

/** The players' voices (by player number): four men's voices, a little apart in pitch and size. */
export const PLAYER_VOICES: VoiceSpec[] = [
  { f0: 112, tract: 1.0 }, { f0: 124, tract: 0.95 }, { f0: 101, tract: 1.05 }, { f0: 136, tract: 0.93 },
];

/**
 * A grunt with a shot (`effort` 0..1). Players exhale through hard strokes; past a point it is voiced, short,
 * pitched up by the effort and falling ("hah", "uh"). Light efforts are only breath. Shouts and grunts carry more
 * sound power in real padel than the impacts do (Piana et al.: +1.9 dB(A) overall with them), so they matter in the
 * mix, but the game keeps them a step under the racket.
 */
export function grunt(rng: Rng, v: VoiceSpec, effort: number): Float32Array {
  const e = clamp01(effort);
  const len = 0.11 + 0.22 * e * rng.range(0.8, 1.2);
  const out = buf(len + 0.05, LO_SR);
  const rise = 1 + 0.45 * e;
  const fall = rng.range(0.18, 0.3);
  const vowels = e > 0.7 ? ['ah', 'uh'] : ['uh', 'uh'];
  const breath = e < 0.3 ? 0.95 : 0.25 + 0.3 * (1 - e);
  vocal(out, rng, 0.004, len, v, vowels[0]!, vowels[1]!, (u) => rise * (1 + 0.06 * Math.min(1, u * 8) - fall * u), breath,
    0.25 + 0.75 * e, e > 0.6 ? 0.008 : 0.03, 0.06 + 0.04 * e);
  removeDC(out);
  return fadeTail(out, 0.02, LO_SR);
}

// ---- the crowd --------------------------------------------------------------------------------------------------
/**
 * Hand-clap resonances (ClaPD: Peltola et al. 2007, after Repp 1987's eight hand configurations): centre (Hz) and
 * its spread, -3 dB bandwidth and spread, gain and spread. A clap lasts about 5 ms (Jylhä & Erkut, DAFx 2008).
 */
const CLAPS = [
  [1364, 333, 188, 54, 27.2, 9.76], [774, 448, 139, 7, 13.8, 3.5], [1562, 257, 375, 94, 19.5, 6.31],
  [775, 39, 137, 15, 22.2, 3.55], [1355, 57, 222, 53, 24, 8.03], [1452, 12, 183, 40, 13.8, 4.45],
  [500, 178, 91, 27, 33.8, 5.57], [984, 396, 137, 36, 11.3, 1.42],
];

/** One clap into a stereo pair at time t (s), panned by `pan` -1..1, with the clapper's hand configuration. */
function clap(L: Float32Array, R: Float32Array, rng: Rng, t: number, cfg: number[], amp: number, pan: number, sr: number): void {
  const f = Math.max(250, cfg[0]! + rng.gauss() * cfg[1]! * 0.5);
  const bw = Math.max(60, cfg[2]! + rng.gauss() * cfg[3]! * 0.5);
  const g = Math.max(2, cfg[4]! + rng.gauss() * cfg[5]! * 0.5) / 33.8;
  const r = Math.exp((-Math.PI * bw) / sr), w = (2 * Math.PI * f) / sr;
  const c1 = 2 * r * Math.cos(w), c2 = -r * r;
  const start = Math.round(t * sr), n = Math.round(0.005 * sr), tail = Math.round(0.03 * sr);
  const gl = Math.cos(((pan + 1) * Math.PI) / 4), gr = Math.sin(((pan + 1) * Math.PI) / 4);
  let y1 = 0, y2 = 0;
  for (let i = 0; i < n + tail && start + i < L.length; i++) {
    const x = i < n ? (rng.next() * 2 - 1) * Math.exp(-i / (n * 0.3)) : 0;
    const y = x * (1 - r) * 2 + c1 * y1 + c2 * y2;
    y2 = y1; y1 = y;
    const s = (y * 0.9 + x * 0.1) * g * amp;
    L[start + i] = L[start + i]! + s * gl;
    R[start + i] = R[start + i]! + s * gr;
  }
}

/**
 * Applause from `people` clappers over `secs`: each has a hand configuration, a place (pan, distance), a rate of
 * about 4 claps a second (unsynchronised applause; tuning), starts within half a second as the moment sinks in and
 * stops at their own time, the last few trailing off. `big` builds and holds longer. Stereo at LO_SR. A big crowd's
 * thousands are many more than are rendered: a diffuse band of noise in the claps' spectrum stands in for the rest.
 */
export function applause(rng: Rng, people: number, secs: number, big: boolean): Float32Array[] {
  const sr = LO_SR;
  const L = new Float32Array(Math.round(secs * sr)), R = new Float32Array(L.length);
  const nRender = Math.min(people, 160);
  for (let p = 0; p < nRender; p++) {
    const cfg = CLAPS[Math.floor(rng.next() * CLAPS.length)]!;
    const rate = Math.max(2.2, 4 + rng.gauss() * 0.6);
    const pan = rng.range(-0.9, 0.9);
    const amp = rng.range(0.4, 1) * (1 / Math.sqrt(nRender)) * 1.6;
    const begin = rng.range(0.03, big ? 0.6 : 0.4) + (rng.next() < 0.15 ? rng.range(0.3, 0.8) : 0);
    const end = secs * (big ? rng.range(0.55, 0.95) : rng.range(0.4, 0.9));
    let t = begin;
    while (t < end) {
      const fade = t > end - 0.4 ? Math.max(0.2, (end - t) / 0.4) : 1;
      clap(L, R, rng, t, cfg, amp * fade * (big ? 1 : 0.8), pan, sr);
      t += (1 / rate) * (1 + rng.gauss() * 0.05);
    }
  }
  if (people > nRender) {
    // The rest: noise shaped like a clap's spectrum, under the same swell.
    const bp1 = Biquad.make('bp', 1100, 0.6, 0, sr), bp2 = Biquad.make('bp', 1100, 0.6, 0, sr);
    const lvl = 0.25 * Math.min(1, Math.log10(people / nRender));
    for (let i = 0; i < L.length; i++) {
      const t = i / sr;
      const env = Math.min(1, t / (big ? 0.7 : 0.4)) * Math.min(1, Math.max(0, (secs * (big ? 0.85 : 0.7) - t) / (secs * 0.35)));
      L[i] = L[i]! + bp1.run(rng.next() * 2 - 1) * env * lvl;
      R[i] = R[i]! + bp2.run(rng.next() * 2 - 1) * env * lvl;
    }
  }
  fadeTail(L, 0.1, sr); fadeTail(R, 0.1, sr);
  return [removeDC(L), removeDC(R)];
}

/**
 * A crowd's vocal reaction: `kind` 'ooh' (a gasp at a great get or a near miss), 'aah' (disappointment, falling),
 * 'cheer' (a winner, a ball out of the court). `people` voices (up to 40 rendered, men's and women's), staggered,
 * each with its own pitch contour. Stereo at LO_SR.
 */
export function crowdVoice(rng: Rng, people: number, kind: 'ooh' | 'aah' | 'cheer', secs: number): Float32Array[] {
  const sr = LO_SR;
  const L = new Float32Array(Math.round(secs * sr)), R = new Float32Array(L.length);
  const n = Math.min(people, 40);
  const mono = new Float32Array(L.length);
  for (let p = 0; p < n; p++) {
    mono.fill(0);
    const woman = rng.next() < 0.4;
    const v: VoiceSpec = { f0: woman ? rng.range(175, 245) : rng.range(95, 140), tract: woman ? rng.range(0.82, 0.9) : rng.range(0.95, 1.06) };
    const at = rng.range(0, kind === 'cheer' ? 0.25 : 0.15);
    const len = Math.min(secs - at - 0.05, (kind === 'cheer' ? rng.range(0.6, 1.4) : rng.range(0.6, 1.1)) * (secs / 1.6));
    const amp = rng.range(0.5, 1) / Math.sqrt(n);
    if (kind === 'ooh') {
      const peak = rng.range(0.3, 0.5);
      vocal(mono, rng, at, len, v, 'oo', 'oo', (u) => 1 + 0.25 * Math.sin(Math.PI * Math.min(1, u / (peak * 2))) - 0.15 * u, 0.35, amp, 0.08, 0.3, sr);
    } else if (kind === 'aah') {
      vocal(mono, rng, at, len, v, 'aw', 'uh', (u) => 1.15 - 0.35 * u, 0.4, amp, 0.06, 0.3, sr);
    } else {
      // "Yeah!", "hey!", the odd high "whoo".
      const r = rng.next();
      if (r < 0.2) vocal(mono, rng, at, len * 0.8, v, 'oo', 'oo', (u) => 1.6 + 0.4 * Math.sin(Math.PI * u), 0.3, amp * 0.8, 0.04, 0.2, sr);
      else vocal(mono, rng, at, len, v, r < 0.6 ? 'eh' : 'ee', 'ah', (u) => 1.35 + 0.15 * Math.sin(Math.PI * Math.min(1, u * 1.5)) - 0.25 * u, 0.3, amp, 0.03, 0.25, sr);
    }
    const pan = rng.range(-0.9, 0.9);
    const gl = Math.cos(((pan + 1) * Math.PI) / 4), gr = Math.sin(((pan + 1) * Math.PI) / 4);
    for (let i = 0; i < mono.length; i++) { L[i] = L[i]! + mono[i]! * gl; R[i] = R[i]! + mono[i]! * gr; }
  }
  if (people > n) {
    // Thousands more: breathy noise through the same vowel, swelling and falling.
    const vw = VOWELS[kind === 'ooh' ? 'oo' : kind === 'aah' ? 'aw' : 'ah']!;
    for (const ch of [L, R]) {
      const fs = [new Formant(sr), new Formant(sr), new Formant(sr)];
      fs.forEach((f, k) => f.set(vw[k]!, BW[k]! * 2));
      const lvl = 0.06 * Math.min(1, Math.log10(people / n));
      for (let i = 0; i < ch.length; i++) {
        const u = i / ch.length;
        let x = rng.next() * 2 - 1;
        for (const f of fs) x = f.run(x);
        ch[i] = ch[i]! + x * lvl * Math.sin(Math.PI * Math.min(1, u * 1.4)) ** 1.5;
      }
    }
  }
  fadeTail(L, 0.1, sr); fadeTail(R, 0.1, sr);
  return [removeDC(L), removeDC(R)];
}

/**
 * The crowd's murmur between points, a loop `secs` long: talkers in phrases (about 5 syllables a second, Pellegrino
 * et al. 2011 measure 5-8 across languages) with pauses, each syllable a vowel with a consonant's noise before it,
 * at their own pitch, spread across the stereo field. The loop's ends are crossfaded so it repeats without a seam.
 */
export function murmur(rng: Rng, talkers: number, secs: number): Float32Array[] {
  const sr = LO_SR;
  const fade = 0.5;
  const total = secs + fade;
  const L = new Float32Array(Math.round(total * sr)), R = new Float32Array(L.length);
  const mono = new Float32Array(L.length);
  const keys = Object.keys(VOWELS);
  const n = Math.min(talkers, 24);
  for (let p = 0; p < n; p++) {
    mono.fill(0);
    const woman = rng.next() < 0.45;
    const v: VoiceSpec = { f0: woman ? rng.range(170, 230) : rng.range(95, 135), tract: woman ? rng.range(0.83, 0.9) : rng.range(0.96, 1.05) };
    let t = rng.range(0, 1.5);
    while (t < total - 0.3) {
      const phrase = rng.range(0.8, 2.6);
      const end = Math.min(total - 0.2, t + phrase);
      while (t < end) {
        const syl = 1 / rng.range(4.5, 6.5);
        const a = keys[Math.floor(rng.next() * keys.length)]!, b = keys[Math.floor(rng.next() * keys.length)]!;
        const pitch0 = rng.range(0.9, 1.15);
        noiseBurst(mono, rng, t, 0.005, 0.03, 0.04, [Biquad.make('bp', rng.range(2500, 6000), 1, 0, sr)], sr);
        vocal(mono, rng, t + 0.02, syl * 0.75, v, a, b, (u) => pitch0 * (1 - 0.08 * u), 0.2, 0.5, 0.02, 0.04, sr);
        t += syl;
      }
      t += rng.range(0.4, 1.8);
    }
    const pan = rng.range(-0.9, 0.9);
    const gl = Math.cos(((pan + 1) * Math.PI) / 4), gr = Math.sin(((pan + 1) * Math.PI) / 4);
    const amp = rng.range(0.5, 1) / Math.sqrt(n);
    for (let i = 0; i < mono.length; i++) { L[i] = L[i]! + mono[i]! * gl * amp; R[i] = R[i]! + mono[i]! * gr * amp; }
  }
  // Heard from the stands' distance: the highs go first.
  for (const ch of [L, R]) Biquad.make('lp', 3200, 0.7, 0, sr).process(ch);
  return [loopable(L, secs, fade, sr), loopable(R, secs, fade, sr)];
}

/** Fold the last `fade` seconds onto the start (equal-power), so the first `secs` loop seamlessly. */
function loopable(x: Float32Array, secs: number, fade: number, sr: number): Float32Array {
  const n = Math.round(secs * sr), nf = Math.round(fade * sr);
  const out = x.slice(0, n);
  for (let i = 0; i < nf; i++) {
    const u = i / nf;
    out[i] = x[i]! * Math.sin((Math.PI / 2) * u) + x[n + i]! * Math.cos((Math.PI / 2) * u);
  }
  return removeDC(out);
}

/**
 * Outdoor and hall beds, loops of `secs`: `wind` (low noise with slow gusts, and leaves), `birds` (day: short
 * frequency-swept chirps in a few patterns), `crickets` (night: a 4.5 kHz carrier in pulse trains), `hum` (floodlight
 * ballasts at twice the 50 Hz mains, very faint), `hall` (a covered hall's air: broadband, low).
 */
export function ambience(rng: Rng, kind: 'wind' | 'birds' | 'crickets' | 'hum' | 'hall', secs: number): Float32Array[] {
  const sr = LO_SR, fade = 0.5;
  const total = secs + fade;
  const L = new Float32Array(Math.round(total * sr)), R = new Float32Array(L.length);
  if (kind === 'wind' || kind === 'hall') {
    for (const ch of [L, R]) {
      const lp = Biquad.make('lp', kind === 'wind' ? 500 : 900, 0.7, 0, sr), lp2 = Biquad.make('lp', 300, 0.7, 0, sr);
      const ph = rng.next() * 6.28, f1 = rng.range(0.05, 0.11), f2 = rng.range(0.15, 0.3);
      let brown = 0;
      for (let i = 0; i < ch.length; i++) {
        const t = i / sr;
        brown = brown * 0.995 + (rng.next() * 2 - 1) * 0.05;
        const gust = kind === 'wind' ? 0.55 + 0.3 * Math.sin(2 * Math.PI * f1 * t + ph) + 0.15 * Math.sin(2 * Math.PI * f2 * t) : 1;
        ch[i] = (lp.run(rng.next() * 2 - 1) * 0.6 + lp2.run(brown) * 2) * gust * 0.3;
      }
    }
    if (kind === 'wind') {
      // Leaves stirring with the gusts.
      for (let k = 0; k < secs * 6; k++) {
        const t = rng.next() * secs;
        const ch = rng.next() < 0.5 ? L : R;
        noiseBurst(ch, rng, t, 0.05, 0.25, 0.01, [Biquad.make('bp', rng.range(3000, 7000), 0.8, 0, sr)], sr);
      }
    }
  } else if (kind === 'birds') {
    const species = [
      { f: [3200, 4200], n: [3, 6], len: 0.06, gap: 0.09 },
      { f: [2200, 2900], n: [2, 3], len: 0.18, gap: 0.12 },
      { f: [4800, 6200], n: [5, 9], len: 0.03, gap: 0.05 },
    ];
    for (let k = 0; k < secs * 0.9; k++) {
      const sp = species[Math.floor(rng.next() * species.length)]!;
      const ch = rng.next() < 0.5 ? L : R;
      let t = rng.next() * (secs - 1.5);
      const count = Math.round(rng.range(sp.n[0]!, sp.n[1]!));
      const fb = rng.range(sp.f[0]!, sp.f[1]!);
      const amp = rng.range(0.01, 0.035);
      for (let c = 0; c < count; c++) {
        const start = Math.round(t * sr), n = Math.round(sp.len * sr);
        let ph = 0;
        const up = rng.next() < 0.5;
        for (let i = 0; i < n && start + i < ch.length; i++) {
          const u = i / n;
          const f = fb * (1 + (up ? 0.35 * u : 0.35 * (1 - u)) + 0.05 * Math.sin(2 * Math.PI * 40 * u));
          ph += (2 * Math.PI * f) / sr;
          ch[start + i] = ch[start + i]! + Math.sin(ph) * Math.sin(Math.PI * u) * amp;
        }
        t += sp.len + sp.gap * rng.range(0.7, 1.3);
      }
    }
  } else if (kind === 'crickets') {
    for (let k = 0; k < 4; k++) {
      const ch = k % 2 ? L : R;
      const fc = rng.range(4200, 4900), amp = rng.range(0.006, 0.015);
      let t = rng.next() * 0.5;
      while (t < total - 0.3) {
        for (let p = 0; p < 4; p++) {
          const start = Math.round((t + p * 0.033) * sr), n = Math.round(0.018 * sr);
          for (let i = 0; i < n && start + i < ch.length; i++) {
            ch[start + i] = ch[start + i]! + Math.sin((2 * Math.PI * fc * (start + i)) / sr) * Math.sin((Math.PI * i) / n) * amp;
          }
        }
        t += rng.range(0.5, 0.9);
      }
    }
  } else {
    for (const ch of [L, R]) {
      for (let i = 0; i < ch.length; i++) {
        const t = i / sr;
        ch[i] = 0.01 * Math.sin(2 * Math.PI * 100 * t) + 0.004 * Math.sin(2 * Math.PI * 200 * t) + 0.002 * Math.sin(2 * Math.PI * 300 * t);
      }
    }
  }
  return [loopable(L, secs, fade, sr), loopable(R, secs, fade, sr)];
}

// ---- rooms ------------------------------------------------------------------------------------------------------
/** A room's reverberation (data/audio.json `rooms`). */
export interface RoomSpec {
  /** RT60 (s) in the low (< 400 Hz), mid and high (> 3 kHz) bands. */
  rt60: [number, number, number];
  /** Delay of the diffuse tail after the direct sound (s). */
  preDelay: number;
  /** Early reflections: delay (s), level (linear), pan -1..1. */
  early: Array<[number, number, number]>;
  /** Flutter between two parallel hard surfaces (e.g. floor and roof): round-trip delay (s) and level; 0: none. */
  flutter?: [number, number];
}

/**
 * A stereo impulse response for the convolver: exponentially decaying noise (independent per ear), in three bands
 * each with its own RT60, fading in after the pre-delay; early reflections as single taps; an optional flutter
 * echo. Normalised to unit energy, so `wet` in the mix sets the reverb's level.
 */
export function impulseResponse(rng: Rng, room: RoomSpec, sr = SR): Float32Array[] {
  const len = Math.min(4, Math.max(0.3, room.rt60[0] * 1.3));
  const n = Math.round(len * sr);
  const chans: Float32Array[] = [];
  for (let c = 0; c < 2; c++) {
    const lo = new Float32Array(n), mid = new Float32Array(n), hi = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = rng.gauss(); lo[i] = x; mid[i] = x; hi[i] = x; }
    Biquad.make('lp', 400, 0.7, 0, sr).process(lo);
    Biquad.make('hp', 400, 0.7, 0, sr).process(mid); Biquad.make('lp', 3000, 0.7, 0, sr).process(mid);
    Biquad.make('hp', 3000, 0.7, 0, sr).process(hi);
    const out = new Float32Array(n);
    const pd = Math.round(room.preDelay * sr), build = Math.round(0.04 * sr);
    const k = room.rt60.map((t) => 6.9078 / (t * sr));
    for (let i = pd; i < n; i++) {
      const j = i - pd;
      const env = Math.min(1, j / build);
      out[i] = env * (lo[i]! * Math.exp(-k[0]! * j) + mid[i]! * Math.exp(-k[1]! * j) + hi[i]! * Math.exp(-k[2]! * j));
    }
    // Early reflections (each ear its own level by pan), and the flutter.
    let e2 = 0;
    for (let i = 0; i < n; i++) e2 += out[i]! * out[i]!;
    const tapScale = Math.sqrt(e2 / Math.max(1, n)) * 40;
    for (const [t, g, pan] of room.early) {
      const i = Math.round(t * sr);
      if (i < n) out[i] = out[i]! + g * tapScale * (c === 0 ? Math.cos(((pan + 1) * Math.PI) / 4) : Math.sin(((pan + 1) * Math.PI) / 4));
    }
    if (room.flutter && room.flutter[1] > 0) {
      const [d, g] = room.flutter;
      for (let r = 1; r * d < len; r++) {
        const i = Math.round(r * d * sr);
        out[i] = out[i]! + g * tapScale * Math.exp(-k[1]! * i) * (1 - 0.1 * r);
      }
    }
    chans.push(out);
  }
  let e = 0;
  for (const ch of chans) for (let i = 0; i < ch.length; i++) e += ch[i]! * ch[i]!;
  const s = 1 / Math.sqrt(e || 1);
  for (const ch of chans) for (let i = 0; i < ch.length; i++) ch[i] = ch[i]! * s;
  return chans;
}
