// Which of three's two backends the page runs on, and what a WebGPU failure does.
//
// Safari's WebGPU can lose its device while the game loads (friends' Macs, 4 Nov 2026, the plain link: "Compiling
// shaders", then "Range consisting of offset and length are out of bounds"). three carries on with the dead device,
// and in Safari a buffer made on a lost device maps to an empty range, so the first vertex buffer three fills throws
// that RangeError (reproduced in Safari 27 by destroying the device before filling a buffer). WebGL 2 runs the same
// game, so a WebGPU failure while loading starts the page again on WebGL 2, and this browser keeps WebGL 2 until its
// user agent changes (an update may have fixed it). A device lost during play stops three drawing: the player is told,
// and Try again starts on WebGL 2. ?backend=webgl always runs WebGL 2; ?backend=webgpu tries WebGPU whatever is stored.

import type * as THREE from 'three/webgpu';

const KEY = 'bandeja.webgpu-failed';

/** What a failure leaves in storage: the browser it happened in, why, and when. */
interface Failure {
  ua: string;
  why: string;
  at: string;
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

/** localStorage, or null where reading it throws (blocked storage). */
function local(): Store | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Why WebGPU failed in this browser before, or null if it hasn't (or nothing can be read). */
export function lastFailure(ua: string = navigator.userAgent, store: Store | null = local()): string | null {
  try {
    const f = JSON.parse(store?.getItem(KEY) ?? 'null') as Failure | null;
    return f && f.ua === ua && typeof f.why === 'string' ? f.why : null;
  } catch {
    return null;
  }
}

/** Remember that WebGPU failed in this browser. False if it can't be stored. */
export function rememberFailure(why: string, ua: string = navigator.userAgent, store: Store | null = local()): boolean {
  try {
    if (!store) return false;
    const f: Failure = { ua, why: why.slice(0, 300), at: new Date().toISOString() };
    store.setItem(KEY, JSON.stringify(f));
    return true;
  } catch {
    return false;
  }
}

/** Should the renderer start on WebGL 2? */
export function wantWebGL(params: URLSearchParams, ua: string = navigator.userAgent, store: Store | null = local()): boolean {
  const asked = params.get('backend');
  if (asked === 'webgl') return true;
  if (asked === 'webgpu') return false;
  return lastFailure(ua, store) !== null;
}

/** Is this renderer drawing with WebGPU (not three's WebGL 2 backend)? */
export function onWebGPU(renderer: THREE.WebGPURenderer): boolean {
  return (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
}

/** Start the page again on WebGL 2: from storage if the failure was stored, else from the URL. */
function restartOnWebGL(stored: boolean): void {
  if (stored) {
    location.reload();
    return;
  }
  const u = new URL(location.href);
  u.searchParams.set('backend', 'webgl');
  location.replace(u.href);
}

/**
 * Watches a WebGPU renderer. While nothing is at stake (`canRestart`: a loading screen, the title's match), a failure
 * starts the page again on WebGL 2 by itself; a device lost during a match calls `onLostLater` instead (three draws
 * nothing more on a lost device).
 */
export class BackendGuard {
  /** Can the page start again without losing anything (no match under way)? */
  canRestart: () => boolean = () => true;
  /** Shown while the page restarts (the loading screen's stage line). */
  onRestart: (why: string) => void = () => undefined;
  /** The device was lost during play or on a menu. */
  onLostLater: (why: string) => void = () => undefined;
  /** How the page starts again (tests replace it). */
  restart: (stored: boolean) => void = restartOnWebGL;
  private restarting = false;
  private readonly renderer: THREE.WebGPURenderer;
  private readonly params: URLSearchParams;
  private readonly ua: string;
  private readonly store: Store | null;

  constructor(renderer: THREE.WebGPURenderer, params: URLSearchParams, ua: string = navigator.userAgent, store: Store | null = local()) {
    this.renderer = renderer;
    this.params = params;
    this.ua = ua;
    this.store = store;
    if (!onWebGPU(renderer)) return;
    // three's own handler stays (it logs and stops drawing); a device we destroyed ourselves never gets here.
    const base = renderer.onDeviceLost;
    renderer.onDeviceLost = (info) => {
      base.call(renderer, info);
      const why = `WebGPU device lost: ${info.message || 'no message'}${info.reason ? ` (${info.reason})` : ''}`;
      if (this.failed(why)) return;
      if (this.canRestart()) return; // (?backend=webgpu: the build's own error says what happened)
      if (this.params.get('backend') !== 'webgpu') rememberFailure(why, this.ua, this.store);
      this.onLostLater(why);
    };
  }

  /**
   * WebGPU failed (a lost device, or an error out of the warm-up). With nothing at stake, and unless the URL asks for
   * WebGPU, the page starts again on WebGL 2 and this returns true: the caller stops where it is.
   */
  failed(why: string): boolean {
    if (!this.canRestart() || !onWebGPU(this.renderer) || this.params.get('backend') === 'webgpu') return false;
    if (this.restarting) return true;
    this.restarting = true;
    console.warn(`BANDEJA: ${why}. Starting again on WebGL 2.`);
    this.onRestart(why);
    this.restart(rememberFailure(why, this.ua, this.store));
    return true;
  }
}
