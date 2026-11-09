// The umpire's voice and captions (M7 phase E): each call from game/umpire.ts spoken by the browser's own speech
// (Web Speech API, local voices only: `localService`, so no words leave the machine) and/or written on screen. With
// no local voice for the language the calls are captions only. The captions are hidden from screen readers, which
// hear the score from ui/announce.ts.
import type { CallSink, UmpireLang } from '../game/umpire.ts';

/** How long a caption stays (s), at the least; longer calls stay longer. */
const CAPTION_MIN = 2.2;
const CAPTION_PER_CHAR = 0.05;

/** A local voice for the language, the umpire's own country's first (en-GB, es-ES), else null. */
export function pickVoice(voices: readonly SpeechSynthesisVoice[], lang: UmpireLang): SpeechSynthesisVoice | null {
  const local = voices.filter((v) => v.localService && v.lang.toLowerCase().replace('_', '-').startsWith(lang));
  const home = lang === 'en' ? 'en-gb' : 'es-es';
  return local.find((v) => v.lang.toLowerCase().replace('_', '-') === home) ?? local[0] ?? null;
}

export class UmpireVoice implements CallSink {
  speak: boolean;
  captions: boolean;
  volume: number;
  private lang: UmpireLang;
  private readonly el: HTMLElement;
  private timer = 0;
  private voice: SpeechSynthesisVoice | null = null;
  private readonly synth: SpeechSynthesis | null;
  private readonly onVoices = (): void => { this.voice = this.synth ? pickVoice(this.synth.getVoices(), this.lang) : null; };

  constructor(root: HTMLElement, lang: UmpireLang, speak: boolean, captions: boolean, volume = 1) {
    this.lang = lang;
    this.speak = speak;
    this.captions = captions;
    this.volume = volume;
    this.synth = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
    // (the voices list fills in after the page loads in some browsers)
    this.onVoices();
    this.synth?.addEventListener('voiceschanged', this.onVoices);
    this.el = document.createElement('div');
    this.el.className = 'umpire-caption';
    this.el.setAttribute('aria-hidden', 'true');
    this.el.style.cssText = 'position:absolute;left:50%;bottom:11vh;transform:translateX(-50%);max-width:70vw;padding:.35em .8em;'
      + 'border-radius:6px;background:rgba(8,10,14,.72);color:#f4f6f8;font:600 calc(17px * var(--ui-scale, 1))/1.3 system-ui, sans-serif;'
      + 'text-align:center;letter-spacing:.01em;pointer-events:none;opacity:0;transition:opacity .25s;z-index:5';
    root.appendChild(this.el);
  }

  /** The language changed mid-match. */
  setLang(lang: UmpireLang): void {
    this.lang = lang;
    this.onVoices();
  }

  /** Whether a call can be heard (a local voice for the language). */
  get voiced(): boolean {
    return !!this.voice;
  }

  call(text: string): void {
    if (this.captions) {
      this.el.textContent = text;
      this.el.style.opacity = '1';
      clearTimeout(this.timer);
      this.timer = window.setTimeout(() => { this.el.style.opacity = '0'; }, 1000 * Math.max(CAPTION_MIN, text.length * CAPTION_PER_CHAR));
    }
    if (this.speak && this.synth && this.voice) {
      const u = new SpeechSynthesisUtterance(text);
      u.voice = this.voice;
      u.lang = this.voice.lang;
      u.volume = this.volume;
      u.rate = 1.02;
      this.synth.speak(u);
    }
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.synth?.removeEventListener('voiceschanged', this.onVoices);
    // (only our own calls are queued on the page's speech)
    if (this.speak) this.synth?.cancel();
    this.el.remove();
  }
}
