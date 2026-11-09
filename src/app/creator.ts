// The Players screens and the creator (M5 phase D), behind ?creator=1 until the owner has seen them: the player's own
// characters (store.ts), made and changed on the studio's turntable (game/studio.ts), shared as codes and links
// (character.ts). The one marked as playing plays as the player in Quick Match, the knock-out and practice.
//
// The creator has the face preset, the hand, the skin's and hair's tone, tattoos, the body's proportions (realistic or
// ridiculous), the racket in its maker's colours or the player's own (render/avatar/racketDesign.ts), and the outfit
// from what is owned.
import type { Choice, Item, Menu, Screen } from '../ui/menu/menu.ts';
import {
  checkedBody, checkedRacket, cleanName, decodeCharacter, defaultCharacter, encodeCharacter, FACE_FINISH, FACES, FRAME_FINISH, HAIR_TONES,
  faceVoice, NAME_MAX, RACKET_ART, RACKET_IDS, setSilly, TATTOOS, voicesFor, type Character, type RacketDesign, type Tattoo,
} from './character.ts';
import { racketLookFor } from '../render/avatar/racket.ts';
import { designFrom, RACKET_PALETTE } from '../render/avatar/racketDesign.ts';
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
  /** Play a grunt of `voice` (voices.ts PLAYER_VOICES) at `rate`, as it sounds on court (absent: no sound to play). */
  grunt?(voice: number, rate: number): void;
}

/** A grunt is heard this long (ms) after the voice or pitch last changed: once the slider rests, not at each step. */
const HEAR_MS = 220;

/** A grunt's pitch as the character holds it (-1..1) to semitones: three either way (game.ts). */
const SEMITONES = 3;

/** What the pitch slider says. */
export function pitchWords(p: number): string {
  if (p === 0) return 'As the voice is';
  const st = Math.abs(p * SEMITONES);
  return `${p > 0 ? 'Higher' : 'Lower'} ${st.toFixed(1)} semitone${st === 1 ? '' : 's'}`;
}

/** A character a name may hold (character.ts cleanName keeps these). */
const NAME_CHAR = /^[\p{L}\p{M} '’.-]$/u;

/** The grunt's choices for a face: its own, or one of its sex's four voices. */
function gruntOptions(face: string): Choice[] {
  return [{ value: null, label: 'Their own' }, ...voicesFor(face).map((v, i) => ({ value: v, label: `Voice ${i + 1}` }))];
}

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
  /** The racket colours they made last while this one is open: back to the maker's and to their own again keeps them. */
  private lastDesign: RacketDesign['look'] = null;
  /** The grunt waiting to be heard (HEAR_MS after the last change). */
  private hearing: ReturnType<typeof setTimeout> | null = null;

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
    this.lastDesign = null;
    this.at = at;
    this.was = JSON.stringify(c);
    this.dress();
    this.menu.open(this.editScreen());
  }

  /** The draft's grunt: now, or once the changes rest. Their own face's tone with their pitch on it, as game.ts plays it. */
  private hear(now = false): void {
    if (!this.host.grunt) return;
    if (this.hearing) clearTimeout(this.hearing);
    this.hearing = null;
    const go = (): void => {
      this.hearing = null;
      const c = this.draft;
      if (!c) return;
      const own = faceVoice(c.face);
      this.host.grunt!(c.voice ?? own.voice, own.tone * 2 ** ((c.pitch * SEMITONES) / 12));
    };
    if (now) go();
    else this.hearing = setTimeout(go, HEAR_MS);
  }

  /** The turntable to the draft as it is now. */
  private dress(): void {
    const d = this.draft;
    if (d) this.host.studio()?.show(this.host.options(d));
  }

  private close(): void {
    if (this.hearing) clearTimeout(this.hearing);
    this.hearing = null;
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
    // (its voices are the face's sex's: they change with a face of the other sex)
    const grunt: Item = {
      kind: 'choice', label: 'Grunt', desc: 'Their face’s own, or another voice. Heard as you change it.',
      options: gruntOptions(d().face), get: () => d().voice,
      set: (v) => { d().voice = typeof v === 'number' ? v : null; this.hear(); },
    };
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
        set: (v) => {
          const c = d();
          c.face = String(v);
          if (c.voice !== null && !voicesFor(c.face).includes(c.voice)) c.voice = null;
          grunt.options = gruntOptions(c.face);
          this.dress();
        },
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
      { kind: 'group', label: 'Voice' },
      grunt,
      {
        kind: 'slider', label: 'Pitch', step: 0.1, desc: 'Their grunt higher or lower, up to three semitones. Heard as you change it.',
        readout: () => pitchWords(d().pitch), get: () => (d().pitch + 1) / 2,
        set: (v) => { d().pitch = Math.round((Number(v) * 2 - 1) * 100) / 100; this.hear(); },
      },
      { kind: 'button', label: 'Hear them', desc: 'Their grunt, as it sounds on court.', action: () => this.hear(true) },
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
      ...this.designItems(d),
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

  /** The racket's colours: the maker's, or their own (the same racket underneath, so it plays the same) from the
   * designer's palette, with its graphic and finishes. Their own starts from the maker's in the palette's nearest
   * colours, or from the last they made while this screen is open. */
  private designItems(d: () => Character): Item[] {
    type Look = NonNullable<RacketDesign['look']>;
    const own = (): Look => d().racket.look!;
    const put = <K extends keyof Look>(k: K, v: Look[K]): void => {
      const r = d().racket;
      d().racket = { ...r, look: { ...r.look!, [k]: v } };
      this.dress();
    };
    const mine = (): boolean => d().racket.look === null;
    const words = (w: string): string => w[0]!.toUpperCase() + w.slice(1);
    const palette = RACKET_PALETTE.map((p) => ({ value: p.hex, label: p.name, swatch: p.hex }));
    // (no grip colour: the overgrip slot is never empty, and the overgrip is what shows)
    const colour = (k: 'face' | 'a' | 'b' | 'accent' | 'frame', label: string, desc: string): Item => ({
      kind: 'choice', label, desc, options: palette, hidden: mine, get: () => own()[k], set: (v) => put(k, String(v)),
    });
    return [
      {
        kind: 'choice', label: 'Racket colours', desc: 'The maker’s, or your own over the same racket. Colours never change how it plays.',
        options: [{ value: false, label: 'Maker’s' }, { value: true, label: 'Your own' }],
        get: () => d().racket.look !== null,
        set: (v) => {
          const r = d().racket;
          if (v === true) d().racket = r.look ? r : this.lastDesign ? { ...r, look: this.lastDesign } : checkedRacket({ base: r.base, look: designFrom(racketLookFor(0, r.base)) });
          else {
            if (r.look) this.lastDesign = r.look;
            d().racket = { ...r, look: null };
          }
          this.dress();
          this.menu.refresh();
        },
      },
      {
        kind: 'choice', label: 'Graphic', desc: 'What is printed on the face, in your colours.', hidden: mine,
        options: RACKET_ART.map((a) => ({ value: a, label: words(a) })), get: () => own().art, set: (v) => put('art', v as Look['art']),
      },
      colour('face', 'Face colour', 'The face’s ground.'),
      colour('a', 'Graphic colour', 'The graphic’s main colour.'),
      colour('b', 'Second colour', 'The graphic’s other colour.'),
      colour('accent', 'Accent', 'The graphic’s highlights, the finishing tape and the cap.'),
      colour('frame', 'Frame colour', 'The frame, and the bumper over its top.'),
      {
        kind: 'choice', label: 'Face finish', desc: 'Sand (a gritty print), matte or gloss: a look only. How the face grips the ball is the racket’s own.', hidden: mine,
        options: FACE_FINISH.map((f) => ({ value: f, label: words(f) })), get: () => own().finish, set: (v) => put('finish', v as Look['finish']),
      },
      {
        kind: 'choice', label: 'Frame finish', desc: 'The frame’s lacquer.', hidden: mine,
        options: FRAME_FINISH.map((f) => ({ value: f, label: words(f) })), get: () => own().frameFinish, set: (v) => put('frameFinish', v as Look['frameFinish']),
      },
    ];
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
