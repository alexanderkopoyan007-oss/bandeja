# Step 1 of the Meshy pilot: an AI-generated GLB to a game-sized mesh with game textures, in a background Blender.
#   Blender -b --python tools/assets/meshy/decimate-bake.py -- <person.glb> <out-dir> [tris]
# Scales the person to the height of the player it stands in for, collapses it to about <tris> triangles, unwraps it again, and
# writes low.npz (Blender axes, metres) with opaque.webp (base colour baked at 2048, a skin mask in alpha) and normal.webp (the
# full mesh and its 4K normal map baked onto the low one, tangent space, so what the collapse took off stays as shading).
import sys, os, time, math
import bpy, bmesh
import numpy as np
from bpy_extras.bmesh_utils import bmesh_linked_uv_islands

args = sys.argv[sys.argv.index('--') + 1:]
GLB, OUT = args[0], args[1]
TRIS = int(args[2]) if len(args) > 2 else 40000
TEX = 2048
# Soles to the top of the hair, the same as p1's (1.80 m of skin and his hair over it).
HEIGHT = 1.8164
# Texels on the head and the hands as a multiple of the rest's, by length.
HEAD_TEXELS = 2.2
HAND_TEXELS = 1.5
# Islands under this many triangles join a neighbour.
MIN_ISLAND = 80
os.makedirs(OUT, exist_ok=True)

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.import_scene.gltf(filepath=GLB, merge_vertices=True)
hi = next(o for o in bpy.data.objects if o.type == 'MESH')
bpy.context.view_layer.objects.active = hi
hi.select_set(True)
zs = np.empty(len(hi.data.vertices) * 3, dtype=np.float32)
hi.data.vertices.foreach_get('co', zs)
zs = zs.reshape(-1, 3)
lo_z, hi_z = float(zs[:, 2].min()), float(zs[:, 2].max())
k = HEIGHT / (hi_z - lo_z)
zs *= k
zs[:, 2] -= lo_z * k
hi.data.vertices.foreach_set('co', zs.reshape(-1))
hi.data.update()
print('MESHY scale', round(k, 4), 'tris', len(hi.data.polygons))

# ---------- the low mesh ----------
low = hi.copy()
low.data = hi.data.copy()
low.name = 'low'
bpy.context.scene.collection.objects.link(low)
for o in bpy.data.objects:
    o.select_set(o == low)
bpy.context.view_layer.objects.active = low
t0 = time.time()
m = low.modifiers.new('dec', 'DECIMATE')
m.decimate_type = 'COLLAPSE'
m.ratio = TRIS / len(hi.data.polygons)
bpy.ops.object.modifier_apply(modifier=m.name)
if 'custom_normal' in low.data.attributes:
    low.data.attributes.remove(low.data.attributes['custom_normal'])
low.data.shade_smooth()
print('MESHY low tris', len(low.data.polygons), 'verts', len(low.data.vertices), 'in', round(time.time() - t0, 1), 's')

# ---------- a new atlas ----------
# Meshy's UVs are thousands of scraps (13.5k seam edges), and the collapse doesn't respect them: a triangle with corners in
# two scraps drew a camouflage of hair and shirt across the chest. So the low mesh gets its own islands, the head and the hands
# with more texels, and the colour is baked across from the full mesh like the normals.
me = low.data
for o in bpy.data.objects:
    o.select_set(o == low)
bpy.context.view_layer.objects.active = low
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(70), island_margin=0.002, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
bm = bmesh.from_edit_mesh(me)
uvl = bm.loops.layers.uv.active
# Smart UV leaves about a thousand islands of a few triangles in the creases, and every one splits its vertices for the
# GPU: they go to the neighbour they touch most, and the patches are unwrapped again along what is left of the seams.
bm.faces.ensure_lookup_table()
members = {i: list(faces) for i, faces in enumerate(bmesh_linked_uv_islands(bm, uvl))}
print('MESHY smart islands', len(members))
lab = np.zeros(len(bm.faces), dtype=np.int64)
for i, faces in members.items():
    for f in faces:
        lab[f.index] = i
for i in sorted(members, key=lambda q: len(members[q])):
    if len(members[i]) >= MIN_ISLAND:
        continue
    touch = {}
    for f in members[i]:
        for e in f.edges:
            for g in e.link_faces:
                q = int(lab[g.index])
                if q != i:
                    touch[q] = touch.get(q, 0) + 1
    if touch:
        q = max(touch, key=touch.get)
        for f in members[i]:
            lab[f.index] = q
        members[q] += members.pop(i)
for e in bm.edges:
    fs = e.link_faces
    e.seam = bool(len(fs) == 2 and lab[fs[0].index] != lab[fs[1].index])
bmesh.update_edit_mesh(me)
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.unwrap(method='ANGLE_BASED', margin=0.002)
bm = bmesh.from_edit_mesh(me)
uvl = bm.loops.layers.uv.active
islands = bmesh_linked_uv_islands(bm, uvl)
for faces in islands:
    z = sum(f.calc_center_median().z for f in faces) / len(faces)
    x = abs(sum(f.calc_center_median().x for f in faces) / len(faces))
    k_ = HEAD_TEXELS if z > 1.5 else HAND_TEXELS if (z < 1.0 and x > 0.3) else 1.0
    if k_ != 1.0:
        loops = [l for f in faces for l in f.loops]
        cu = sum(l[uvl].uv.x for l in loops) / len(loops)
        cv = sum(l[uvl].uv.y for l in loops) / len(loops)
        for l in loops:
            l[uvl].uv.x = cu + (l[uvl].uv.x - cu) * k_
            l[uvl].uv.y = cv + (l[uvl].uv.y - cv) * k_
bmesh.update_edit_mesh(me)
bpy.ops.uv.select_all(action='SELECT')
bpy.ops.uv.pack_islands(rotate=True, scale=True, margin_method='FRACTION', margin=0.004, shape_method='CONCAVE')
bpy.ops.object.mode_set(mode='OBJECT')
print('MESHY islands', len(islands))

# ---------- colour and normals, the full mesh onto the low one ----------
scn = bpy.context.scene
scn.render.engine = 'CYCLES'
scn.cycles.samples = 8
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    scn.cycles.device = 'GPU'
except Exception as e:
    print('bake on the CPU:', e)
mlow = bpy.data.materials.new('low')
mlow.use_nodes = True
node = mlow.node_tree.nodes.new('ShaderNodeTexImage')
mlow.node_tree.nodes.active = node
low.data.materials.clear()
low.data.materials.append(mlow)


def bake(name, space, **kw):
    im = bpy.data.images.new(name, TEX, TEX, alpha=False)
    im.colorspace_settings.name = space
    node.image = im
    for o in bpy.data.objects:
        o.select_set(o in (hi, low))
    bpy.context.view_layer.objects.active = low
    t0 = time.time()
    bpy.ops.object.bake(use_selected_to_active=True, cage_extrusion=0.005, max_ray_distance=0.014, margin=10, target='IMAGE_TEXTURES', use_clear=True, **kw)
    print('MESHY bake', name, round(time.time() - t0, 1), 's')
    return im


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


nm = bake('normal', 'Non-Color', type='NORMAL', normal_space='TANGENT')
nm.filepath_raw = os.path.join(OUT, 'normal.webp')
nm.file_format = 'WEBP'
nm.save(filepath=os.path.join(OUT, 'normal.webp'), quality=88)

col = bake('colour', 'sRGB', type='DIFFUSE', pass_filter={'COLOR'})
small = np.empty(TEX * TEX * 4, dtype=np.float32)
col.pixels.foreach_get(small)
small = small.reshape(TEX, TEX, 4)
# Skin: warm and not dark (a white shirt, navy shorts and white shoes have R about B; dark hair is warm but low).
r, g, b = small[:, :, 0], small[:, :, 1], small[:, :, 2]
warm = (r - b) / np.maximum(r + b, 0.02)
skin = smooth(0.14, 0.26, warm) * smooth(0.22, 0.34, r)
# (never 0: the WebP encoder treats a block of alpha 0 as invisible and flattens its colour, and the shirt came out black)
small[:, :, 3] = 0.25 + 0.75 * skin
print('MESHY colour mean', small[:, :, :3].reshape(-1, 3).mean(0).round(3), 'skin share of texels', round(float((skin > 0.5).mean()), 3))
im = bpy.data.images.new('opaque', TEX, TEX, alpha=True)
im.colorspace_settings.name = 'sRGB'
im.pixels.foreach_set(small.reshape(-1))
im.filepath_raw = os.path.join(OUT, 'opaque.webp')
im.file_format = 'WEBP'
im.save(filepath=os.path.join(OUT, 'opaque.webp'), quality=88)

# ---------- the low mesh out ----------
me = low.data
me.calc_loop_triangles()
n = len(me.vertices)
co = np.empty(n * 3, dtype=np.float32)
me.vertices.foreach_get('co', co)
nt = len(me.loop_triangles)
tv = np.empty(nt * 3, dtype=np.int32)
tl = np.empty(nt * 3, dtype=np.int32)
me.loop_triangles.foreach_get('vertices', tv)
me.loop_triangles.foreach_get('loops', tl)
uv = np.empty(len(me.loops) * 2, dtype=np.float32)
me.uv_layers.active.data.foreach_get('uv', uv)
uv = uv.reshape(-1, 2)
hico = zs.astype(np.float32)
me2 = hi.data
me2.calc_loop_triangles()
ht = np.empty(len(me2.loop_triangles) * 3, dtype=np.int32)
me2.loop_triangles.foreach_get('vertices', ht)
np.savez(os.path.join(OUT, 'low.npz'), co=co.reshape(-1, 3), tri=tv.reshape(-1, 3), uv=uv[tl].reshape(-1, 3, 2), hico=hico, hitri=ht.reshape(-1, 3))
print('MESHY wrote', OUT, nt, 'tris', n, 'verts')
