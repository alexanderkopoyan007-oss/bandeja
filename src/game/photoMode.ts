// Photo mode (M7 phase C, the brief's "Photo mode"): from the pause menu the match stands still and a free camera goes
// anywhere round it. It orbits a point, comes closer or goes further, and the point moves about the court and up and
// down. The lens goes wider or longer and the picture brighter or darker. The HUD and the cues are hidden, and "Save
// photo" writes the next frame drawn as a PNG the browser downloads (game.ts). Nothing here touches the match.
//
// Keys: arrows orbit, W A S D move the point, R and F raise and lower it, the wheel or Z and X come closer and go
// back, 1 and 2 the lens, 3 and 4 the exposure, P (or Enter) saves, Escape goes back to the pause menu. A drag with
// the mouse orbits. A pad: the left stick moves the point, the right orbits, the triggers zoom, the shoulders the
// lens, the d-pad's up and down the exposure, Y saves, B goes back.
import * as THREE from 'three/webgpu';

/** Limits: how far the camera stands from its point (m), its pitch (rad, from level), the point's reach (m from the
 * court's middle, and up), the lens (vertical degrees) and the exposure (tone mapping's, a factor). */
export const PHOTO = {
  dist: [0.8, 48] as const,
  pitch: [-0.25, 1.45] as const,
  reachX: 22,
  reachZ: 30,
  height: [0.05, 12] as const,
  fov: [12, 80] as const,
  exposure: [0.4, 2.5] as const,
  /** Rates: orbit (rad/s at full push), move (as a share of the distance a second, at least MOVE_MIN m/s), rise (m/s),
   * zoom (e-folds a second), lens (deg/s), exposure (e-folds a second), and a drag's turn (rad per pixel). */
  orbit: 1.4,
  move: 0.9,
  moveMin: 1.5,
  rise: 2.5,
  zoom: 1.2,
  lens: 25,
  expo: 0.8,
  drag: 0.006,
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** What the controls ask for this frame (each -1..1). */
export interface PhotoPush {
  orbitX: number;
  orbitY: number;
  moveX: number;
  moveZ: number;
  rise: number;
  zoom: number;
  lens: number;
  expo: number;
}

export function noPush(): PhotoPush {
  return { orbitX: 0, orbitY: 0, moveX: 0, moveZ: 0, rise: 0, zoom: 0, lens: 0, expo: 0 };
}

export class PhotoCamera {
  /** Round the point (rad: 0 looks along -z), above level (rad), and how far (m). */
  yaw = 0;
  pitch = 0.4;
  dist = 12;
  readonly target = new THREE.Vector3();
  fov = 40;
  exposure = 1;

  /** Starting where `camera` is, looking at `at` (the match camera's view: the photo starts from what was on screen). */
  constructor(camera: THREE.PerspectiveCamera, at: THREE.Vector3, exposure: number) {
    this.target.copy(at);
    this.target.x = clamp(this.target.x, -PHOTO.reachX, PHOTO.reachX);
    this.target.z = clamp(this.target.z, -PHOTO.reachZ, PHOTO.reachZ);
    this.target.y = clamp(this.target.y, PHOTO.height[0], PHOTO.height[1]);
    const dx = camera.position.x - this.target.x, dy = camera.position.y - this.target.y, dz = camera.position.z - this.target.z;
    this.dist = clamp(Math.hypot(dx, dy, dz), PHOTO.dist[0], PHOTO.dist[1]);
    this.pitch = clamp(Math.atan2(dy, Math.hypot(dx, dz)), PHOTO.pitch[0], PHOTO.pitch[1]);
    this.yaw = Math.atan2(dx, dz);
    this.fov = clamp(camera.fov, PHOTO.fov[0], PHOTO.fov[1]);
    this.exposure = clamp(exposure, PHOTO.exposure[0], PHOTO.exposure[1]);
  }

  /** A frame's controls over `dt` s. */
  step(p: PhotoPush, dt: number): void {
    if (dt <= 0) return;
    this.yaw += p.orbitX * PHOTO.orbit * dt;
    this.pitch = clamp(this.pitch + p.orbitY * PHOTO.orbit * dt, PHOTO.pitch[0], PHOTO.pitch[1]);
    this.dist = clamp(this.dist * Math.exp(-p.zoom * PHOTO.zoom * dt), PHOTO.dist[0], PHOTO.dist[1]);
    // The point moves as the picture shows it: right is the screen's right, up the stick away from you.
    const v = Math.max(PHOTO.moveMin, this.dist * PHOTO.move) * dt;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    this.target.x = clamp(this.target.x + (p.moveX * cy - p.moveZ * sy) * v, -PHOTO.reachX, PHOTO.reachX);
    this.target.z = clamp(this.target.z + (-p.moveX * sy - p.moveZ * cy) * v, -PHOTO.reachZ, PHOTO.reachZ);
    this.target.y = clamp(this.target.y + p.rise * PHOTO.rise * dt, PHOTO.height[0], PHOTO.height[1]);
    this.fov = clamp(this.fov + p.lens * PHOTO.lens * dt, PHOTO.fov[0], PHOTO.fov[1]);
    this.exposure = clamp(this.exposure * Math.exp(p.expo * PHOTO.expo * dt), PHOTO.exposure[0], PHOTO.exposure[1]);
  }

  /** A mouse drag of (dx, dy) pixels: orbit. */
  drag(dx: number, dy: number): void {
    this.yaw -= dx * PHOTO.drag;
    this.pitch = clamp(this.pitch + dy * PHOTO.drag, PHOTO.pitch[0], PHOTO.pitch[1]);
  }

  /** A wheel's turn (its deltaY): closer for a negative one. */
  wheel(deltaY: number): void {
    this.dist = clamp(this.dist * Math.exp(deltaY * 0.0012), PHOTO.dist[0], PHOTO.dist[1]);
  }

  /** Point `camera` (never under the floor). */
  apply(camera: THREE.PerspectiveCamera): void {
    const cp = Math.cos(this.pitch);
    camera.position.set(
      this.target.x + Math.sin(this.yaw) * cp * this.dist,
      Math.max(0.15, this.target.y + Math.sin(this.pitch) * this.dist),
      this.target.z + Math.cos(this.yaw) * cp * this.dist,
    );
    camera.up.set(0, 1, 0);
    camera.lookAt(this.target);
    if (camera.fov !== this.fov) {
      camera.fov = this.fov;
      camera.updateProjectionMatrix();
    }
  }
}

/** The keys and the mouse while photo mode is on: what they push, and the one-off presses (save, leave). */
export class PhotoControls {
  private readonly down = new Set<string>();
  private readonly ac = new AbortController();
  saveAsked = false;
  leaveAsked = false;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private readonly cam: PhotoCamera;
  private padWas = 0;

  /** The keys, and a line for what happened ("Saved ..."), at the foot of the picture: never in a saved photo (HTML). */
  private readonly panel: HTMLElement;
  private readonly status: HTMLElement;

  constructor(target: Window, canvas: HTMLElement, cam: PhotoCamera) {
    this.cam = cam;
    const sig = this.ac.signal;
    this.panel = document.createElement('div');
    this.panel.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:20;padding:10px 14px;border-radius:8px;'
      + 'background:rgba(10,12,16,.62);color:#e8edf2;font:600 12px/1.6 ui-sans-serif,system-ui;pointer-events:none;max-width:560px';
    this.panel.innerHTML = '<b style="letter-spacing:.12em">PHOTO MODE</b><br>'
      + 'Arrows or drag: orbit · W A S D: move · R F: up, down · wheel or Z X: closer, further · 1 2: lens · 3 4: exposure<br>'
      + 'P or Enter: save the photo · Escape: back · Pad: sticks, triggers, shoulders, d-pad, Y saves, B back';
    this.status = document.createElement('div');
    this.status.style.cssText = 'color:#f2c14e';
    this.panel.appendChild(this.status);
    document.body.appendChild(this.panel);
    target.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') this.leaveAsked = true;
      else if (e.code === 'KeyP' || e.code === 'Enter') this.saveAsked = true;
      else this.down.add(e.code);
      e.preventDefault();
    }, { signal: sig });
    target.addEventListener('keyup', (e) => this.down.delete(e.code), { signal: sig });
    target.addEventListener('blur', () => this.down.clear(), { signal: sig });
    canvas.addEventListener('pointerdown', (e) => { this.dragging = true; this.lastX = e.clientX; this.lastY = e.clientY; }, { signal: sig });
    target.addEventListener('pointerup', () => { this.dragging = false; }, { signal: sig });
    target.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.cam.drag(e.clientX - this.lastX, e.clientY - this.lastY);
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    }, { signal: sig });
    canvas.addEventListener('wheel', (e) => { this.cam.wheel(e.deltaY); e.preventDefault(); }, { signal: sig, passive: false });
  }

  /** This frame's push, from the keys and the first standard pad (`out` filled, returned). */
  read(out: PhotoPush): PhotoPush {
    const k = (c: string): number => (this.down.has(c) ? 1 : 0);
    out.orbitX = k('ArrowRight') - k('ArrowLeft');
    out.orbitY = k('ArrowUp') - k('ArrowDown');
    out.moveX = k('KeyD') - k('KeyA');
    out.moveZ = k('KeyW') - k('KeyS');
    out.rise = k('KeyR') - k('KeyF');
    out.zoom = k('KeyZ') - k('KeyX');
    out.lens = k('Digit2') - k('Digit1');
    out.expo = k('Digit4') - k('Digit3');
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected || p.mapping !== 'standard') continue;
      const dz = (v: number | undefined): number => (v === undefined || Math.abs(v) < 0.15 ? 0 : v);
      const b = (i: number): number => p.buttons[i]?.value ?? 0;
      out.moveX += dz(p.axes[0]);
      out.moveZ -= dz(p.axes[1]);
      out.orbitX += dz(p.axes[2]);
      out.orbitY -= dz(p.axes[3]);
      out.zoom += b(7) - b(6);
      out.lens += b(5) - b(4);
      out.expo += b(12) - b(13);
      // Y saves, B leaves: on the press only.
      const held = (p.buttons[3]?.pressed ? 1 : 0) | (p.buttons[1]?.pressed ? 2 : 0);
      if (held & 1 && !(this.padWas & 1)) this.saveAsked = true;
      if (held & 2 && !(this.padWas & 2)) this.leaveAsked = true;
      this.padWas = held;
      break;
    }
    return out;
  }

  /** A line under the keys ("Saved bandeja-photo-....png"). */
  say(text: string): void {
    this.status.textContent = text;
  }

  dispose(): void {
    this.ac.abort();
    this.down.clear();
    this.panel.remove();
  }
}
