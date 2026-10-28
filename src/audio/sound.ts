// Hit feedback by ear (Phase 2; FEEL.md "Sound"). Synthesised with WebAudio, no samples: a racket hit is a short
// noise burst through a resonance plus a decaying tone, and how clean the contact was changes both. A centred,
// well-timed hit is short, bright and dry (the ball's own "pock"); a poorly timed one is duller and longer, with
// a low knock from the frame. Loudness follows the ball's speed off the racket. The full soundscape (bounces,
// glass, mesh, crowd) is Phase 6.
// Nodes are one-shot by WebAudio's design, so each hit makes a few (a handful of small objects a second, off the
// sim's hot path).

/** What the sound of one racket hit depends on. */
export interface HitSound {
  /** Contact quality 0..1 (1: Perfect timing, centred). */
  quality: number;
  /** Ball speed off the racket, m/s. */
  speed: number;
  /** A soft touch (drop shot, chiquita, lob): played quieter and rounder. */
  soft: boolean;
  /** A smash or víbora: the full swing, a harder crack. */
  overhead: boolean;
  /** Seconds from now (the sim can be a tick ahead of the screen). */
  delay: number;
  /** -1 left .. 1 right, from where the hit is on screen. */
  pan: number;
  /** 0..1: closer to the camera is louder. */
  near: number;
}

export class Sound {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private master: GainNode | null = null;
  enabled = true;

  /** Browsers only start audio from a user gesture: call from the first key or pointer press. */
  unlock(): void {
    if (!this.enabled) return;
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      // A gentle limiter so a smash next to the camera can't clip.
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -10;
      comp.knee.value = 6;
      comp.ratio.value = 6;
      comp.attack.value = 0.001;
      comp.release.value = 0.08;
      this.master.connect(comp).connect(this.ctx.destination);
      // 0.25 s of white noise, reused by every burst (deterministic: a fixed LCG, not Math.random).
      const n = Math.round(this.ctx.sampleRate * 0.25);
      this.noise = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      let s = 12345;
      for (let i = 0; i < n; i++) {
        s = (s * 1103515245 + 12345) >>> 0;
        d[i] = (s / 2147483648) - 1;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** The audio clock is running (unlocked and not suspended). */
  get live(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  hit(h: HitSound): void {
    const ctx = this.ctx;
    if (!ctx || !this.noise || !this.master || ctx.state !== 'running') return;
    const t = ctx.currentTime + Math.max(0, h.delay);
    const q = Math.min(1, Math.max(0, h.quality));
    // Loudness: about +6 dB per doubling of ball speed (pressure ~ impact speed), a softer touch for drops.
    const v = Math.min(1.6, Math.max(0.15, h.speed / 25));
    const amp = v * (h.soft ? 0.45 : 1) * (0.55 + 0.45 * h.near) * (h.overhead ? 1.15 : 1);
    // Centred hit: resonance high and narrow, short; off-centre or mistimed: lower, wider, longer.
    const f0 = 900 + 500 * q + (h.overhead ? 150 : 0) - (h.soft ? 200 : 0);
    const decay = 0.018 + 0.03 * (1 - q) + (h.soft ? 0.01 : 0);

    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-0.8, Math.min(0.8, h.pan));
    pan.connect(this.master);

    // The impact: a 3-6 ms noise burst through the ball/face resonance.
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f0;
    bp.Q.value = 1.2 + 2.8 * q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.0008);
    g.gain.exponentialRampToValueAtTime(0.0008, t + decay + 0.004);
    src.connect(bp).connect(g).connect(pan);
    src.start(t, (h.speed * 0.0123) % 0.2, decay + 0.01);

    // The tone of the hit: the ball's shell ringing briefly (sweet) or the face's dull "thock" (off).
    const tone = ctx.createOscillator();
    tone.type = 'sine';
    tone.frequency.setValueAtTime(f0 * 1.05, t);
    tone.frequency.exponentialRampToValueAtTime(f0 * 0.82, t + decay);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0, t);
    tg.gain.linearRampToValueAtTime(amp * 0.35, t + 0.001);
    tg.gain.exponentialRampToValueAtTime(0.0005, t + decay * 1.4);
    tone.connect(tg).connect(pan);
    tone.start(t);
    tone.stop(t + decay * 1.4 + 0.01);

    // A mistimed or framey contact: the racket's frame knocks, low and longer.
    const off = 1 - q;
    if (off > 0.2) {
      const knock = ctx.createOscillator();
      knock.type = 'triangle';
      knock.frequency.setValueAtTime(240, t);
      knock.frequency.exponentialRampToValueAtTime(170, t + 0.07);
      const kg = ctx.createGain();
      kg.gain.setValueAtTime(0, t);
      kg.gain.linearRampToValueAtTime(amp * 0.5 * off, t + 0.002);
      kg.gain.exponentialRampToValueAtTime(0.0005, t + 0.06 + 0.05 * off);
      knock.connect(kg).connect(pan);
      knock.start(t);
      knock.stop(t + 0.13);
    }
  }

  /** The swish of a swing that met nothing. */
  whiff(delay: number, pan: number, near: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.noise || !this.master || ctx.state !== 'running') return;
    const t = ctx.currentTime + Math.max(0, delay);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(500, t);
    bp.frequency.exponentialRampToValueAtTime(1600, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.12 * (0.5 + 0.5 * near), t + 0.07);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.16);
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-0.8, Math.min(0.8, pan));
    src.connect(bp).connect(g).connect(p).connect(this.master);
    src.start(t, 0.05, 0.18);
  }
}
