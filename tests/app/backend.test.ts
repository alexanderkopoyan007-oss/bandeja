// The backend choice and what a WebGPU failure does (render/backend.ts): Safari's lost device under the warm-up showed
// friends "Range consisting of offset and length are out of bounds" on the plain link (4 Nov 2026).
import { describe, expect, it } from 'vitest';
import type * as THREE from 'three/webgpu';
import { BackendGuard, lastFailure, rememberFailure, wantWebGL } from '../../src/render/backend.ts';

const UA = 'Mozilla/5.0 (Macintosh) Version/26.1 Safari/605.1.15';

function memory(): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) } as unknown as Storage & { data: Map<string, string> };
}

/** A renderer as far as the guard reads one: the backend's kind and three's lost-device callback. */
function fakeRenderer(webgpu: boolean) {
  const r = { backend: { isWebGPUBackend: webgpu }, lostSeen: 0, onDeviceLost(this: { lostSeen: number }) { this.lostSeen++; } };
  return r as unknown as THREE.WebGPURenderer & { lostSeen: number };
}

const lose = (r: THREE.WebGPURenderer, message = 'GPU process exited', reason: string | null = 'unknown'): void =>
  r.onDeviceLost({ api: 'WebGPU', message, reason, originalEvent: null });

describe('which backend the page starts on', () => {
  const q = (s: string) => new URLSearchParams(s);
  it('WebGPU unless the URL asks or WebGPU failed in this same browser', () => {
    const s = memory();
    expect(wantWebGL(q(''), UA, s)).toBe(false);
    expect(wantWebGL(q('backend=webgl'), UA, s)).toBe(true);
    expect(rememberFailure('lost', UA, s)).toBe(true);
    expect(lastFailure(UA, s)).toBe('lost');
    expect(wantWebGL(q(''), UA, s)).toBe(true);
    // ?backend=webgpu tries it anyway; an updated browser (another user agent) tries WebGPU again.
    expect(wantWebGL(q('backend=webgpu'), UA, s)).toBe(false);
    expect(wantWebGL(q(''), UA.replace('26.1', '26.2'), s)).toBe(false);
  });
  it('storage that is missing, broken or throwing reads as no failure', () => {
    expect(wantWebGL(new URLSearchParams(), UA, null)).toBe(false);
    const s = memory();
    s.data.set('bandeja.webgpu-failed', '{not json');
    expect(lastFailure(UA, s)).toBeNull();
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(lastFailure(UA, throwing)).toBeNull();
    expect(rememberFailure('lost', UA, throwing)).toBe(false);
    expect(rememberFailure('lost', UA, null)).toBe(false);
  });
});

describe('a WebGPU failure', () => {
  it('while loading: three still hears of it, the failure is stored and the page restarts, once', () => {
    const r = fakeRenderer(true), s = memory();
    const g = new BackendGuard(r, new URLSearchParams(), UA, s);
    const restarts: boolean[] = [];
    let said = '';
    g.restart = (stored) => restarts.push(stored);
    g.onRestart = (why) => { said = why; };
    lose(r);
    expect(r.lostSeen).toBe(1);
    expect(restarts).toEqual([true]);
    expect(said).toContain('GPU process exited');
    expect(lastFailure(UA, s)).toContain('device lost');
    // The warm-up's RangeError right after: the restart is already under way.
    expect(g.failed('the warm-up failed on WebGPU: Range consisting of offset and length are out of bounds')).toBe(true);
    expect(restarts).toEqual([true]);
  });
  it('with nowhere to store it, the restart asks for WebGL 2 in the URL (no loop)', () => {
    const r = fakeRenderer(true);
    const g = new BackendGuard(r, new URLSearchParams(), UA, null);
    const restarts: boolean[] = [];
    g.restart = (stored) => restarts.push(stored);
    expect(g.failed('warm-up')).toBe(true);
    expect(restarts).toEqual([false]);
  });
  it('during a match: no restart; the player is told and WebGL 2 is stored for Try again', () => {
    const r = fakeRenderer(true), s = memory();
    const g = new BackendGuard(r, new URLSearchParams(), UA, s);
    let restarted = false, told = '';
    g.restart = () => { restarted = true; };
    g.onLostLater = (why) => { told = why; };
    g.canRestart = () => false;
    lose(r, 'device hung');
    expect(restarted).toBe(false);
    expect(told).toContain('device hung');
    expect(wantWebGL(new URLSearchParams(), UA, s)).toBe(true);
    expect(g.failed('warm-up')).toBe(false);
  });
  it('changes nothing on WebGL 2, or when the URL asks for WebGPU', () => {
    const gl = fakeRenderer(false), s = memory();
    const a = new BackendGuard(gl, new URLSearchParams(), UA, s);
    a.restart = () => { throw new Error('no restart on WebGL 2'); };
    expect(a.failed('warm-up')).toBe(false);
    const r = fakeRenderer(true);
    const b = new BackendGuard(r, new URLSearchParams('backend=webgpu'), UA, s);
    b.restart = () => { throw new Error('no restart when WebGPU was asked for'); };
    let told = false;
    b.onLostLater = () => { told = true; };
    expect(b.failed('warm-up')).toBe(false);
    lose(r);
    expect(told).toBe(false);
    expect(lastFailure(UA, s)).toBeNull();
  });
});
