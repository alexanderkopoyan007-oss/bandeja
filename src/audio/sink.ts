// What the soundscape asks of the audio engine (Phase 6): kept apart from engine.ts so the soundscape and its tests
// don't pull in three or WebAudio.

export const BUS_BALL = 0, BUS_PLAYERS = 1, BUS_CROWD = 2, BUS_AMB = 3;

/** What the soundscape asks of the engine (tests record these instead of playing them). */
export interface AudioSink {
  /** Audio is running and can be heard. */
  readonly live: boolean;
  /**
   * A sound placed in the world (x, y, z), `delay` s from now, at `gain` (linear) and `rate` (pitch). `offset`:
   * start this far into the sound (it should have started that long ago).
   */
  play(family: string, bin: number, x: number, y: number, z: number, gain: number, rate: number, delay: number, bus: number, offset?: number): void;
  /** A sound all round (the crowd), stereo as rendered. */
  playFlat(family: string, bin: number, gain: number, delay: number, bus: number): void;
  /** A looping bed's level (linear; 0 silences it), approached with time constant `tc` s. */
  loop(name: string, gain: number, tc: number): void;
}
