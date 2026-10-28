// The audio engine (Phase 6): WebAudio playback of the bank from the broadcast camera's place. Every sound goes
// through one of a fixed pool of voices (gain, air lowpass, panner, reverb send) to a bus (ball and racket, players,
// crowd, ambience), then the arena's reverb, a master gain, a limiter and a soft clip. The listener follows the
// camera each frame. Browsers start audio only from a user gesture (`unlock`); until then, and until the bank's
// family has arrived from the worker, plays are dropped.
import * as THREE from 'three/webgpu';
import { AUDIO, arenaAudio, buildBank, renderRoom, type BankEnv, type Sample } from './bank.ts';
import { resample } from './dsp.ts';

export const BUS_BALL = 0, BUS_PLAYERS = 1, BUS_CROWD = 2, BUS_AMB = 3;

/** What the soundscape asks of the engine (tests record these instead of playing them). */
export interface AudioSink {
  /** Audio is running and can be heard. */
  readonly live: boolean;
  /** A sound placed in the world (x, y, z), `delay` s from now, at `gain` (linear) and `rate` (pitch). */
  play(family: string, bin: number, x: number, y: number, z: number, gain: number, rate: number, delay: number, bus: number): void;
  /** A sound all round (the crowd), stereo as rendered. */
  playFlat(family: string, bin: number, gain: number, delay: number, bus: number): void;
  /** A looping bed's level (linear; 0 silences it), approached with time constant `tc` s. */
  loop(name: string, gain: number, tc: number): void;
}

interface Voice {
  gain: GainNode;
  air: BiquadFilterNode;
  pan: PannerNode;
  send: GainNode;
  src: AudioBufferSourceNode | null;
  until: number;
  bus: number;
}

const POOL = 32;
const db = (x: number): number => Math.pow(10, x / 20);

export class AudioEngine implements AudioSink {
  enabled = true;
  private ctx: AudioContext | null = null;
  private readonly env: BankEnv;
  private readonly raw = new Map<string, Sample[][]>();
  private readonly buffers = new Map<string, AudioBuffer[][]>();
  private room: Sample | null = null;
  private buses: GainNode[] = [];
  private wet: GainNode | null = null;
  private convolver: ConvolverNode | null = null;
  private voices: Voice[] = [];
  private nextVoice = 0;
  private readonly lastVariant = new Map<string, number>();
  private readonly loops = new Map<string, { src: AudioBufferSourceNode | null; gain: GainNode; want: number; tc: number }>();
  private seed = 12345;
  private worker: Worker | null = null;
  /** Families still to come from the worker (for the debug overlay and tests). */
  pending = true;
  private readonly fwd = new THREE.Vector3();
  private readonly up = new THREE.Vector3();

  constructor(env: BankEnv) {
    this.env = env;
  }

  /** Start rendering the bank (in a worker where there is one). Call at load. */
  load(): void {
    if (!this.enabled || this.worker || this.raw.size > 0) return;
    try {
      this.worker = new Worker(new URL('./bankWorker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (ev: MessageEvent): void => this.receive(ev.data);
      this.worker.onerror = (): void => { this.worker = null; this.renderHere(); };
      this.worker.postMessage(this.env);
    } catch {
      this.renderHere();
    }
  }

  private renderHere(): void {
    // No worker: render on the main thread after the first frames.
    setTimeout(() => {
      for (const [k, v] of buildBank(this.env)) this.raw.set(k, v);
      this.room = renderRoom(this.env.arena);
      this.pending = false;
      this.attachRoom();
      this.startLoops();
    }, 1500);
  }

  private receive(m: { name?: string; samples?: Sample[][]; room?: Sample; done?: boolean }): void {
    if (m.name && m.samples) {
      this.raw.set(m.name, m.samples);
      if (this.loops.has(m.name)) this.startLoop(m.name);
    } else if (m.room) {
      this.room = m.room;
      this.attachRoom();
    } else if (m.done) {
      this.pending = false;
      this.worker?.terminate();
      this.worker = null;
    }
  }

  /** Browsers only start audio from a user gesture: call from the first key, pointer or pad press. */
  unlock(): void {
    if (!this.enabled) return;
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC({ latencyHint: 'interactive' });
      this.ctx = ctx;
      // Master: gain, then a limiter, then a soft clip (the limiter's attack lets the first ms through).
      const master = ctx.createGain();
      master.gain.value = db(AUDIO.master);
      const lim = ctx.createDynamicsCompressor();
      lim.threshold.value = -8;
      lim.knee.value = 4;
      lim.ratio.value = 12;
      lim.attack.value = 0.002;
      lim.release.value = 0.15;
      const clip = ctx.createWaveShaper();
      const curve = new Float32Array(1025);
      for (let i = 0; i < curve.length; i++) {
        const x = (i / (curve.length - 1)) * 2 - 1;
        curve[i] = Math.tanh(x * 1.2) / Math.tanh(1.2);
      }
      clip.curve = curve;
      clip.oversample = '2x';
      master.connect(lim).connect(clip).connect(ctx.destination);
      for (let b = 0; b < 4; b++) {
        const g = ctx.createGain();
        g.connect(master);
        this.buses.push(g);
      }
      const wet = ctx.createGain();
      wet.gain.value = db(arenaAudio(this.env.arena).wet);
      this.wet = wet;
      this.convolver = ctx.createConvolver();
      this.convolver.normalize = false;
      wet.connect(this.convolver).connect(master);
      for (let i = 0; i < POOL; i++) {
        const gain = ctx.createGain();
        const air = ctx.createBiquadFilter();
        air.type = 'lowpass';
        air.Q.value = 0.5;
        const pan = ctx.createPanner();
        pan.panningModel = 'equalpower';
        pan.distanceModel = 'inverse';
        pan.refDistance = AUDIO.distance.ref;
        pan.rolloffFactor = AUDIO.distance.rolloff;
        pan.maxDistance = AUDIO.distance.max;
        const send = ctx.createGain();
        gain.connect(air).connect(pan);
        pan.connect(send).connect(wet);
        this.voices.push({ gain, air, pan, send, src: null, until: 0, bus: -1 });
      }
      this.attachRoom();
      this.startLoops();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  get live(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  private attachRoom(): void {
    if (!this.ctx || !this.room || !this.convolver || this.convolver.buffer) return;
    const sr = this.ctx.sampleRate;
    const ch = this.room.ch.map((c) => resample(c, this.room!.sr, sr));
    const b = this.ctx.createBuffer(2, ch[0]!.length, sr);
    b.copyToChannel(ch[0]! as Float32Array<ArrayBuffer>, 0);
    b.copyToChannel(ch[1]! as Float32Array<ArrayBuffer>, 1);
    this.convolver.buffer = b;
  }

  /** The family's AudioBuffers for a bin, made from the rendered floats on first use. */
  private get(family: string, bin: number): AudioBuffer[] | null {
    if (!this.ctx) return null;
    let fam = this.buffers.get(family);
    const raw = this.raw.get(family);
    if (!raw) return null;
    if (!fam) {
      fam = [];
      this.buffers.set(family, fam);
    }
    let row = fam[bin];
    if (!row) {
      const rr = raw[bin];
      if (!rr) return null;
      row = rr.map((s) => {
        const b = this.ctx!.createBuffer(s.ch.length, s.ch[0]!.length, s.sr);
        s.ch.forEach((c, i) => b.copyToChannel(c as Float32Array<ArrayBuffer>, i));
        return b;
      });
      fam[bin] = row;
    }
    return row;
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  /** A variant, never the one just played for this family and bin (no machine-gun repeats). */
  private pick(family: string, bin: number, n: number): number {
    const key = family + bin;
    const last = this.lastVariant.get(key) ?? -1;
    let v = Math.floor(this.rand() * n);
    if (n > 1 && v === last) v = (v + 1 + Math.floor(this.rand() * (n - 1))) % n;
    this.lastVariant.set(key, v);
    return v;
  }

  /** A free voice, else the one that ends soonest (it is cut). */
  private voice(now: number): Voice {
    for (let i = 0; i < POOL; i++) {
      const v = this.voices[(this.nextVoice + i) % POOL]!;
      if (v.until <= now) { this.nextVoice = (this.nextVoice + i + 1) % POOL; return v; }
    }
    let best = this.voices[0]!;
    for (const v of this.voices) if (v.until < best.until) best = v;
    return best;
  }

  play(family: string, bin: number, x: number, y: number, z: number, gain: number, rate: number, delay: number, bus: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const row = this.get(family, bin);
    if (!row || row.length === 0) return;
    const buf = row[this.pick(family, bin, row.length)]!;
    const t = ctx.currentTime + Math.max(0, delay);
    const v = this.voice(t);
    if (v.src) { try { v.src.stop(); } catch { /* already ended */ } v.src.disconnect(); }
    if (v.bus !== bus) {
      v.pan.disconnect();
      v.pan.connect(this.buses[bus]!);
      v.pan.connect(v.send);
      v.bus = bus;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    // Every play a little different: +-3% pitch, +-1.5 dB.
    src.playbackRate.value = rate * (1 + (this.rand() - 0.5) * 0.06);
    src.connect(v.gain);
    v.gain.gain.setValueAtTime(gain * db((this.rand() - 0.5) * 3), t);
    v.pan.positionX.setValueAtTime(x, t);
    v.pan.positionY.setValueAtTime(y, t);
    v.pan.positionZ.setValueAtTime(z, t);
    // Air and distance take the highs; farther sounds are wetter (less direct sound against the same room).
    const l = ctx.listener;
    const dx = x - l.positionX.value, dy = y - l.positionY.value, dz = z - l.positionZ.value;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    v.air.frequency.setValueAtTime(Math.min(20000, AUDIO.distance.airHz / (1 + d / AUDIO.distance.airM)), t);
    v.send.gain.setValueAtTime(0.5 + d / 40, t);
    src.start(t);
    v.src = src;
    v.until = t + buf.duration / src.playbackRate.value;
  }

  playFlat(family: string, bin: number, gain: number, delay: number, bus: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const row = this.get(family, bin);
    if (!row || row.length === 0) return;
    const buf = row[this.pick(family, bin, row.length)]!;
    const t = ctx.currentTime + Math.max(0, delay);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 1 + (this.rand() - 0.5) * 0.04;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    g.connect(this.buses[bus]!);
    // The crowd is in the room too.
    const s = ctx.createGain();
    s.gain.value = 0.7;
    g.connect(s).connect(this.wet!);
    src.start(t);
    src.onended = (): void => { g.disconnect(); s.disconnect(); };
  }

  loop(name: string, gain: number, tc: number): void {
    let l = this.loops.get(name);
    if (!l) {
      if (!this.ctx) {
        // Remember the level for when audio starts.
        this.loops.set(name, { src: null, gain: null as unknown as GainNode, want: gain, tc });
        return;
      }
      const g = this.ctx.createGain();
      g.gain.value = 0;
      g.connect(this.buses[name === 'murmur' ? BUS_CROWD : BUS_AMB]!);
      const s = this.ctx.createGain();
      s.gain.value = 0.6;
      g.connect(s).connect(this.wet!);
      l = { src: null, gain: g, want: gain, tc };
      this.loops.set(name, l);
      this.startLoop(name);
    }
    l.want = gain;
    l.tc = tc;
    if (this.ctx && l.gain) l.gain.gain.setTargetAtTime(gain, this.ctx.currentTime, Math.max(0.01, tc));
  }

  private startLoops(): void {
    for (const [name, l] of this.loops) {
      if (!l.gain && this.ctx) {
        this.loops.delete(name);
        this.loop(name, l.want, l.tc);
      } else this.startLoop(name);
    }
  }

  private startLoop(name: string): void {
    const l = this.loops.get(name);
    if (!l || l.src || !this.ctx || !l.gain) return;
    const row = this.get(name, 0);
    if (!row || !row[0]) return;
    const src = this.ctx.createBufferSource();
    src.buffer = row[0];
    src.loop = true;
    src.connect(l.gain);
    // Start each loop somewhere in itself, so two beds never line up the same way twice.
    src.start(this.ctx.currentTime, this.rand() * row[0].duration);
    l.src = src;
  }

  /** The listener at the camera (call each frame). */
  setListener(camera: THREE.Camera): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    const p = camera.position;
    this.fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
    this.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    if (l.positionX) {
      l.positionX.value = p.x; l.positionY.value = p.y; l.positionZ.value = p.z;
      l.forwardX.value = this.fwd.x; l.forwardY.value = this.fwd.y; l.forwardZ.value = this.fwd.z;
      l.upX.value = this.up.x; l.upY.value = this.up.y; l.upZ.value = this.up.z;
    } else {
      (l as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(p.x, p.y, p.z);
      (l as unknown as { setOrientation(a: number, b: number, c: number, d: number, e: number, f: number): void })
        .setOrientation(this.fwd.x, this.fwd.y, this.fwd.z, this.up.x, this.up.y, this.up.z);
    }
  }

  /** The tab is hidden (the game freezes the sim): stop the audio clock too, and pick up again on return. */
  pause(hidden: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (hidden && ctx.state === 'running') void ctx.suspend();
    else if (!hidden && ctx.state === 'suspended') void ctx.resume();
  }

  /** Families the engine has (for tests and the debug overlay). */
  has(family: string): boolean {
    return this.raw.has(family);
  }
}
