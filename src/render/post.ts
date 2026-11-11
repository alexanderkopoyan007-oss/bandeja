// Post-processing (Phase 5): the scene rendered to an HDR target, then bloom on what is brighter than white (the
// floodlight lenses at night, the roof's light panels, the sun's sparkle), the way a broadcast camera's lens
// blooms them, then tone mapping. `?bloom=0` renders straight to the screen as before.
import * as THREE from 'three/webgpu';
import { colorToDirection, directionToColor, dot, float, fract, int, mix, mrt, normalView, output, pass, renderOutput, sample, screenCoordinate, screenUV, sin, smoothstep, uniform, vec2, vec3, vec4, velocity } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { motionBlur } from 'three/addons/tsl/display/MotionBlur.js';

export interface PostLook {
  /** Bloom strength, the blur's radius (0..1), and the linear brightness it starts from. */
  strength: number;
  radius: number;
  threshold: number;
}

/**
 * The look pass (`?look=2`, until the owner has seen it): what a film camera adds to the same scene. Soft shadowing
 * where things meet (GTAO off the pass's own depth and normals), motion blur off per-pixel velocity (the racket and the
 * ball smear along their paths; a cut smears nothing: `cut()`), then the bloom, a grade (a little more contrast, cool
 * shadows under warm lights, the corners darker) and grain after the tone mapping. Without the switch none of it is
 * built and the pipeline is the bloom's alone, as before.
 */
export interface FilmLook {
  /** How much of the occlusion is laid on (0..1) and its reach (m). */
  ao: number;
  aoRadius: number;
  /** The shutter: the share of a frame's travel that smears (0 = none). */
  shutter: number;
  /** Contrast about middle grey (1 = none), saturation (1 = none), the corners' darkening (0..1) and the grain (0..1). */
  contrast: number;
  saturation: number;
  vignette: number;
  grain: number;
  /** The replay camera's lens (Post.focus): how far outside the stretch it holds sharp things go fully soft (m), and the blur's size. */
  focusRange: number;
  bokeh: number;
}

export const FILM_LOOK: FilmLook = { ao: 0.85, aoRadius: 0.35, shutter: 0.45, contrast: 1.12, saturation: 1.06, vignette: 0.28, grain: 0.035, focusRange: 8, bokeh: 2.2 };
/** The furthest a pixel smears (screen widths): a frame's worth of a fast racket, not a whip pan's. */
const BLUR_MAX = 0.03;
/** A cut: the camera more than this far (m) or turned more than about 7 degrees (the half-angle's cosine) in a frame. */
const CUT_M = 1.2, CUT_COS = Math.cos((7 * Math.PI) / 360);

/** How deep the scene pass's draw is: inside the pipeline's draw of its quad (three's Renderer._callDepth there). */
const PASS_DEPTH = 1;

export class Post {
  private readonly pipeline: THREE.RenderPipeline;
  /** The look pass's picture through the replay camera's lens (depth of field), drawn instead while it is focused (`focus`). */
  private pipelineLens: THREE.RenderPipeline | null = null;
  /** (the stretch the lens holds sharp: x its near end, y its far end, m along the camera's line.) */
  private lens: THREE.UniformNode<'vec2', THREE.Vector2> | null = null;
  private focused = false;
  private readonly canvas: HTMLCanvasElement;
  private readonly nodes: Array<{ dispose(): void }>;
  private readonly scenePass: ReturnType<typeof pass>;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.Camera;
  /** The look pass's small plain drawing of the solid things, for the occlusion (null without it). */
  private prePass: ReturnType<typeof pass> | null = null;
  /** (one vector: x the shutter, y the frame's number for the grain. Writing a scalar uniform boxes a double a frame.) */
  private readonly film: THREE.UniformNode<'vec2', THREE.Vector2> | null = null;
  private shutterOpen = 0;
  private skip = 0;
  /** While the look pass's shaders compile: the target and outputs the renderer is held at (compile). */
  private held: { renderer: THREE.WebGPURenderer; rt: THREE.RenderTarget; mrt: THREE.MRTNode | null } | null = null;
  /** The camera a frame ago: where (3) and its turn (4). */
  private readonly was = new Float64Array(7);

  constructor(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera, look: PostLook, film?: FilmLook) {
    this.canvas = renderer.domElement;
    this.scene = scene;
    this.camera = camera;
    const scenePass = (this.scenePass = pass(scene, camera));
    if (!film) {
      const color = scenePass.getTextureNode('output');
      const glow = bloom(color, look.strength, look.radius, look.threshold);
      this.pipeline = new THREE.RenderPipeline(renderer, color.add(glow));
      this.nodes = [scenePass, glow];
      return;
    }
    scenePass.setMRT(mrt({ output, velocity }));
    // (two channels are all a pixel's travel across the screen needs: half the memory of the four it would get)
    scenePass.getTexture('velocity').format = THREE.RGFormat;
    const color = scenePass.getTextureNode('output');
    // The occlusion reads depth, and the picture's own depth is many samples a pixel (antialiasing), which it can't.
    // So the solid things are drawn once more, small and plain: depth and the surfaces' facing, at half size.
    const pre = (this.prePass = pass(scene, camera, { samples: 0 }));
    pre.transparent = false;
    pre.setResolutionScale(0.5);
    pre.setMRT(mrt({ output: directionToColor(normalView) }));
    pre.getTexture('output').type = THREE.UnsignedByteType;
    const facing = pre.getTextureNode('output');
    const occ = ao(pre.getTextureNode('depth'), sample((at) => colorToDirection(facing.sample(at))), camera);
    occ.resolutionScale = 0.5;
    occ.radius.value = film.aoRadius;
    occ.samples.value = 8;
    // (the blur reads the pass's own picture: it samples a texture; the occlusion is laid on after, unsmeared)
    const f = (this.film = uniform(new THREE.Vector2(film.shutter, 0)));
    this.shutterOpen = film.shutter;
    const v = scenePass.getTextureNode('velocity').xy.mul(f.x);
    const len = v.length().max(1e-6);
    const smear = motionBlur(color, v.mul(len.min(BLUR_MAX).div(len)), int(6)).mul(mix(float(1), occ.getTextureNode().r, film.ao));
    // The same from here whether the lens is in or not: the bloom, the grade, the tone mapping, the grain.
    const finish = (base: typeof smear): { out: ReturnType<typeof vec4>; glow: ReturnType<typeof bloom> } => {
    const glow = bloom(base, look.strength, look.radius, look.threshold);
    // The grade, in the scene's own light (before the tone mapping): contrast about middle grey, the shadows a little
    // cool and the lights a little warm, the corners darker.
    const lit = base.add(glow).rgb;
    const luma = dot(lit, vec3(0.2126, 0.7152, 0.0722));
    const sat = mix(vec3(luma), lit, film.saturation);
    const con = sat.div(0.18).max(0).pow(vec3(film.contrast)).mul(0.18);
    const tone = con.mul(mix(vec3(0.94, 0.99, 1.07), vec3(1.04, 1.0, 0.95), smoothstep(0.02, 0.6, luma)));
    const away = screenUV.sub(0.5).mul(vec2(1, 0.8)).length();
    const framed = tone.mul(float(1).sub(smoothstep(0.35, 0.95, away).mul(film.vignette)));
    // Grain after the tone mapping (in what the screen shows), new every frame, strongest in the mid-tones.
    const shown = renderOutput(vec4(framed, 1));
    const seed = screenCoordinate.xy.add(vec2(f.y.mul(37.13), f.y.mul(91.7)));
    const noise = fract(sin(dot(seed, vec2(12.9898, 78.233))).mul(43758.5453)).sub(0.5);
    const mid = dot(shown.rgb, vec3(0.2126, 0.7152, 0.0722));
    const grained = shown.rgb.add(noise.mul(film.grain).mul(float(1).sub(mid.sub(0.5).abs().mul(1.2)).max(0.25)));
    return { out: vec4(grained, 1), glow };
    };
    const plain = finish(smear);
    this.pipeline = new THREE.RenderPipeline(renderer, plain.out);
    this.pipeline.outputColorTransform = false;
    // The replay camera's lens: what it is focused on sharp, the stands and the far wall soft, as a long lens on a
    // slow-motion camera draws them. A second pipeline (the bloom's targets twice over), drawn only while a replay shows:
    // in play both pairs stay sharp.
    // Sharp from the nearer of the two it follows to the further (x to y, m along its line), not at one distance: the
    // hitter and the ball are 10 m apart by the time the ball lands, and a lens focused on either lost the other. So the
    // depth it is given is the distance outside that stretch (inside it: at the focus).
    const lens = (this.lens = uniform(new THREE.Vector2(8, 12)));
    const far = pre.getViewZNode().negate();
    const soft = dof(smear, far.min(lens.x).add(far.sub(lens.y).max(0)).negate(), lens.x, film.focusRange, film.bokeh);
    const lensed = finish(soft as unknown as typeof smear);
    this.pipelineLens = new THREE.RenderPipeline(renderer, lensed.out);
    this.pipelineLens.outputColorTransform = false;
    this.nodes = [scenePass, pre, occ, plain.glow, soft, lensed.glow];
  }

  /** The lens sharp from `near` to `far` m along the camera's line (the look pass's replays), or out (0): everything sharp. */
  focus(near: number, far = near): void {
    this.focused = near > 0 && this.pipelineLens !== null;
    if (this.focused) this.lens!.value.set(near, far > near ? far : near);
  }

  /** The camera has cut (or the view jumped): the next frames smear nothing, since their velocity is the jump's. */
  cut(): void {
    this.skip = 2;
  }

  /**
   * The scene's shaders compiled for the target they are drawn into (half float, the renderer's samples), not the
   * canvas: a compile for the canvas built every material a second time, synchronously, on the first frame (50 of the
   * title's 137 builds). The target's type and samples are set as the pass's own setup sets them on that first frame.
   *
   * The scene pass draws inside the pipeline's own draw, one call deep, and three keys a draw's render context (and so
   * every shader built in it) by that depth, while `compileAsync` always asks for depth 0: its shaders were built again
   * on the first frame all the same. So each compile's lookup of its context (made before its first await) asks for
   * depth 1. If three's internals change, the compile still runs, keyed as three keys it.
   *
   * `units` (compileUnits): the scene in pieces, compiled side by side. One compileAsync builds an object's shaders,
   * then waits for the GPU to make its pipeline, then the next: with several going, one builds while another waits.
   */
  async compile(renderer: THREE.WebGPURenderer, units: THREE.Object3D[]): Promise<void> {
    const rt = this.scenePass.renderTarget;
    rt.samples = renderer.samples;
    rt.texture.type = renderer.getOutputBufferType();
    await this.compileInto(renderer, this.scenePass, units);
    if (this.prePass) await this.compileInto(renderer, this.prePass, units);
    // (the replay lens's own shaders built now, by one frame through it, not on the first replay's first frame)
    if (this.pipelineLens && this.canvas.width > 0 && this.canvas.height > 0) this.pipelineLens.render();
  }

  private async compileInto(renderer: THREE.WebGPURenderer, into: ReturnType<typeof pass>, units: THREE.Object3D[]): Promise<void> {
    const rt = into.renderTarget;
    const contexts = (renderer as unknown as { _renderContexts?: { get(rt: unknown, mrt: unknown, depth?: number): unknown } })._renderContexts;
    const get = contexts?.get;
    const was = renderer.getRenderTarget(), wasMrt = renderer.getMRT();
    let done: Array<Promise<void>> = [];
    renderer.setRenderTarget(rt);
    renderer.setMRT(into.getMRT());
    if (contexts && get) contexts.get = (target, mrt, depth = PASS_DEPTH) => get.call(contexts, target, mrt, depth);
    try {
      done = units.map((u) => renderer.compileAsync(u, this.camera, this.scene));
    } finally {
      if (contexts && get) contexts.get = get;
      renderer.setRenderTarget(was);
      renderer.setMRT(wasMrt);
    }
    if (this.film) {
      // The look pass draws to more than one target, and a shader built after compileAsync's first yield reads the
      // renderer's target and outputs again: with them put back by then, it is built for one target and its pipeline
      // for several (refused). So they are held until the compiles are done; a frame drawn meanwhile puts them aside
      // (render).
      const mrtNode = into.getMRT();
      renderer.setRenderTarget(rt);
      renderer.setMRT(mrtNode);
      this.held = { renderer, rt, mrt: mrtNode };
      try {
        await Promise.all(done);
      } finally {
        this.held = null;
        renderer.setRenderTarget(was);
        renderer.setMRT(wasMrt);
      }
      return;
    }
    await Promise.all(done);
  }

  /** Free the HDR target and the bloom's targets. */
  dispose(): void {
    for (const n of this.nodes) n.dispose();
    this.pipeline.dispose();
    this.pipelineLens?.dispose();
  }

  render(): void {
    // A 0 x 0 window (a hidden tab) would make the targets at zero size, and in WebGL they stay broken after a
    // resize (every later frame black): draw nothing until there is a size.
    if (this.canvas.width === 0 || this.canvas.height === 0) return;
    if (this.film) {
      // A cut (the camera somewhere else, or looking somewhere else, than a frame's travel allows) smears nothing.
      const p = this.camera.position, q = this.camera.quaternion, w = this.was;
      const dx = p.x - w[0]!, dy = p.y - w[1]!, dz = p.z - w[2]!;
      if (dx * dx + dy * dy + dz * dz > CUT_M * CUT_M || Math.abs(q.x * w[3]! + q.y * w[4]! + q.z * w[5]! + q.w * w[6]!) < CUT_COS) this.skip = 2;
      w[0] = p.x; w[1] = p.y; w[2] = p.z; w[3] = q.x; w[4] = q.y; w[5] = q.z; w[6] = q.w;
      const f = this.film.value;
      f.x = this.skip > 0 ? 0 : this.shutterOpen;
      if (this.skip > 0) this.skip--;
      f.y = (f.y + 1) % 1024;
    }
    const h = this.held;
    if (h) {
      h.renderer.setRenderTarget(null);
      h.renderer.setMRT(null);
      this.pipeline.render();
      h.renderer.setRenderTarget(h.rt);
      h.renderer.setMRT(h.mrt);
      return;
    }
    (this.focused ? this.pipelineLens! : this.pipeline).render();
  }
}
