// The timing cue, drawn in screen space on a 2D canvas over the game, so it is crisp and the same size near or
// far: a reticle ring on the ball, an approach ring that closes onto it at the ideal moment, a countdown arc
// that fills as the moment arrives, and on release a burst with the grade word rising from the contact point.
// It only reads the sim; the HUD calls flash() on swing events. Hidden in Pro mode.
import type { MatchSim } from '../sim/match.ts';
import { PH_RALLY, PH_TOSS } from '../sim/match.ts';
import { SW_CHARGE, SW_COMMITTED, SW_IDLE, SW_RECOVER } from '../sim/player/player.ts';

const DISPLAY = '"Avenir Next Condensed", "DIN Condensed", "Arial Narrow", system-ui, sans-serif';

/** Grade colours, Too early .. Too late. */
export const GRADE_CSS = ['#ff5a4f', '#ffb13b', '#8fe36b', '#5ff2ff', '#ffb13b', '#ff5a4f'];
const WHITE: Rgb = [255, 255, 255];
const GOOD: Rgb = [143, 227, 107];
const PERFECT: Rgb = [95, 242, 255];
const AMBER: Rgb = [255, 177, 59];
type Rgb = [number, number, number];

const R0 = 17; // reticle radius, CSS px
const SHOW = 0.6; // seconds before the ideal moment the approach ring appears
const RATE = 150; // approach ring px per second before the ideal
const BURST = 0.75; // seconds the release burst lasts

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function rgba(c: Rgb, a: number): string {
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a.toFixed(3)})`;
}
const easeOut = (t: number): number => 1 - (1 - t) * (1 - t) * (1 - t);

export class TimingCue {
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private dpr = 1;
  private w = 0;
  private h = 0;
  private drewLast = false;
  pro = false;

  // Release burst.
  private burstAt = -10;
  private burstX = 0;
  private burstY = 0;
  private burstColor = '#fff';
  private burstText = '';
  // Last projected ball position (CSS px) for events that arrive between frames.
  private ballX = 0;
  private ballY = 0;

  constructor(root: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'cue';
    this.canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none';
    root.prepend(this.canvas);
    this.g = this.canvas.getContext('2d')!;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  private resize(): void {
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    this.w = innerWidth;
    this.h = innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }

  // Aim marker: a chevron floating over the aim target (the floor reticle is hard to see at the far end).
  private aimOn = false;
  private aimX = 0;
  private aimY = 0;
  private aimPower = false;
  private aimFade = 0;

  /** Where the aim target is on screen this frame (`on` false: not aiming). */
  aimAt(x: number, y: number, on: boolean, power: boolean): void {
    this.aimOn = on;
    if (on) {
      this.aimX = x;
      this.aimY = y;
      this.aimPower = power;
    }
  }

  /** A grade (or "Out of reach") to burst from where the ball is now. */
  flash(text: string, color: string, now: number): void {
    this.burstAt = now;
    this.burstX = this.ballX;
    this.burstY = this.ballY;
    this.burstText = text;
    this.burstColor = color;
  }

  /**
   * `bx, by`: the ball on screen (CSS px), `onScreen` false if it is behind the camera.
   * `renderTime`: sim time being shown; `now`: wall seconds (animations).
   */
  update(
    sim: MatchSim, human: number, bx: number, by: number, onScreen: boolean, renderTime: number, timingScale: number,
    now: number,
  ): void {
    this.ballX = bx;
    this.ballY = by;
    const g = this.g;
    const burst = now - this.burstAt < BURST;
    let ring = false;
    let dt = 0;
    let reach = true;
    if (human >= 0 && !this.pro && onScreen && (sim.phase === PH_RALLY || sim.phase === PH_TOSS)) {
      const p = sim.players[human]!;
      const ideal = sim.focusIdeal(human);
      if (ideal >= 0 && (p.swing === SW_CHARGE || sim.phase === PH_TOSS || p.swing === SW_IDLE)) {
        dt = ideal - renderTime;
        reach = sim.focusInReach;
        ring = dt <= SHOW && dt > -0.15 && p.swing !== SW_COMMITTED && p.swing !== SW_RECOVER;
      }
    }
    // The aim marker fades in and out over ~0.12 s.
    const want = this.aimOn && !this.pro ? 1 : 0;
    const step = Math.min(1, Math.max(0, now - this.lastNow)) * 8;
    this.lastNow = now;
    this.aimFade = want > this.aimFade ? Math.min(1, this.aimFade + step) : Math.max(0, this.aimFade - step);
    const aim = this.aimFade > 0;
    if (!ring && !burst && !aim && !this.drewLast) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drewLast = ring || burst || aim;
    if (aim) this.drawAim(now);
    if (ring) this.drawRing(bx, by, dt, reach, timingScale, now);
    if (burst) this.drawBurst(now - this.burstAt);
  }

  private lastNow = 0;

  /** A downward chevron bobbing above the aim target, with a soft drop line to the floor. */
  private drawAim(now: number): void {
    const g = this.g;
    const x = this.aimX;
    const y = this.aimY;
    const col: Rgb = this.aimPower ? [255, 154, 60] : [255, 216, 74];
    const a = this.aimFade;
    const top = y - 30 - 4 * Math.sin(now * 4);
    const grad = g.createLinearGradient(x, top, x, y);
    grad.addColorStop(0, rgba(col, 0.7 * a));
    grad.addColorStop(1, rgba(col, 0));
    g.strokeStyle = grad;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x, top + 4);
    g.lineTo(x, y - 4);
    g.stroke();
    g.shadowColor = rgba(col, 0.9 * a);
    g.shadowBlur = 10;
    g.fillStyle = rgba(col, a);
    g.strokeStyle = `rgba(20,14,0,${(0.55 * a).toFixed(3)})`;
    g.lineWidth = 1.5;
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(x - 9, top - 9);
    g.lineTo(x, top + 1);
    g.lineTo(x + 9, top - 9);
    g.lineTo(x, top - 5);
    g.closePath();
    g.fill();
    g.shadowBlur = 0;
    g.stroke();
  }

  private drawRing(x: number, y: number, dt: number, reach: boolean, k: number, now: number): void {
    const g = this.g;
    const a = Math.abs(dt);
    // Colour: white far out, warming to green inside Good, cyan inside Perfect; amber while out of reach.
    let col: Rgb;
    if (!reach) col = AMBER;
    else if (a <= 0.025 * k) col = PERFECT;
    else if (a <= 0.06 * k) col = mix(GOOD, PERFECT, 1 - (a - 0.025 * k) / (0.035 * k));
    else col = mix(WHITE, GOOD, Math.max(0, 1 - (a - 0.06 * k) / 0.2));
    const fade = dt < 0 ? Math.max(0, 1 + dt / 0.15) : Math.min(1, (SHOW - dt) / 0.1);
    const alpha = (reach ? 1 : 0.55) * fade;
    const perfect = reach && a <= 0.025 * k;

    g.lineCap = 'round';
    // Inner fill that lights up in the Perfect window.
    if (perfect) {
      const grad = g.createRadialGradient(x, y, 0, x, y, R0 * 1.3);
      grad.addColorStop(0, rgba(col, 0.28 * alpha));
      grad.addColorStop(1, rgba(col, 0));
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, R0 * 1.3, 0, Math.PI * 2);
      g.fill();
    }
    // Reticle: ring + four ticks, with glow.
    const pop = perfect ? 1 + 0.12 * Math.sin(now * 40) * 0.5 + 0.08 : 1;
    const r0 = R0 * pop;
    g.shadowColor = rgba(col, 0.9 * alpha);
    g.shadowBlur = 10;
    g.strokeStyle = rgba(col, 0.55 * alpha);
    g.lineWidth = 2;
    g.beginPath();
    g.arc(x, y, r0, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 2;
    g.strokeStyle = rgba(col, 0.9 * alpha);
    for (let i = 0; i < 4; i++) {
      const t = (i * Math.PI) / 2;
      const c = Math.cos(t);
      const s = Math.sin(t);
      g.beginPath();
      g.moveTo(x + c * (r0 + 4), y + s * (r0 + 4));
      g.lineTo(x + c * (r0 + 9), y + s * (r0 + 9));
      g.stroke();
    }
    // Countdown arc on the reticle, filling clockwise from the top as the moment arrives.
    if (dt > 0) {
      const f = Math.min(1, Math.max(0, 1 - dt / SHOW));
      g.lineWidth = 3.5;
      g.strokeStyle = rgba(col, alpha);
      g.beginPath();
      g.arc(x, y, r0, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2);
      g.stroke();
      // Approach ring: a soft halo and a crisp line, closing onto the reticle.
      const r = r0 + RATE * dt;
      g.shadowBlur = 0;
      g.lineWidth = 9;
      g.strokeStyle = rgba(col, 0.1 * alpha);
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.stroke();
      g.shadowBlur = 8;
      g.lineWidth = 2;
      g.strokeStyle = rgba(col, 0.9 * alpha);
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.stroke();
    }
    g.shadowBlur = 0;
  }

  private drawBurst(age: number): void {
    const g = this.g;
    const t = age / BURST;
    const e = easeOut(Math.min(1, t * 1.6));
    const x = this.burstX;
    const y = this.burstY;
    const fade = 1 - t;
    g.shadowColor = this.burstColor;
    g.shadowBlur = 12;
    g.strokeStyle = this.burstColor;
    g.globalAlpha = fade;
    // Shock ring.
    g.lineWidth = 3 * (1 - e) + 0.5;
    g.beginPath();
    g.arc(x, y, R0 + 46 * e, 0, Math.PI * 2);
    g.stroke();
    // Sparks.
    g.lineWidth = 2;
    g.lineCap = 'round';
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.3;
      const r1 = R0 + 8 + 44 * e;
      const r2 = r1 + 12 * (1 - e) + 2;
      g.beginPath();
      g.moveTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
      g.lineTo(x + Math.cos(a) * r2, y + Math.sin(a) * r2);
      g.stroke();
    }
    // The grade, rising from the contact point.
    if (this.burstText) {
      const rise = 26 + 22 * easeOut(Math.min(1, t * 1.3));
      const pop = 1 + 0.35 * (1 - easeOut(Math.min(1, t * 4)));
      g.globalAlpha = t < 0.6 ? 1 : Math.max(0, 1 - (t - 0.6) / 0.4);
      g.font = `italic 800 ${Math.round(24 * pop)}px ${DISPLAY}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.shadowBlur = 14;
      g.lineWidth = 4;
      g.strokeStyle = 'rgba(6,8,12,0.75)';
      g.shadowColor = 'rgba(0,0,0,0.6)';
      const label = this.burstText.toUpperCase();
      g.strokeText(label, x, y - rise);
      g.shadowColor = this.burstColor;
      g.fillStyle = this.burstColor;
      g.fillText(label, x, y - rise);
    }
    g.globalAlpha = 1;
    g.shadowBlur = 0;
  }
}
