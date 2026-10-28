// The loading screen (Phase 8): the wordmark, a ball bouncing on a line, a progress bar that moves smoothly between
// the real stages (renderer, player body download, arena, reflections, shaders), the stage's name and a tip. It is
// plain HTML and CSS in the page itself, so it is up before any script has loaded beyond this one, and it fades out
// over the first frame of the game.

const CSS = `
#loading { position: fixed; inset: 0; z-index: 20; display: flex; flex-direction: column; align-items: center; justify-content: center;
  background: radial-gradient(ellipse at 50% 38%, #18324f 0%, #0d1420 55%, #07090d 100%); color: #e8ecef;
  font: 15px/1.4 ui-sans-serif, system-ui, sans-serif; transition: opacity .5s; zoom: var(--ui-scale, 1);
  --display: "Avenir Next Condensed", "DIN Condensed", "Arial Narrow", system-ui, sans-serif; }
#loading.out { opacity: 0; pointer-events: none; }
#loading .mark { font: italic 800 min(13vw, 120px)/1 var(--display); letter-spacing: .06em; color: #fff;
  text-shadow: 0 8px 40px rgba(0,0,0,.5); }
#loading .mark b { color: #ffd84a; }
#loading .tag { margin-top: 8px; font: 700 13px/1 var(--display); letter-spacing: .5em; text-transform: uppercase; color: rgba(255,255,255,.55); }
#loading .court { position: relative; width: min(420px, 80vw); height: 70px; margin-top: 44px; }
#loading .court::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 2px; background: rgba(255,255,255,.25); }
#loading .ball { position: absolute; bottom: 2px; width: 14px; height: 14px; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #fbff9a, #d9ef2a 55%, #a5b81a); box-shadow: 0 0 12px rgba(220,240,60,.35);
  animation: ld-x 1.8s linear infinite alternate, ld-y .45s cubic-bezier(.3,.0,.7,1) infinite alternate; }
@keyframes ld-x { from { left: 0; } to { left: calc(100% - 14px); } }
@keyframes ld-y { from { transform: translateY(0); } to { transform: translateY(-52px); } }
#loading .bar { width: min(420px, 80vw); height: 4px; margin-top: 26px; border-radius: 2px; background: rgba(255,255,255,.12); overflow: hidden; }
#loading .bar i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, #ffd84a, #ffb13b); transition: width .3s ease-out; }
#loading .stage { margin-top: 12px; font: 700 12px/1 var(--display); letter-spacing: .22em; text-transform: uppercase; color: rgba(255,255,255,.7); }
#loading .tip { position: absolute; bottom: 7vh; max-width: min(640px, 86vw); text-align: center; color: #b7c0c8; font-size: 14px; }
#loading .tip b { color: #ffd84a; font-weight: 700; }
#loading .err { margin-top: 18px; max-width: min(560px, 86vw); text-align: center; color: #ffb4a8; display: none; }
#loading .retry { margin-top: 16px; padding: 10px 26px; border: 0; border-radius: 999px; background: #ffd84a; color: #10161f;
  font: 800 13px/1 var(--display); letter-spacing: .18em; text-transform: uppercase; cursor: pointer; }
#loading .retry:focus-visible { outline: 3px solid #fff; outline-offset: 3px; }
@media (prefers-reduced-motion: reduce) { #loading .ball { animation: none; left: calc(50% - 7px); } }
:root.calm #loading .ball { animation: none; left: calc(50% - 7px); }
`;

/** Real tips about how the game plays (no filler). */
const TIPS = [
  'Hold a shot key as the ball comes, then <b>release when the closing ring meets the ring on the ball</b>.',
  'Deep balls are often best <b>off the back glass</b>: let it come off the wall and take it as it drops.',
  'A lob over your head: hold <b>overhead</b> for a bandeja, add <b>power</b> for a smash that can leave the court.',
  'The <b>chiquita</b> (topspin with precision) dips at the feet of a pair at the net.',
  'While you hold a shot key, the movement keys <b>aim the yellow target</b> and you run to the ball yourself.',
  'At the net, the <b>volley</b> key takes the ball in the air and punches it.',
  'A serve must bounce in your opponents’ box; off the glass after that is fine, the mesh is a fault.',
  'Two faults in a row lose the point. A serve that clips the net and lands in is played again.',
  'In doubles your partner calls the balls on their side. Holding a shot key takes it anyway.',
  'Out of the court over the back wall after a good bounce is <b>por cuatro</b>; over the side, <b>por tres</b>.',
];

export class LoadingScreen {
  private readonly root: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly stageEl: HTMLElement;
  private readonly err: HTMLElement;
  private readonly tip: HTMLElement;
  private shown = 0;
  private tipTimer = 0;
  /** Each stage's start (ms since navigation), read by tools as window.__loadLog. */
  readonly log: { name: string; t: number }[] = [];

  constructor() {
    if (!document.getElementById('loading-css')) {
      const st = document.createElement('style');
      st.id = 'loading-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    const existing = document.getElementById('loading');
    this.root = existing ?? document.body.appendChild(document.createElement('div'));
    this.root.id = 'loading';
    (window as unknown as { __loadLog: unknown }).__loadLog = this.log;
    this.root.setAttribute('role', 'progressbar');
    this.root.setAttribute('aria-label', 'Loading BANDEJA');
    this.root.setAttribute('aria-valuemin', '0');
    this.root.setAttribute('aria-valuemax', '100');
    this.root.innerHTML = '<div class="mark">BANDEJA<b>.</b></div><div class="tag">Padel</div><div class="court"><div class="ball"></div></div>'
      + '<div class="bar"><i></i></div><div class="stage"></div><div class="err" role="alert"></div><div class="tip"></div>';
    this.bar = this.root.querySelector('.bar i')!;
    this.stageEl = this.root.querySelector('.stage')!;
    this.err = this.root.querySelector('.err')!;
    this.tip = this.root.querySelector('.tip')!;
    let t = Math.floor(Math.random() * TIPS.length);
    this.tip.innerHTML = TIPS[t]!;
    this.tipTimer = window.setInterval(() => { t = (t + 1) % TIPS.length; this.tip.innerHTML = TIPS[t]!; }, 5000);
  }

  /** A stage and how far along the whole load is (0..1). */
  stage(name: string, frac: number): void {
    // The stages' times, for tools/perf.mjs load (a short list per load; reset by show()).
    if (this.log.at(-1)?.name !== name) this.log.push({ name, t: Math.round(performance.now()) });
    this.shown = Math.max(this.shown, Math.min(1, frac));
    this.bar.style.width = `${(this.shown * 100).toFixed(1)}%`;
    this.stageEl.textContent = name;
    this.root.setAttribute('aria-valuenow', String(Math.round(this.shown * 100)));
    this.root.setAttribute('aria-valuetext', name);
  }

  /** Back on screen (between a menu and a match): a quick cover while the next one builds. */
  show(name: string): void {
    this.log.length = 0;
    this.shown = 0;
    this.bar.style.transition = 'none';
    this.bar.style.width = '0';
    void this.bar.offsetWidth;
    this.bar.style.transition = '';
    this.root.style.display = '';
    this.root.classList.remove('out');
    this.stage(name, 0.05);
  }

  /** Fade out (the game is drawing underneath). */
  done(): Promise<void> {
    this.stage('Ready', 1);
    this.log.push({ name: 'shown', t: Math.round(performance.now()) });
    this.root.classList.add('out');
    return new Promise((r) => setTimeout(() => { this.root.style.display = 'none'; r(); }, 520));
  }

  /** Something stopped the load: say what, and offer to try again (Enter or the pad's A press the focused button). */
  fail(message: string): void {
    this.stageEl.textContent = 'Could not start';
    this.err.textContent = message;
    this.err.style.display = 'block';
    clearInterval(this.tipTimer);
    this.tip.textContent = '';
    this.root.classList.remove('out');
    this.root.style.display = '';
    const b = document.createElement('button');
    b.className = 'retry';
    b.textContent = 'Try again';
    b.onclick = () => location.reload();
    this.err.appendChild(document.createElement('br'));
    this.err.appendChild(b);
    b.focus();
    const pad = (): void => {
      if (!b.isConnected) return;
      for (const g of navigator.getGamepads?.() ?? []) if (g?.buttons[0]?.pressed) { location.reload(); return; }
      requestAnimationFrame(pad);
    };
    requestAnimationFrame(pad);
  }
}
