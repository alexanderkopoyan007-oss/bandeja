// Floor decals for the player cues, drawn once into canvas textures at start-up (no per-frame uploads).
// Textures are white with alpha so one texture serves every tint; meshes use additive blending, so on the
// court they read as light on the surface rather than stickers on top of it.
import * as THREE from 'three/webgpu';

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return [c, c.getContext('2d')!];
}

function texture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8; // seen at a grazing angle from the broadcast camera
  return t;
}

function glowDisc(g: CanvasRenderingContext2D, cx: number, r: number, inner: number, outer: number): void {
  const grad = g.createRadialGradient(cx, cx, 0, cx, cx, r);
  grad.addColorStop(0, `rgba(255,255,255,${inner})`);
  grad.addColorStop(0.55, `rgba(255,255,255,${(inner + outer) / 2})`);
  grad.addColorStop(1, `rgba(255,255,255,${outer})`);
  g.fillStyle = grad;
  g.beginPath();
  g.arc(cx, cx, r, 0, Math.PI * 2);
  g.fill();
}

/** Where to stand: a soft pool of light, a crisp ring and a dashed inner ring (rotated by the view). */
export function makeSpotTexture(): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = canvas(S);
  const m = S / 2;
  glowDisc(g, m, m * 0.98, 0.28, 0);
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = S * 0.028;
  g.beginPath();
  g.arc(m, m, m * 0.7, 0, Math.PI * 2);
  g.stroke();
  // Dashed inner ring: 12 dashes.
  g.lineWidth = S * 0.022;
  g.lineCap = 'round';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.beginPath();
    g.arc(m, m, m * 0.46, a, a + 0.28);
    g.stroke();
  }
  g.fillStyle = 'rgba(255,255,255,1)';
  g.beginPath();
  g.arc(m, m, S * 0.035, 0, Math.PI * 2);
  g.fill();
  return texture(c);
}

/** Aim reticle: four corner brackets on a ring, crosshair ticks, a centre dot and a faint fill. */
export function makeAimTexture(): THREE.CanvasTexture {
  const S = 512;
  const [c, g] = canvas(S);
  const m = S / 2;
  glowDisc(g, m, m * 0.62, 0.16, 0.02);
  g.strokeStyle = 'rgba(255,255,255,1)';
  g.lineCap = 'round';
  // Bracket arcs at the diagonals.
  g.lineWidth = S * 0.03;
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    g.beginPath();
    g.arc(m, m, m * 0.78, a - 0.42, a + 0.42);
    g.stroke();
  }
  // Thin full ring inside.
  g.lineWidth = S * 0.01;
  g.globalAlpha = 0.7;
  g.beginPath();
  g.arc(m, m, m * 0.6, 0, Math.PI * 2);
  g.stroke();
  // Crosshair ticks on the axes.
  g.globalAlpha = 1;
  g.lineWidth = S * 0.018;
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const cx = Math.cos(a);
    const sy = Math.sin(a);
    g.beginPath();
    g.moveTo(m + cx * m * 0.68, m + sy * m * 0.68);
    g.lineTo(m + cx * m * 0.92, m + sy * m * 0.92);
    g.stroke();
  }
  g.beginPath();
  g.arc(m, m, S * 0.04, 0, Math.PI * 2);
  g.fill();
  return texture(c);
}

/** Shot spread: a dashed circle (scaled by the power / precision modifier). */
export function makeSpreadTexture(): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = canvas(S);
  const m = S / 2;
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = S * 0.018;
  g.lineCap = 'round';
  const n = 28;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    g.beginPath();
    g.arc(m, m, m * 0.94, a, a + (Math.PI * 2) / n * 0.5);
    g.stroke();
  }
  return texture(c);
}

/** A flat, additive, depth-tested decal on the floor. */
export function decal(tex: THREE.Texture, size: number, color: number, opacity: number): THREE.Mesh {
  const mat = new THREE.MeshBasicMaterial({
    map: tex, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 2;
  return m;
}
