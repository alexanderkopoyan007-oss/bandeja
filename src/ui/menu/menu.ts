// The menus (Phase 8): one engine for every screen. A screen is a title and a list of items (buttons, choices,
// sliders, key bindings); the engine draws it as a panel over the game, moves the focus with the arrow keys, WASD,
// the d-pad or the left stick, changes a choice with left/right, confirms with Enter / Space / A, goes back with
// Esc / Backspace / B, and follows the mouse. Focus is real DOM focus on real buttons, with ARIA roles, so a screen
// reader follows it. Screens slide in (a fade only with reduced motion).

const CSS = `
#menu { position: fixed; inset: 0; z-index: 10; display: none; font: 15px/1.3 ui-sans-serif, system-ui, sans-serif;
  color: #e8ecef; --display: "Avenir Next Condensed", "DIN Condensed", "Arial Narrow", system-ui, sans-serif;
  --accent: #ffd84a; --glass: rgba(9,12,17,.74); --edge: rgba(255,255,255,.12); zoom: var(--ui-scale, 1); }
#menu.on { display: block; }
#menu .shade { position: absolute; inset: 0; background: linear-gradient(90deg, rgba(5,7,10,.78) 0%, rgba(5,7,10,.45) 46%, rgba(5,7,10,.08) 100%);
  opacity: 0; transition: opacity .35s; }
#menu.on .shade { opacity: 1; }
#menu .brand { position: absolute; left: 6vw; top: 6vh; font: italic 800 30px/1 var(--display); letter-spacing: .1em; color: #fff; }
#menu .brand b { color: var(--accent); font-weight: 800; }
#menu .panel { position: absolute; left: 6vw; top: calc(6vh + 54px); bottom: calc(5vh + 34px); width: min(520px, 88vw);
  display: flex; flex-direction: column; justify-content: center; }
#menu .panel.wide { width: min(760px, 88vw); }
#menu .screen { animation: menu-in .22s cubic-bezier(.2,.8,.2,1); display: flex; flex-direction: column; min-height: 0; max-height: 100%; }
#menu .screen.back { animation-name: menu-back; }
@keyframes menu-in { from { opacity: 0; transform: translateX(28px); } to { opacity: 1; transform: none; } }
@keyframes menu-back { from { opacity: 0; transform: translateX(-28px); } to { opacity: 1; transform: none; } }
#menu.calm .screen { animation: menu-fade .2s linear; }
@keyframes menu-fade { from { opacity: 0; } to { opacity: 1; } }
#menu h1 { margin: 0 0 4px; font: italic 800 52px/1 var(--display); letter-spacing: .02em; text-transform: uppercase; color: #fff;
  text-shadow: 0 4px 24px rgba(0,0,0,.5); }
#menu .sub { margin: 0 0 18px; font: 700 13px/1.4 var(--display); letter-spacing: .2em; text-transform: uppercase; color: var(--accent); }
#menu .list { position: relative; overflow-y: auto; padding: 6px; margin: 0 -6px; scrollbar-width: thin; }
#menu .item { position: relative; display: flex; align-items: center; width: 100%; height: 46px; padding: 0 16px; margin: 0 0 4px;
  border: 0; border-radius: 8px; background: var(--glass); color: #dfe5ea; font: 700 17px/1 var(--display); letter-spacing: .09em;
  text-transform: uppercase; text-align: left; cursor: pointer; outline: none; backdrop-filter: blur(12px);
  transition: background .12s, color .12s, transform .12s; box-shadow: inset 0 0 0 1px var(--edge); }
#menu .item .lab { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#menu .item .val { display: flex; align-items: center; gap: 10px; color: #fff; font-weight: 800; }
#menu .item .val .arw { opacity: 0; color: var(--accent); font-size: 15px; transition: opacity .12s; padding: 6px; margin: -6px; }
#menu .item.focus { background: rgba(255,255,255,.14); color: #fff; box-shadow: inset 0 0 0 1px rgba(255,216,74,.55); transform: translateX(6px); }
#menu .item.focus::before { content: ""; position: absolute; left: 0; top: 9px; bottom: 9px; width: 4px; border-radius: 2px; background: var(--accent); }
#menu .item.focus .val .arw { opacity: 1; }
#menu .item.primary { background: linear-gradient(90deg, rgba(255,216,74,.95), rgba(255,177,59,.9)); color: #111; }
#menu .item.primary.focus { background: linear-gradient(90deg, #fff1a8, #ffc65a); color: #111; box-shadow: 0 6px 20px rgba(255,190,70,.35); }
#menu .item.primary.focus::before { background: #111; }
#menu .item[aria-disabled="true"] { opacity: .45; cursor: default; }
#menu .item.listening .val { color: var(--accent); animation: menu-blink 1s steps(2) infinite; }
@keyframes menu-blink { 50% { opacity: .35; } }
#menu .bar { width: 120px; height: 6px; border-radius: 3px; background: rgba(255,255,255,.18); overflow: hidden; }
#menu .bar i { display: block; height: 100%; background: var(--accent); }
#menu .group { margin: 14px 0 6px 4px; font: 700 11px/1 var(--display); letter-spacing: .26em; text-transform: uppercase; color: rgba(255,255,255,.5); }
#menu .desc { min-height: 38px; flex: none; margin-top: 12px; font: 13px/1.45 ui-sans-serif, system-ui, sans-serif; color: #c4ccd3; max-width: 520px; }
#menu .side { position: absolute; left: calc(6vw + min(520px, 88vw) + 4vw); top: calc(6vh + 54px); bottom: calc(5vh + 34px);
  width: min(420px, 34vw); display: flex; flex-direction: column; justify-content: center; overflow-y: auto; }
#menu .card { padding: 16px 18px; border-radius: 10px; background: var(--glass); box-shadow: inset 0 0 0 1px var(--edge); backdrop-filter: blur(12px); }
#menu .card h2 { margin: 0 0 10px; font: 700 12px/1 var(--display); letter-spacing: .24em; text-transform: uppercase; color: var(--accent); }
#menu .card table { width: 100%; border-collapse: collapse; font: 700 15px/1 var(--display); letter-spacing: .05em; }
#menu .card td { padding: 7px 0; border-top: 1px solid rgba(255,255,255,.08); color: #cfd6dc; text-align: center; }
#menu .card tr:first-child td { border-top: 0; }
#menu .card td.l { text-align: left; color: #fff; text-transform: uppercase; }
#menu .card td.w { color: var(--accent); }
#menu .foot { position: absolute; left: 6vw; bottom: 5vh; display: flex; gap: 18px; font: 700 12px/1 var(--display); letter-spacing: .14em;
  text-transform: uppercase; color: rgba(255,255,255,.72); }
#menu .cap { display: inline-block; min-width: 20px; padding: 3px 6px 2px; margin-right: 6px; border-radius: 5px; text-align: center;
  font: 800 11px/1 var(--display); color: #0b0d10; background: linear-gradient(180deg, #fff, #cfd6dc); box-shadow: 0 2px 0 #8a939b; }
#menu .cap.pad { border-radius: 50%; min-width: 18px; padding: 4px 4px 3px; }
#menu .keys td { text-align: left; }
#menu .keys td.k { text-align: right; white-space: nowrap; }
#menu .inline { display: none; margin-top: 12px; flex: none; }
@media (max-width: 1000px) { #menu .side { display: none; } #menu .inline { display: block; } #menu .shade { background: rgba(5,7,10,.62); } }
#menu .foot span { white-space: nowrap; }
#menu .foot { flex-wrap: wrap; row-gap: 8px; }
@media (max-height: 640px) { #menu h1 { font-size: 38px; } #menu .item { height: 40px; } }
`;

export interface Choice<T = unknown> { value: T; label: string }

export interface Item {
  kind: 'button' | 'choice' | 'slider' | 'key' | 'group';
  label: string;
  /** What it does or means, shown under the list while focused. */
  desc?: string;
  primary?: boolean;
  action?: () => void;
  options?: Choice[];
  get?: () => unknown;
  set?: (v: unknown) => void;
  /** Sliders: 0..1 in `step`s. */
  step?: number;
  /** Key bindings: the keys' names now; `listen` starts a capture. */
  keys?: () => string;
  listen?: (code: string | null) => void;
  hidden?: () => boolean;
  disabled?: () => boolean;
}

export interface Screen {
  id: string;
  title: string;
  sub?: string;
  items: Item[];
  /** Esc / B: null = no going back (the title screen); default: pop the stack. */
  back?: (() => void) | null;
  /** A card beside the list (HTML of our own strings). */
  side?: () => string;
  wide?: boolean;
  /** Item to focus first. */
  focus?: number;
}

const REPEAT_FIRST = 380;
const REPEAT_NEXT = 110;

export class Menu {
  readonly root: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly sideEl: HTMLElement;
  private readonly foot: HTMLElement;
  private readonly brand: HTMLElement;
  private stack: Screen[] = [];
  private els: HTMLElement[] = [];
  private items: Item[] = [];
  private focusIdx = 0;
  private descEl: HTMLElement | null = null;
  private listening = -1;
  private visible = false;
  private raf = 0;
  /** Pad buttons/directions as last seen, and when each held direction repeats next. */
  private padPrev = new Map<number, boolean>();
  private repeatAt = new Map<number, number>();
  private usingPad = false;
  /** Called on every change of what is shown (the app saves settings here). */
  onChange: (() => void) | null = null;
  /** A short tick for focus moves and a confirm sound (the app routes these to the audio engine). */
  onSound: ((kind: 'move' | 'ok' | 'back') => void) | null = null;

  constructor(parent: HTMLElement) {
    if (!document.getElementById('menu-css')) {
      const st = document.createElement('style');
      st.id = 'menu-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    this.root = parent.appendChild(document.createElement('div'));
    this.root.id = 'menu';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.appendChild(el('div', 'shade'));
    this.brand = this.root.appendChild(el('div', 'brand'));
    this.brand.innerHTML = 'BANDEJA<b>.</b>';
    this.brand.setAttribute('aria-hidden', 'true');
    this.panel = this.root.appendChild(el('div', 'panel'));
    this.sideEl = this.root.appendChild(el('div', 'side'));
    this.foot = this.root.appendChild(el('div', 'foot'));
    this.foot.setAttribute('aria-hidden', 'true');
    // Capture phase: menu keys never reach the game behind (its own listeners are on the bubble phase).
    addEventListener('keydown', (e) => this.onKey(e), true);
    addEventListener('keyup', (e) => { if (this.visible) e.stopImmediatePropagation(); }, true);
  }

  get isOpen(): boolean {
    return this.visible;
  }

  get current(): Screen | null {
    return this.stack[this.stack.length - 1] ?? null;
  }

  /** Reduced motion: screens fade instead of sliding. */
  set calm(on: boolean) {
    this.root.classList.toggle('calm', on);
  }

  /** Show a screen on top of the stack (or as the only one with `reset`). */
  open(s: Screen, reset = false): void {
    if (reset) this.stack = [];
    this.stack.push(s);
    this.show();
    this.render(false);
  }

  /** Replace the top screen (same place in the stack). */
  replace(s: Screen): void {
    this.stack.pop();
    this.stack.push(s);
    this.render(false);
  }

  back(): void {
    const s = this.current;
    if (!s) return;
    if (s.back === null) return;
    this.onSound?.('back');
    if (s.back) { s.back(); return; }
    this.pop();
  }

  pop(): void {
    this.stack.pop();
    if (this.stack.length) this.render(true);
    else this.hide();
  }

  /** Redraw the current screen in place (values changed elsewhere), keeping the focus. */
  refresh(): void {
    const keep = this.focusIdx;
    this.render(false, keep, true);
  }

  show(): void {
    if (this.visible) return;
    this.visible = true;
    this.root.classList.add('on');
    this.padPrev.clear();
    this.primePad();
    const loop = (): void => {
      this.pollPad();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.root.classList.remove('on');
    cancelAnimationFrame(this.raf);
    this.stack = [];
    this.listening = -1;
    (document.activeElement as HTMLElement | null)?.blur?.();
  }

  private render(back: boolean, focus = -1, still = false): void {
    const s = this.current;
    if (!s) return;
    this.listening = -1;
    this.panel.classList.toggle('wide', !!s.wide);
    const scr = el('div', still ? 'screen still' : back ? 'screen back' : 'screen');
    if (still) scr.style.animation = 'none';
    const h1 = scr.appendChild(document.createElement('h1'));
    h1.textContent = s.title;
    h1.id = 'menu-title';
    this.root.setAttribute('aria-labelledby', 'menu-title');
    if (s.sub) {
      const sub = scr.appendChild(el('div', 'sub'));
      sub.textContent = s.sub;
    }
    const list = scr.appendChild(el('div', 'list'));
    list.setAttribute('role', 'menu');
    this.els = [];
    this.items = [];
    for (const it of s.items) {
      if (it.hidden?.()) continue;
      if (it.kind === 'group') {
        const g = list.appendChild(el('div', 'group'));
        g.textContent = it.label;
        continue;
      }
      const b = list.appendChild(document.createElement('button')) as HTMLButtonElement;
      b.className = it.primary ? 'item primary' : 'item';
      b.tabIndex = -1;
      const idx = this.items.length;
      this.items.push(it);
      this.els.push(b);
      this.fill(b, it);
      b.addEventListener('mouseenter', () => { if (this.listening < 0) this.setFocus(idx, false); });
      b.addEventListener('click', (e) => {
        this.usingPad = false;
        const arw = (e.target as HTMLElement).closest('.arw') as HTMLElement | null;
        this.setFocus(idx, false);
        if (arw && (it.kind === 'choice' || it.kind === 'slider')) this.change(arw.dataset.d === '-' ? -1 : 1);
        else this.activate();
      });
    }
    this.descEl = scr.appendChild(el('div', 'desc'));
    this.descEl.setAttribute('aria-live', 'polite');
    const side = s.side?.() ?? '';
    // Beside the list on a wide window, under it on a narrow one (one copy is hidden by the media query).
    if (side) {
      const inl = scr.appendChild(el('div', 'inline'));
      inl.innerHTML = side;
      inl.setAttribute('aria-hidden', 'true');
    }
    this.panel.replaceChildren(scr);
    this.sideEl.innerHTML = side;
    this.sideEl.style.display = side ? '' : 'none';
    this.drawFoot();
    let f = focus >= 0 ? focus : s.focus ?? 0;
    f = Math.max(0, Math.min(this.items.length - 1, f));
    while (f < this.items.length - 1 && this.items[f]!.disabled?.()) f++;
    this.setFocus(f, false);
  }

  private fill(b: HTMLElement, it: Item): void {
    const dis = it.disabled?.() ?? false;
    b.setAttribute('aria-disabled', String(dis));
    if (it.kind === 'button') {
      b.setAttribute('role', 'menuitem');
      b.innerHTML = `<span class="lab"></span>`;
      b.querySelector('.lab')!.textContent = it.label;
      b.setAttribute('aria-label', it.label);
    } else if (it.kind === 'choice') {
      const opts = it.options ?? [];
      const v = it.get?.();
      const i = Math.max(0, opts.findIndex((o) => o.value === v));
      const lab = opts[i]?.label ?? '';
      b.setAttribute('role', 'slider');
      b.setAttribute('aria-label', it.label);
      b.setAttribute('aria-valuemin', '0');
      b.setAttribute('aria-valuemax', String(opts.length - 1));
      b.setAttribute('aria-valuenow', String(i));
      b.setAttribute('aria-valuetext', lab);
      b.innerHTML = `<span class="lab"></span><span class="val"><span class="arw" data-d="-">◀</span><span class="v"></span><span class="arw" data-d="+">▶</span></span>`;
      b.querySelector('.lab')!.textContent = it.label;
      b.querySelector('.v')!.textContent = lab;
    } else if (it.kind === 'slider') {
      const v = Number(it.get?.() ?? 0);
      const pct = Math.round(v * 100);
      b.setAttribute('role', 'slider');
      b.setAttribute('aria-label', it.label);
      b.setAttribute('aria-valuemin', '0');
      b.setAttribute('aria-valuemax', '100');
      b.setAttribute('aria-valuenow', String(pct));
      b.setAttribute('aria-valuetext', `${pct}%`);
      b.innerHTML = `<span class="lab"></span><span class="val"><span class="arw" data-d="-">◀</span><span class="bar"><i style="width:${pct}%"></i></span><span class="v">${pct}%</span><span class="arw" data-d="+">▶</span></span>`;
      b.querySelector('.lab')!.textContent = it.label;
    } else if (it.kind === 'key') {
      const k = it.keys?.() ?? '';
      b.setAttribute('role', 'menuitem');
      b.setAttribute('aria-label', `${it.label}: ${k}. Press Enter to change.`);
      b.innerHTML = `<span class="lab"></span><span class="val"><span class="v"></span></span>`;
      b.querySelector('.lab')!.textContent = it.label;
      b.querySelector('.v')!.textContent = k;
    }
  }

  private setFocus(i: number, sound: boolean): void {
    if (i < 0 || i >= this.els.length) return;
    if (sound && i !== this.focusIdx) this.onSound?.('move');
    this.els[this.focusIdx]?.classList.remove('focus');
    this.focusIdx = i;
    const b = this.els[i]!;
    b.classList.add('focus');
    b.focus({ preventScroll: true });
    b.scrollIntoView({ block: 'nearest' });
    if (this.descEl) this.descEl.textContent = this.items[i]!.desc ?? '';
  }

  private move(d: number): void {
    const n = this.els.length;
    if (!n) return;
    let i = this.focusIdx;
    for (let k = 0; k < n; k++) {
      i = (i + d + n) % n;
      if (!this.items[i]!.disabled?.()) break;
    }
    this.setFocus(i, true);
  }

  private change(d: number): void {
    const it = this.items[this.focusIdx];
    if (!it || it.disabled?.()) return;
    if (it.kind === 'choice') {
      const opts = it.options ?? [];
      if (!opts.length) return;
      const cur = Math.max(0, opts.findIndex((o) => o.value === it.get?.()));
      const nx = (cur + d + opts.length) % opts.length;
      it.set?.(opts[nx]!.value);
    } else if (it.kind === 'slider') {
      const st = it.step ?? 0.1;
      const v = Math.max(0, Math.min(1, Math.round((Number(it.get?.() ?? 0) + d * st) / st) * st));
      it.set?.(v);
    } else return;
    this.onSound?.('move');
    // Other items can depend on this one (hidden/disabled): redraw the screen in place.
    this.refresh();
    this.onChange?.();
  }

  private activate(): void {
    const it = this.items[this.focusIdx];
    if (!it || it.disabled?.()) return;
    if (it.kind === 'button') { this.onSound?.('ok'); it.action?.(); }
    else if (it.kind === 'choice' || it.kind === 'slider') this.change(1);
    else if (it.kind === 'key') {
      this.listening = this.focusIdx;
      const b = this.els[this.focusIdx]!;
      b.classList.add('listening');
      b.querySelector('.v')!.textContent = 'Press a key · Esc cancels';
      if (this.descEl) this.descEl.textContent = 'Press the key to use. Esc keeps the one there is.';
    }
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.visible) return;
    e.stopImmediatePropagation();
    this.usingPad = false;
    if (this.listening >= 0) {
      e.preventDefault();
      if (e.repeat) return;
      const it = this.items[this.listening]!;
      it.listen?.(e.code === 'Escape' ? null : e.code);
      this.refresh();
      this.onChange?.();
      return;
    }
    const c = e.code;
    const handled = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyS', 'KeyA', 'KeyD', 'Enter', 'Space', 'Escape', 'Backspace', 'Tab'];
    if (!handled.includes(c)) return;
    e.preventDefault();
    if (c === 'ArrowUp' || c === 'KeyW' || (c === 'Tab' && e.shiftKey)) this.move(-1);
    else if (c === 'ArrowDown' || c === 'KeyS' || c === 'Tab') this.move(1);
    else if (c === 'ArrowLeft' || c === 'KeyA') this.change(-1);
    else if (c === 'ArrowRight' || c === 'KeyD') this.change(1);
    else if (c === 'Enter' || c === 'Space') { if (!e.repeat) this.activate(); }
    else if (c === 'Escape' || c === 'Backspace') { if (!e.repeat) this.back(); }
    this.drawFoot();
  }

  /** Buttons held when a menu opens (the press that opened it) are not presses. */
  private primePad(): void {
    const p = firstPad();
    if (!p) return;
    for (let b = 0; b < p.buttons.length; b++) this.padPrev.set(b, p.buttons[b]!.pressed);
    for (const d of [100, 101, 102, 103]) this.padPrev.set(d, true);
  }

  private pollPad(): void {
    const p = firstPad();
    if (!p) return;
    const now = performance.now();
    const ax = p.axes[0] ?? 0, ay = p.axes[1] ?? 0;
    // Directions as virtual buttons 100-103 (up, down, left, right): d-pad or stick past half-way.
    const dirs: Array<[number, boolean]> = [
      [100, !!p.buttons[12]?.pressed || ay < -0.5], [101, !!p.buttons[13]?.pressed || ay > 0.5],
      [102, !!p.buttons[14]?.pressed || ax < -0.5], [103, !!p.buttons[15]?.pressed || ax > 0.5],
    ];
    const edge = (id: number, on: boolean): boolean => {
      const was = this.padPrev.get(id) ?? false;
      this.padPrev.set(id, on);
      return on && !was;
    };
    for (const [id, on] of dirs) {
      const fire = edge(id, on);
      if (fire) this.repeatAt.set(id, now + REPEAT_FIRST);
      else if (on && now >= (this.repeatAt.get(id) ?? Infinity)) this.repeatAt.set(id, now + REPEAT_NEXT);
      else continue;
      this.usingPad = true;
      if (this.listening >= 0) continue;
      if (id === 100) this.move(-1);
      else if (id === 101) this.move(1);
      else if (id === 102) this.change(-1);
      else this.change(1);
      this.drawFoot();
    }
    const a = edge(0, !!p.buttons[0]?.pressed);
    const b = edge(1, !!p.buttons[1]?.pressed);
    const start = edge(9, !!p.buttons[9]?.pressed);
    if (a || b || start) this.usingPad = true;
    if (this.listening >= 0) {
      // Pad buttons can't be rebound here; B cancels a key capture.
      if (b) { this.items[this.listening]!.listen?.(null); this.refresh(); }
      return;
    }
    if (a) this.activate();
    else if (b) this.back();
    else if (start) {
      // Start: the pause screen resumes; elsewhere it confirms.
      const s = this.current;
      if (s?.id === 'pause') this.back();
      else this.activate();
    }
    if (a || b || start) this.drawFoot();
  }

  private footShown = '';

  private drawFoot(): void {
    const pad = this.usingPad;
    const cap = (k: string, round = false): string => `<span class="cap${round ? ' pad' : ''}">${k}</span>`;
    const s = this.current;
    const canBack = s?.back !== null;
    const html = pad
      ? `<span>${cap('✥', true)}Move</span><span>${cap('A', true)}Select</span>${canBack ? `<span>${cap('B', true)}Back</span>` : ''}`
      : `<span>${cap('↑')}${cap('↓')}Move</span><span>${cap('←')}${cap('→')}Change</span><span>${cap('Enter')}Select</span>${canBack ? `<span>${cap('Esc')}Back</span>` : ''}`;
    if (html === this.footShown) return;
    this.footShown = html;
    this.foot.innerHTML = html;
  }
}

function firstPad(): Gamepad | null {
  try {
    for (const p of navigator.getGamepads?.() ?? []) if (p && p.connected) return p;
  } catch {
    // Blocked by a permissions policy: no pad.
  }
  return null;
}

function el(tag: string, cls: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}
