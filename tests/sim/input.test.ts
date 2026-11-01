// Input edge cases at the sim's boundary: what a release reads from the keys around it.
import { describe, it, expect } from 'vitest';
import { MatchSim, PH_RALLY, PH_SETUP, PH_TOSS, PH_OVER, E_HIT, E_FAULT } from '../../src/sim/match.ts';
import { InputFrame, BTN_DRIVE, BTN_OVERHEAD, BTN_POWER } from '../../src/sim/input.ts';
import { DT } from '../../src/sim/core/constants.ts';
import { SW_IDLE, SW_CHARGE } from '../../src/sim/player/player.ts';
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
});
