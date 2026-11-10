// Post-processing (Phase 5): the scene rendered to an HDR target, then bloom on what is brighter than white (the
// floodlight lenses at night, the roof's light panels, the sun's sparkle), the way a broadcast camera's lens
// blooms them, then tone mapping. `?bloom=0` renders straight to the screen as before.
import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

export interface PostLook {
  /** Bloom strength, the blur's radius (0..1), and the linear brightness it starts from. */
  strength: number;
  radius: number;
  threshold: number;
}

/** How deep the scene pass's draw is: inside the pipeline's draw of its quad (three's Renderer._callDepth there). */
const PASS_DEPTH = 1;

export class Post {
  private readonly pipeline: THREE.RenderPipeline;
  private readonly canvas: HTMLCanvasElement;
  private readonly nodes: Array<{ dispose(): void }>;
  private readonly scenePass: ReturnType<typeof pass>;

  constructor(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera, look: PostLook) {
    this.canvas = renderer.domElement;
    const scenePass = (this.scenePass = pass(scene, camera));
    const color = scenePass.getTextureNode('output');
    const glow = bloom(color, look.strength, look.radius, look.threshold);
    this.pipeline = new THREE.RenderPipeline(renderer, color.add(glow));
    this.nodes = [scenePass, glow];
  }

  /**
   * The scene's shaders compiled for the target they are drawn into (half float, the renderer's samples), not the
   * canvas: a compile for the canvas built every material a second time, synchronously, on the first frame (50 of the
   * title's 137 builds). The target's type and samples are set as the pass's own setup sets them on that first frame.
   *
   * The scene pass draws inside the pipeline's own draw, one call deep, and three keys a draw's render context (and so
   * every shader built in it) by that depth, while `compileAsync` always asks for depth 0: its shaders were built again
   * on the first frame all the same. So the compile's lookup of its context (made before its first await) asks for
   * depth 1. If three's internals change, the compile still runs, keyed as three keys it.
   */
  async compile(renderer: THREE.WebGPURenderer): Promise<void> {
    const rt = this.scenePass.renderTarget;
    rt.samples = renderer.samples;
    rt.texture.type = renderer.getOutputBufferType();
    const contexts = (renderer as unknown as { _renderContexts?: { get(rt: unknown, mrt: unknown, depth?: number): unknown } })._renderContexts;
    const get = contexts?.get;
    if (contexts && get) contexts.get = (target, mrt, depth = PASS_DEPTH) => get.call(contexts, target, mrt, depth);
    let done: Promise<void>;
    try {
      done = this.scenePass.compileAsync(renderer);
    } finally {
      if (contexts && get) contexts.get = get;
    }
    await done;
  }

  /** Free the HDR target and the bloom's targets. */
  dispose(): void {
    for (const n of this.nodes) n.dispose();
    this.pipeline.dispose();
  }

  render(): void {
    // A 0 x 0 window (a hidden tab) would make the targets at zero size, and in WebGL they stay broken after a
    // resize (every later frame black): draw nothing until there is a size.
    if (this.canvas.width === 0 || this.canvas.height === 0) return;
    this.pipeline.render();
  }
}
