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
# - What the suit doesn't have is generated in person_kit.py from the body it goes on (spec "kit"): the sleeves off a tank, a
#   skirt, a headband or visor.
import os, json, math, struct
import bpy, bmesh, mathutils
import numpy as np
from mathutils import Vector, Matrix

from bl_ext.user_default.mpfb.services.targetservice import TargetService
from bl_ext.user_default.mpfb.services.assetservice import AssetService
import person_face as face
import person_kit as kit
import person_wear as pw

P = 'mixamorig:'
# Part codes (the game's body shader colours by them).
PART = {'skin': 0, 'shirt': 1, 'shorts': 2, 'shoe': 3, 'eye': 4, 'sock': 5, 'hair': 6, 'brow': 7, 'lash': 8,
        'teeth': 9, 'tongue': 10}
ALPHA_PARTS = ('hair', 'brow', 'lash')
# Atlas rectangles in pixels from the bottom left (Blender's image rows run upwards, like UV v).
# Skin at its source's 2048 (MakeHuman's skins), hair at 2048, the rest at 1024 or 512. The ramp: a grey from black to white
# along u, where generated cloth's baked occlusion is looked up (person_wear.py).
OPAQUE_SIZE = (3072, 2048)
ALPHA_SIZE = (2560, 2048)
RECT = {'skin': (0, 0, 2048, 2048), 'clothes': (2048, 1024, 1024, 1024), 'eye': (2048, 512, 512, 512),
        'teeth': (2560, 512, 512, 512), 'tongue': (2048, 0, 512, 256), 'ramp': (2048, 256, 512, 256), 'skirt': (2560, 0, 512, 512),
        'hair': (0, 0, 2048, 2048), 'brow': (2048, 1024, 512, 512), 'lash': (2048, 512, 512, 512)}
# The game skeleton's bone order (ybot-rest.json keys) is the output order.
SIDES = ('Left', 'Right')
# The thigh's skin goes SKIN_UP up inside the shorts' legs; their openings stand HEM_FLARE off it at the hem, easing to
# nothing HEM_UP above (REVIEW.md round 3 critic #3).
SKIN_UP = 0.06
HEM_FLARE = 0.004
HEM_UP = 0.04
# How far round skin a cut can bare the bake without the clothes blends in (m).
REVEAL_BLEND = 0.03
SHORTS_EASE = {False: 0.016, True: 0.014}
SHORTS_INNER = 0.8
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
    if n.startswith('Skirt'):
        return 'skirt'
    if n.startswith('HeadPiece') or n.startswith('Collar'):
        return 'extra'
    if n.startswith('Wear.'):
        return 'wear'
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

    # ---------- the eyes clear of hair ----------
    # A fringe over one eye is a look, not one anybody plays padel with (review round 7, the critic's #1: p5 and p9).
    eye_pts = [o.matrix_world @ v.co for o in meshes if kinds[o.name] == 'eye' for v in o.data.vertices]
    if eye_pts:
        brow_z = max(c.z for c in eye_pts) + 0.016
        eye_y = sum(c.y for c in eye_pts) / len(eye_pts)
        for o in meshes:
            if kinds[o.name] != 'hair':
                continue
            bm = bmesh.new()
            bm.from_mesh(o.data)
            dead = []
            for f in bm.faces:
                c = o.matrix_world @ f.calc_center_median()
                if c.z < brow_z and c.y < eye_y + 0.015 and abs(c.x) < 0.09:
                    dead.append(f)
            bmesh.ops.delete(bm, geom=dead, context='FACES')
            bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
            bm.to_mesh(o.data)
            bm.free()
            o.data.update()
            print('FACE fringe faces out', len(dead))

    # ---------- a closer cut of the same hair ----------
    # There are too few haircuts for ten heads (MakeHuman has five a man can wear): "hair_fit" takes a head of hair in towards
    # the scalp, each vertex to that share of its height over the skin, down to a little over it.
    if spec.get('hair_fit'):
        from mathutils.bvhtree import BVHTree
        fit = spec['hair_fit']
        scalp = BVHTree.FromPolygons([v.co.copy() for v in body.data.vertices],
                                     [tuple(p.vertices) for p in body.data.polygons if max(p.vertices) < kit.N_BODY])
        for o in meshes:
            if kinds[o.name] != 'hair':
                continue
            for v in o.data.vertices:
                q = scalp.find_nearest(v.co)[0]
                if q is not None:
                    d = v.co - q
                    v.co = q + d * max(fit, min(1.0, 0.003 / max(d.length, 1e-6)))
            o.data.update()
            print('FACE hair fit', fit)
    # "hair_trim": cut level with the back of the shirt's collar (metres over the Neck joint), a little lower in front. Long
    # hair on these cards runs inside the shirt, and the shirt draws a ragged line across it.
    if spec.get('hair_trim') is not None:
        at = Vector((0, 0, rig.data.bones[P + 'Neck'].head_local.z + spec['hair_trim']))
        tilt = Vector((0, -0.25, 1)).normalized()  # (the model faces -y)
        for o in meshes:
            if kinds[o.name] != 'hair':
                continue
            bm = bmesh.new()
            bm.from_mesh(o.data)
            bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=at, plane_no=tilt, clear_inner=True)
            bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
            bm.to_mesh(o.data)
            bm.free()
            o.data.update()
            print('FACE hair trim', spec['hair_trim'], 'vertices left', len(o.data.vertices))

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
    print('BUILD', json.dumps(kit.body_build(body, rig, spec['name'])))

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
    outfit = spec.get('kit', {})
    women = spec['clothes'][0].startswith('female_')
    armholes = None
    under = None
    # (the shirt as MakeHuman fitted it: every other cut is made from it as this one is, person_wear.make_tops)
    raw = pw.shirt_only(suit, women, 'Wear.raw') if suit is not None else None
    if suit is not None:
        if outfit.get('top') == 'tank':
            armholes = kit.cut_tank(suit, body, rig, women, face.shirt_polygons(suit.data, women))
        face.fit_suit(body, suit, rig.data.bones[P + 'Hips'].head_local.z, rig.data.bones[P + 'LeftArm'].head_local.z, women,
                      seed=sum(ord(c) for c in spec['name']), folds=outfit.get('bottom', 'shorts') == 'shorts',
                      hang_from=face.HANG_FROM_TANK if outfit.get('top') == 'tank' else None)
        face.cut_shorts_under_shirt(suit, women)
        if hem is not None:
            sm = suit.data
            n_flare = 0
            for v in sm.vertices:
                u = (v.co.z - hem) / HEM_UP
                if u < 1:
                    v.co += v.normal * HEM_FLARE * (1 - max(0.0, u))
                    n_flare += 1
            if outfit.get('bottom', 'shorts') == 'shorts':
                # Shorts stand off the leg, more towards the hem, hanging from the seat and the thigh's front: the men's suit is a pair of
                # trousers cut off, the women's legs are jeans-tight. Less on the inside of the leg, where two legs of shorts would
                # go through each other.
                top = set()
                for p, s in zip(sm.polygons, face.shirt_polygons(sm, women)):
                    if s:
                        top.update(p.vertices)
                # The same shorts as they are before standing off the leg, worn instead under a skirt (person_wear.PIECES 'under'): loose,
                # the thighs carried them out through a skirt's front in a ready stance, and the skirt sized over them hung 25 cm out.
                under = pw.copy_of(suit, 'Wear.under', keep=lambda po: not any(i in top for i in po.vertices))
                z0 = rig.data.bones[P + 'Hips'].head_local.z - 0.04
                ease = SHORTS_EASE[women]
                for v in sm.vertices:
                    if v.index not in top and v.co.z < z0:
                        inner = max(0.0, -v.normal.x * (1 if v.co.x > 0 else -1))
                        level = Vector((v.normal.x, v.normal.y, 0))  # (along the normal itself it took the hem down with it)
                        v.co += level * ease * min(1.0, (z0 - v.co.z) / (z0 - hem)) * (1 - SHORTS_INNER * inner)
            sm.update()
            print('HEM flared', n_flare, 'vertices')

    # ---------- what the suit doesn't have (person_kit.py), built on the fitted body and suit ----------
    def wear(o):
        meshes.append(o)
        kinds[o.name] = kind_of(o, spec)
    skirt_style = outfit.get('bottom') in ('pleated', 'aline') and outfit['bottom']
    if skirt_style:
        wear(kit.make_skirt(body, suit, rig, spec, women))
    # The skirts and the collar not modelled: any player can choose them (person_wear.py's cuts; M5 phase C step 5). A skirt
    # chosen instead of shorts goes over them, its hem SKIRT_BELOW under theirs; on a skirted body the other style hangs as far.
    # They are out of every bake (`unworn`): baked under a skirt, a player in shorts had dark thighs.
    unworn = []
    for style in ('pleated', 'aline'):
        if style != skirt_style and suit is not None:
            at = outfit['skirt'] if skirt_style else (hem if hem is not None else 0.4 * want) - kit.SKIRT_BELOW
            unworn.append(kit.make_skirt(body, suit, rig, spec, women, style, at, under=under))
            wear(unworn[-1])
    if outfit.get('top') == 'polo' or (outfit.get('top', 'tee') == 'tee' and suit is not None):
        wear(kit.make_collar(body, suit, rig, women))
        if outfit.get('top') != 'polo':
            unworn.append(meshes[-1])
    if outfit.get('head'):
        hair_o = next((o for o in meshes if kinds[o.name] == 'hair'), None)
        eyes = [v.co.copy() for o in meshes if kinds[o.name] == 'eye' for v in o.data.vertices]
        wear(kit.make_head_piece(body, hair_o, rig, eyes, outfit['head']))
    shoe = next(o for o in meshes if kinds[o.name] == 'shoe')
    crew = pw.split_crew(shoe)
    wear(crew)

    # ---------- helpers and hidden skin out ----------
    # As the MASK modifiers would (a vertex survives every mask), by bmesh: applying a modifier fails on a mesh with
    # shape keys, and bmesh keeps the keys and attributes of what stays.
    select_only(body)
    # The skin behind the neckline stays: the game opens the collar (kit.ts, a smooth cut in the shader) and the gap showed
    # holes and slivers where this skin had gone (review round 6, the critic's #7).
    neck = rig.data.bones[P + 'Neck'].head_local
    behind_collar = lambda c: abs(c.x - neck.x) < 0.105 and neck.z - 0.1 < c.z < neck.z + 0.03 and neck.y - 0.16 < c.y < neck.y + 0.025
    keep = np.ones(len(body.data.vertices), dtype=bool)
    # The clothes' delete groups: the skin each garment hides outright (kept, and hidden by the game when that garment is
    # worn: person_wear.hide_masks). The helpers' mask still takes MakeHuman's helper geometry out.
    deleted = {}
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
        gone = ~inside if not m.invert_vertex_group else inside
        if m.vertex_group.startswith('Delete.'):
            deleted[m.vertex_group[len('Delete.'):]] = gone[:kit.N_BODY].copy()
        keep &= ~gone
        print('MASK', m.name, m.vertex_group, 'skin vertices', int(gone[:kit.N_BODY].sum()), 'helpers', int(gone[kit.N_BODY:].sum()))
        body.modifiers.remove(m)
    # (the first BODY_VERTS are the skin, all of it kept; after them come MakeHuman's helpers, which must stay out)
    keep[:kit.N_BODY] = True
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.verts[i] for i in np.nonzero(~keep)[0]], context='VERTS')
    bm.to_mesh(body.data)
    bm.free()
    body.data.update()
    print('MASKED', int((~keep).sum()), 'vertices out,', len(body.data.vertices), 'left')

    # ---------- every cut, and the skin each hides ----------
    # The masks leave skin under the sleeves and over the shoulders, and it pokes through once the arm moves. The
    # clothes go 3 mm out along their normals; then skin that sees a garment within 3 cm straight out from it is hidden by that
    # garment, except a 2.5 cm band next to the skin that shows, so looking into a sleeve never shows a hole in the arm. The
    # skin stays in the mesh with a mask of the garments that hide it (person_wear.hide_masks): the game draws what the worn ones
    # leave bare.
    from mathutils.kdtree import KDTree
    if under is not None:
        wear(under)
    for o in meshes:
        if kinds[o.name] == 'suit' or o is under:
            pw.push(o)
    if armholes:
        kit.hug_armholes(suit, body, armholes, women)
    top0 = 'tank' if outfit.get('top') == 'tank' else 'tee'
    tops = pw.make_tops(body, raw, rig, spec, women, outfit.get('top', 'tee'), suit) if suit is not None else {}
    bpy.data.objects.remove(raw)
    for o in tops.values():
        wear(o)
    if 'tee' in tops:
        # (a body modelled in a tank: its collar lies on the tee built for it)
        unworn.append(kit.make_collar(body, tops['tee'], rig, women, whole=True, lift=0.0045 - pw.PUSH))
        wear(unworn[-1])
    socks = pw.make_socks(body, crew, shoe, rig)
    for o in socks.values():
        wear(o)
    tights = pw.make_tights(body, rig, hem, shoe, crew) if hem is not None else None
    if tights:
        wear(tights)
    piece_obj = {**tops, **socks, 'crew': crew, 'shoe': shoe}
    if tights:
        piece_obj['tights'] = tights
    if under is not None:
        piece_obj['under'] = under
    is_shirt = face.shirt_polygons(suit.data, women)
    cover = {top0: pw.covered_by(body, suit, is_shirt), 'shorts': pw.covered_by(body, suit, [not x for x in is_shirt])}
    for name, o in piece_obj.items():
        cover[name] = pw.covered_by(body, o)
    # MakeHuman's delete groups: the suit's split between its shirt and its shorts by the nearer, the shoes' between the shoe and the sock.
    skin_co = [body.data.vertices[i].co for i in range(kit.N_BODY)]
    mask = {}
    sm = suit.data
    sv_shirt = np.zeros(len(sm.vertices), dtype=bool)
    for po, sh in zip(sm.polygons, is_shirt):
        if sh:
            sv_shirt[list(po.vertices)] = True
    kd = KDTree(len(sm.vertices))
    for v in sm.vertices:
        kd.insert(v.co, v.index)
    kd.balance()
    gs = deleted.get(spec['clothes'][0], np.zeros(kit.N_BODY, dtype=bool))
    near_shirt = np.array([sv_shirt[kd.find(c)[1]] for c in skin_co])
    mask[top0] = gs & near_shirt
    mask['shorts'] = gs & ~near_shirt
    if under is not None:
        mask['under'] = mask['shorts']
    shoe_name = next((c for c in spec['clothes'] if c.startswith('shoes')), None)
    gsh = deleted.get(shoe_name, np.zeros(kit.N_BODY, dtype=bool))
    low = np.array([c.z < pw.shoe_top(shoe) + 0.005 for c in skin_co])
    mask['shoe'] = gsh & low
    mask['crew'] = gsh & ~low
    keep_always = np.array([behind_collar(c) for c in skin_co])
    keep_in_hem = np.array([hem is not None and hem - 0.05 < c.z < hem + SKIN_UP for c in skin_co])
    # (the skin in a V-neck's V shows: the game cuts the V, and the skin a little way under its edge, kit.ts)
    vfield = pw.vneck_field(rig, women)
    keep_for = {'vneck': np.array([vfield(c) > -0.02 and c.y < neck.y - 0.01 for c in skin_co])}
    base_others = {'top': ['shorts', 'crew', 'shoe'], 'shorts': [top0, 'crew', 'shoe'], 'under': [top0, 'crew', 'shoe'], 'tights': ['shorts', top0, 'crew', 'shoe'],
                   'socks': [top0, 'shorts', 'shoe'], 'shoe': [top0, 'shorts']}
    union_of = {}
    for name in cover:
        slot = 'top' if name in pw.TOPS else 'socks' if name in pw.SOCKS else name
        union_of[name] = base_others[slot]
    hide = pw.hide_masks(body, cover, mask, union_of, keep_always, keep_in_hem, keep_for)
    body.data.attributes.new('hide', 'INT', 'POINT').data.foreach_set('value', np.concatenate([hide, np.zeros(len(body.data.vertices) - kit.N_BODY, np.uint16)]).astype(np.int32))
    worn = ['body', 'shoe', top0, 'shorts', 'crew'] + (['collar'] if outfit.get('top') == 'polo' else []) + ([skirt_style] if skirt_style else [])
    base_bits = 0
    for name in worn:
        base_bits |= 1 << pw.PIECES.index(name)
    print('COVERED skin hidden as modelled', int(((hide & base_bits) != 0).sum()), 'of', kit.N_BODY, 'vertices')

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
    # (the cuts not worn as modelled are out of every bake but their own: each lies where the modelled one does)
    variants = [o for o in meshes if kinds[o.name] == 'wear' and o is not crew]
    for o in hidden + variants + unworn:
        o.hide_render = True
    face.cycles_setup()
    import time
    t0 = time.time()
    ao = {'body': face.bake_ao_image(body, RECT['skin'][2], 'ao_skin')}
    # The skin a cut can bare (hidden as modelled, shown by another) was baked in the modelled garment's shade: it, and
    # REVEAL_BLEND round it, take a bake without the clothes. (Without it a tank showed the tee's sleeve as a dark ring round
    # the arm.)
    clothes = [o for o in meshes if kinds[o.name] in ('suit', 'skirt') or o is crew or o.name.startswith('Collar')]
    for o in clothes:
        o.hide_render = True
    ao_bare = face.bake_ao_image(body, RECT['skin'][2], 'ao_bare')
    for o in clothes:
        o.hide_render = o in unworn
    bit = lambda n: 1 << pw.PIECES.index(n)
    always = bit('shoe') | bit('shorts')
    shown = ((hide & always) == 0) & np.any([(hide & bit(t)) == 0 for t in pw.TOPS], axis=0)
    revealed = ((hide & base_bits) != 0) & shown
    co_s = np.array([body.data.vertices[i].co[:] for i in range(kit.N_BODY)])
    w_bare = revealed.astype(np.float32)
    if revealed.any():
        kr = KDTree(int(revealed.sum()))
        for i in np.nonzero(revealed)[0]:
            kr.insert(co_s[i], int(i))
        kr.balance()
        for i in np.nonzero(~revealed)[0]:
            w_bare[i] = max(0.0, 1 - kr.find(co_s[i])[2] / REVEAL_BLEND)
    me_b = body.data
    me_b.calc_loop_triangles()
    uvb = me_b.uv_layers.active.data
    tri_uv = np.array([[tuple(uvb[li].uv) for li in t.loops] for t in me_b.loop_triangles if max(t.vertices) < kit.N_BODY])
    tri_w = np.array([[w_bare[vi] for vi in t.vertices] for t in me_b.loop_triangles if max(t.vertices) < kit.N_BODY])
    m_bare, _ = pw.rasterize(RECT['skin'][2], tri_uv, tri_w)
    m_bare = face.blur(m_bare, 2)
    ao['body'] = ao['body'] * (1 - m_bare) + ao_bare * m_bare
    # Skin nothing ever bares (under the shorts, inside the shoes) is one flat shade: its bake's noise only cost the atlas's size.
    tri_n = np.array([[0.0 if shown[vi] else 1.0 for vi in t.vertices] for t in me_b.loop_triangles if max(t.vertices) < kit.N_BODY])
    m_never, _ = pw.rasterize(RECT['skin'][2], tri_uv, tri_n)
    never = face.blur((m_never > 0.999).astype(np.float32), 1) > 0.999
    ao['body'][never] = 0.5
    print('AO skin a cut can bare:', int(revealed.sum()), 'vertices,', round(float((m_bare > 0.5).mean()) * 100, 1), '% of the skin atlas from the bare bake')
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
    vao[crew.name] = face.bake_ao_vertices(crew)
    for o in variants:
        name = o.name[len('Wear.'):]
        off = [suit] if name in pw.TOPS or name == 'under' else [crew] if name in pw.SOCKS else []
        for x in off:
            x.hide_render = True
        o.hide_render = False
        vao[o.name] = face.bake_ao_vertices(o)
        o.hide_render = True
        for x in off:
            x.hide_render = False
    for o in hidden + variants + unworn:
        o.hide_render = False
    # Generated cloth's occlusion into its UVs: a place along the ramp (person_wear.py).
    for o in variants:
        uvl = o.data.uv_layers.active
        if uvl is None:
            continue
        a = vao[o.name]
        for po in o.data.polygons:
            for li, vi in zip(po.loop_indices, po.vertices):
                if uvl.data[li].uv.x >= 2:
                    uvl.data[li].uv.x = 2 + 0.02 + 0.96 * float(a[vi])
    for o in by_kind.get('hair', []):
        vao[o.name] = face.hair_depth_ao(o, body)
    for o in by_kind.get('extra', []):
        a = np.empty(len(o.data.vertices), dtype=np.float32)
        o.data.attributes['shade'].data.foreach_get('value', a)
        vao[o.name] = a
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
            a = ao.get(kd)
            r[:, :, 3] = 1 if a is None else (a if a.shape == r.shape[:2] else face.resize(a[:, :, None], r.shape[1], r.shape[0])[:, :, 0])
        elif kd == 'skirt':
            # (both skirts' shading, each on its band of the rectangle: person_kit.SKIRT_BANDS)
            paste(opaque, kit.skirts_ao(RECT['skirt'][2]), RECT['skirt'])
        elif kd in ALPHA_PARTS:
            r = paste(alpha, img_of(o), RECT[kd])
            if kd == 'hair' and spec.get('hair_tone'):
                # (the same hairstyle in another person's colour)
                r[:, :, :3] = r[:, :, :3] * np.array(spec['hair_tone'], dtype=np.float32)

    x0r, y0r, wr, hr = RECT['ramp']
    opaque[y0r:y0r + hr, x0r:x0r + wr, :3] = np.linspace(0, 1, wr, dtype=np.float32)[None, :, None]
    opaque[y0r:y0r + hr, x0r:x0r + wr, 3] = 1

    # ---------- the suit's sculpted folds (one file for everybody in that suit) ----------
    suit_name = spec['clothes'][0]
    n_png = AssetService.find_asset_absolute_path(f'{suit_name}/{suit_name}_normal.png', asset_subdir='clothes')
    n_img = bpy.data.images.load(n_png)
    n_img.colorspace_settings.name = 'Non-Color'
    cloth_file = 'suit-normal-f.webp' if women else 'suit-normal.webp'
    save(pixels(n_img, 1024, 1024), (1024, 1024), os.path.join(os.path.dirname(out.rstrip('/')), cloth_file), False)
    bpy.data.images.remove(n_img)

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
        return {'pos': [], 'nrm': [], 'uv': [], 'si': [], 'sw': [], 'part': [], 'index': [], 'ao': [], 'mask': [], 'morph': [],
                'piece': [], 'tpiece': [], 'hide': []}
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
        hang = me.attributes['hang'].data if kd == 'skirt' else None
        va = vao.get(o.name)
        top_piece = face.highest_piece(me) if kd == 'suit' and spec['clothes'][0].startswith('female_') else None
        wname = o.name[len('Wear.'):] if kd == 'wear' else None
        for tri in me.loop_triangles:
            u0, v0 = 0, 0
            for li in tri.loops:
                u0 += uvl[li].uv.x / 3
                v0 += uvl[li].uv.y / 3
            # Which garment the triangle is (person_wear.PIECES; the game draws the ones worn).
            if kd == 'suit':
                tp = top0 if (tri.vertices[0] in top_piece if top_piece else v0 > 0.57) else 'shorts'
            elif kd == 'wear':
                tp = wname
            elif kd == 'shoe':
                tp = kd
            elif kd == 'skirt':
                tp = o.name[len('Skirt.'):]
            elif kd == 'extra':
                tp = 'collar' if o.name.startswith('Collar') else 'body'
            else:
                tp = 'body'
            B['tpiece'].append(pw.PIECES.index(tp))
            for li, vi in zip(tri.loops, tri.vertices):
                u, v = uvl[li].uv
                key = (vi, round(u, 5), round(v, 5))
                if key not in seen:
                    vert = me.vertices[vi]
                    co = vert.co
                    if kd == 'body':
                        part, uv = 'skin', uv_to(RECT['skin'], OPAQUE_SIZE, u, v)
                    elif kd == 'suit':
                        # The suit's atlas: the shirt on the top half, the trousers below. A women's suit: separate pieces
                        # whose atlases overlap in height.
                        part = 'shirt' if (vi in top_piece if top_piece else v0 > 0.57) else 'shorts'
                        uv = uv_to(RECT['clothes'], OPAQUE_SIZE, u, v)
                    elif kd == 'skirt':
                        part, uv = 'shorts', uv_to(RECT['skirt'], OPAQUE_SIZE, u, v)
                    elif kd == 'extra':
                        part, uv = 'sock', (0.0, 0.0)
                    elif kd == 'wear':
                        part = 'shirt' if wname in pw.TOPS else 'shorts' if wname in ('tights', 'under') else 'sock'
                        if u >= 2:
                            uv = uv_to(RECT['ramp'], OPAQUE_SIZE, u - 2, v - 2)
                        elif part == 'shirt' or wname == 'under':
                            uv = uv_to(RECT['clothes'], OPAQUE_SIZE, u, v)
                        else:
                            uv = (0.0, 0.0)
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
                    B['piece'].append(pw.PIECES.index(tp))
                    B['hide'].append(int(hide[vi]) if kd == 'body' and vi < kit.N_BODY else 0)
                    B['ao'].append(float(va[vi]) if va is not None else 1.0)
                    B['mask'] += [mk[k][vi].value for k in range(4)] if mk else [hang[vi].value if hang else 0.0, 0.0, 0.0, 0.0]
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
              'textures': {'opaque': 'opaque.webp', 'alpha': 'alpha.webp', 'cloth': cloth_file}, 'parts': PART, 'morphs': face.MORPHS,
              'kit': outfit,
              'wardrobe': {'pieces': list(pw.PIECES), 'worn': worn, 'vneck': [pw.VNECK_DROP[women], pw.VNECK_SLOPE]},
              'meshes': {}}
    for kind, B in buffers.items():
        ent = {'vertices': len(B['part']), 'indices': len(B['index'])}
        for key, fmt in (('pos', 'f'), ('nrm', 'f'), ('uv', 'f'), ('si', 'B'), ('sw', 'f'), ('part', 'B'), ('index', 'I'),
                         ('ao', 'f'), ('mask', 'f'), ('morph', 'f'), ('piece', 'B'), ('tpiece', 'B'), ('hide', 'H')):
            data = np.asarray(B[key], dtype={'f': '<f4', 'B': 'u1', 'I': '<u4', 'H': '<u2'}[fmt]).tobytes()
            ent[key] = [len(blob), len(data)]
            blob += data
            blob += b'\0' * ((4 - len(blob) % 4) % 4)
        header['meshes'][kind] = ent
    open(os.path.join(out, 'body.bin'), 'wb').write(bytes(blob))
    json.dump(header, open(os.path.join(out, 'body.json'), 'w'))
    print('WROTE', out, len(blob) // 1024, 'KB')
    if os.environ.get('BANDEJA_FINISHED_BLEND'):
        # (the finished person, posed in the T-pose, to look at: tools/assets/mpfb/wear-sheet.py)
        bpy.ops.wm.save_as_mainfile(filepath=os.environ['BANDEJA_FINISHED_BLEND'])


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
