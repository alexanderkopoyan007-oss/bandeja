// M5 phase C: the cosmetics catalogue, the rules that unlock it, the store that keeps the progress (checked on
// load like the settings), and the per-player feats the rules read from a match.
import { describe, expect, it } from 'vitest';
import {
  blankProgress, checkedLoadout, COSMETICS, covered, defaultLoadout, describeRule, DRILL_NAMES, earned, LEVELS,
  recordDrill, recordMatch, ruleMet, ruleProgress, SLOT_INFO, SLOTS, type MatchRecord, type Rule,
} from '../../src/app/unlocks.ts';
import { memoryBackend, ownedFrom, progressFrom, Store, type Backend } from '../../src/app/store.ts';
import { MatchSim } from '../../src/sim/match.ts';
import { MatchStats } from '../../src/game/stats.ts';

const match = (o: Partial<MatchRecord> = {}): MatchRecord => ({
  level: 'club', won: false, cupRound: -1, aces: 0, porTres: 0, fastest: 0, longestRally: 0, ...o,
});
const STARTERS = COSMETICS.filter((c) => c.unlock === 'starter').map((c) => c.id);

describe('cosmetics catalogue', () => {
  it('every item is well formed: a known slot and kind, a unique id, a rule the engine reads', () => {
    const ids = new Set<string>();
    for (const c of COSMETICS) {
      expect(ids.has(c.id), c.id).toBe(false);
      ids.add(c.id);
      expect(SLOTS, c.id).toContain(c.slot);
      expect(['paint', 'garment', 'attachment', 'costume'], c.id).toContain(c.kind);
      for (const s of c.covers ?? []) expect(SLOTS, c.id).toContain(s);
      const r = c.unlock as Exclude<Rule, 'starter'>;
      if (c.unlock !== 'starter') {
        const keys = Object.keys(r);
        expect(keys.length, c.id).toBeGreaterThan(0);
        for (const [k, v] of Object.entries(r)) {
          if (k === 'level') expect(LEVELS, c.id).toContain(v);
          else if (k === 'drill') expect(DRILL_NAMES, c.id).toContain(v);
          else expect(Number.isInteger(v) && (v as number) >= 0, `${c.id} ${k}`).toBe(true);
        }
        // Not met by a new player: only starters are owned from the start.
        expect(ruleMet(c.unlock, blankProgress()), c.id).toBe(false);
      }
      expect(describeRule(c.unlock), c.id).toMatch(/^[A-Z].*\.$/);
    }
  });

  it('a new player owns the starters, at least one in every slot that must be filled', () => {
    expect(earned(blankProgress()).sort()).toEqual([...STARTERS].sort());
    for (const s of SLOTS) if (SLOT_INFO[s].required) expect(STARTERS.some((id) => COSMETICS.find((c) => c.id === id)!.slot === s), s).toBe(true);
    const l = defaultLoadout();
    for (const s of SLOTS) {
      if (SLOT_INFO[s].required) expect(STARTERS).toContain(l[s]);
      else expect(l[s]).toBeNull();
    }
  });

  it('every item can be earned: a player who has done everything owns the lot', () => {
    let p = blankProgress();
    for (let i = 0; i < 16; i++) p = recordMatch(p, match({ level: 'pro', won: true, cupRound: i % 3, aces: 5, porTres: 3, fastest: 135, longestRally: 31 }));
    for (const d of DRILL_NAMES) p = recordDrill(p, d, 25);
    expect(earned(p).length).toBe(COSMETICS.length);
  });

  it('the costumes cover what they replace, and a dress the bottom', () => {
    const l = { ...defaultLoadout(), costume: 'costume-astronaut' };
    expect([...covered(l)].sort()).toEqual(['bottom', 'eyes', 'head', 'pattern', 'top']);
    expect([...covered({ ...defaultLoadout(), top: 'top-dress' })]).toEqual(['bottom']);
    expect(covered(defaultLoadout()).size).toBe(0);
  });
});

describe('unlock rules', () => {
  it('a level rule counts that level and harder, never easier', () => {
    const rule: Rule = { won: 2, level: 'advanced' };
    let p = blankProgress();
    p = recordMatch(p, match({ level: 'club', won: true }));
    p = recordMatch(p, match({ level: 'novice', won: true }));
    expect(ruleProgress(rule, p)).toEqual([0, 2]);
    p = recordMatch(p, match({ level: 'advanced', won: true }));
    p = recordMatch(p, match({ level: 'pro', won: false }));
    expect(ruleMet(rule, p)).toBe(false);
    p = recordMatch(p, match({ level: 'pro', won: true }));
    expect(ruleMet(rule, p)).toBe(true);
    // Played counts the losses too; no level is any level.
    expect(ruleProgress({ played: 10 }, p)).toEqual([5, 10]);
  });

  it('the knock-out: a round won reaches the next, the final won is the cup', () => {
    let p = blankProgress();
    p = recordMatch(p, match({ level: 'club', won: false, cupRound: 0 }));
    expect(p.cupReached).toBe(0);
    p = recordMatch(p, match({ level: 'club', won: true, cupRound: 0 }));
    expect(p.cupReached).toBe(1);
    expect(ruleMet({ cupReached: 1 }, p)).toBe(true);
    expect(ruleMet({ cupReached: 2 }, p)).toBe(false);
    p = recordMatch(p, match({ level: 'pro', won: true, cupRound: 2 }));
    expect(p.cupReached).toBe(2);
    expect(p.cupWins).toBe(1);
    // A quick match isn't the cup.
    p = recordMatch(p, match({ level: 'pro', won: true }));
    expect(p.cupWins).toBe(1);
  });

  it('drills add up visit by visit; "every drill" waits for the weakest', () => {
    let p = blankProgress();
    p = recordDrill(p, 'Volleys', 12);
    p = recordDrill(p, 'Volleys', 9);
    expect(ruleMet({ drill: 'Volleys', points: 20 }, p)).toBe(true);
    expect(ruleProgress({ drills: 10 }, p)).toEqual([0, 10]);
    for (const d of DRILL_NAMES) p = recordDrill(p, d, 10);
    expect(ruleMet({ drills: 10 }, p)).toBe(true);
    // An unknown drill is ignored rather than stored.
    expect(recordDrill(p, 'Nonsense', 50).drills).toEqual(p.drills);
  });

  it('feats: aces and por tres add up, rally and speed keep the best; online counts apart from the levels', () => {
    let p = blankProgress();
    p = recordMatch(p, match({ aces: 3, porTres: 2, fastest: 121.4, longestRally: 18 }));
    p = recordMatch(p, match({ aces: 4, porTres: 1, fastest: 108, longestRally: 9 }));
    expect([p.aces, p.porTres, p.speed, p.rally]).toEqual([7, 3, 121, 18]);
    p = recordMatch(p, match({ level: null, won: true }));
    expect(p.online).toEqual({ played: 1, won: 1 });
    expect(ruleProgress({ played: 1 }, p)).toEqual([2, 1]);
  });

  it('recording never changes the progress it was given', () => {
    const p = blankProgress();
    const before = JSON.stringify(p);
    recordMatch(p, match({ won: true, aces: 2 }));
    recordDrill(p, 'Volleys', 3);
    expect(JSON.stringify(p)).toBe(before);
  });
});

describe('store', () => {
  it('a stored progress is checked field by field', () => {
    const p = progressFrom({
      played: { club: 4, pro: -2, legend: 9, novice: 'x' }, won: { club: 9, advanced: 1.7 }, online: { played: 2, won: 5 },
      cupReached: 7, cupWins: Infinity, drills: { Volleys: 12, Nonsense: 4, 'Back glass': -1 }, aces: 3, porTres: '5', rally: 1e9, speed: 900,
    });
    expect(p.played).toEqual({ novice: 0, club: 4, advanced: 0, pro: 0 });
    // Wins can't outnumber matches played.
    expect(p.won).toEqual({ novice: 0, club: 4, advanced: 0, pro: 0 });
    expect(p.online).toEqual({ played: 2, won: 2 });
    expect(p.cupReached).toBe(-1);
    expect(p.cupWins).toBe(0);
    expect(p.drills).toEqual({ Volleys: 12 });
    expect([p.aces, p.porTres, p.rally, p.speed]).toEqual([3, 0, 1000, 400]);
    for (const bad of [null, undefined, 'progress', 42, []]) expect(progressFrom(bad)).toEqual(blankProgress());
  });

  it('owned ids: only items that exist; a loadout: only owned items in their own slot', () => {
    expect([...ownedFrom(['head-cap', 'gold-crown', 7, 'grip-coral'])]).toEqual(['head-cap', 'grip-coral']);
    const owned = new Set([...STARTERS, 'head-cap']);
    const l = checkedLoadout({ top: 'top-tank', head: 'head-cap', eyes: 'eyes-wrap', grip: 'head-cap', bottom: null, costume: null }, owned);
    expect(l.top).toBe('top-tank');
    expect(l.head).toBe('head-cap');
    expect(l.eyes).toBeNull(); // not owned
    expect(l.grip).toBe(defaultLoadout().grip); // wrong slot
    expect(l.bottom).toBe(defaultLoadout().bottom); // a required slot can't be emptied
    expect(checkedLoadout('junk', owned)).toEqual(defaultLoadout());
  });

  it('records, saves and loads back; newly earned items are returned once', async () => {
    const be = memoryBackend();
    const s = await Store.open(be);
    expect([...s.owned].sort()).toEqual([...STARTERS].sort());
    expect(s.recordMatch(match({ level: 'club', won: true }))).toEqual([]);
    // Two played (the cap) and two won at Club or harder (the lime grip), in catalogue order; and only once.
    expect(s.recordMatch(match({ level: 'club', won: true })).map((c) => c.id)).toEqual(['head-cap', 'grip-lime']);
    // The third match played is the V-neck's; the cap and grip aren't given again.
    expect(s.recordMatch(match({ level: 'novice', won: false })).map((c) => c.id)).toEqual(['top-vneck']);
    expect(s.wear('head', 'head-cap')).toBe(true);
    expect(s.wear('eyes', 'eyes-wrap')).toBe(false);
    await s.flush();
    const t = await Store.load(be, true);
    expect(t.progress).toEqual(s.progress);
    expect([...t.owned].sort()).toEqual([...s.owned].sort());
    expect(t.loadout.head).toBe('head-cap');
  });

  it('an item stays owned when the progress behind it is lost', async () => {
    const be = memoryBackend();
    await be.put('owned.v1', ['costume-dino', 'nope']);
    await be.put('loadout.v1', { costume: 'costume-dino' });
    const s = await Store.load(be, true);
    expect(s.owned.has('costume-dino')).toBe(true);
    expect(s.owned.has('nope')).toBe(false);
    expect(s.loadout.costume).toBe('costume-dino');
  });

  it('a backend that throws: the store runs in memory and the game goes on', async () => {
    const broken: Backend = { get: () => Promise.reject(new Error('blocked')), put: () => Promise.reject(new Error('blocked')) };
    const s = await Store.load(broken, false);
    expect(s.persistent).toBe(false);
    expect(s.progress).toEqual(blankProgress());
    s.recordDrill('Volleys', 25);
    await s.flush();
    expect(s.owned.has('pat-fade')).toBe(true);
  });

  it('with no IndexedDB (Node), open() falls back to memory', async () => {
    const s = await Store.open();
    expect(s.persistent).toBe(false);
    expect(s.loadout).toEqual(defaultLoadout());
  });
});

describe('match stats: each player\'s own feats', () => {
  it('per-player aces, por tres and fastest add up to the team\'s', () => {
    for (const [seed, doubles] of [[3, true], [11, false]] as const) {
      const n = doubles ? 4 : 2;
      const m = new MatchSim({ seed, doubles, human: new Array(n).fill(false) });
      const st = new MatchStats();
      const none = new Array(n).fill(null);
      for (let k = 0; k < 60000; k++) {
        m.step(none);
        if (k % 8 === 0) st.update(m);
      }
      st.update(m);
      for (const t of [0, 1]) {
        const mine = st.player.filter((_, i) => i < n && m.players[i]!.team === t);
        expect(mine.reduce((a, f) => a + f.aces, 0), `aces ${seed} ${t}`).toBe(st.team[t]!.aces);
        expect(mine.reduce((a, f) => a + f.outOfCourt, 0), `por tres ${seed} ${t}`).toBe(st.team[t]!.outOfCourt);
        expect(Math.max(...mine.map((f) => f.fastest))).toBe(st.team[t]!.fastest);
      }
      expect(st.team[0].points + st.team[1].points).toBeGreaterThan(20);
    }
  });
});
