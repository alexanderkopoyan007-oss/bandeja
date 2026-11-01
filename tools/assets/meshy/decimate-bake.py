# Step 1 of the Meshy pilot: an AI-generated GLB to a game-sized mesh with game textures, in a background Blender.
#   Blender -b --python tools/assets/meshy/decimate-bake.py -- <person.glb> <out-dir> [tris] [height]
# Scales the person to <height>, collapses it to about <tris> triangles, unwraps it again, and
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
# Soles to the top of the hair; the default is p1's (1.80 m of skin and his hair over it).
HEIGHT = float(args[3]) if len(args) > 3 else 1.8164
# Texels on the head and the hands as a multiple of the rest's, by length.
HEAD_TEXELS = 2.2
HAND_TEXELS = 1.5
# Islands under this many triangles join a neighbour.
MIN_ISLAND = 80
# Rounds of cutting out what overlaps in the atlas, and the grid that finds it.
UNLAP_ROUNDS = 8
LAP_GRID = 1024
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


def overlaps(size=LAP_GRID):
    """The faces that share atlas texels with another face: a texel's centre lies inside one triangle only, unless they overlap."""
    owner = np.full((size, size), -1, dtype=np.int64)
    out = set()
    for f in bm.faces:
        p = np.array([(l[uvl].uv.x, l[uvl].uv.y) for l in f.loops]) * size
        x0, y0 = np.floor(p.min(0) - 0.5).astype(int)
        x1, y1 = np.ceil(p.max(0) + 0.5).astype(int)
        xs, ys = np.meshgrid(np.arange(max(x0, 0), min(x1, size)), np.arange(max(y0, 0), min(y1, size)))
        if xs.size == 0:
            continue
        cx_, cy_ = xs + 0.5, ys + 0.5
        side = [(p[(i + 1) % 3, 0] - p[i, 0]) * (cy_ - p[i, 1]) - (p[(i + 1) % 3, 1] - p[i, 1]) * (cx_ - p[i, 0]) for i in range(3)]
        inside = (side[0] >= 0) & (side[1] >= 0) & (side[2] >= 0) | (side[0] <= 0) & (side[1] <= 0) & (side[2] <= 0)
        xi, yi = xs[inside], ys[inside]
        was = owner[yi, xi]
        was = np.unique(was[was >= 0])
        if len(was):
            out.update(int(q) for q in was)
            out.add(f.index)
        owner[yi, xi] = f.index
    return out


# A flattened ring (the waist, a sleeve) can lap over its own other end with no triangle flipped: two parts of the body then share texels,
# whichever bakes last wins, and the other shows it as shards. What overlaps goes to islands of its own, until nothing does.
for round_ in range(UNLAP_ROUNDS):
    lap = overlaps()
    print('MESHY overlapping faces, round', round_, len(lap))
    if not lap:
        break
    for e in bm.edges:
        fs = e.link_faces
        if len(fs) == 2 and (fs[0].index in lap) != (fs[1].index in lap):
            e.seam = True
    bmesh.update_edit_mesh(me)
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.unwrap(method='ANGLE_BASED', margin=0.002)
    bm = bmesh.from_edit_mesh(me)
    uvl = bm.loops.layers.uv.active
    bm.faces.ensure_lookup_table()
islands = bmesh_linked_uv_islands(bm, uvl)
for faces in islands:
    z = sum(f.calc_center_median().z for f in faces) / len(faces)
    x = abs(sum(f.calc_center_median().x for f in faces) / len(faces))
    k_ = HEAD_TEXELS if z > 0.826 * HEIGHT else HAND_TEXELS if (z < 0.55 * HEIGHT and x > 0.165 * HEIGHT) else 1.0
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
bm = bmesh.from_edit_mesh(me)
uvl = bm.loops.layers.uv.active
print('MESHY overlapping faces after packing', len(overlaps()))
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


def bake(name, space, cage=0.005, ray=0.014, margin=10, **kw):
    im = bpy.data.images.new(name, TEX, TEX, alpha=True)
    im.colorspace_settings.name = space
    node.image = im
    for o in bpy.data.objects:
        o.select_set(o in (hi, low))
    bpy.context.view_layer.objects.active = low
    t0 = time.time()
    bpy.ops.object.bake(use_selected_to_active=True, cage_extrusion=cage, max_ray_distance=ray, margin=margin, target='IMAGE_TEXTURES', use_clear=True, **kw)
    print('MESHY bake', name, round(time.time() - t0, 1), 's')
    return im


def texels(im):
    px = np.empty(TEX * TEX * 4, dtype=np.float32)
    im.pixels.foreach_get(px)
    return px.reshape(TEX, TEX, 4)


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


# (a texel whose short ray misses stays flat: a long ray comes back from the wrong wall of a crease with a wild normal)
nm = bake('normal', 'Non-Color', type='NORMAL', normal_space='TANGENT')
nb = texels(nm)
nb[:, :, 3] = 1
nm.pixels.foreach_set(nb.reshape(-1))
nm.filepath_raw = os.path.join(OUT, 'normal.webp')
nm.file_format = 'WEBP'
nm.save(filepath=os.path.join(OUT, 'normal.webp'), quality=88)

# Colour: where the low surface bridges a crease deeper than the short ray (the fused armpits, folds in the shirt), it misses and the
# texel stays black; those take a long ray's colour, and then the islands' edges are bled out by hand (the bakes have no margin, so
# that a miss can be told from a hit).
near = texels(bake('colour', 'sRGB', margin=0, type='DIFFUSE', pass_filter={'COLOR'}))
wide = texels(bake('colour2', 'sRGB', cage=0.03, ray=0.09, margin=0, type='DIFFUSE', pass_filter={'COLOR'}))
hit = near[:, :, 3] > 0.5
fill = ~hit & (wide[:, :, 3] > 0.5)
print('MESHY colour texels', int(hit.sum()), 'near', int(fill.sum()), 'from the long ray', int((~hit & ~fill).sum()), 'empty')
small = near.copy()
small[fill] = wide[fill]
has = hit | fill
rgb = small[:, :, :3]
for _ in range(14):
    acc = np.zeros_like(rgb)
    cnt = np.zeros(has.shape, dtype=np.float32)
    for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        acc += np.roll(np.roll(rgb * has[:, :, None], dy, 0), dx, 1)
        cnt += np.roll(np.roll(has.astype(np.float32), dy, 0), dx, 1)
    grow = ~has & (cnt > 0)
    rgb[grow] = acc[grow] / cnt[grow][:, None]
    has = has | grow
# Skin: warm and not dark (a white shirt, navy shorts and white shoes have R about B; dark hair is warm but low). How dark is dark
# goes by the person's own skin, the brightest of what is warm: a fixed floor left a dark-skinned face two thirds cloth.
r, g, b = small[:, :, 0], small[:, :, 1], small[:, :, 2]
warm = (r - b) / np.maximum(r + b, 0.02)
dark = 0.31 * float(np.percentile(r[has & (warm > 0.15)], 90))
skin = smooth(0.14, 0.26, warm) * smooth(dark, 1.55 * dark, r)
print('MESHY skin floor', round(dark, 3))
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
