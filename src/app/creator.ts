// The Players screens and the creator (M5 phase D), behind ?creator=1 until the owner has seen them: the player's own
// characters (store.ts), made and changed on the studio's turntable (game/studio.ts), shared as codes and links
// (character.ts). The one marked as playing plays as the player in Quick Match, the knock-out and practice.
//
// This step has what shows on the body as it is drawn now: the face preset, the hand, the body's proportions
// (realistic or ridiculous), the outfit from what is owned and the racket. The skin's and hair's tone, tattoos, the
// racket's own colours, the grunt and the celebration join with the looks they need (phase D's next step).
import type { Choice, Item, Menu, Screen } from '../ui/menu/menu.ts';
import {
  checkedBody, cleanName, decodeCharacter, defaultCharacter, encodeCharacter, FACES, HAIR_TONES, NAME_MAX, RACKET_IDS, setSilly,
  TATTOOS, type Character, type Tattoo,
} from './character.ts';
import { CHARACTERS_MAX, type Store } from './store.ts';
import { COSMETICS, covered, SLOT_INFO, SLOTS, type Slot } from './unlocks.ts';
import { PROPORTION_KEYS, RANGES, type Proportions } from '../render/avatar/proportions.ts';
import { RACKETS } from '../sim/contact/racket.ts';
import { racketStats, type RacketStats } from '../sim/contact/racketStats.ts';
import { STUDIO_DRILLS, type Studio } from '../game/studio.ts';
import type { GameOptions } from '../game/game.ts';

/** What the creator needs of the app. */
export interface CreatorHost {
  readonly menu: Menu;
  /** The store, once it has opened (null before). */
  store(): Store | null;
  /** The studio, with the renderer lent to it (null: no bodies to show, ?avatar=0). */
  studio(): Studio | null;
  /** The renderer back to the title's match. */
  leaveStudio(): void;
  /** A match's options with the character applied (what the studio dresses them from). */
  options(c: Character): GameOptions;
  confirm(title: string, sub: string, yesDesc: string, yes: () => void): Screen;
}

/** A character a name may hold (character.ts cleanName keeps these). */
const NAME_CHAR = /^[\p{L}\p{M} '’.-]$/u;

/** A face preset's name in the lists: the presets are numbered by sex. */
export function faceLabel(id: string): string {
  const f = FACES.find((x) => x.id === id);
  if (!f) return id;
  const same = FACES.filter((x) => x.woman === f.woman);
  return `${f.woman ? 'Woman' : 'Man'} ${same.indexOf(f) + 1}`;
}

const BODY: Record<keyof Proportions, [string, string]> = {
  height: ['Height', 'Taller or shorter, all of them together.'],
  legs: ['Legs', 'Longer or shorter legs for the height.'],
  arms: ['Arms', 'Arm length, shoulder to wrist.'],
  torso: ['Torso', 'The trunk, hips to shoulders.'],
  neck: ['Neck', 'Neck length.'],
  shoulders: ['Shoulders', 'Shoulder width.'],
  head: ['Head size', 'Head size.'],
  hands: ['Hands', 'Hand size.'],
  feet: ['Feet', 'Foot size.'],
  build: ['Build', 'Slimmer or broader, all over.'],
};

/** A slider's 0..1 to a proportion: the middle is always the preset's own (1), each half spans one side of the range,
 * so a range that isn't even either side of 1 still has it in the middle. */
export function toScale(v: number, [lo, hi]: readonly [number, number]): number {
  return v <= 0.5 ? lo + (1 - lo) * (v / 0.5) : 1 + (hi - 1) * ((v - 0.5) / 0.5);
}
export function fromScale(x: number, [lo, hi]: readonly [number, number]): number {
  return x <= 1 ? (0.5 * (x - lo)) / (1 - lo) : 0.5 + (0.5 * (x - 1)) / (hi - 1);
}

/** The hair choices: the face's own, the natural tones, and the dyed ones in ridiculous mode. */
function hairOptions(silly: boolean): Choice[] {
  const tones = Object.entries(HAIR_TONES).filter(([, t]) => silly || !t.silly);
  return [{ value: null, label: 'Their own' }, ...tones.map(([k]) => ({ value: k, label: k[0]!.toUpperCase() + k.slice(1) }))];
}

/** A skin tint as the slider shows it. */
export function skinWords(t: number): string {
  const n = Math.round(Math.abs(t) * 100);
  return n === 0 ? 'Their own' : `${t < 0 ? 'Darker' : 'Lighter'} ${n}%`;
}

/** A racket's name without its specs in brackets (data/rackets.json `name`). */
function racketName(id: string): string {
  return (RACKETS[id]?.name ?? id).replace(/\s*\(.*\)\s*$/, '');
}

const STATS = new Map<string, RacketStats>();
function statsOf(id: string): RacketStats | null {
  const spec = RACKETS[id];
  if (!spec) return null;
  let s = STATS.get(id);
  if (!s) STATS.set(id, (s = racketStats(spec)));
  return s;
}

function racketLine(id: string): string {
  const s = statsOf(id);
  const name = RACKETS[id]?.name ?? id;
  if (!s) return name;
  const n = (x: number): number => Math.round(x / 10);
  return `${name}. Power ${n(s.power)}, control ${n(s.control)}, spin ${n(s.spin)}, sweet spot ${n(s.sweetSpot)}, handling ${n(s.manoeuvrability)} (out of 10). It plays the same for anyone who picks it.`;
}

export class Creator {
  /** The character being made or changed, the number it is saved as (-1: new), and how it was when opened. */
  private draft: Character | null = null;
  private at = -1;
  private was = '';
  /** What "Copy their code" last did, said under it. */
  private copied = '';

  private readonly host: CreatorHost;

  constructor(host: CreatorHost) {
    this.host = host;
  }

  private get menu(): Menu {
    return this.host.menu;
  }

  // ---- the list ---------------------------------------------------------------------------------------------

  playersScreen(): Screen {
    const s = this.host.store();
    const list = s?.characters ?? [];
    const playing = s && s.active >= 0 ? list[s.active] : undefined;
    const items: Item[] = [
      {
        kind: 'button', label: 'Create a player', primary: true,
        desc: list.length >= CHARACTERS_MAX ? `That's the most there can be (${CHARACTERS_MAX}): delete one first.` : 'Their face, their body, what they wear, their racket.',
        disabled: () => !s || list.length >= CHARACTERS_MAX,
        action: () => this.edit(-1, defaultCharacter()),
      },
      ...list.map((c, i): Item => ({
        kind: 'button', label: c.name + (s!.active === i ? '  ·  playing' : ''),
        desc: `${faceLabel(c.face)}, ${c.hand}-handed${c.silly ? ', ridiculous' : ''}, ${racketName(c.racket.base)}.`,
        action: () => this.menu.open(this.playerScreen(i)),
      })),
      {
        kind: 'text', label: 'Paste a code', desc: 'A friend’s player: paste their code or link here.', get: () => '',
        paste: (t) => void this.addCode(t),
      },
      {
        kind: 'button', label: 'Play as the dealt players', hidden: () => !s || s.active < 0,
        desc: 'Nobody of yours: you play as whoever the match deals you, as before.',
        action: () => { s?.setActive(-1); this.menu.replace(this.playersScreen()); },
      },
    ];
    return {
      id: 'players', title: 'Players',
      sub: !s ? 'Opening your saves' : playing ? `You play as ${playing.name}` : 'You play as the dealt players',
      items,
    };
  }

  private playerScreen(i: number): Screen {
    const s = this.host.store()!;
    const c = s.characters[i]!;
    this.copied = '';
    const again = (): void => { this.menu.pop(); this.menu.replace(this.playersScreen()); };
    return {
      id: 'player', title: c.name, sub: `${faceLabel(c.face)} · ${c.hand}-handed · ${racketName(c.racket.base)}`,
      back: again,
      items: [
        {
          kind: 'button', label: s.active === i ? 'You play as them' : 'Play as them', primary: s.active !== i,
          desc: 'In Quick Match, the knock-out and practice. Online everyone plays the dealt players.',
          disabled: () => s.active === i,
          action: () => { s.setActive(i); again(); },
        },
        { kind: 'button', label: 'Change them', desc: 'Back on the turntable.', action: () => this.edit(i, c) },
        {
          kind: 'button', label: 'Copy their code', desc: () => this.copied || 'A link a friend can open, or paste in their Players screen.',
          action: () => void this.copy(c),
        },
        {
          kind: 'button', label: 'Make a copy', desc: 'A new player starting from this one.', disabled: () => s.characters.length >= CHARACTERS_MAX,
          action: () => this.edit(-1, { ...structuredClone(c), name: cleanName(`${c.name} 2`) || 'Player' }),
        },
        {
          kind: 'button', label: 'Delete',
          action: () => this.menu.open(this.host.confirm(`Delete ${c.name}?`, 'There is no getting them back', 'Delete them.', () => {
            s.removeCharacter(i);
            this.menu.pop();
            again();
          })),
        },
      ],
    };
  }

  private async copy(c: Character): Promise<void> {
    const link = `${location.origin}${location.pathname}?creator=1#p=${await encodeCharacter(c)}`;
    try {
      await navigator.clipboard.writeText(link);
      this.copied = 'Copied: a link with them in it. Send it to a friend.';
    } catch {
      this.copied = 'The clipboard said no. Allow it for this page, then try again.';
    }
    if (this.menu.current?.id === 'player') this.menu.refresh();
  }

  /** A code or a link (#p=): added as a new player and opened on the turntable, saved once they say so. */
  async addCode(text: string): Promise<boolean> {
    const s = this.host.store();
    const code = text.match(/[#&]p=([A-Za-z0-9_-]+)/)?.[1] ?? text;
    const c = s ? await decodeCharacter(code, s.owned) : null;
    if (!s || !c || s.characters.length >= CHARACTERS_MAX) return false;
    this.edit(-1, c);
    return true;
  }

  // ---- the creator ------------------------------------------------------------------------------------------

  /** Open the creator on a copy of `c`, to be saved as number `at` (-1: a new one). */
  edit(at: number, c: Character): void {
    this.draft = structuredClone(c);
    this.at = at;
    this.was = JSON.stringify(c);
    this.dress();
    this.menu.open(this.editScreen());
  }

  /** The turntable to the draft as it is now. */
  private dress(): void {
    const d = this.draft;
    if (d) this.host.studio()?.show(this.host.options(d));
  }

  private close(): void {
    this.draft = null;
    this.host.leaveStudio();
    this.menu.pop();
    if (this.menu.current?.id === 'player') this.menu.pop();
    if (this.menu.current?.id === 'players') this.menu.replace(this.playersScreen());
  }

  private save(): void {
    const s = this.host.store(), d = this.draft;
    if (!s || !d) return;
    d.name = cleanName(d.name) || 'Player';
    const at = s.saveCharacter(this.at, d);
    // The first one made plays at once.
    if (at >= 0 && s.active < 0) s.setActive(at);
    this.close();
  }

  private leave(): void {
    if (!this.draft || JSON.stringify(this.draft) === this.was) { this.close(); return; }
    this.menu.open(this.host.confirm('Leave without saving?', 'The changes go', 'Leave them as they were.', () => {
      this.menu.pop();
      this.close();
    }));
  }

  private editScreen(): Screen {
    const d = (): Character => this.draft!;
    const s = this.host.store();
    const owned = s?.owned ?? new Set<string>();
    // (its choices change with ridiculous: dyed colours only there)
    const hair: Item = {
      kind: 'choice', label: 'Hair colour', desc: () => (d().silly ? 'The face’s own, a natural colour, or dyed.' : 'The face’s own or a natural colour. Ridiculous has dyed ones.'),
      options: hairOptions(d().silly), get: () => d().hair, set: (v) => { d().hair = typeof v === 'string' ? v : null; this.dress(); },
    };
    const items: Item[] = [
      {
        kind: 'text', label: 'Name', free: true, desc: 'Letters, spaces, apostrophes, hyphens, dots.', get: () => d().name,
        // (only what a name keeps: character.ts cleanName)
        type: (l) => {
          const n = d().name;
          if (l === null) d().name = n.slice(0, -1);
          else if (NAME_CHAR.test(l) && n.length < NAME_MAX && !(l === ' ' && (n === '' || n.endsWith(' ')))) d().name = n + l;
        },
        paste: (t) => { d().name = cleanName(t); },
      },
      { kind: 'group', label: 'Look' },
      {
        kind: 'choice', label: 'Face', desc: 'Who they look like. Hair and beard come with the face.',
        options: FACES.map((f) => ({ value: f.id, label: faceLabel(f.id) })), get: () => d().face,
        set: (v) => { d().face = String(v); this.dress(); },
      },
      {
        kind: 'choice', label: 'Racket hand', options: [{ value: 'right', label: 'Right' }, { value: 'left', label: 'Left' }],
        get: () => d().hand, set: (v) => { d().hand = v === 'left' ? 'left' : 'right'; this.dress(); },
      },
      {
        kind: 'slider', label: 'Skin', step: 0.05, desc: 'Darker or lighter than the face’s own, within real skin.',
        readout: () => skinWords(d().skin), get: () => (d().skin + 1) / 2,
        set: (v) => { d().skin = Math.round((Number(v) * 2 - 1) * 100) / 100; this.dress(); },
      },
      hair,
      ...(['arm', 'calf'] as const).map((where): Item => ({
        kind: 'choice', label: where === 'arm' ? 'Arm tattoo' : 'Calf tattoo',
        desc: where === 'arm' ? 'On the racket arm’s forearm, outside.' : 'On the back of the other leg’s calf.',
        options: [{ value: null, label: 'None' }, ...TATTOOS.map((t) => ({ value: t, label: t[0]!.toUpperCase() + t.slice(1) }))],
        get: () => d().tattoos[where],
        set: (v) => { d().tattoos = { ...d().tattoos, [where]: (v as Tattoo | null) ?? null }; this.dress(); },
      })),
      { kind: 'group', label: 'Body' },
      {
        kind: 'choice', label: 'Ridiculous', options: [{ value: false, label: 'Off' }, { value: true, label: 'On' }],
        desc: 'Off: within real people’s range. On: giant heads, long arms, little legs. They still play the ball.',
        get: () => d().silly,
        set: (v) => { setSilly(d(), v === true); hair.options = hairOptions(d().silly); this.dress(); this.menu.refresh(); },
      },
      ...PROPORTION_KEYS.map((k): Item => ({
        kind: 'slider', label: BODY[k][0], step: 0.05,
        desc: () => `${BODY[k][1]} ${Math.round(d().body[k] * 100)}% of the preset’s.`,
        readout: () => `${Math.round(d().body[k] * 100)}%`,
        get: () => fromScale(d().body[k], RANGES[d().silly ? 'silly' : 'real'][k]),
        set: (v) => {
          const c = d();
          c.body = checkedBody({ ...c.body, [k]: toScale(Number(v), RANGES[c.silly ? 'silly' : 'real'][k]) }, c.silly);
          this.dress();
        },
      })),
      {
        kind: 'button', label: 'Body as the preset', desc: 'Every slider back to the middle.',
        action: () => { d().body = checkedBody({}, d().silly); this.dress(); this.menu.refresh(); },
      },
      { kind: 'group', label: 'Racket and outfit' },
      {
        kind: 'choice', label: 'Racket', desc: () => racketLine(d().racket.base),
        options: RACKET_IDS.map((id) => ({ value: id, label: racketName(id) })),
        get: () => d().racket.base, set: (v) => { d().racket = { ...d().racket, base: String(v) }; this.dress(); },
      },
      ...SLOTS.map((slot): Item => this.slotItem(slot, d, owned)),
      { kind: 'group', label: 'Turntable' },
      {
        kind: 'choice', label: 'Watch them play', desc: 'A coach you can’t see feeds them; drag the picture to turn it, the wheel to come closer.',
        options: [{ value: -1, label: 'Still' }, ...STUDIO_DRILLS.map((x) => ({ value: x.drill, label: x.label }))],
        get: () => this.host.studio()?.playing ?? -1, set: (v) => this.host.studio()?.play(Number(v)),
      },
      { kind: 'button', label: this.at < 0 ? 'Save them' : 'Save the changes', primary: true, action: () => this.save() },
      { kind: 'button', label: 'Leave without saving', action: () => this.leave() },
    ];
    return { id: 'creator', title: this.at < 0 ? 'New player' : 'Change them', back: () => this.leave(), items };
  }

  /** An outfit slot's choice: what is owned for it (and nothing, where it can be empty); hidden under a costume. */
  private slotItem(slot: Slot, d: () => Character, owned: ReadonlySet<string>): Item {
    const mine = COSMETICS.filter((x) => x.slot === slot && owned.has(x.id));
    const options: Choice[] = [...(SLOT_INFO[slot].required ? [] : [{ value: null, label: 'None' }]), ...mine.map((x) => ({ value: x.id, label: x.name }))];
    const all = COSMETICS.filter((x) => x.slot === slot).length;
    const more = all - mine.length;
    return {
      kind: 'choice', label: SLOT_INFO[slot].name, options,
      desc: more > 0 ? `${more} more to earn by playing.` : 'Every one there is.',
      hidden: () => options.length < 2 || covered(d().outfit).has(slot),
      get: () => d().outfit[slot], set: (v) => { d().outfit = { ...d().outfit, [slot]: v as string | null }; this.dress(); this.menu.refresh(); },
    };
  }
}
