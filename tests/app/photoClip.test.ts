// Photo mode's free camera and the clip format choice (M7 phase C).
import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { PhotoCamera, PHOTO, noPush } from '../../src/game/photoMode.ts';
import { clipType, clipExt, clipBitrate, fileStem, CLIP_TYPES } from '../../src/game/clipRecorder.ts';

function matchCamera(): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera(26, 16 / 9, 0.1, 300);
  c.position.set(0, 7.6, 25.5);
  c.lookAt(0, 0.35, -1.1);
  c.updateMatrixWorld();
  return c;
}

describe('the photo camera', () => {
  it('starts from the match camera\'s view', () => {
    const cam = matchCamera();
    const at = new THREE.Vector3(1, 1, 3);
    const p = new PhotoCamera(cam, at, 1);
    const out = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 300);
    p.apply(out);
    expect(out.position.distanceTo(cam.position)).toBeLessThan(1e-6);
    expect(out.fov).toBe(26);
    // It looks at the point.
    out.updateMatrixWorld();
    const dir = new THREE.Vector3();
    out.getWorldDirection(dir);
    const want = at.clone().sub(out.position).normalize();
    expect(dir.dot(want)).toBeGreaterThan(0.9999);
  });

  it('moves the point as the picture shows it, and keeps every limit', () => {
    const p = new PhotoCamera(matchCamera(), new THREE.Vector3(0, 1, 0), 1);
    const out = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 300);
    p.apply(out);
    out.updateMatrixWorld();
    const right = new THREE.Vector3().setFromMatrixColumn(out.matrixWorld, 0);
    const before = p.target.clone();
    const push = noPush();
    push.moveX = 1;
    p.step(push, 0.2);
    const moved = p.target.clone().sub(before);
    expect(moved.length()).toBeGreaterThan(0.1);
    expect(moved.normalize().dot(right)).toBeGreaterThan(0.999);
    // Pushed hard for a long time every way: still inside the limits, and never under the floor.
    const all = noPush();
    Object.assign(all, { orbitX: 1, orbitY: 1, moveX: 1, moveZ: 1, rise: -1, zoom: -1, lens: 1, expo: 1 });
    for (let k = 0; k < 600; k++) p.step(all, 1 / 30);
    expect(p.pitch).toBeLessThanOrEqual(PHOTO.pitch[1]);
    expect(p.dist).toBeLessThanOrEqual(PHOTO.dist[1]);
    expect(p.fov).toBeLessThanOrEqual(PHOTO.fov[1]);
    expect(p.exposure).toBeLessThanOrEqual(PHOTO.exposure[1]);
    expect(Math.abs(p.target.x)).toBeLessThanOrEqual(PHOTO.reachX);
    expect(Math.abs(p.target.z)).toBeLessThanOrEqual(PHOTO.reachZ);
    expect(p.target.y).toBeGreaterThanOrEqual(PHOTO.height[0]);
    Object.assign(all, { orbitY: -1, zoom: 1, lens: -1, expo: -1 });
    for (let k = 0; k < 600; k++) p.step(all, 1 / 30);
    expect(p.pitch).toBeGreaterThanOrEqual(PHOTO.pitch[0]);
    expect(p.dist).toBeGreaterThanOrEqual(PHOTO.dist[0]);
    expect(p.fov).toBeGreaterThanOrEqual(PHOTO.fov[0]);
    expect(p.exposure).toBeGreaterThanOrEqual(PHOTO.exposure[0]);
    p.apply(out);
    expect(out.position.y).toBeGreaterThanOrEqual(0.15);
  });
});

describe('clip files', () => {
  it('take the best format the browser records', () => {
    expect(clipType(() => true)).toBe(CLIP_TYPES[0]);
    expect(clipType((t) => t.startsWith('video/webm'))).toBe('video/webm;codecs=vp9,opus');
    expect(clipType(() => false)).toBeNull();
    expect(clipExt('video/mp4;codecs=avc1')).toBe('mp4');
    expect(clipExt('video/webm;codecs=vp9,opus')).toBe('webm');
  });

  it('get a bitrate by size, and a name by the time', () => {
    expect(clipBitrate(1920, 1080)).toBe(14929920);
    expect(clipBitrate(640, 360)).toBe(8e6);
    expect(clipBitrate(3840, 2160)).toBe(24e6);
    expect(fileStem('photo', new Date(2026, 10, 9, 17, 5))).toBe('bandeja-photo-2026-11-09-1705');
  });
});
