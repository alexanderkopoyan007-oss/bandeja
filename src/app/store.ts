// The player's saved things (M5 phases C and D): progress, the cosmetics owned, what is worn and the player's own
// characters (character.ts), in IndexedDB as the brief asks. Like settings.ts, nothing stored is trusted: every value is checked on load,
// and anything unknown, out of range or of the wrong kind falls back to its default, so an old, hand-edited or
// half-written store can't break the game. Where IndexedDB is missing or refuses (private windows, blocked site
// data, a stuck open), the store runs in memory for the visit and says so (`persistent`).
import {
  blankProgress, checkedLoadout, COSMETIC_BY_ID, defaultLoadout, DRILL_NAMES, earned, LEVELS, newlyEarned, recordDrill, recordMatch,
  type Cosmetic, type Loadout, type MatchRecord, type Progress, type Slot,
} from './unlocks.ts';
import { checkedCharacter, type Character } from './character.ts';

/** Where values are kept: IndexedDB in the browser, a Map in tests or when IndexedDB is refused. */
export interface Backend {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
}

export function memoryBackend(): Backend {
  const m = new Map<string, unknown>();
  return {
    get: async (k) => structuredClone(m.get(k)),
    put: async (k, v) => { m.set(k, structuredClone(v)); },
  };
}

const DB = 'bandeja';
const STORE = 'kv';

/** IndexedDB's one object store of keyed values; rejects if it can't be opened within `timeoutMs` (a blocked
 * upgrade or a browser that never answers). */
export function idbBackend(timeoutMs = 3000): Promise<Backend> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no IndexedDB')); return; }
    const timer = setTimeout(() => reject(new Error('IndexedDB did not open')), timeoutMs);
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB, 1);
    } catch (err) {
      clearTimeout(timer);
      reject(err);
      return;
    }
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onerror = () => { clearTimeout(timer); reject(req.error ?? new Error('IndexedDB refused')); };
    req.onsuccess = () => {
      clearTimeout(timer);
      const db = req.result;
      const run = <T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => new Promise((res, rej) => {
        const tx = db.transaction(STORE, mode);
        const r = f(tx.objectStore(STORE));
        tx.oncomplete = () => res(r.result);
        tx.onerror = () => rej(tx.error ?? r.error);
        tx.onabort = () => rej(tx.error ?? new Error('aborted'));
      });
      resolve({
        get: (k) => run('readonly', (s) => s.get(k)),
        put: async (k, v) => { await run('readwrite', (s) => s.put(v, k)); },
      });
    };
  });
}

// ---- checking what was stored -----------------------------------------------------------------------------

const MAX_COUNT = 1e7;
const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(Math.floor(v), MAX_COUNT) : 0);

/** A stored progress, every field checked (unknown drills and levels dropped, counts whole and in range). */
export function progressFrom(raw: unknown): Progress {
  const p = blankProgress();
  if (!raw || typeof raw !== 'object') return p;
  const r = raw as Record<string, unknown>;
  for (const by of ['played', 'won'] as const) {
    const src = r[by];
    if (src && typeof src === 'object') for (const l of LEVELS) p[by][l] = count((src as Record<string, unknown>)[l]);
  }
  if (r.online && typeof r.online === 'object') {
    const o = r.online as Record<string, unknown>;
    p.online.played = count(o.played);
    p.online.won = Math.min(count(o.won), p.online.played);
  }
  for (const l of LEVELS) p.won[l] = Math.min(p.won[l], p.played[l]);
  p.cupReached = typeof r.cupReached === 'number' && Number.isInteger(r.cupReached) && r.cupReached >= -1 && r.cupReached <= 2 ? r.cupReached : -1;
  p.cupWins = count(r.cupWins);
  if (r.drills && typeof r.drills === 'object') {
    for (const d of DRILL_NAMES) {
      const n = count((r.drills as Record<string, unknown>)[d]);
      if (n > 0) p.drills[d] = n;
    }
  }
  p.aces = count(r.aces);
  p.porTres = count(r.porTres);
  p.rally = Math.min(count(r.rally), 1000);
  p.speed = Math.min(count(r.speed), 400);
  return p;
}

/** Stored owned ids: only items that exist. */
export function ownedFrom(raw: unknown): Set<string> {
  const out = new Set<string>();
  if (Array.isArray(raw)) for (const v of raw) if (typeof v === 'string' && COSMETIC_BY_ID.has(v)) out.add(v);
  return out;
}

// ---- the store --------------------------------------------------------------------------------------------

const K_PROGRESS = 'progress.v1';
const K_OWNED = 'owned.v1';
const K_LOADOUT = 'loadout.v1';
const K_CHARACTERS = 'characters.v1';
const K_ACTIVE = 'active.v1';
/** M6's saved documents, each checked by its own module on use (tournament.ts tourFrom; the career, the challenges). */
export const DOC_KEYS = ['tournament.v1', 'career.v1', 'challenges.v1'] as const;
export type DocKey = (typeof DOC_KEYS)[number];
/** The most characters kept (the creator's list fits one screen). */
export const CHARACTERS_MAX = 12;

/** Stored characters, each checked against what is owned now; at most CHARACTERS_MAX. */
export function charactersFrom(raw: unknown, owned: ReadonlySet<string>): Character[] {
  return Array.isArray(raw) ? raw.slice(0, CHARACTERS_MAX).map((c) => checkedCharacter(c, owned)) : [];
}

export class Store {
  progress: Progress;
  /** Items owned: everything ever earned (an item stays owned if a later version makes its rule harder). */
  readonly owned: Set<string>;
  loadout: Loadout;
  /** The player's own characters, and the one that plays as them (-1: none, the dealt cast's player plays). */
  characters: Character[];
  active: number;

  /** M6's documents as read (unchecked: their modules check them; `doc`). */
  private readonly docs = new Map<DocKey, unknown>();

  /** False when the store is in memory only (IndexedDB missing or refused): nothing outlives the visit. */
  readonly persistent: boolean;
  private readonly backend: Backend;
  /** The writes in flight, one after another (`put`). */
  private writes: Promise<void> = Promise.resolve();

  private constructor(backend: Backend, persistent: boolean, progress: Progress, owned: Set<string>, loadout: unknown, characters: unknown, active: unknown,
    docs: unknown[] = []) {
    this.backend = backend;
    this.persistent = persistent;
    this.progress = progress;
    // What the progress has earned is owned even if the save of the owned list was lost.
    this.owned = new Set([...owned, ...earned(progress)]);
    this.loadout = checkedLoadout(loadout, this.owned);
    this.characters = charactersFrom(characters, this.owned);
    this.active = typeof active === 'number' && Number.isInteger(active) && active >= 0 && active < this.characters.length ? active : -1;
    DOC_KEYS.forEach((k, i) => { if (docs[i] !== undefined) this.docs.set(k, docs[i]); });
  }

  /** A saved document as it was read or last saved (undefined: none); its module checks it. */
  doc(key: DocKey): unknown {
    return this.docs.get(key);
  }

  /** Save a document (null removes what it held). */
  saveDoc(key: DocKey, v: unknown): void {
    this.docs.set(key, v ?? undefined);
    this.put(key, v ?? null);
  }

  /** The browser's store, or one in memory if IndexedDB is missing or refuses. */
  static async open(backend?: Backend): Promise<Store> {
    if (backend) return Store.load(backend, true);
    try {
      return await Store.load(await idbBackend(), true);
    } catch {
      return Store.load(memoryBackend(), false);
    }
  }

  /** A store on this backend (tests pass a memory one; `persistent` is what the store reports). */
  static async load(backend: Backend, persistent: boolean): Promise<Store> {
    let raw: unknown[] = [];
    try {
      raw = await Promise.all([K_PROGRESS, K_OWNED, K_LOADOUT, K_CHARACTERS, K_ACTIVE, ...DOC_KEYS].map((k) => backend.get(k)));
    } catch {
      // Unreadable: the defaults (and saving will try again).
    }
    return new Store(backend, persistent, progressFrom(raw[0]), ownedFrom(raw[1]), raw[2], raw[3], raw[4], raw.slice(5).map((v) => v ?? undefined));
  }

  /** A finished match: the progress moves on, and anything it earns is owned. Returns the new items at once (the
   * game shows them); the save follows in the background (`flush`). */
  recordMatch(m: MatchRecord): Cosmetic[] {
    return this.advance(recordMatch(this.progress, m));
  }

  /** Points won off the coach in a drill (by name), since the last record of it. Returns the new items. */
  recordDrill(drill: string, points: number): Cosmetic[] {
    return this.advance(recordDrill(this.progress, drill, points));
  }

  /** Wear an owned item (or empty an optional slot with null); false if it can't be worn there. */
  wear(slot: Slot, id: string | null): boolean {
    const next = checkedLoadout({ ...this.loadout, [slot]: id }, this.owned);
    if (next[slot] !== id) return false;
    this.loadout = next;
    this.put(K_LOADOUT, this.loadout);
    return true;
  }

  /** Save a character (checked against what is owned) as number `at`, or as a new one with -1; returns its number, or
   * -1 if the list is full. */
  saveCharacter(at: number, c: Character): number {
    const checked = checkedCharacter(c, this.owned);
    if (at >= 0 && at < this.characters.length) this.characters[at] = checked;
    else if (this.characters.length >= CHARACTERS_MAX) return -1;
    else at = this.characters.push(checked) - 1;
    this.put(K_CHARACTERS, this.characters);
    return at;
  }

  removeCharacter(at: number): void {
    if (at < 0 || at >= this.characters.length) return;
    this.characters.splice(at, 1);
    if (this.active === at) this.active = -1;
    else if (this.active > at) this.active--;
    this.put(K_CHARACTERS, this.characters);
    this.put(K_ACTIVE, this.active);
  }

  /** The character that plays as the player (-1: none). */
  setActive(at: number): void {
    this.active = at >= 0 && at < this.characters.length ? at : -1;
    this.put(K_ACTIVE, this.active);
  }

  /** Back to the defaults (the locker's reset; tests). */
  clear(): void {
    this.progress = blankProgress();
    this.owned.clear();
    for (const id of earned(this.progress)) this.owned.add(id);
    this.loadout = defaultLoadout();
    this.put(K_PROGRESS, this.progress);
    this.put(K_OWNED, [...this.owned]);
    this.put(K_LOADOUT, this.loadout);
  }

  /** Resolves when every write so far has been tried. */
  flush(): Promise<void> {
    return this.writes;
  }

  private advance(next: Progress): Cosmetic[] {
    this.progress = next;
    const fresh = newlyEarned(next, this.owned);
    for (const c of fresh) this.owned.add(c.id);
    this.put(K_PROGRESS, next);
    if (fresh.length) this.put(K_OWNED, [...this.owned]);
    return fresh;
  }

  /** Writes go one after another, in the order made (a value is copied now: later changes don't reach it). A failed
   * write keeps the value in memory for the visit: the game goes on, and the next write of the key tries again. */
  private put(k: string, v: unknown): void {
    const copy = structuredClone(v);
    this.writes = this.writes.then(() => this.backend.put(k, copy)).catch(() => undefined);
  }
}
