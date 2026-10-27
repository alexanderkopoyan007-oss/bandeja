// Playing as the human with the assists: balls off the glass, a cue that holds still, and aiming that lands.
import { describe, it, expect } from 'vitest';
import { MatchSim, PH_RALLY, PH_SETUP, PH_OVER, E_HIT, E_POINT, E_WALL, E_FLOOR } from '../../src/sim/match.ts';
import { InputFrame, BTN_DRIVE, BTN_PRECISION, BTN_OVERHEAD, BTN_POWER } from '../../src/sim/input.ts';
import { SHOT_SMASH, SHOT_BANDEJA } from '../../src/sim/contact/shots.ts';
import { DT } from '../../src/sim/core/constants.ts';
import { SW_IDLE, SW_CHARGE } from '../../src/sim/player/player.ts';

/**
 * A human-like bot: holds drive as soon as the opponent strikes (auto timing releases it), gets back to the
 * middle of the back court after its own shot, and steers the aim with `aimKeys` (player-relative x, y).
 */
function play(seed: number, seconds: number, aimKeys: [number, number], onTick?: (m: MatchSim) => void) {
  const m = new MatchSim({ seed, human: [true, false], firstServer: 1, autoTiming: true, assist: 0.45, timingScale: 1.5 });
  const f = new InputFrame();
  let holding = false;
  for (let i = 0; i < seconds * 120 && m.phase !== PH_OVER; i++) {
    f.clear();
    const p = m.players[0]!;
    if (holding && p.swing !== SW_CHARGE) { f.push(false, BTN_DRIVE, m.time); holding = false; }
    const serve = m.phase === PH_SETUP && m.score.serverTeam() === 0 && m.time > m.phaseUntil + 0.2;
    if (!holding && p.swing === SW_IDLE && (serve || (m.phase === PH_RALLY && m.rally.hitter === 1))) {
      f.push(true, BTN_DRIVE, m.time);
      holding = true;
    }
    if (p.aiming) { f.moveX = aimKeys[0]; f.moveY = aimKeys[1]; }
    else if (m.phase === PH_RALLY && m.rally.hitter === 0) {
      const s = m.side(0);
      const dx = -p.pos.x;
      const dz = s * 7.6 - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.3) { f.moveX = (dx / d) * s; f.moveY = (-dz / d) * s; }
    }
    f.held = holding ? BTN_DRIVE : 0;
    m.step([f, null]);
    onTick?.(m);
  }
  return m;
}

describe('balls off the glass', () => {
  it('a human-like player returns nearly every ball that comes off the back or side glass', () => {
    let wallBalls = 0;
    let returned = 0;
    for (let seed = 1; seed <= 3; seed++) {
      let seen = 0;
      let cur = false;
      play(seed, 150, [0, 0], (m) => {
        for (; seen < m.eventSeq; seen++) {
          const e = m.events[seen % m.events.length]!;
          if (e.kind === E_HIT && e.team === 1) {
            const pr = m.pred;
            const s = m.side(0);
            cur = false;
            for (let i = 0; i < pr.n; i++) {
              if (pr.bounces[i]! > 1) break;
              if (pr.bounces[i]! === 1 && pr.walls[i]! > 0 && pr.z[i]! * s > 0) { cur = true; break; }
            }
            if (cur) wallBalls++;
          } else if (e.kind === E_HIT && e.team === 0 && cur) { returned++; cur = false; }
          else if (e.kind === E_POINT) cur = false;
        }
      });
    }
    expect(wallBalls).toBeGreaterThan(100);
    expect(returned / wallBalls).toBeGreaterThan(0.9);
  });
});

describe('the timing cue holds still', () => {
  it('while the player waits for a ball, the ideal moment does not slide with the clock', () => {
    // Re-reading the ball after a bounce (the turf kicks it a little) may move the moment; the clock alone must not.
    let checked = 0;
    let last = -1;
    let lastTime = 0;
    let lastVersion = -1;
    let maxSlide = 0;
    play(4, 60, [0, 0], (m) => {
      const p = m.players[0]!;
      const st = m.stand[0]!;
      const waiting = m.phase === PH_RALLY && p.swing === SW_CHARGE && st.valid && m.focusInReach
        && Math.hypot(p.vel.x, p.vel.z) < 0.05 && st.t - m.time < 0.3 && st.t > m.time;
      const ideal = waiting ? m.focusIdeal(0) : -1;
      if (waiting && last >= 0 && m.time - lastTime < 1.5 * DT && m.pred.version === lastVersion) {
        maxSlide = Math.max(maxSlide, Math.abs(ideal - last));
        checked++;
      }
      last = ideal;
      lastTime = m.time;
      lastVersion = m.pred.version;
    });
    expect(checked).toBeGreaterThan(50);
    expect(maxSlide).toBeLessThan(0.02);
  });
});

describe('aiming', () => {
  it('holding left/right while charging moves the target, and the ball lands on that side', () => {
    for (const dir of [-1, 1]) {
      const xs: number[] = [];
      let seen = 0;
      let mine = false;
      play(5, 200, [dir, 0], (m) => {
        for (; seen < m.eventSeq; seen++) {
          const e = m.events[seen % m.events.length]!;
          if (e.kind === E_HIT) mine = e.team === 0;
          else if (e.kind === E_FLOOR && mine) {
            xs.push(e.x * m.side(0)); // player-relative: + is to the human's right
            mine = false;
          } else if (e.kind === E_WALL) mine = false;
        }
      });
      expect(xs.length).toBeGreaterThan(20);
      const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
      expect(mean * dir).toBeGreaterThan(1.8);
    }
  });

  it('a serve aimed with the keys lands near the target', () => {
    let errs = 0;
    let n = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const m = new MatchSim({ seed, human: [true, false], firstServer: 0, timingScale: 1.5 });
      const f = new InputFrame();
      // Steer the target right for 0.3 s during the pre-serve pause, then toss and hit on the ideal moment.
      while (m.time < m.phaseUntil + 0.3) { f.clear(); f.moveX = m.time > m.phaseUntil ? 1 : 0; m.step([f, null]); }
      const p = m.players[0]!;
      const tx = p.aimX;
      const tz = p.aimZ;
      f.clear();
      f.push(true, BTN_DRIVE, m.time);
      f.held = BTN_DRIVE | BTN_PRECISION;
      m.step([f, null]);
      while (m.time + DT <= m.tossIdeal) { f.clear(); f.held = BTN_DRIVE | BTN_PRECISION; m.step([f, null]); }
      f.clear();
      f.held = BTN_PRECISION;
      f.push(false, BTN_DRIVE, m.tossIdeal);
      m.step([f, null]);
      let seen = m.eventSeq;
      for (let i = 0; i < 400; i++) {
        f.clear();
        m.step([f, null]);
        let landed = false;
        for (; seen < m.eventSeq; seen++) {
          const e = m.events[seen % m.events.length]!;
          if (e.kind === E_FLOOR) {
            errs += Math.hypot(e.x - tx, e.z - tz);
            n++;
            landed = true;
          }
        }
        if (landed) break;
      }
    }
    expect(n).toBeGreaterThan(10);
    expect(errs / n).toBeLessThan(0.8);
  });
});

describe('overheads', () => {
  /** Goes to the net after each shot (that draws lobs) and holds the overhead key when a lob comes. */
  function lobs(power: boolean) {
    const res = { lobs: 0, overheads: 0, high: 0, smashes: 0 };
    for (let seed = 1; seed <= 3; seed++) {
      const m = new MatchSim({ seed, human: [true, false], firstServer: 1, autoTiming: true, assist: 0.45, timingScale: 1.5 });
      const f = new InputFrame();
      let seen = 0;
      let held = 0;
      let lob = -1; // -1 no ball coming, 0 groundstroke, 1 lob
      for (let i = 0; i < 150 * 120 && m.phase !== PH_OVER; i++) {
        f.clear();
        const p = m.players[0]!;
        const s = m.side(0);
        if (held && p.swing !== SW_CHARGE) { f.push(false, held, m.time); held = 0; }
        const serve = m.phase === PH_SETUP && m.score.serverTeam() === 0 && m.time > m.phaseUntil + 0.2;
        if (!held && p.swing === SW_IDLE && (serve || (m.phase === PH_RALLY && m.rally.hitter === 1 && lob >= 0))) {
          held = lob === 1 && !serve ? BTN_OVERHEAD : BTN_DRIVE;
          f.push(true, held, m.time);
        }
        if (!p.aiming && m.phase === PH_RALLY && m.rally.hitter === 0) {
          const dx = -p.pos.x;
          const dz = s * 3.2 - p.pos.z;
          const d = Math.hypot(dx, dz);
          if (d > 0.3) { f.moveX = (dx / d) * s; f.moveY = (-dz / d) * s; }
        }
        f.held = held | (power ? BTN_POWER : 0);
        m.step([f, null]);
        for (; seen < m.eventSeq; seen++) {
          const e = m.events[seen % m.events.length]!;
          if (e.kind === E_HIT && e.team === 1) {
            let top = 0;
            const pr = m.pred;
            for (let k = 0; k < pr.n && pr.bounces[k]! === 0; k++) if (pr.z[k]! * s > 1.5) top = Math.max(top, pr.y[k]!);
            lob = top > 2.3 ? 1 : 0;
            if (lob) res.lobs++;
          } else if (e.kind === E_HIT && e.team === 0) {
            if (lob === 1 && (e.a === SHOT_SMASH || e.a === SHOT_BANDEJA)) {
              res.overheads++;
              if (e.y >= 2.0) res.high++;
              if (e.a === SHOT_SMASH) res.smashes++;
            }
            lob = -1;
          } else if (e.kind === E_POINT) lob = -1;
        }
      }
    }
    return res;
  }

  it('holding O for a lob takes it in the air, high, as a bandeja', () => {
    const r = lobs(false);
    expect(r.lobs).toBeGreaterThan(20);
    expect(r.overheads / r.lobs).toBeGreaterThan(0.85);
    expect(r.high / r.overheads).toBeGreaterThan(0.85);
    expect(r.smashes).toBe(0);
  });

  it('with power held the overhead is a smash', () => {
    const r = lobs(true);
    expect(r.lobs).toBeGreaterThan(20);
    expect(r.smashes / r.lobs).toBeGreaterThan(0.85);
  });
});
