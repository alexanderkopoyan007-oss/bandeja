// The audio engine (Phase 6): WebAudio playback of the bank from the broadcast camera's place. Every sound goes
// through one of a fixed pool of voices (gain, air lowpass, panner, reverb send) to a bus (ball and racket, players,
// crowd, ambience), then the arena's reverb, a master gain, a limiter and a soft clip. The listener follows the
// camera each frame. Browsers start audio only from a user gesture (`unlock`); until then, and until the bank's
// family has arrived from the worker, plays are dropped.
import * as THREE from 'three/webgpu';
import { AUDIO, arenaAudio, families, renderFamily, renderRoom, type BankEnv, type Sample } from './bank.ts';
import { resample } from './dsp.ts';
import { BUS_CROWD, BUS_AMB, type AudioSink } from './sink.ts';

export { BUS_BALL, BUS_PLAYERS, BUS_CROWD, BUS_AMB, type AudioSink } from './sink.ts';

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
  /** Rendered floats until the context exists to make AudioBuffers of them (then dropped). */
  private readonly raw = new Map<string, Sample[][]>();
  private readonly buffers = new Map<string, AudioBuffer[][]>();
  private room: Sample | null = null;
  private buses: GainNode[] = [];
  private wet: GainNode | null = null;
  private convolver: ConvolverNode | null = null;
  private voices: Voice[] = [];
  private nextVoice = 0;
  /** Per family, the variant last played per bin (numbers, no string keys per play). */
  private readonly lastVariant = new Map<string, Int32Array>();
  private readonly loops = new Map<string, { src: AudioBufferSourceNode | null; gain: GainNode; want: number; tc: number }>();
  private seed = 12345;
  private worker: Worker | null = null;
  /** Families still to come from the worker (for the debug overlay and tests). */
  pending = true;
  private readonly fwd = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  /** The listener's position, kept here: Firefox's AudioListener has no positionX (only setPosition). */
  private lx = 0;
  private ly = 0;
  private lz = 0;
  private readonly lastCam = new Float64Array(7).fill(NaN);
  /** The page wants sound (not hidden): resume whenever the context stops for any other reason. */
  private wantRunning = true;
  private master: GainNode | null = null;
  private closed = false;
  /** The player's volume and crowd level (0..1, applied on an audio taper: gain = level squared). */
  private volume = 1;
  private crowdLevel = 1;

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
    // No worker: render on the main thread, one family per task after the first frames, so no single frame
    // carries the whole bank (171-532 ms in node).
    const defs = families(this.env);
    let i = 0;
    const next = (): void => {
      if (i < defs.length) {
        const d = defs[i++]!;
        this.receive({ name: d.name, samples: renderFamily(d, this.env) });
        setTimeout(next, 30);
      } else {
        this.receive({ room: renderRoom(this.env.arena) });
        this.receive({ done: true });
      }
    };
    setTimeout(next, 1500);
  }

  private receive(m: { name?: string; samples?: Sample[][]; room?: Sample; done?: boolean }): void {
    if (this.closed) return;
    if (m.name && m.samples) {
      this.raw.set(m.name, m.samples);
      this.makeBuffers(m.name);
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
    if (!this.enabled || this.closed) return;
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC({ latencyHint: 'interactive' });
      this.ctx = ctx;
      // Master: gain, a safety limiter, a clip that only rounds off what gets past the limiter's attack. Both are
      // transparent below their thresholds: a DynamicsCompressor adds its own make-up gain, (1 / gain at full
      // scale)^0.6 (WebAudio spec), which the gain after it takes back out.
      const master = ctx.createGain();
      this.master = master;
      const lim = ctx.createDynamicsCompressor();
      const T = AUDIO.limiter.threshold, R = AUDIO.limiter.ratio;
      lim.threshold.value = T;
      lim.knee.value = 0;
      lim.ratio.value = R;
      lim.attack.value = 0.003;
      lim.release.value = 0.12;
      const fullScale = db(T + (0 - T) / R);
      const unmakeup = ctx.createGain();
      unmakeup.gain.value = 1 / Math.pow(1 / fullScale, 0.6);
      const clip = ctx.createWaveShaper();
      clip.curve = softClipCurve();
      clip.oversample = '2x';
      master.connect(lim).connect(unmakeup).connect(clip).connect(ctx.destination);
      for (let b = 0; b < 4; b++) {
        const g = ctx.createGain();
        g.connect(master);
        this.buses.push(g);
      }
      this.applyLevels();
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
        air.Q.value = -3.01; // dB for a WebAudio lowpass: Butterworth, no resonant bump
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
      for (const k of [...this.raw.keys()]) this.makeBuffers(k);
      this.startLoops();
      // Any stop the page didn't ask for (another tab took the device, Safari's 'interrupted'): start again.
      ctx.onstatechange = (): void => {
        if (this.wantRunning && ctx.state !== 'running' && ctx.state !== 'closed') void ctx.resume().catch(() => undefined);
      };
    }
    if (this.wantRunning && this.ctx.state !== 'running') void this.ctx.resume().catch(() => undefined);
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

  /**
   * A family's AudioBuffers, all made at once (at unlock, or on arrival after it), then the floats are dropped:
   * the bank is held once, and no buffer is made mid-rally.
   */
  private makeBuffers(family: string): void {
    const ctx = this.ctx;
    const raw = this.raw.get(family);
    if (!ctx || !raw) return;
    this.buffers.set(family, raw.map((row) => row.map((s) => {
      const b = ctx.createBuffer(s.ch.length, s.ch[0]!.length, s.sr);
      s.ch.forEach((c, i) => b.copyToChannel(c as Float32Array<ArrayBuffer>, i));
      return b;
    })));
    this.lastVariant.set(family, new Int32Array(raw.length).fill(-1));
    this.raw.delete(family);
  }

  private get(family: string, bin: number): AudioBuffer[] | null {
    return this.buffers.get(family)?.[bin] ?? null;
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  /** A variant, never the one just played for this family and bin (no machine-gun repeats). */
  private pick(family: string, bin: number, n: number): number {
    const lv = this.lastVariant.get(family);
    const last = lv ? lv[bin]! : -1;
    let v = Math.floor(this.rand() * n);
    if (n > 1 && v === last) v = (v + 1 + Math.floor(this.rand() * (n - 1))) % n;
    if (lv) lv[bin] = v;
    return v;
  }

  /** A free voice (its sound has ended now, not merely by the new one's start), else the one that ends soonest. */
  private voice(now: number): Voice {
    for (let i = 0; i < POOL; i++) {
      const v = this.voices[(this.nextVoice + i) % POOL]!;
      if (v.until <= now) { this.nextVoice = (this.nextVoice + i + 1) % POOL; return v; }
    }
    let best = this.voices[0]!;
    for (const v of this.voices) if (v.until < best.until) best = v;
    return best;
  }

  play(family: string, bin: number, x: number, y: number, z: number, gain: number, rate: number, delay: number, bus: number, offset = 0): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const row = this.get(family, bin);
    if (!row || row.length === 0) return;
    const buf = row[this.pick(family, bin, row.length)]!;
    if (offset >= buf.duration) return;
    const t = ctx.currentTime + Math.max(0, delay);
    const v = this.voice(ctx.currentTime);
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
    const dx = x - this.lx, dy = y - this.ly, dz = z - this.lz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    v.air.frequency.setValueAtTime(Math.min(20000, AUDIO.distance.airHz / (1 + d / AUDIO.distance.airM)), t);
    v.send.gain.setValueAtTime(0.5 + d / 40, t);
    src.start(t, Math.max(0, offset));
    v.src = src;
    v.until = t + (buf.duration - Math.max(0, offset)) / src.playbackRate.value;
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
    } else if (l.want === gain && l.tc === tc) return;
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

  /** The listener at the camera (call each frame; only a moved camera touches the AudioParams). */
  setListener(camera: THREE.Camera): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    const p = camera.position;
    const q = camera.quaternion;
    const c = this.lastCam;
    if (c[0] === p.x && c[1] === p.y && c[2] === p.z && c[3] === q.x && c[4] === q.y && c[5] === q.z && c[6] === q.w) return;
    c[0] = p.x; c[1] = p.y; c[2] = p.z; c[3] = q.x; c[4] = q.y; c[5] = q.z; c[6] = q.w;
    this.lx = p.x; this.ly = p.y; this.lz = p.z;
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

  /** The settings' volume and crowd level (0..1). */
  setLevels(volume: number, crowd: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    this.crowdLevel = Math.max(0, Math.min(1, crowd));
    this.applyLevels();
  }

  private applyLevels(): void {
    if (!this.master || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(db(AUDIO.master) * this.volume * this.volume, t, 0.02);
    this.buses[BUS_CROWD]?.gain.setTargetAtTime(this.crowdLevel * this.crowdLevel, t, 0.02);
  }

  /**
   * Menu sounds: a soft wooden tick for a move, a brighter one for a choice, a lower one for back. Two damped modes
   * of a struck bar (no samples), well under the game's levels.
   */
  uiBlip(kind: 'move' | 'ok' | 'back'): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.master) return;
    const f = kind === 'ok' ? 1320 : kind === 'back' ? 660 : 980;
    const t = ctx.currentTime;
    for (const [mul, amp, decay] of [[1, 0.05, 0.04], [2.76, 0.02, 0.018]] as const) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f * mul;
      g.gain.setValueAtTime(amp, t);
      g.gain.setTargetAtTime(0, t + 0.002, decay / 3);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + decay * 3 + 0.02);
    }
  }

  /** The game is torn down: stop rendering the bank and close the context (browsers cap how many can be open). */
  close(): void {
    this.closed = true;
    this.worker?.terminate();
    this.worker = null;
    this.wantRunning = false;
    const ctx = this.ctx;
    this.ctx = null;
    this.raw.clear();
    this.buffers.clear();
    this.voices = [];
    this.buses = [];
    this.master = null;
    if (ctx) void ctx.close().catch(() => undefined);
  }

  /** The tab is hidden (the game freezes the sim): stop the audio clock too, and pick up again on return. */
  pause(hidden: boolean): void {
    this.wantRunning = !hidden;
    const ctx = this.ctx;
    if (!ctx) return;
    // (always ask: a quick hide and show can find the state still 'running' while the suspend is pending)
    if (hidden) void ctx.suspend().catch(() => undefined);
    else void ctx.resume().catch(() => undefined);
  }

  /** Families the engine has (for tests and the debug overlay). */
  has(family: string): boolean {
    return this.raw.has(family) || this.buffers.has(family);
  }
}

/** Unity below 0.8, then a smooth knee to the rails: what gets past the limiter's attack is rounded, nothing else. */
export function softClipCurve(n = 2049): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(n);
  const k = 0.8, w = 1 - k;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    curve[i] = Math.sign(x) * (a <= k ? a : k + w * Math.tanh((a - k) / w));
  }
  return curve;
}
