# Second step after make-player.py, in the same Blender session: turns the MPFB character into a game body.
#
# Imported by make-player.py (run that; it calls finish() on the character it has just built).
#
# - The body's shape baked, then the whole character scaled so soles to skin top is player.json "height" (1.80 m
#   default) and moved so the soles are on the floor.
# - Trousers cut into shorts at "shorts" (m above the floor), the legs below shown again; skin hidden under clothes
#   and MPFB's helper geometry removed.
# - The mesh stays in the pose it was modelled in (MPFB's A-pose) and is bound there: skinning from the modelled
#   pose deforms better than baking a T-pose first. The rig is posed into the game skeleton's rest (a T-pose,
#   tools/assets/mpfb/ybot-rest.mjs) only where the two differ by pose rather than by build: the arms, hands and
#   fingers, and the legs straight down. Shoulders, spine, neck, head, hips and feet keep MPFB's own joints (their
#   directions differ from the game skeleton's because the bodies differ). Each bone's move from the modelled pose
#   to that T-pose (M) and the T-pose joints are written out; tools/assets/build-people.mjs makes the bind matrices.
# - Textures packed into two atlases: opaque (skin, the clothes' ambient occlusion for team colours, eyes) and
#   alpha-tested (hair, brows, lashes). The suit's own diffuse (a printed logo, jeans) and the trainers' texture (a
#   photo of a branded shoe) are not used: the game colours them.
import os, json, math, struct
import bpy, bmesh, mathutils
import numpy as np
from mathutils import Vector, Matrix

from bl_ext.user_default.mpfb.services.targetservice import TargetService

P = 'mixamorig:'
# Part codes (the game's body shader colours by them).
PART = {'skin': 0, 'shirt': 1, 'shorts': 2, 'shoe': 3, 'eye': 4, 'sock': 5, 'hair': 6, 'brow': 7, 'lash': 8}
ALPHA_PARTS = ('hair', 'brow', 'lash')
# Atlas rectangles in pixels from the bottom left (Blender's image rows run upwards, like UV v).
OPAQUE_SIZE = (1536, 1024)
ALPHA_SIZE = (768, 512)
RECT = {'skin': (0, 0, 1024, 1024), 'clothes': (1024, 512, 512, 512), 'eye': (1024, 256, 256, 256),
        'hair': (0, 0, 512, 512), 'brow': (512, 256, 256, 256), 'lash': (512, 0, 256, 256)}
# The game skeleton's bone order (ybot-rest.json keys) is the output order.
SIDES = ('Left', 'Right')
FINGERS = ('Thumb', 'Index', 'Middle', 'Ring', 'Pinky')


def select_only(o):
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    for x in bpy.data.objects:
        x.select_set(False)
    o.select_set(True)
    bpy.context.view_layer.objects.active = o


def evaluated_z(o):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = o.evaluated_get(dg)
    me = ev.to_mesh()
    zs = [(ev.matrix_world @ v.co).z for v in me.vertices]
    ev.to_mesh_clear()
    return min(zs), max(zs)


def kind_of(o, spec):
    n = o.name
    if n == 'Human':
        return 'body'
    for part, key in (('eye', 'eyes'), ('brow', 'eyebrows'), ('lash', 'eyelashes'), ('hair', 'hair')):
        if spec.get(key) and n.endswith(spec[key]):
            return part
    for c in spec.get('clothes', []):
        if n.endswith(c):
            return 'shoe' if c.startswith('shoes') else 'suit'
    raise ValueError('unknown mesh ' + n)


def finish(yb, spec, out, preview=False):
    os.makedirs(out, exist_ok=True)
    rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    body = next(o for o in bpy.data.objects if o.type == 'MESH' and o.name == 'Human')
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    kinds = {o.name: kind_of(o, spec) for o in meshes}
    assert rig.matrix_world == Matrix.Identity(4), rig.matrix_world

    # ---------- shape baked, height ----------
    select_only(body)
    TargetService.bake_targets(body)
    lo = min(evaluated_z(o)[0] for o in meshes)  # the soles (the shoes)
    hi = evaluated_z(body)[1]  # the skin's top (helpers masked; the hair sits above it)
    want = spec.get('height', 1.80)
    k = want / (hi - lo)
    for o in bpy.data.objects:
        o.select_set(o == rig or o.parent == rig)
    bpy.context.view_layer.objects.active = rig
    rig.scale = (k, k, k)
    rig.location = (0, 0, -lo * k)
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=True)
    for o in meshes:
        for m in o.modifiers:
            if m.type == 'ARMATURE':
                m.object = rig
    print('HEIGHT', round(hi - lo, 4), '->', want, 'scale', round(k, 4))

    # ---------- shorts ----------
    hem = spec.get('shorts')
    suit = next((o for o in meshes if kinds[o.name] == 'suit'), None)
    if hem is not None and suit is not None:
        bm = bmesh.new()
        bm.from_mesh(suit.data)
        # The trouser legs sliced level at the hem and everything under it dropped (the shirt never reaches below
        # the hips); the slice keeps the UVs.
        n0 = len(bm.faces)
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, hem), plane_no=(0, 0, 1),
                               clear_inner=True)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
        dead = [None] * max(0, n0 - len(bm.faces))
        bm.to_mesh(suit.data)
        bm.free()
        # The body under the suit is masked by a vertex group; the legs below the hem show again (2 cm under it).
        g = body.vertex_groups.get('Delete.' + spec['clothes'][0])
        if g:
            g.remove([v.index for v in body.data.vertices if v.co.z < hem - 0.02])
        print('SHORTS cut', len(dead), 'faces at', hem)

    # ---------- helpers and hidden skin out ----------
    select_only(body)
    for m in list(body.modifiers):
        if m.type == 'MASK':
            bpy.ops.object.modifier_apply(modifier=m.name)

    # ---------- skin under the clothes out ----------
    # The masks leave skin under the sleeves and over the shoulders, and it pokes through once the arm moves. The
    # clothes go 3 mm out along their normals; then skin that sees clothing within 3 cm straight out from it is
    # removed, except a 2.5 cm band next to the uncovered skin: the skin just inside a hem stays, so looking into a
    # sleeve never shows a hole in the arm.
    from mathutils.bvhtree import BVHTree
    from mathutils.kdtree import KDTree
    covers = [o for o in meshes if kinds[o.name] in ('suit', 'shoe')]
    for o in covers:
        if kinds[o.name] == 'suit':
            for v in o.data.vertices:
                v.co += v.normal * 0.003
            o.data.update()
    dg = bpy.context.evaluated_depsgraph_get()
    trees = [BVHTree.FromObject(o, dg, deform=False) for o in covers]
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.normal_update()
    covered = set()
    for v in bm.verts:
        o0 = v.co + v.normal * 0.0005
        if any(t.ray_cast(o0, v.normal, 0.03)[0] is not None for t in trees):
            covered.add(v.index)
    open_skin = [v for v in bm.verts if v.index not in covered]
    kd = KDTree(len(open_skin))
    for i, v in enumerate(open_skin):
        kd.insert(v.co, i)
    kd.balance()
    gone = {v.index for v in bm.verts if v.index in covered and kd.find(v.co)[2] > 0.025}
    dead = [f for f in bm.faces if all(v.index in gone for v in f.verts)]
    bmesh.ops.delete(bm, geom=dead, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(body.data)
    bm.free()
    print('COVERED skin faces removed', len(dead))

    # ---------- the rig posed into the game skeleton's T-pose where they differ by pose ----------
    select_only(rig)
    bpy.ops.object.mode_set(mode='POSE')
    pb = rig.pose.bones
    rest = {b.name[len(P):]: b.matrix_local.copy() for b in rig.data.bones}

    def head(n):
        return pb[P + n].head.copy()

    ENDS = {'HeadTop_End': 'Head'}
    for s in SIDES:
        ENDS[s + 'Toe_End'] = s + 'ToeBase'
        for f in FINGERS:
            ENDS[f'{s}Hand{f}4'] = f'{s}Hand{f}3'

    def mp_joint(n):
        return pb[P + ENDS[n]].tail.copy() if n in ENDS else head(n)

    def yb_joint(n):
        return Vector(yb[n]['head'])

    # Bone -> (the joint its direction points to, how it is turned: 'min' the smallest turn, 'palm' also rolled so
    # the palm faces the way the game skeleton's does).
    AIM = {}
    for s in SIDES:
        AIM[s + 'UpLeg'] = (s + 'Leg', 'min')
        AIM[s + 'Leg'] = (s + 'Foot', 'min')
        AIM[s + 'Arm'] = (s + 'ForeArm', 'min')
        AIM[s + 'ForeArm'] = (s + 'Hand', 'palm')
        AIM[s + 'Hand'] = (s + 'HandMiddle1', 'palm')
        for f in FINGERS:
            for j in (1, 2, 3):
                AIM[f'{s}Hand{f}{j}'] = (f'{s}Hand{f}{j + 1}', 'min' if f == 'Thumb' else 'palm')

    def palm(s, joint):
        return joint(s + 'HandIndex1') - joint(s + 'HandPinky1')

    def frame(d, e):
        x = d.normalized()
        y = e - x * e.dot(x)
        y.normalize()
        return Matrix((x, y, x.cross(y))).transposed()

    names = []

    def visit(b):
        names.append(b.name[len(P):])
        for c in b.children:
            visit(c)
    for b in rig.data.bones:
        if b.parent is None:
            visit(b)
    for n in names:
        b = pb[P + n]
        h = head(n)
        if n in AIM:
            to, how = AIM[n]
            d0 = mp_joint(to) - h
            d1 = yb_joint(to) - yb_joint(n)
            if how == 'palm':
                s = 'Left' if n.startswith('Left') else 'Right'
                R = frame(d1, palm(s, yb_joint)) @ frame(d0, palm(s, mp_joint)).transposed()
            else:
                R = d0.rotation_difference(d1).to_matrix()
            b.matrix = Matrix.Translation(h) @ R.to_4x4() @ Matrix.Translation(-h) @ b.matrix
        else:
            # Not posed: keeps the modelled pose's world rotation (a foot stays flat when its leg straightens).
            b.matrix = Matrix.Translation(h) @ rest[n].to_3x3().to_4x4()
        bpy.context.view_layer.update()

    worst = 0
    for n, (to, how) in AIM.items():
        worst = max(worst, math.degrees((mp_joint(to) - head(n)).angle(yb_joint(to) - yb_joint(n))))
    print('ALIGN worst posed bone direction', round(worst, 3), 'deg')

    # Each bone's move from the modelled pose to the T-pose (armature space = world: the rig sits at the origin).
    move = {n: pb[P + n].matrix @ rest[n].inverted() for n in names}
    joints = {}
    for n in yb:
        joints[n] = mp_joint(n) if (n in ENDS or n in names) else None
        if joints[n] is None:
            raise ValueError('MPFB rig has no ' + n)
    for n in ENDS:
        move[n] = move[ENDS[n]]
    # Reported against the game skeleton (Blender axes, metres).
    for n in ('Hips', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'Spine2', 'Neck', 'Head', 'HeadTop_End', 'LeftArm', 'LeftHand'):
        print('JOINT', n.ljust(12), 'body', [round(x, 3) for x in joints[n]], 'game', [round(x, 3) for x in yb_joint(n)])
    bpy.ops.object.mode_set(mode='OBJECT')

    # ---------- atlases ----------
    def img_of(o):
        mat = o.data.materials[0] if o.data.materials else None
        best = None
        for nd in (mat.node_tree.nodes if mat and mat.use_nodes else []):
            if nd.type == 'TEX_IMAGE' and nd.image and 'diffuse' in nd.name.lower():
                best = nd.image
        return best

    def ao_of(o):
        mat = o.data.materials[0]
        for nd in mat.node_tree.nodes:
            if nd.type == 'TEX_IMAGE' and nd.image and nd.name.lower().startswith('aomap'):
                return nd.image
        return None

    def paste(atlas, W, img, rect, grey=False):
        x0, y0, w, h = rect
        im = img.copy()
        im.scale(w, h)
        px = np.empty(w * h * 4, dtype=np.float32)
        im.pixels.foreach_get(px)
        px = px.reshape(h, w, 4)
        if grey:
            g = px[:, :, :3].mean(axis=2, keepdims=True)
            px = np.concatenate([g, g, g, np.ones_like(g)], axis=2)
        atlas[y0:y0 + h, x0:x0 + w] = px
        bpy.data.images.remove(im)

    def save(atlas, size, path, alpha):
        W, H = size
        im = bpy.data.images.new(os.path.basename(path), W, H, alpha=alpha)
        im.pixels.foreach_set(atlas.reshape(-1))
        im.filepath_raw = path
        im.file_format = 'WEBP'
        im.save(filepath=path, quality=88)
        bpy.data.images.remove(im)

    opaque = np.zeros((OPAQUE_SIZE[1], OPAQUE_SIZE[0], 4), dtype=np.float32)
    opaque[:, :, 3] = 1
    alpha = np.zeros((ALPHA_SIZE[1], ALPHA_SIZE[0], 4), dtype=np.float32)
    for o in meshes:
        kd = kinds[o.name]
        if kd == 'body':
            paste(opaque, OPAQUE_SIZE[0], img_of(o), RECT['skin'])
        elif kd == 'suit':
            paste(opaque, OPAQUE_SIZE[0], ao_of(o), RECT['clothes'], grey=True)
        elif kd == 'eye':
            paste(opaque, OPAQUE_SIZE[0], img_of(o), RECT['eye'])
        elif kd in ALPHA_PARTS:
            paste(alpha, ALPHA_SIZE[0], img_of(o), RECT[kd])
    # Alpha-tested edges: colour bled out under the transparent texels so filtering never pulls in black.
    rgb = alpha[:, :, :3].copy()
    has = alpha[:, :, 3] > 0.05
    for _ in range(8):
        acc = np.zeros_like(rgb)
        cnt = np.zeros(has.shape, dtype=np.float32)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            acc += np.roll(np.roll(rgb * has[:, :, None], dy, 0), dx, 1)
            cnt += np.roll(np.roll(has.astype(np.float32), dy, 0), dx, 1)
        fill = ~has & (cnt > 0)
        rgb[fill] = acc[fill] / cnt[fill][:, None]
        has = has | fill
    alpha[:, :, :3] = rgb
    save(opaque, OPAQUE_SIZE, os.path.join(out, 'opaque.webp'), False)
    save(alpha, ALPHA_SIZE, os.path.join(out, 'alpha.webp'), True)

    # ---------- mesh export (game axes: three (x, y, z) = Blender (x, z, -y), metres) ----------
    bone_names = list(yb)
    bone_ix = {n: i for i, n in enumerate(bone_names)}
    # The trainers (shoes05) carry their own crew sock: the thin tube above the shoe's collar (the shoe's vertices
    # are dense to 11 cm, the tube's rings sparse from 12 to 24 cm).
    sock_from = 0.118

    def uv_to(rect, size, u, v):
        x0, y0, w, h = rect
        return ((x0 + min(max(u, 0), 1) * w) / size[0], (y0 + min(max(v, 0), 1) * h) / size[1])

    buffers = {'opaque': {'pos': [], 'nrm': [], 'uv': [], 'si': [], 'sw': [], 'part': [], 'index': []},
               'alpha': {'pos': [], 'nrm': [], 'uv': [], 'si': [], 'sw': [], 'part': [], 'index': []}}
    for o in meshes:
        kd = kinds[o.name]
        me = o.data
        me.calc_loop_triangles()
        uvl = me.uv_layers.active.data
        gname = {g.index: g.name for g in o.vertex_groups}
        kind = 'alpha' if kd in ALPHA_PARTS else 'opaque'
        B = buffers[kind]
        base = len(B['part'])
        seen = {}
        for tri in me.loop_triangles:
            u0, v0 = 0, 0
            for li in tri.loops:
                u0 += uvl[li].uv.x / 3
                v0 += uvl[li].uv.y / 3
            for li, vi in zip(tri.loops, tri.vertices):
                u, v = uvl[li].uv
                key = (vi, round(u, 5), round(v, 5))
                if key not in seen:
                    vert = me.vertices[vi]
                    co = vert.co
                    if kd == 'body':
                        part, uv = 'skin', uv_to(RECT['skin'], OPAQUE_SIZE, u, v)
                    elif kd == 'suit':
                        # The suit's atlas: the shirt on the top half, the trousers below.
                        part = 'shirt' if v0 > 0.57 else 'shorts'
                        uv = uv_to(RECT['clothes'], OPAQUE_SIZE, u, v)
                    elif kd == 'shoe':
                        part, uv = ('sock' if co.z > sock_from else 'shoe'), (0.0, 0.0)
                    elif kd == 'eye':
                        part, uv = 'eye', uv_to(RECT['eye'], OPAQUE_SIZE, u, v)
                    else:
                        part, uv = kd, uv_to(RECT[kd], ALPHA_SIZE, u, v)
                    ws = sorted(((g.weight, gname[g.group]) for g in vert.groups
                                 if gname.get(g.group, '').startswith(P) and g.weight > 1e-4), reverse=True)[:4]
                    tot = sum(w for w, _ in ws) or 1
                    si = [bone_ix[n[len(P):]] for _, n in ws] + [0] * (4 - len(ws))
                    sw = [w / tot for w, _ in ws] + [0] * (4 - len(ws))
                    if not ws:
                        si, sw = [bone_ix['Hips'], 0, 0, 0], [1, 0, 0, 0]
                    nrm = vert.normal
                    seen[key] = base + len(seen)
                    B['pos'] += [co.x, co.z, -co.y]
                    B['nrm'] += [nrm.x, nrm.z, -nrm.y]
                    B['uv'] += list(uv)
                    B['si'] += si
                    B['sw'] += sw
                    B['part'].append(PART[part])
                B['index'].append(seen[key])
        print('MESH', o.name, kd, len(seen), 'vertices', len(me.loop_triangles), 'triangles')

    C = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))

    def game_m(m):
        g = C @ m @ C.transposed()
        return [g[r][c] for c in range(4) for r in range(4)]  # column-major (THREE.Matrix4.fromArray)

    blob = bytearray()
    header = {'name': spec['name'], 'height': want, 'bones': bone_names,
              'joints': [[joints[n].x, joints[n].z, -joints[n].y] for n in bone_names],
              'move': [game_m(move[n]) for n in bone_names],
              'textures': {'opaque': 'opaque.webp', 'alpha': 'alpha.webp'}, 'parts': PART, 'meshes': {}}
    for kind, B in buffers.items():
        ent = {'vertices': len(B['part']), 'indices': len(B['index'])}
        for key, fmt in (('pos', 'f'), ('nrm', 'f'), ('uv', 'f'), ('si', 'B'), ('sw', 'f'), ('part', 'B'), ('index', 'I')):
            data = struct.pack('<%d%s' % (len(B[key]), fmt), *B[key])
            ent[key] = [len(blob), len(data)]
            blob += data
            blob += b'\0' * ((4 - len(blob) % 4) % 4)
        header['meshes'][kind] = ent
    open(os.path.join(out, 'body.bin'), 'wb').write(bytes(blob))
    json.dump(header, open(os.path.join(out, 'body.json'), 'w'))
    print('WROTE', out, len(blob) // 1024, 'KB')

    if preview:
        # The T-pose, skinned (the armature modifiers follow the posed rig).
        select_only(rig)
        bpy.ops.object.mode_set(mode='POSE')
        bpy.ops.object.mode_set(mode='OBJECT')
        scn = bpy.context.scene
        scn.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE'
        scn.render.image_settings.file_format = 'PNG'
        scn.render.image_settings.color_mode = 'RGBA'
        scn.render.resolution_x, scn.render.resolution_y = 1400, 1000
        scn.world = scn.world or bpy.data.worlds.new('w')
        scn.world.use_nodes = True
        bg = scn.world.node_tree.nodes.get('Background')
        bg.inputs[0].default_value = (0.55, 0.57, 0.6, 1)
        bg.inputs[1].default_value = 0.6
        sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
        sun.data.energy = 3.5
        sun.rotation_euler = (math.radians(50), 0, math.radians(30))
        scn.collection.objects.link(sun)
        cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
        cam.data.lens = 50
        scn.collection.objects.link(cam)
        scn.camera = cam
        for tag, ang in (('tpose', 0), ('tpose3', 40)):
            a = math.radians(ang)
            cam.location = (5.5 * math.sin(a), -5.5 * math.cos(a), 0.95)
            d = Vector((0, 0, 0.95)) - cam.location
            cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
            scn.render.filepath = os.path.join(out, f"{spec['name']}-{tag}.png")
            bpy.ops.render.render(write_still=True)
