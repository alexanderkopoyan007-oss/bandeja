# The golden club's broadleaf trees as impostors (render/arena/grove.ts): each CC0 tree (Poly Haven, assets-src/golden/<id>/)
# rendered from VIEWS azimuths a little above the horizon, orthographic, into two atlases: albedo with its cut-out (RGBA,
# sRGB) and the surface's normal as that view's camera saw it (RGB, x right, y up, z towards the camera, 0.5 + 0.5 n). The
# game turns a card to the camera, picks the nearest view and lights it with that normal, so the sun still models the
# crown. A million-triangle tree becomes two triangles.
#   blender -b --factory-startup --python impostor.py -- <in.gltf> <out dir> <name> [views=8] [size=512]
# Views: k-th from Blender azimuth 360 k / VIEWS (camera on +X first, counter-clockwise seen from above), ELEV up; the
# atlas is VIEWS/2 across and 2 down, view 0 top left. Prints the tree's height and the frame's size (m) for grove.ts.
import sys, math, json, bpy, numpy as np
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
src, out, name = argv[0], argv[1], argv[2]
VIEWS = int(argv[3]) if len(argv) > 3 else 8
SIZE = int(argv[4]) if len(argv) > 4 else 512
ELEV = math.radians(10)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
lo = Vector((1e9, 1e9, 1e9)); hi = Vector((-1e9, -1e9, -1e9))
for o in meshes:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
height = hi.z - max(lo.z, 0)
cx, cy = 0.0, 0.0  # the trunk stands at the origin in every Poly Haven tree
reach = max(abs(lo.x), abs(hi.x), abs(lo.y), abs(hi.y))
frame = max(2 * reach, height) * 1.04

# Two overrides per material: its base colour as emission, cut out by its alpha; and the normal (as Cycles gives it: towards the viewer on either side).
def override(mat, kind):
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    out_n = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
    em = nt.nodes.new('ShaderNodeEmission'); tr = nt.nodes.new('ShaderNodeBsdfTransparent'); mix = nt.nodes.new('ShaderNodeMixShader')
    em.inputs['Strength'].default_value = 1.0
    if kind == 'albedo':
        if bsdf and bsdf.inputs['Base Color'].is_linked:
            nt.links.new(bsdf.inputs['Base Color'].links[0].from_socket, em.inputs['Color'])
        elif bsdf:
            em.inputs['Color'].default_value = bsdf.inputs['Base Color'].default_value
    else:
        # (Cycles already turns a back face's normal to the viewer: flipping it again on Backfacing put a fifth of the leaves
        # facing away from the camera, and the crowns speckled dark)
        geo = nt.nodes.new('ShaderNodeNewGeometry')
        enc = nt.nodes.new('ShaderNodeVectorMath'); enc.operation = 'MULTIPLY_ADD'
        nt.links.new(geo.outputs['Normal'], enc.inputs[0]); enc.inputs[1].default_value = (0.5, 0.5, 0.5); enc.inputs[2].default_value = (0.5, 0.5, 0.5)
        nt.links.new(enc.outputs[0], em.inputs['Color'])
    if bsdf and bsdf.inputs['Alpha'].is_linked:
        nt.links.new(bsdf.inputs['Alpha'].links[0].from_socket, mix.inputs['Fac'])
    else:
        mix.inputs['Fac'].default_value = bsdf.inputs['Alpha'].default_value if bsdf else 1.0
    nt.links.new(tr.outputs[0], mix.inputs[1]); nt.links.new(em.outputs[0], mix.inputs[2])
    for l in list(out_n.inputs['Surface'].links): nt.links.remove(l)
    nt.links.new(mix.outputs[0], out_n.inputs['Surface'])

originals = {m.name: m for m in bpy.data.materials if m.use_nodes}
variants = {}
for kind in ('albedo', 'normal'):
    for nm, m in originals.items():
        c = m.copy(); override(c, kind); variants[(nm, kind)] = c
def use(kind):
    for o in meshes:
        for s in o.material_slots:
            orig = s.material.get('_orig', s.material.name) if s.material else None
            s.material = variants[(orig, kind)]
            s.material['_orig'] = orig
for o in meshes:
    for s in o.material_slots:
        if s.material: s.material['_orig'] = s.material.name

sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.samples = 24
sc.cycles.use_denoising = False
try:
    sc.cycles.device = 'GPU'
    bpy.context.preferences.addons['cycles'].preferences.compute_device_type = 'METAL'
    bpy.context.preferences.addons['cycles'].preferences.get_devices()
    for d in bpy.context.preferences.addons['cycles'].preferences.devices: d.use = True
except Exception as e:
    print('impostor: CPU', e)
sc.cycles.max_bounces = 0
sc.cycles.transparent_max_bounces = 64
sc.render.film_transparent = True
sc.render.resolution_x = sc.render.resolution_y = SIZE
sc.render.image_settings.file_format = 'OPEN_EXR'
sc.render.image_settings.color_depth = '32'
sc.view_settings.view_transform = 'Standard'
sc.world = bpy.data.worlds.new('none'); sc.world.color = (0, 0, 0)

cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = 'ORTHO'; cam.data.ortho_scale = frame
cam.data.clip_start = 0.1; cam.data.clip_end = 200
mid = Vector((cx, cy, frame / 2 - 0.02 * frame))  # the frame's foot a little under the ground: the trunk meets the card's edge

cols = VIEWS // 2
atlas = {k: np.zeros((2 * SIZE, cols * SIZE, 4), np.float32) for k in ('albedo', 'normal')}
for v in range(VIEWS):
    az = 2 * math.pi * v / VIEWS
    d = Vector((math.cos(az) * math.cos(ELEV), math.sin(az) * math.cos(ELEV), math.sin(ELEV)))
    cam.location = mid + d * 60
    cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.view_layer.update()
    R = cam.matrix_world.to_3x3()
    for kind in ('albedo', 'normal'):
        use(kind)
        path = f'{out}/_{name}_{kind}_{v}.exr'  # (temporary; overwritten each run)
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(path)
        px = np.empty(SIZE * SIZE * 4, np.float32); img.pixels.foreach_get(px)
        px = px.reshape(SIZE, SIZE, 4)[::-1]  # top row first
        bpy.data.images.remove(img)
        a = px[..., 3:4]
        rgb = np.where(a > 1e-4, px[..., :3] / np.maximum(a, 1e-4), 0)  # un-premultiply
        if kind == 'normal':
            n = rgb * 2 - 1
            n = n @ np.array(R)  # world -> camera: (R^T n) as rows
            n /= np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-6)
            rgb = n * 0.5 + 0.5
        else:
            rgb = np.where(rgb <= 0.0031308, rgb * 12.92, 1.055 * np.power(np.clip(rgb, 0, None), 1 / 2.4) - 0.055)
        r0, c0 = (v // cols) * SIZE, (v % cols) * SIZE
        atlas[kind][r0:r0 + SIZE, c0:c0 + SIZE] = np.concatenate([np.clip(rgb, 0, 1), a], -1)

# Bleed colour under the cut-out (mips then fade to the crown's own colour, not to black).
for kind in atlas:
    A = atlas[kind]
    a = A[..., 3:4]
    col = A[..., :3] * (a > 0.02)
    w = (a > 0.02).astype(np.float32)
    for _ in range(6):
        k = lambda x: (x + np.roll(x, 1, 0) + np.roll(x, -1, 0) + np.roll(x, 1, 1) + np.roll(x, -1, 1))
        cs, ws = k(col), k(w)
        fill = (w[..., 0] == 0) & (ws[..., 0] > 0)
        col[fill] = cs[fill] / ws[fill]
        w[fill] = 1
    A[..., :3] = np.where(a > 0.02, A[..., :3], col)
    np.save(f'{out}/{name}-{kind}.npy', (A * 255 + 0.5).astype(np.uint8))
print('IMPOSTOR', json.dumps({'name': name, 'height': round(height, 3), 'frame': round(frame, 3), 'foot': round(0.02 * frame, 3), 'views': VIEWS, 'elev': 10}))
