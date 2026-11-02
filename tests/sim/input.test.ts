// Input edge cases at the sim's boundary: what a release reads from the keys around it.
import { describe, it, expect } from 'vitest';
import { MatchSim, PH_RALLY, PH_SETUP, PH_TOSS, PH_OVER, E_HIT, E_FAULT } from '../../src/sim/match.ts';
import { InputFrame, BTN_DRIVE, BTN_OVERHEAD, BTN_POWER, BTN_PRECISION, BTN_SLICE } from '../../src/sim/input.ts';
import { DT } from '../../src/sim/core/constants.ts';
import { SW_IDLE, SW_CHARGE, SW_RECOVER } from '../../src/sim/player/player.ts';
import { SHOT_BANDEJA, SHOT_CHIQUITA, SHOT_DRIVE, SHOT_SMASH, SHOT_SLICE, SHOT_TOPSPIN, SHOT_VOLLEY, MOD_NONE, MOD_PRECISION } from '../../src/sim/contact/shots.ts';

describe('modifiers at the release', () => {
  it('Space let go a few ms after the overhead key, in the same tick, still makes the smash', () => {
    // The fresh-eyes review: the release read the modifiers from the tick's end, so Space let go up to ~10 ms
    // after O turned every smash into a bandeja (and Shift's víbora and chiquita the same way).
    let smash = 0, other = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const m = new MatchSim({ seed, human: [true, false], firstServer: 1, assist: 0.45, timingScale: 1.5 });
      const f = new InputFrame();
      const p = m.players[0]!;
      let key = 0;
      let seen = 0;
      for (let i = 0; i < 120 * 150 && m.phase !== PH_OVER; i++) {
        f.clear();
        let pressed = false;
        if (!key && p.swing === SW_IDLE) {
          pressed = true;
          if (m.phase === PH_SETUP && m.score.serverTeam() === 0 && m.time > m.phaseUntil + 0.2) { key = BTN_DRIVE; f.push(true, key, m.time); }
          else if (m.phase === PH_RALLY && m.rally.hitter === 1) { key = BTN_OVERHEAD; f.push(true, key, m.time); f.push(true, BTN_POWER, m.time); }
          else pressed = false;
        }
        let held = key === BTN_OVERHEAD ? BTN_OVERHEAD | BTN_POWER : key;
        if (key && p.swing === SW_CHARGE) {
          const ideal = m.focusIdeal(0);
          const close = m.phase === PH_TOSS || (m.stand[0]!.valid && m.focusInReach);
          if (close && ideal >= m.time && ideal < m.time + DT) {
            // Both let go inside this tick, Space 4 ms after the shot key: the tick ends with neither held.
            const r = Math.max(m.time, ideal - 0.005);
            f.push(false, key, r);
            if (key === BTN_OVERHEAD) f.push(false, BTN_POWER, Math.min(r + 0.004, m.time + DT - 1e-4));
            held = 0;
            key = 0;
          }
        } else if (key && !pressed && p.swing !== SW_CHARGE) {
          f.push(false, key, m.time);
          if (key === BTN_OVERHEAD) f.push(false, BTN_POWER, m.time);
          held = 0;
          key = 0;
        }
        f.held = held;
        m.step([f, null]);
        for (; seen < m.eventSeq; seen++) {
          const e = m.events[seen % m.events.length]!;
          if (e.kind !== E_HIT || e.player !== 0 || e.y < 1.55) continue;
          if (e.a === SHOT_SMASH) smash++; else other++;
        }
      }
    }
    expect(smash + other).toBeGreaterThan(8);
    expect(smash / (smash + other)).toBeGreaterThan(0.9);
  });
});

describe('the first press of a match', () => {
  it('a tap that lets go before the ball is down is no swing: it goes on down for the next press, no fault', () => {
    // (it was a fault, and two of them a double fault, seven seconds into the game: review round 16, the critic's #1)
    const m = new MatchSim({ seed: 7, doubles: true, human: [true, false, false, false], firstServer: 0, assist: 0.45, timingScale: 1.5 });
    const f = new InputFrame();
    const none = [null, null, null, null];
    for (let i = 0; i < 120 * 12 && (m.phase !== PH_SETUP || m.walking !== 0 || m.time < m.phaseUntil + 0.1); i++) m.step(none);
    expect(m.phase).toBe(PH_SETUP);
    const first = m.serveNo;
    let seq = m.eventSeq, faults = 0;
    for (let tap = 0; tap < 3; tap++) {
      f.clear();
      f.push(true, BTN_DRIVE, m.time);
      f.held = BTN_DRIVE;
      m.step([f, null, null, null]);
      expect(m.phase).toBe(PH_TOSS);
      for (let i = 0; i < 6; i++) { f.clear(); f.held = BTN_DRIVE; m.step([f, null, null, null]); }
      const y = m.ball.pos.y;
      f.clear();
      f.push(false, BTN_DRIVE, m.time);
      m.step([f, null, null, null]);
      for (; seq < m.eventSeq; seq++) if (m.events[seq % m.events.length]!.kind === E_FAULT) faults++;
      // (no ball put back in the hand: a metre up in a tick, and it hung there)
      expect(m.phase).toBe(PH_TOSS);
      expect(m.ball.pos.y).toBeLessThan(y);
      expect(m.players[0]!.swing).toBe(SW_IDLE);
    }
    expect(faults).toBe(0);
    expect(m.serveNo).toBe(first);
  });
});

describe('the keys in the air', () => {
  const m = new MatchSim({ seed: 1, human: [false, false] }) as unknown as { shotHeight: number; shotMod: number; shotContra: boolean; shotFor(p: unknown, air: boolean): number };
  const p = { tune: { overheadHeight: 2.2 }, shot: SHOT_TOPSPIN };
  it('every ground stroke key plays a ball in the air as a volley, the topspin key too', () => {
    // (alone in swinging at it, the topspin key lost 37 sets of 40 where the drive key went 21-19, and nothing said why)
    m.shotHeight = 1.1; m.shotMod = MOD_NONE; m.shotContra = false;
    for (const k of [SHOT_DRIVE, SHOT_SLICE, SHOT_TOPSPIN]) expect(m.shotFor({ ...p, shot: k }, true)).toBe(SHOT_VOLLEY);
    expect(m.shotFor(p, false)).toBe(SHOT_TOPSPIN);
  });
  it('the chiquita stays where precision asks for it', () => {
    m.shotMod = MOD_PRECISION;
    expect(m.shotFor(p, true)).toBe(SHOT_CHIQUITA);
    m.shotMod = MOD_NONE;
  });
});

describe('a second shot key on a held swing', () => {
  // The game's hint says to press O on a lob, and that press was dropped: the old key's release whiffed the ball.
  function intoRally(): { m: MatchSim; f: InputFrame } {
    const m = new MatchSim({ seed: 11, human: [true, false], firstServer: 1, assist: 0.45, timingScale: 1.5 });
    const f = new InputFrame();
    for (let i = 0; i < 120 * 30 && m.phase !== PH_RALLY; i++) { f.clear(); m.step([f, null]); }
    expect(m.phase).toBe(PH_RALLY);
    return { m, f };
  }
  function tick(m: MatchSim, f: InputFrame, press: boolean, key: number, held: number): void {
    f.clear();
    f.push(press, key, m.time);
    f.held = held;
    m.step([f, null]);
  }

  it('takes over, and only its own release counts', () => {
    const { m, f } = intoRally();
    const p = m.players[0]!;
    tick(m, f, true, BTN_DRIVE, BTN_DRIVE);
    expect(p.swing).toBe(SW_CHARGE);
    tick(m, f, true, BTN_OVERHEAD, BTN_DRIVE | BTN_OVERHEAD);
    expect(p.shot).toBe(SHOT_BANDEJA);
    expect(p.swing).toBe(SW_CHARGE);
    tick(m, f, false, BTN_DRIVE, BTN_OVERHEAD);
    expect(p.swing).toBe(SW_CHARGE);
    tick(m, f, false, BTN_OVERHEAD, 0);
    expect(p.swing).not.toBe(SW_CHARGE);
  });

  it('the same key again changes nothing', () => {
    const { m, f } = intoRally();
    const p = m.players[0]!;
    tick(m, f, true, BTN_DRIVE, BTN_DRIVE);
    const start = p.chargeStart;
    tick(m, f, true, BTN_DRIVE, BTN_DRIVE);
    expect(p.swing).toBe(SW_CHARGE);
    expect(p.chargeStart).toBe(start);
    expect(p.shot).toBe(SHOT_DRIVE);
  });

  it('a neighbouring key brushed in a hold does not fire it: the swing goes when the last key comes up', () => {
    const { m, f } = intoRally();
    const p = m.players[0]!;
    tick(m, f, true, BTN_DRIVE, BTN_DRIVE);
    tick(m, f, true, BTN_SLICE, BTN_DRIVE | BTN_SLICE);
    tick(m, f, false, BTN_SLICE, BTN_DRIVE);
    expect(p.swing).toBe(SW_CHARGE);
    expect(p.shot).toBe(SHOT_DRIVE);
    tick(m, f, false, BTN_DRIVE, 0);
    expect(p.swing).not.toBe(SW_CHARGE);
  });
});

describe('a movement key and the aim', () => {
  // A key left down from the run in went on as aim: at 11 m/s a held swing took the target to the stop, and every sixth drive with it.
  function holding(moveAtPress: number): { m: MatchSim; f: InputFrame; x0: number } {
    const m = new MatchSim({ seed: 12, human: [true, false], firstServer: 1, assist: 0.45, timingScale: 1.5 });
    const f = new InputFrame();
    const p = m.players[0]!;
    for (let i = 0; i < 120 * 40; i++) {
      f.clear();
      f.moveX = moveAtPress;
      if (m.phase === PH_RALLY && m.rally.hitter === 1 && m.stand[0]!.valid && p.swing === SW_IDLE) {
        f.push(true, BTN_DRIVE, m.time);
        f.held = BTN_DRIVE;
        m.step([f, null]);
        f.clear();
        f.held = BTN_DRIVE;
        f.moveX = moveAtPress;
        m.step([f, null]);
        if ((p.swing as number) === SW_CHARGE && p.aiming) return { m, f, x0: p.aimX };
        continue;
      }
      m.step([f, null]);
    }
    throw new Error('no ball to hold for');
  }
  const run = (m: MatchSim, f: InputFrame, moveX: number, ticks: number): void => {
    for (let i = 0; i < ticks; i++) { f.clear(); f.held = BTN_DRIVE; f.moveX = moveX; m.step([f, null]); }
  };

  it('stays the run\'s while it stays down', () => {
    const { m, f, x0 } = holding(1);
    run(m, f, 1, 30);
    expect(m.players[0]!.aimX).toBeCloseTo(x0, 5);
  });
  it('aims when it went down with the shot key, whichever landed first', () => {
    const m = new MatchSim({ seed: 12, human: [true, false], firstServer: 1, assist: 0.45, timingScale: 1.5 });
    const f = new InputFrame();
    const p = m.players[0]!;
    for (let i = 0; i < 120 * 40 && (p.swing as number) !== SW_CHARGE; i++) {
      f.clear();
      if (m.phase === PH_RALLY && m.rally.hitter === 1 && m.stand[0]!.valid && p.swing === SW_IDLE) {
        // The direction one tick (8 ms) before the shot key.
        f.moveX = 1;
        m.step([f, null]);
        f.clear();
        f.moveX = 1;
        f.push(true, BTN_DRIVE, m.time);
        f.held = BTN_DRIVE;
      }
      m.step([f, null]);
    }
    if (!p.aiming) { f.clear(); f.held = BTN_DRIVE; f.moveX = 1; m.step([f, null]); }
    expect(p.aiming).toBe(true);
    const x0 = p.aimX;
    run(m, f, 1, 12);
    expect(Math.abs(p.aimX - x0)).toBeGreaterThan(0.5);
  });
  it('a stick wobbling round where it was at the press is not a steer', () => {
    const { m, f, x0 } = holding(0.8);
    for (let i = 0; i < 40; i++) run(m, f, 0.8 + (i % 2 ? 0.15 : -0.15), 1);
    expect(m.players[0]!.aimX).toBeCloseTo(x0, 5);
  });
  it('aims once it has been let go and pressed again', () => {
    const { m, f, x0 } = holding(1);
    run(m, f, 0, 2);
    run(m, f, 1, 12);
    expect(Math.abs(m.players[0]!.aimX - x0)).toBeGreaterThan(0.5);
  });
  it('aims when it goes down after the shot key', () => {
    const { m, f, x0 } = holding(0);
    run(m, f, 1, 12);
    expect(Math.abs(m.players[0]!.aimX - x0)).toBeGreaterThan(0.5);
  });
  /** Holding for a ball well to one side of the player: the key that way, whichever side of the court they are on. */
  function holdingWide(): { m: MatchSim; f: InputFrame; x0: number; toward: number } {
    for (let seed = 12; seed < 60; seed++) {
      const m = new MatchSim({ seed, human: [true, false], firstServer: 1, assist: 0.45, timingScale: 1.5 });
      const f = new InputFrame(), p = m.players[0]!, st = m.stand[0]!;
      for (let i = 0; i < 120 * 40; i++) {
        f.clear();
        if (m.phase === PH_RALLY && m.rally.hitter === 1 && st.valid && p.swing === SW_IDLE && Math.abs(st.x - p.pos.x) > 0.9 && st.t - m.time > 0.9) {
          f.push(true, BTN_DRIVE, m.time);
          f.held = BTN_DRIVE;
          m.step([f, null]);
          f.clear();
          f.held = BTN_DRIVE;
          m.step([f, null]);
          if ((p.swing as number) === SW_CHARGE && p.aiming) return { m, f, x0: p.aimX, toward: Math.sign((st.x - p.pos.x) * (p.pos.z > 0 ? 1 : -1)) };
          break;
        }
        m.step([f, null]);
      }
    }
    throw new Error('no wide ball to hold for');
  }
  it('a key pointing where the player still has to go is the run\'s, even after the shot key', () => {
    const { m, f, x0, toward } = holdingWide();
    run(m, f, toward, 12);
    expect(m.players[0]!.aimX).toBeCloseTo(x0, 5);
  });
  it('the other way it aims', () => {
    const { m, f, x0, toward } = holdingWide();
    run(m, f, -toward, 12);
    expect(Math.abs(m.players[0]!.aimX - x0)).toBeGreaterThan(0.5);
  });
  it('the keys stop in from the glass, Precision goes on to the lines', () => {
    const { m, f, toward } = holdingWide();
    const p = m.players[0]!, edge = m.world.court.halfW;
    run(m, f, -toward, 50);
    expect(edge - Math.abs(p.aimX)).toBeCloseTo(1.2, 5);
    for (let i = 0; i < 20; i++) { f.clear(); f.held = BTN_DRIVE | BTN_PRECISION; f.moveX = -toward; m.step([f, null]); }
    expect(edge - Math.abs(p.aimX)).toBeLessThan(0.5);
  });
});

describe('a shot key pressed too soon', () => {
  it('starts its hold when the recovery ends', () => {
    const m = new MatchSim({ seed: 12, human: [true, false], firstServer: 1, assist: 0.45, timingScale: 1.5 });
    const f = new InputFrame(), p = m.players[0]!;
    for (let i = 0; i < 120 * 30 && m.phase !== PH_RALLY; i++) { f.clear(); m.step([f, null]); }
    expect(m.phase).toBe(PH_RALLY);
    p.swing = SW_RECOVER;
    p.recoverUntil = m.time + 0.1;
    f.clear();
    f.push(true, BTN_DRIVE, m.time);
    f.held = BTN_DRIVE;
    m.step([f, null]);
    expect(p.heldShot).toBe(SHOT_DRIVE);
    for (let k = 0; k < 30 && (p.swing as number) !== SW_CHARGE; k++) { f.clear(); f.held = BTN_DRIVE; m.step([f, null]); }
    expect(p.swing).toBe(SW_CHARGE);
    expect(p.heldShot).toBe(-1);
  });
  it('is forgotten when it comes up before then', () => {
    const m = new MatchSim({ seed: 12, human: [true, false], firstServer: 1, assist: 0.45, timingScale: 1.5 });
    const f = new InputFrame(), p = m.players[0]!;
    p.swing = SW_RECOVER;
    p.recoverUntil = m.time + 0.3;
    f.push(true, BTN_DRIVE, m.time);
    f.held = BTN_DRIVE;
    m.step([f, null]);
    expect(p.heldShot).toBe(SHOT_DRIVE);
    f.clear();
    f.push(false, BTN_DRIVE, m.time);
    m.step([f, null]);
    expect(p.heldShot).toBe(-1);
  });
});
