// ?lab=ball: the ball test lab in the browser. Every lab shot (src/sim/lab/ballLab.ts) replayed on the court
// with its trail, its contacts marked (glass cyan, mesh orange, floor white), the random runs of the noisy
// surfaces drawn faintly, and the measured numbers beside it. Arrow keys or the list pick a shot; drag to orbit.
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildCourtView } from '../render/courtView.ts';
import { NetView } from '../render/netView.ts';
import { makeWorld, makeNetCloth } from '../sim/setup.ts';
import { Rng } from '../sim/core/rng.ts';
import { HIT_FLOOR } from '../sim/ball/ball.ts';
import { SURF_GLASS, SURF_MESH } from '../sim/court/court.ts';
import { runLab, runShot, type ShotSummary } from '../sim/lab/ballLab.ts';

const SURF_COLOR: Record<number, number> = { [SURF_GLASS]: 0x4fd3ff, [SURF_MESH]: 0xff9a3c };

export async function startBallLab(renderer: THREE.WebGPURenderer, hud: HTMLElement): Promise<void> {
  const world = makeWorld();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d0f12);
  scene.add(new THREE.HemisphereLight(0xdfe8f0, 0x30343a, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.0);
  sun.position.set(5, 15, 7);
  scene.add(sun);
  scene.add(buildCourtView(world.court));
  const net = new NetView(makeNetCloth(world));
  scene.add(net.group);

  const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.05, 200);
  camera.position.set(-9, 6, 16);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(1, 1, 7);
  controls.update();

  const results = runLab();
  const layer = new THREE.Group();
  scene.add(layer);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(world.spec.radius * 1.6, 16, 12), new THREE.MeshStandardMaterial({ color: 0xd8f03a, emissive: 0x3a4410 }));
  scene.add(ball);

  // Panel: shot list and the selected shot's numbers.
  const panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;left:12px;top:12px;bottom:12px;width:min(440px,calc(100vw - 24px));overflow:auto;'
    + 'background:rgba(10,12,16,.82);color:#e8edf2;font:12px/1.45 system-ui,sans-serif;padding:10px 12px;border-radius:8px;';
  hud.appendChild(panel);
  let sel = 0;
  let pathPts: number[] = [];
  let t0 = performance.now();

  const f = (v: number, d = 2): string => (Number.isFinite(v) ? v.toFixed(d) : '-');
  const describe = (s: ShotSummary): string => {
    const rows = s.run.contacts.map((c) => {
      const what = c.kind === HIT_FLOOR ? 'floor' : c.surface === SURF_GLASS ? 'glass' : c.surface === SURF_MESH ? 'mesh' : 'wall';
      return `<tr><td>${what}</td><td>${f(c.speedIn, 1)}→${f(c.speedOut, 1)}</td><td>${f(c.en)}</td><td>${f(c.angIn, 0)}→${f(c.angOut, 0)}°</td><td>${f(c.ex)}</td><td>${f(c.rollIn, 0)}→${f(c.rollOut, 0)}</td></tr>`;
    }).join('');
    let extra = '';
    if (s.glass) {
      const g = s.glass;
      extra += `<p>Off the glass: meets it at ${f(g.heightAtGlass)} m, ${f(g.speedIntoGlass, 1)}→${f(g.speedOff, 1)} m/s, `
        + `rises to ${f(g.apexAfterGlass)} m, ${f(g.heightAt1m)} m high 1 m out, next bounce ${f(g.comesBack, 1)} m from the glass.</p>`;
    }
    if (s.stats) {
      const st = s.stats;
      extra += `<p>${st.n} runs: e_n ${f(st.en[0])} ± ${f(st.en[1])}, off the mirror path ${f(st.deflect[0], 1)} ± ${f(st.deflect[1], 1)}°.</p>`;
    }
    if (s.shot.id.startsWith('drop')) extra += `<p>Rebound ${f((s.run.apexAfter - world.spec.radius) * 100, 1)} cm (FIP: 135-145 cm on a hard floor).</p>`;
    return `<h3 style="margin:6px 0 4px;font-size:14px">${s.shot.label}</h3>`
      + '<table style="border-collapse:collapse;width:100%"><tr style="opacity:.7"><td>contact</td><td>m/s</td><td>e_n</td><td>angle</td><td>e_x</td><td>roll rpm</td></tr>'
      + rows + '</table>' + extra;
  };

  const show = (i: number): void => {
    sel = (i + results.length) % results.length;
    layer.clear();
    const s = results[sel]!;
    const drawPath = (p: number[], color: number, opacity: number): void => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      layer.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity })));
    };
    // The random runs, faintly: the spread a noisy surface gives.
    if ((s.shot.runs ?? 1) > 1) {
      const rng = new Rng(4242);
      for (let k = 0; k < 40; k++) drawPath(runShot(s.shot, world, rng).path, 0xffffff, 0.18);
    }
    drawPath(s.run.path, 0xd8f03a, 1);
    for (const c of s.run.contacts) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshBasicMaterial({ color: c.kind === HIT_FLOOR ? 0xffffff : SURF_COLOR[c.surface] ?? 0xff4060 }));
      m.position.set(c.x, c.y, c.z);
      layer.add(m);
    }
    pathPts = s.run.path;
    t0 = performance.now();
    let group = '';
    let list = '<p style="opacity:.75;margin:0 0 6px">Ball lab: ←/→ or click a shot; drag to orbit. Yellow: the shot; white: random runs.</p>';
    results.forEach((r, k) => {
      if (r.shot.group !== group) { group = r.shot.group; list += `<div style="margin-top:8px;opacity:.6;text-transform:uppercase;font-size:11px">${group}</div>`; }
      list += `<div data-k="${k}" style="cursor:pointer;padding:1px 4px;border-radius:4px;${k === sel ? 'background:#2c3a4a' : ''}">${r.shot.id}</div>`;
    });
    panel.innerHTML = describe(s) + '<hr style="border-color:#334">' + list;
  };
  panel.addEventListener('click', (e) => {
    const k = (e.target as HTMLElement).dataset.k;
    if (k !== undefined) show(Number(k));
  });
  addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') show(sel + 1);
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') show(sel - 1);
  });
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
  const params = new URLSearchParams(location.search);
  const first = results.findIndex((r) => r.shot.id === params.get('shot'));
  show(first >= 0 ? first : 0);
  (window as unknown as { __ballLab: unknown }).__ballLab = { results, show, select: () => sel };

  renderer.setAnimationLoop(() => {
    // Replay at real speed, looping with a pause at the end.
    const n = pathPts.length / 3;
    const k = Math.min(n - 1, Math.floor(((performance.now() - t0) / 1000) * 120) % (n + 60));
    const i = Math.min(k, n - 1) * 3;
    ball.position.set(pathPts[i]!, pathPts[i + 1]!, pathPts[i + 2]!);
    controls.update();
    renderer.render(scene, camera);
  });
}
