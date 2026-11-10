// The scene in pieces for the warm-up's compile (Game.warmUp, Post.compile): three's compileAsync builds one object's
// shaders, waits for the GPU to make its pipeline, then goes on to the next, so a whole scene in one call leaves the
// main thread idle through every pipeline. Several calls side by side overlap one's building with another's waiting.
// A piece is compiled as `compileAsync(piece, camera, scene)`, which takes the lights from the whole scene; a piece
// holding a light would add it to them a second time, the lights' key would differ from the frames' own, and every
// shader in it would be built again on the first frame. So no piece holds a light: an object with one is split into
// its children (the light itself compiles nothing), and so is any group of more than MAX_MESHES meshes. A mesh that
// holds a light can't be split from it: it is left to the whole-scene pass after the pieces (Game.warmUp), which finds
// everything else already built.
import type * as THREE from 'three/webgpu';

const MAX_MESHES = 12;

/**
 * The pieces in two rounds: one of each kind first (by name, else type, and the first material's type), then the
 * others. Side by side, four bags (four bottles, four rackets' cords) each built the same shader at the same moment,
 * 11 builds of the title's 133; a round later the others find theirs made.
 */
export function compileRounds(scene: THREE.Object3D): [THREE.Object3D[], THREE.Object3D[]] {
  const first: THREE.Object3D[] = [], rest: THREE.Object3D[] = [];
  const seen = new Set<string>();
  for (const u of compileUnits(scene)) {
    let mat = '';
    u.traverse((d) => { const m = (d as THREE.Mesh).material; if (!mat && m) mat = (Array.isArray(m) ? m[0] : m)?.type ?? ''; });
    const key = `${u.name || u.type}|${mat}`;
    (seen.has(key) ? rest : first).push(u);
    seen.add(key);
  }
  return [first, rest];
}

export function compileUnits(scene: THREE.Object3D): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  const split = (o: THREE.Object3D): void => {
    for (const c of o.children) {
      if ((c as THREE.Light).isLight) continue;
      let lights = false, meshes = 0;
      c.traverse((d) => {
        if ((d as THREE.Light).isLight) lights = true;
        else if ((d as THREE.Mesh).isMesh || (d as THREE.Line).isLine || (d as THREE.Points).isPoints) meshes++;
      });
      if (meshes === 0) continue;
      // (an object drawn itself and split into its children would lose its own draw: only groups are split)
      const drawn = (c as THREE.Mesh).isMesh || (c as THREE.Line).isLine || (c as THREE.Points).isPoints;
      if (!drawn && (lights || meshes > MAX_MESHES)) split(c);
      else if (!lights) out.push(c);
    }
  };
  split(scene);
  return out;
}
