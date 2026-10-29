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
# - The face (person_face.py): expression and gaze shape keys on the body and its proxies, skin regions, the scalp
#   and brows painted under the hair, ambient occlusion baked with Cycles in the T-pose.
# - Textures packed into two atlases at the sources' full resolution: opaque (skin with its baked occlusion in alpha,
#   the clothes' ambient occlusion for team colours, eyes, teeth, tongue) and alpha-tested (hair, brows, lashes). The
#   suit's own diffuse (a printed logo, jeans) and the trainers' texture (a photo of a branded shoe) are not used:
#   the game colours them.
import os, json, math, struct
import bpy, bmesh, mathutils
import numpy as np
from mathutils import Vector, Matrix

from bl_ext.user_default.mpfb.services.targetservice import TargetService
from bl_ext.user_default.mpfb.services.assetservice import AssetService
import person_face as face

P = 'mixamorig:'
# Part codes (the game's body shader colours by them).
PART = {'skin': 0, 'shirt': 1, 'shorts': 2, 'shoe': 3, 'eye': 4, 'sock': 5, 'hair': 6, 'brow': 7, 'lash': 8,
        'teeth': 9, 'tongue': 10}
ALPHA_PARTS = ('hair', 'brow', 'lash')
# Atlas rectangles in pixels from the bottom left (Blender's image rows run upwards, like UV v).
# Skin at its source's 2048 (MakeHuman's skins), hair at 2048, the rest at 1024 or 512.
OPAQUE_SIZE = (3072, 2048)
ALPHA_SIZE = (2560, 2048)
RECT = {'skin': (0, 0, 2048, 2048), 'clothes': (2048, 1024, 1024, 1024), 'eye': (2048, 512, 512, 512),
        'teeth': (2560, 512, 512, 512), 'tongue': (2048, 0, 512, 512),
        'hair': (0, 0, 2048, 2048), 'brow': (2048, 1024, 512, 512), 'lash': (2048, 512, 512, 512)}
# The game skeleton's bone order (ybot-rest.json keys) is the output order.
SIDES = ('Left', 'Right')
# The thigh's skin goes SKIN_UP up inside the shorts' legs; their openings stand HEM_FLARE off it at the hem, easing to
# nothing HEM_UP above (REVIEW.md round 3 critic #3).
SKIN_UP = 0.06
HEM_FLARE = 0.004
HEM_UP = 0.04
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
    for part, key in (('eye', 'eyes'), ('brow', 'eyebrows'), ('lash', 'eyelashes'), ('hair', 'hair'), ('teeth', 'teeth'),
                      ('tongue', 'tongue')):
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
    # ---------- the eyes' cornea shell out ----------
    # MakeHuman's high-poly eyes put a cornea shell over the eyeball, mapped to a transparent patch of the eye texture;
    # drawn opaque it hid the iris (and baked the eyeball's occlusion black). The wet look comes from the eyeball's
    # clearcoat in the game instead.
    for o in meshes:
        if kinds[o.name] != 'eye':
            continue
        mat = o.data.materials[0]
        img = next((nd.image for nd in mat.node_tree.nodes if nd.type == 'TEX_IMAGE' and nd.image), None)
        W0, H0 = img.size
        px = np.empty(W0 * H0 * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        alpha_at = px.reshape(H0, W0, 4)[:, :, 3]
        bm = bmesh.new()
        bm.from_mesh(o.data)
        uvl = bm.loops.layers.uv.active
        dead = []
        for f in bm.faces:
            u = sum(l[uvl].uv.x for l in f.loops) / len(f.loops)
            v = sum(l[uvl].uv.y for l in f.loops) / len(f.loops)
            if alpha_at[min(H0 - 1, max(0, int(v * H0))), min(W0 - 1, max(0, int(u * W0)))] < 0.5:
                dead.append(f)
        bmesh.ops.delete(bm, geom=dead, context='FACES')
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
        bm.to_mesh(o.data)
        bm.free()
        o.data.update()
        print('FACE cornea faces out', len(dead), 'eye vertices left', len(o.data.vertices))

    # ---------- the face's shape keys (before anything is scaled or deleted: the units index the whole basemesh) ----------
    units = face.expression_keys(body, meshes, kinds, spec)
    masks = face.region_masks(body, units, rig.data.bones[P + 'Head'].head_local.z)
    for k, name in enumerate(('mask_lips', 'mask_tzone', 'mask_lids', 'mask_ears')):
        at = body.data.attributes.new(name, 'FLOAT', 'POINT')
        at.data.foreach_set('value', masks[:, k].astype(np.float32))
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
        # The body under the suit is masked by a vertex group; the legs show again from SKIN_UP inside the hem down
        # (REVIEW.md round 3 critic #3). Cut 2 cm under the hem, the skin's top ring ended 0.4-4 cm below it: looking
        # up into the hem, or with the hem lifted by a stride, there was a ring of nothing between the thigh and the
        # shorts, and the court showed through the back of the knee.
        g = body.vertex_groups.get('Delete.' + spec['clothes'][0])
        if g:
            g.remove([v.index for v in body.data.vertices if v.co.z < hem + SKIN_UP])
        print('SHORTS cut', len(dead), 'faces at', hem)

    # ---------- the kit fitted (person_face.fit_suit), before the skin under it is masked away ----------
    if suit is not None:
        face.fit_suit(body, suit, rig.data.bones[P + 'Hips'].head_local.z)
        face.cut_shorts_under_shirt(suit)
        if hem is not None:
            sm = suit.data
            n_flare = 0
            for v in sm.vertices:
                u = (v.co.z - hem) / HEM_UP
                if u < 1:
                    v.co += v.normal * HEM_FLARE * (1 - max(0.0, u))
                    n_flare += 1
            sm.update()
            print('HEM flared', n_flare, 'vertices')

    # ---------- helpers and hidden skin out ----------
    # As the MASK modifiers would (a vertex survives every mask), by bmesh: applying a modifier fails on a mesh with
    # shape keys, and bmesh keeps the keys and attributes of what stays.
    select_only(body)
    keep = np.ones(len(body.data.vertices), dtype=bool)
    for m in list(body.modifiers):
        if m.type != 'MASK':
            continue
        g = body.vertex_groups.get(m.vertex_group)
        inside = np.zeros(len(keep), dtype=bool)
        if g is not None:
            for v in body.data.vertices:
                for e in v.groups:
                    if e.group == g.index and e.weight > m.threshold:
                        inside[v.index] = True
        keep &= ~inside if m.invert_vertex_group else inside
        body.modifiers.remove(m)
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.verts[i] for i in np.nonzero(~keep)[0]], context='VERTS')
    bm.to_mesh(body.data)
    bm.free()
    body.data.update()
    print('MASKED', int((~keep).sum()), 'vertices out,', len(body.data.vertices), 'left')

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
    # (the thigh inside the shorts' legs stays, to SKIN_UP up: see the shorts above)
    inside_hem = (lambda z: hem - 0.05 < z < hem + SKIN_UP) if hem is not None else (lambda z: False)
    gone = {v.index for v in bm.verts if v.index in covered and kd.find(v.co)[2] > 0.025 and not inside_hem(v.co.z)}
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

    # ---------- ambient occlusion (Cycles, the T-pose) ----------
    # The alpha-tested cards (hair, brows, lashes) are left out of the bake: Cycles' AO sees a card's whole quad, and
    # the fringe's cards would shade the forehead under their transparent parts. The scalp under them is painted below.
    by_kind = {}
    for o in meshes:
        by_kind.setdefault(kinds[o.name], []).append(o)
    hidden = [o for o in meshes if kinds[o.name] in ALPHA_PARTS]
    for o in hidden:
        o.hide_render = True
    face.cycles_setup()
    import time
    t0 = time.time()
    ao = {'body': face.bake_ao_image(body, RECT['skin'][2], 'ao_skin')}
    # Teeth and tongue with the mouth open: closed, the lips hide them completely and they would bake black.
    face.set_keys(meshes, {'jawOpen': 1.0, 'grimace': 0.7})
    for kd in ('teeth', 'tongue'):
        for o in by_kind.get(kd, []):
            ao[kd] = face.bake_ao_image(o, RECT[kd][2], 'ao_' + kd)
    face.set_keys(meshes, {})
    vao = {}
    for kd in ('eye', 'shoe'):
        for o in by_kind.get(kd, []):
            vao[o.name] = face.bake_ao_vertices(o)
    for o in hidden:
        o.hide_render = False
    for o in by_kind.get('hair', []):
        vao[o.name] = face.hair_depth_ao(o, body)
    print('AO baked in', round(time.time() - t0, 1), 's; skin mean', round(float(ao['body'].mean()), 3))

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

    def pixels(img, w=None, h=None):
        # Read at the image's own size and resized here: Image.scale() on a copy of an image whose buffer isn't
        # loaded yet leaves the buffer at its old size, and the rows came out as streaks (the teeth, the tongue).
        W0, H0 = img.size
        px = np.empty(W0 * H0 * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        out = px.reshape(H0, W0, 4)
        if w and (w, h) != (W0, H0):
            out = face.resize(out, w, h)
        return out

    def paste(atlas, img, rect, grey=False):
        x0, y0, w, h = rect
        px = pixels(img, w, h) if not isinstance(img, np.ndarray) else img
        if grey:
            g = px[:, :, :3].mean(axis=2, keepdims=True)
            px = np.concatenate([g, g, g, np.ones_like(g)], axis=2)
        atlas[y0:y0 + h, x0:x0 + w] = px
        return atlas[y0:y0 + h, x0:x0 + w]

    def save(atlas, size, path, alpha):
        W, H = size
        im = bpy.data.images.new(os.path.basename(path), W, H, alpha=alpha)
        im.pixels.foreach_set(atlas.reshape(-1))
        im.filepath_raw = path
        im.file_format = 'WEBP'
        im.save(filepath=path, quality=90)
        bpy.data.images.remove(im)

    opaque = np.zeros((OPAQUE_SIZE[1], OPAQUE_SIZE[0], 4), dtype=np.float32)
    opaque[:, :, 3] = 1
    alpha = np.zeros((ALPHA_SIZE[1], ALPHA_SIZE[0], 4), dtype=np.float32)
    eye_png = None
    if spec.get('eye_colour'):
        eye_png = AssetService.find_asset_absolute_path('materials/' + spec['eye_colour'] + '_eye.png', asset_subdir='eyes')
    for o in meshes:
        kd = kinds[o.name]
        if kd == 'body':
            skin = paste(opaque, img_of(o), RECT['skin'])
            skin[:, :, 3] = ao['body']
        elif kd == 'suit':
            paste(opaque, ao_of(o), RECT['clothes'], grey=True)
        elif kd == 'eye':
            img = bpy.data.images.load(eye_png) if eye_png else img_of(o)
            paste(opaque, img, RECT['eye'])[:, :, 3] = 1
        elif kd in ('teeth', 'tongue'):
            r = paste(opaque, img_of(o), RECT[kd])
            r[:, :, 3] = ao.get(kd, 1)
        elif kd in ALPHA_PARTS:
            paste(alpha, img_of(o), RECT[kd])

    # ---------- the scalp and brows under the hair ----------
    t0 = time.time()
    skin = opaque[0:RECT['skin'][3], 0:RECT['skin'][2]]
    S = RECT['skin'][2]
    for kd, res, reach, near, blur_r, strength, dark in (('hair', 512, 0.06, 0.05, 1, 0.92, 0.55),
                                                         ('brow', 1024, 0.008, 0.02, 1, 0.55, 0.8)):
        for o in by_kind.get(kd, []):
            px = pixels(img_of(o))
            cov, col, rays = face.coverage_map(body, o, px, res, reach, near)
            # A little wider and softer than the cards' own reach: roots and fine hair round the edge.
            cov = np.maximum(cov, face.blur(cov, blur_r * 2) * 0.85)
            cov = face.blur(cov, blur_r)
            has = cov > 0.01
            mean = col[has].mean(axis=0) if has.any() else np.array([0.1, 0.07, 0.05])
            col[~has] = mean
            col = face.blur(col, 2)
            c = face.upscale(cov, S)[:, :, None] * strength
            tint = face.upscale(col, S) * dark
            skin[:, :, :3] = skin[:, :, :3] * (1 - c) + tint * c
            if kd == 'hair':
                # Under real hair the scalp is in the hair's shadow: its occlusion (atlas alpha) goes down with the
                # coverage, which the game also reads as the skin's cavity for its specular.
                skin[:, :, 3] *= 1 - 0.8 * face.upscale(cov, S)
            print('PAINT', kd, 'coverage texels', int(has.sum()), 'of', res * res, 'rays', rays)
    print('PAINT took', round(time.time() - t0, 1), 's')

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
    save(opaque, OPAQUE_SIZE, os.path.join(out, 'opaque.webp'), True)
    save(alpha, ALPHA_SIZE, os.path.join(out, 'alpha.webp'), True)

    # ---------- mesh export (game axes: three (x, y, z) = Blender (x, z, -y), metres) ----------
    bone_names = list(yb)
    bone_ix = {n: i for i, n in enumerate(bone_names)}
    # The trainers (shoes05) carry their own crew sock: the thin tube above the shoe's collar (the shoe's vertices
    # are dense to 11 cm, the tube's rings sparse from 12 to 24 cm).
    sock_from = 0.118
    NM = len(face.MORPHS)

    def uv_to(rect, size, u, v):
        x0, y0, w, h = rect
        return ((x0 + min(max(u, 0), 1) * w) / size[0], (y0 + min(max(v, 0), 1) * h) / size[1])

    def fresh():
        return {'pos': [], 'nrm': [], 'uv': [], 'si': [], 'sw': [], 'part': [], 'index': [], 'ao': [], 'mask': [], 'morph': []}
    buffers = {'opaque': fresh(), 'alpha': fresh()}
    zero6 = [0.0] * 6
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
        sd = face.shape_deltas(o)
        mk = [me.attributes[n].data for n in ('mask_lips', 'mask_tzone', 'mask_lids', 'mask_ears')] if kd == 'body' else None
        va = vao.get(o.name)
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
                    elif kd in ('eye', 'teeth', 'tongue'):
                        part, uv = kd, uv_to(RECT[kd], OPAQUE_SIZE, u, v)
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
                    B['ao'].append(float(va[vi]) if va is not None else 1.0)
                    B['mask'] += [mk[k][vi].value for k in range(4)] if mk else [0.0] * 4
                    for name in face.MORPHS:
                        d = sd.get(name)
                        if d is None:
                            B['morph'] += zero6
                        else:
                            p, n = d[0][vi], d[1][vi]
                            B['morph'] += [p[0], p[2], -p[1], n[0], n[2], -n[1]]
                B['index'].append(seen[key])
        print('MESH', o.name, kd, len(seen), 'vertices', len(me.loop_triangles), 'triangles', 'keys', len(sd))

    C = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))

    def game_m(m):
        g = C @ m @ C.transposed()
        return [g[r][c] for c in range(4) for r in range(4)]  # column-major (THREE.Matrix4.fromArray)

    blob = bytearray()
    header = {'name': spec['name'], 'height': want, 'bones': bone_names,
              'joints': [[joints[n].x, joints[n].z, -joints[n].y] for n in bone_names],
              'move': [game_m(move[n]) for n in bone_names],
              'textures': {'opaque': 'opaque.webp', 'alpha': 'alpha.webp'}, 'parts': PART, 'morphs': face.MORPHS,
              'meshes': {}}
    for kind, B in buffers.items():
        ent = {'vertices': len(B['part']), 'indices': len(B['index'])}
        for key, fmt in (('pos', 'f'), ('nrm', 'f'), ('uv', 'f'), ('si', 'B'), ('sw', 'f'), ('part', 'B'), ('index', 'I'),
                         ('ao', 'f'), ('mask', 'f'), ('morph', 'f')):
            data = np.asarray(B[key], dtype={'f': '<f4', 'B': 'u1', 'I': '<u4'}[fmt]).tobytes()
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
