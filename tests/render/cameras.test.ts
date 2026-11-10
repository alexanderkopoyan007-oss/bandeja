// The match cameras (M7 phase A): the side and dynamic rigs beside the end cameras. Steering is checked against each
// camera's own picture (its screen right and screen up, from its matrix), not against the table that produces it.
// Smoothness is measured over AI matches: how fast the view turns and how fast that turn rate changes, in rallies
// only (the cut-aways between points and the change-of-ends swing are cuts and moves by design).
import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { MatchSim, PH_RALLY } from '../../src/sim/match.ts';
import { BroadcastCamera, CAMERA_PRESETS, type CameraPreset } from '../../src/render/views.ts';
import { axisFlip, turnStick } from '../../src/game/locals.ts';

const NONE = [null, null, null, null];

/** The world step a stick push makes for a player of `team` (the sim's axes: dx = moveX * side, dz = -moveY * side). */
function worldStep(cam: BroadcastCamera, sim: MatchSim, team: number, cameraTeam: number, sx: number, sy: number): { x: number; z: number } {
  const f = { moveX: 0, moveY: 0 };
  if (cam.rig !== 'side') {
    const flip = axisFlip(team, cameraTeam);
    f.moveX = sx * flip;
    f.moveY = sy * flip;
  } else turnStick(f, sx, sy, cam.steerTurn(team, cameraTeam, sim.side(team)));
  const s = sim.side(team);
  return { x: f.moveX * s, z: -f.moveY * s };
}

describe('steering follows the picture', () => {
  for (const preset of ['tv', 'player', 'side', 'dynamic', 'court', 'close', 'glass'] as CameraPreset[]) {
    for (const sideX of [1, -1]) {
      it(`${preset}, camera on ${sideX > 0 ? '+' : '-'}x: right is screen right, up is into the screen, for both teams at both ends`, () => {
        const sim = new MatchSim({ seed: 3, doubles: true, human: [true, false, false, false] });
        const cam = new BroadcastCamera(16 / 9, 0, sideX);
        cam.setPreset(preset);
        for (const ends of [0, 1]) {
          // (the teams' ends as the sim has them, and after they change: the side() a team has flips)
          const flipEnds = ends === 1;
          const side = (t: number): number => (flipEnds ? -sim.side(t) : sim.side(t));
          const cameraTeam = 0;
          // The camera placed as the match would have it for team 0's end (the match seen through `side`).
          const view = Object.create(sim) as MatchSim;
          Object.defineProperty(view, 'side', { value: side });
          cam.retake();
          // (an end camera swings round over 1.6 s at a change of ends: let it finish)
          cam.update(view, cameraTeam, null, 10 * ends);
          cam.update(view, cameraTeam, null, 10 * ends + 5);
          cam.camera.updateMatrixWorld();
          const e = cam.camera.matrixWorld.elements;
          const right = { x: e[0]!, z: e[2]! };
          const into = { x: -e[8]!, z: -e[10]! };
          for (const team of [0, 1]) {
            const r = worldStep(cam, view, team, cameraTeam, 1, 0);
            const u = worldStep(cam, view, team, cameraTeam, 0, 1);
            // The end cameras: the far team's player steers as the screen shows them too (axisFlip).
            expect(r.x * right.x + r.z * right.z, `team ${team} right`).toBeGreaterThan(0.9);
            expect(u.x * into.x + u.z * into.z, `team ${team} up`).toBeGreaterThan(0.9 * Math.hypot(into.x, into.z));
          }
        }
      });
    }
  }

  it('turned sticks stay exact and never make a -0', () => {
    const f = { moveX: 1, moveY: 1 };
    for (const turn of [1, 3]) for (const sx of [-1, -0, 0, 0.5, 1]) for (const sy of [-1, -0, 0, 0.25, 1]) {
      turnStick(f, sx, sy, turn);
      const want = turn === 1 ? [-sy, sx] : [sy, -sx];
      expect(Math.abs(f.moveX)).toBe(Math.abs(want[0]!));
      expect(Math.abs(f.moveY)).toBe(Math.abs(want[1]!));
      expect(Object.is(f.moveX, -0) || Object.is(f.moveY, -0)).toBe(false);
    }
  });
});

interface Motion { turnMax: number; turnP99: number; accelP99: number; moveMax: number; frames: number; inside: boolean; lowest: number }

/** An AI match drawn at 60 Hz through a camera rig, rallies only: turn rate (deg/s) and its change (deg/s²), and how
 * fast the camera itself moves (m/s). */
function measure(preset: CameraPreset, seed: number, secs: number): Motion {
  BroadcastCamera.cutaways = false;
  const sim = new MatchSim({ seed, doubles: true, human: [false, false, false, false], aiLevel: [0.8, 0.8] });
  const cam = new BroadcastCamera(16 / 9, 0, 1);
  cam.setPreset(preset);
  cam.followPlayer = 0;
  const ball = new THREE.Vector3();
  const fwd = new THREE.Vector3(), last = new THREE.Vector3(), pos = new THREE.Vector3(), lastPos = new THREE.Vector3();
  const turns: number[] = [], accels: number[] = [];
  let lastTurn = -1, moveMax = 0, frames = 0, wasLive = false, inside = true, lowest = Infinity;
  const court = sim.world.court;
  const dt = 1 / 60;
  for (let k = 0; k < secs * 120; k++) {
    sim.step(NONE);
    if (k % 2) continue;
    ball.set(sim.ball.pos.x, sim.ball.pos.y, sim.ball.pos.z);
    cam.update(sim, 0, ball, sim.time);
    cam.camera.updateMatrixWorld();
    cam.camera.getWorldDirection(fwd);
    pos.copy(cam.camera.position);
    // (the court cameras may stand up to 1.4 m behind the back glass, never past the side glass)
    if (Math.abs(pos.x) > court.halfW || Math.abs(pos.z) > court.halfL + 1.4 + 1e-9) inside = false;
    lowest = Math.min(lowest, pos.y);
    const live = sim.phase === PH_RALLY && !cam.swinging;
    if (live && wasLive) {
      const turn = (Math.acos(Math.min(1, Math.max(-1, fwd.dot(last)))) * 180) / Math.PI / dt;
      turns.push(turn);
      if (lastTurn >= 0) accels.push(Math.abs(turn - lastTurn) / dt);
      lastTurn = turn;
      moveMax = Math.max(moveMax, pos.distanceTo(lastPos) / dt);
      frames++;
    } else lastTurn = -1;
    wasLive = live;
    last.copy(fwd);
    lastPos.copy(pos);
  }
  BroadcastCamera.cutaways = true;
  const q = (v: number[], p: number): number => { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0; };
  return { turnMax: Math.max(...turns), turnP99: q(turns, 0.99), accelP99: q(accels, 0.99), moveMax, frames, inside, lowest };
}

describe('the cameras move smoothly', () => {
  const rigs = Object.keys(CAMERA_PRESETS) as CameraPreset[];
  const got: Record<string, Motion> = {};
  for (const preset of rigs) got[preset] = measure(preset, 41, 150);
  it('prints each rig', () => {
    for (const preset of rigs) {
      const m = got[preset]!;
      console.log(`${preset.padEnd(8)} turn max ${m.turnMax.toFixed(1)} p99 ${m.turnP99.toFixed(1)} deg/s, turn change p99 ${m.accelP99.toFixed(0)} deg/s², moves up to ${m.moveMax.toFixed(2)} m/s (${m.frames} rally frames)`);
    }
    expect(got.tv!.frames).toBeGreaterThan(1000);
  });
  // Measured at M7 phase A (seed 41, 150 s): the end cameras turn at most 8-9 deg/s with a p99 change of 21-28
  // deg/s²; the side camera, 16 m out panning 0.2 of the ball's z, 10 and 22 (at 9 m out panning 0.45 it was 25 and
  // 61); the dynamic camera 17 and 41. The limits leave room for other matches and hold every rig to a broadcast
  // operator's pace.
  // The court cameras (court, close) are a third-person camera on the court a few metres behind the player: measured
  // (seed 41, 150 s) 24-25 deg/s at most, a p99 change of 77 deg/s², moving up to 4.2-4.3 m/s (the player runs
  // faster). Their own limits: slower than a head turns and than the player runs.
  it('turn at an operator’s pace', () => {
    for (const preset of rigs) {
      const m = got[preset]!;
      const near = CAMERA_PRESETS[preset].rig === 'court';
      expect(m.turnMax, `${preset} turn`).toBeLessThan(near ? 40 : preset === 'dynamic' ? 22 : 14);
      expect(m.accelP99, `${preset} turn change`).toBeLessThan(near ? 130 : 60);
      expect(m.moveMax, `${preset} speed`).toBeLessThan(near ? 5 : 2);
    }
  });
  it('the court cameras stay on the court or just behind its back glass, above the players\' heads; the glass camera is a tripod', () => {
    for (const preset of ['court', 'close'] as CameraPreset[]) {
      expect(got[preset]!.inside, `${preset} inside the glass`).toBe(true);
      expect(got[preset]!.lowest, `${preset} lowest`).toBeGreaterThan(1.8);
    }
    expect(got.glass!.moveMax).toBe(0);
    expect(got.glass!.turnMax).toBe(0);
  });
  it('the side camera stands still and pans; the dynamic one moves with the player, slower than they run', () => {
    expect(got.side!.moveMax).toBe(0);
    expect(got.dynamic!.moveMax).toBeGreaterThan(0.3);
  });
});

describe('the title\'s establishing shots', () => {
  it('arc slowly round the court between points, from a new place each time, and cut back for the serve', () => {
    const sim = new MatchSim({ seed: 9, doubles: true, human: [false, false, false, false], aiLevel: [0.8, 0.8] });
    const cam = new BroadcastCamera(16 / 9, 0, 1);
    cam.establish = true;
    // The same match through the match camera alone: in play both must show the same.
    const plain = new BroadcastCamera(16 / 9, 0, 1);
    const ball = new THREE.Vector3();
    const fwd = new THREE.Vector3(), last = new THREE.Vector3(), toMid = new THREE.Vector3();
    const court = sim.world.court;
    const starts: THREE.Vector3[] = [];
    let wasWalking = false, turnMax = 0, frames = 0, aimWorst = 1, inPlayOff = 0;
    for (let k = 0; k < 160 * 120; k++) {
      sim.step(NONE);
      if (k % 2) continue;
      ball.set(sim.ball.pos.x, sim.ball.pos.y, sim.ball.pos.z);
      cam.update(sim, 0, ball, sim.time);
      plain.update(sim, 0, ball, sim.time);
      cam.camera.updateMatrixWorld();
      cam.camera.getWorldDirection(fwd);
      const p = cam.camera.position;
      const walking = sim.walking > 0;
      if (walking) {
        if (!wasWalking) starts.push(p.clone());
        else {
          turnMax = Math.max(turnMax, (Math.acos(Math.min(1, fwd.dot(last))) * 180) / Math.PI * 60);
          frames++;
        }
        // Outside the cage, high over the court, looking at its middle.
        expect(Math.abs(p.x) > court.halfW + 4 || Math.abs(p.z) > court.halfL + 4).toBe(true);
        expect(p.y).toBeGreaterThan(5);
        toMid.set(-p.x, 0.4 - p.y, -p.z).normalize();
        aimWorst = Math.min(aimWorst, fwd.dot(toMid));
      } else if (sim.phase === PH_RALLY) inPlayOff = Math.max(inPlayOff, p.distanceTo(plain.camera.position));
      wasWalking = walking;
      last.copy(fwd);
    }
    console.log(`establishing: ${starts.length} shots, ${frames} frames, turn max ${turnMax.toFixed(1)} deg/s`);
    expect(starts.length).toBeGreaterThan(4);
    expect(turnMax).toBeLessThan(6);
    expect(aimWorst).toBeGreaterThan(0.999);
    for (let i = 1; i < starts.length; i++) expect(starts[i]!.distanceTo(starts[i - 1]!)).toBeGreaterThan(5);
    expect(inPlayOff).toBeLessThan(1e-9);
  });
});
