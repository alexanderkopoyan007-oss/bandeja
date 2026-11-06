# A MetaHuman (Unreal's MetaHuman Creator, exported by mh-scripts/export_*.py in the owner's pilot project) as a game
# body: the same body.json/body.bin finish-player.py writes, for tools/assets/build-people.mjs.
#   Blender -b --python tools/assets/metahuman/mh-player.py -- <spec.json> <out-dir> <ybot-rest.json> [--preview]
#
# - Body (its LOD1), head (LOD2), the outfit MetaHuman fitted to this body (a T-shirt and shorts), the hair and brows as
#   the cards Unreal's "UE Optimized" build makes from the grooms. All in MetaHuman's A-pose, metres, facing -y.
# - MetaHuman's 341 body joints and 874 face joints go onto the game's 65: each MetaHuman joint's weights go to the
#   nearest game bone up its chain (DIRECT below), so twist, corrective and facial joints fold into their parents.
#   Hair, brows, eyes, teeth and lashes ride the head.
# - The game bones stand on MetaHuman's own joints; the rig is posed into the game skeleton's T-pose where they differ
#   by pose, as finish-player.py does (arms, hands, fingers, legs straight), and bound in the modelled pose.
# - Shoes: p1's trainers (MPFB shoes05 with its crew sock), each fitted to a foot by the box round it.
# - Skin under the shirt, the shorts and the shoes is removed (it pokes through when the body moves).
# - Tank, skirt, band or visor as the MPFB players have them (spec kit; the geometry is person_kit.py's): the T-shirt's
#   sleeves off along the shader's armhole plane, a skirt over the shorts, a band round the head.
# - Atlases as finish-player.py's RECT, which the body shader reads: skin's square at the left (the head at the
#   source's 2048; the body, mostly under the kit, smaller beside it), the kit's rectangle at the top right (shirt
#   over shorts, each MetaHuman UV square squeezed into half of it), a skirt's shading in a strip at the bottom right,
#   hair at the left of the alpha atlas.
# - Not yet: face expressions and gaze (MetaHuman moves the face with joints; none are baked yet, so the face is
#   still), ambient occlusion (atlas alpha is 1), the garment's own fold normals (a flat cloth map for now).
import bpy, bmesh, json, math, os, sys
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'mpfb'))
import person_kit as pk  # the skirt's and the band's geometry, shared with the MPFB players

args = sys.argv[sys.argv.index('--') + 1:]
spec = json.load(open(args[0]))
OUT = args[1]
YB = json.load(open(args[2]))
PREVIEW = '--preview' in args
SRC = os.path.expanduser(spec['src'])
os.makedirs(OUT, exist_ok=True)

P = 'mixamorig:'
PART = {'skin': 0, 'shirt': 1, 'shorts': 2, 'shoe': 3, 'eye': 4, 'sock': 5, 'hair': 6, 'brow': 7, 'lash': 8,
        'teeth': 9, 'tongue': 10}
ALPHA_PARTS = ('hair', 'brow', 'lash')
OPAQUE_SIZE = (3072, 2048)
ALPHA_SIZE = (2560, 2048)
# x, y, w, h in pixels from the bottom left. The kit's rectangle (u > 2/3, v > 1/2) is fixed by kit.ts (suitUv).
# A skirt's outside and its lining are told apart by atlas v alone (kit.ts SKIRT_OUT_V: its local v x 512/2048, as
# finish-player.py's 512-high rectangle), so it takes the strip at the right, narrower across than the MPFB one.
RECT = {'head': (0, 0, 2048, 2048), 'body': (2048, 0, 768, 768), 'eye': (2816, 768, 256, 256),
        'teeth': (2816, 512, 256, 256), 'skirt': (2816, 0, 256, 512), 'shirt': (2048, 1536, 1024, 512),
        'shorts': (2048, 1024, 1024, 512), 'hair': (0, 0, 2048, 2048), 'brow': (2048, 1024, 512, 512),
        'lash': (2048, 512, 512, 512), 'helmet': (2048, 1536, 512, 512)}
SIDES = (('Left', 'l'), ('Right', 'r'))
FINGERS = (('Thumb', 'thumb'), ('Index', 'index'), ('Middle', 'middle'), ('Ring', 'ring'), ('Pinky', 'pinky'))
BONES = list(YB)
PARENT = {n: YB[n]['parent'] for n in BONES}

# The game's three spine joints stand about 20%, 43% and 70% of the way from the hips to the neck; MetaHuman's spine_02,
# spine_04 and spine_05 do (spine_01 is 3.5 cm over the pelvis: its skin goes with the hips, as Mixamo's does).
DIRECT = {'root': 'Hips', 'pelvis': 'Hips', 'spine_01': 'Hips', 'spine_02': 'Spine', 'spine_03': 'Spine',
          'spine_04': 'Spine1', 'spine_05': 'Spine2', 'neck_01': 'Neck', 'neck_02': 'Neck', 'head': 'Head'}
for s, l in SIDES:
    DIRECT.update({f'clavicle_{l}': s + 'Shoulder', f'upperarm_{l}': s + 'Arm', f'lowerarm_{l}': s + 'ForeArm',
                   f'hand_{l}': s + 'Hand', f'thigh_{l}': s + 'UpLeg', f'calf_{l}': s + 'Leg', f'foot_{l}': s + 'Foot',
                   f'ball_{l}': s + 'ToeBase'})
    for F, f in FINGERS:
        for k in (1, 2, 3):
            DIRECT[f'{f}_0{k}_{l}'] = f'{s}Hand{F}{k}'
# The game bone each one's joint stands on (the rest are ends, placed from the mesh).
JOINT_OF = {}
for mh, g in DIRECT.items():
    JOINT_OF.setdefault(g, mh)
JOINT_OF.update({'Spine': 'spine_02', 'Spine1': 'spine_04', 'Spine2': 'spine_05', 'Neck': 'neck_01', 'Hips': 'pelvis'})
MAIN_CHILD = {'Hips': 'Spine', 'Spine': 'Spine1', 'Spine1': 'Spine2', 'Spine2': 'Neck', 'Neck': 'Head', 'Head': 'HeadTop_End'}
for s, _ in SIDES:
    MAIN_CHILD.update({s + 'Shoulder': s + 'Arm', s + 'Arm': s + 'ForeArm', s + 'ForeArm': s + 'Hand', s + 'Hand': s + 'HandMiddle1',
                       s + 'UpLeg': s + 'Leg', s + 'Leg': s + 'Foot', s + 'Foot': s + 'ToeBase', s + 'ToeBase': s + 'Toe_End'})
    for F, _ in FINGERS:
        for k in (1, 2, 3):
            MAIN_CHILD[f'{s}Hand{F}{k}'] = f'{s}Hand{F}{k + 1}'


def say(*a):
    print('MH', *a, flush=True)


def select_only(o):
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    for x in bpy.data.objects:
        x.select_set(False)
    o.select_set(True)
    bpy.context.view_layer.objects.active = o


def imp(rel):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=os.path.join(SRC, rel), use_anim=False, ignore_leaf_bones=False,
                             automatic_bone_orientation=False)
    return [o for o in bpy.data.objects if o not in before]


def keep_lod(objs, lod):
    arm = next(o for o in objs if o.type == 'ARMATURE')
    mesh = next(o for o in objs if o.type == 'MESH' and o.name.endswith(f'_LOD{lod}'))
    # (the centimetres-to-metres scale sits on an empty above them: keep their world transforms when it goes)
    world = {o: o.matrix_world.copy() for o in (arm, mesh)}
    for o in objs:
        if o not in (arm, mesh):
            bpy.data.objects.remove(o, do_unlink=True)
    for o, m in world.items():
        o.matrix_world = m
    return arm, mesh


def bake_world(o):
    """The mesh's world shape in its data (FBX from Unreal comes in centimetres under a 0.01 scale), unparented."""
    o.data.transform(o.matrix_world)
    o.parent = None
    o.matrix_world = Matrix.Identity(4)
    for m in list(o.modifiers):
        o.modifiers.remove(m)


def game_of(arm, name):
    b = arm.data.bones.get(name)
    while b is not None:
        if b.name in DIRECT:
            return DIRECT[b.name]
        b = b.parent
    return 'Hips'


def remap(o, arm):
    """MetaHuman's groups summed onto the game bones (up each joint's chain), the four largest kept, normalised."""
    gmap = {g.index: game_of(arm, g.name) for g in o.vertex_groups}
    acc = []
    for v in o.data.vertices:
        d = {}
        for g in v.groups:
            if g.weight > 1e-5 and g.group in gmap:
                n = gmap[g.group]
                d[n] = d.get(n, 0.0) + g.weight
        acc.append(d)
    rigid(o, None)
    vg = {n: o.vertex_groups[P + n] for n in BONES}
    for i, d in enumerate(acc):
        top = sorted(d.items(), key=lambda t: -t[1])[:4] or [('Hips', 1.0)]
        tot = sum(w for _, w in top)
        for n, w in top:
            vg[n].add([i], w / tot, 'REPLACE')


def rigid(o, bone):
    o.vertex_groups.clear()
    for n in BONES:
        o.vertex_groups.new(name=P + n)
    if bone:
        o.vertex_groups[P + bone].add(list(range(len(o.data.vertices))), 1.0, 'REPLACE')


def weights(o):
    """Per vertex: {game bone: weight}."""
    names = {g.index: g.name[len(P):] for g in o.vertex_groups}
    return [{names[g.group]: g.weight for g in v.groups if g.weight > 0} for v in o.data.vertices]


def split_by_material(o, kinds):
    """One object per kind from a mesh with several materials: kinds maps a material-name test to a kind (None drops)."""
    me = o.data
    of_index = {}
    for i, m in enumerate(me.materials):
        nm = m.name if m else ''
        of_index[i] = next((k for test, k in kinds if test(nm)), None)
    out = {}
    for kind in {k for k in of_index.values() if k}:
        c = o.copy()
        c.data = me.copy()
        c.name = f'{o.name}.{kind}'
        bpy.context.scene.collection.objects.link(c)
        bm = bmesh.new()
        bm.from_mesh(c.data)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if of_index.get(f.material_index) != kind], context='FACES')
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
        bm.to_mesh(c.data)
        bm.free()
        out.setdefault(kind, []).append(c)
    bpy.data.objects.remove(o, do_unlink=True)
    return out


def join(objs, name):
    if len(objs) == 1:
        objs[0].name = name
        return objs[0]
    select_only(objs[0])
    for o in objs[1:]:
        o.select_set(True)
    bpy.ops.object.join()
    o = bpy.context.object
    o.name = name
    return o


def coords(o):
    a = np.empty(len(o.data.vertices) * 3)
    o.data.vertices.foreach_get('co', a)
    return a.reshape(-1, 3)


def delete_verts(o, mask):
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.verts[i] for i in np.nonzero(mask)[0]], context='VERTS')
    bm.to_mesh(o.data)
    bm.free()


# ---------------------------------------------------------------- import ----------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
body_arm, body = keep_lod(imp(spec['body']), spec.get('body_lod', 1))
face_arm, face = keep_lod(imp(spec['face']), spec.get('face_lod', 2))
outfit_arm, outfit = keep_lod(imp(spec['outfit']), spec.get('outfit_lod', 0))
hair = imp(spec['hair'])[0]
brows = imp(spec['brows'])[0] if spec.get('brows') else None


def only_mesh(objs):
    m = next(o for o in objs if o.type == 'MESH')
    w = m.matrix_world.copy()
    for o in objs:
        if o is not m:
            bpy.data.objects.remove(o, do_unlink=True)
    m.matrix_world = w
    return m


# The hair's helmet: the shell Unreal draws in the cards' place far away, its coverage (where the hair is) in its own
# texture's alpha. Under the cards it is the hair's mass, so the scalp doesn't show between thin strands.
helmet = only_mesh(imp(spec['helmet'])) if spec.get('helmet') else None

MHJ = {b.name: body_arm.matrix_world @ b.head_local for b in body_arm.data.bones}
for b in face_arm.data.bones:
    MHJ.setdefault(b.name, face_arm.matrix_world @ b.head_local)
for o in [body, face, outfit, hair] + [o for o in (brows, helmet) if o]:
    bake_world(o)
remap(body, body_arm)
remap(face, face_arm)
remap(outfit, outfit_arm)
rigid(hair, 'Head')
if brows:
    rigid(brows, 'Head')
if helmet:
    rigid(helmet, 'Head')
for a in (body_arm, face_arm, outfit_arm):
    bpy.data.objects.remove(a, do_unlink=True)
say('mh height', round(max(MHJ['head'].z, coords(face)[:, 2].max()), 3), 'facing', 'ok' if MHJ['clavicle_l'].x > 0 else 'FLIPPED')

head = split_by_material(face, [(lambda n: 'Face_Skin' in n, 'skin'), (lambda n: 'Teeth' in n, 'teeth'),
                                (lambda n: 'EyeL' in n or 'EyeR' in n, 'eye'), (lambda n: 'Eyelashes' in n, 'lash')])
head_skin = join(head['skin'], 'head')
eyes = join(head['eye'], 'eyes')
teeth = join(head['teeth'], 'teeth')
lashes = join(head['lash'], 'lashes')
shirt_shorts = split_by_material(outfit, [(lambda n: 'Shirt' in n, 'shirt'), (lambda n: 'Short' in n, 'shorts')])
shirt = join(shirt_shorts['shirt'], 'shirt')
shorts = join(shirt_shorts['shorts'], 'shorts')
if spec.get('teeth_decimate'):
    # (the face's LOD gives the teeth and gums 3k triangles: more than a closed mouth shows. They ride the head and
    # carry no expressions yet, so the shape keys go and a collapse decimate thins them)
    teeth.shape_key_clear()
    dec = teeth.modifiers.new('dec', 'DECIMATE')
    dec.ratio = spec['teeth_decimate']
    select_only(teeth)
    bpy.ops.object.modifier_apply(modifier=dec.name)
for o in (eyes, teeth, lashes):
    rigid(o, 'Head')
if helmet:
    # (the helmet was made for the far head, LOD5: on this one the forehead and temples came through it at the hairline.
    # Each vertex stands at least HELMET_OFF out from this head's skin)
    HELMET_OFF, HELMET_TUCK = 0.003, 0.004
    hb = bmesh.new()
    hb.from_mesh(head_skin.data)
    head_bvh = BVHTree.FromBMesh(hb)
    hb.free()
    moved, depth = 0, []
    for v in helmet.data.vertices:
        loc, nrm, _, _ = head_bvh.find_nearest(v.co)
        if loc is None:
            continue
        s = (v.co - loc).dot(nrm)
        depth.append(s)
        # (only the vertices just under it: deeper ones are the rim Unreal tucks under the skin on purpose, the hairline,
        # and lifted onto the forehead they painted a band of hair across it)
        if -HELMET_TUCK < s < HELMET_OFF:
            v.co = v.co + nrm * (HELMET_OFF - s)
            moved += 1
    helmet.data.update()
    say('helmet vertices pushed out of the skin', moved, 'of', len(helmet.data.vertices),
        'offsets (mm) by percentile', [round(float(np.percentile(depth, q)) * 1000, 1) for q in (0, 5, 10, 25, 50, 90)])

# ---------------------------------------------------------------- joints ----------------------------------------------------------
J = {}
for g, mh in JOINT_OF.items():
    J[g] = MHJ[mh].copy()
bw = weights(body)
bco = coords(body)


def tip(bone, frm, to, inset):
    """The far end of a chain from the mesh: the vertices mostly on `bone`, furthest along frm -> to, `inset` back."""
    d = (J[to] - J[frm]).normalized()
    ids = [i for i, w in enumerate(bw) if w.get(bone, 0) > 0.5]
    far = max((Vector(bco[i]) - J[to]).dot(d) for i in ids)
    return J[to] + d * (far - inset)


for s, _ in SIDES:
    for F, _ in FINGERS:
        J[f'{s}Hand{F}4'] = tip(f'{s}Hand{F}3', f'{s}Hand{F}2', f'{s}Hand{F}3', 0.007)
    toe_dir = J[s + 'ToeBase'] - J[s + 'Foot']
    toe_dir.z = 0
    ids = [i for i, w in enumerate(bw) if w.get(s + 'ToeBase', 0) > 0.5]
    far = max((Vector(bco[i]) - J[s + 'ToeBase']).dot(toe_dir.normalized()) for i in ids)
    J[s + 'Toe_End'] = J[s + 'ToeBase'] + toe_dir.normalized() * (far - 0.01)
    J[s + 'Toe_End'].z = J[s + 'ToeBase'].z
J['HeadTop_End'] = Vector((J['Head'].x, J['Head'].y, coords(head_skin)[:, 2].max()))
missing = [n for n in BONES if n not in J]
if missing:
    raise ValueError('no joint for ' + ', '.join(missing))

# ---------------------------------------------------------------- shoes -----------------------------------------------------------
with bpy.data.libraries.load(os.path.expanduser(spec['shoes_from'])) as (src, dst):
    dst.objects = [n for n in src.objects if n in ('Human', 'Human.shoes05')]
dg_objs = {}
for o in dst.objects:
    bpy.context.scene.collection.objects.link(o)
    dg_objs[o.name] = o
    for m in o.modifiers:
        if m.type == 'MASK':  # (p1's saved body hides the feet the shoes cover: the box is measured on the feet)
            m.show_viewport = False
dg = bpy.context.evaluated_depsgraph_get()


def evaluated_copy(o, name):
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
    c = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(c)
    c.matrix_world = Matrix.Identity(4)
    me.transform(o.matrix_world)
    return c


p1 = evaluated_copy(dg_objs['Human'], 'p1')
shoe_src = evaluated_copy(dg_objs['Human.shoes05'], 'shoe_src')
for o in list(dst.objects):
    bpy.data.objects.remove(o, do_unlink=True)
p1co = coords(p1)[:13380]  # MakeHuman's skin; its helper geometry follows
p1_sole = p1co[:, 2].min()
mh_sole = bco[:, 2].min()
SOCK_FROM = 0.118  # finish-player.py: shoes05's crew sock is the tube above 11.8 cm
FOOT_TOP = 0.11


def foot_box(co, sole, side):
    m = (co[:, 2] < sole + FOOT_TOP) & ((co[:, 0] > 0) if side == 'Left' else (co[:, 0] < 0))
    return co[m].min(0), co[m].max(0)


sco = coords(shoe_src)
shoe_parts = []
new_co = sco.copy()
for s, _ in SIDES:
    a0, a1 = foot_box(p1co, p1_sole, s)
    b0, b1 = foot_box(bco, mh_sole, s)
    k = (b1 - b0) / (a1 - a0)
    k[2] = (k[0] + k[1]) / 2  # the foot's height in the shoe goes with its size, not with the box's (ankle) cut
    sel = (sco[:, 0] > 0) if s == 'Left' else (sco[:, 0] < 0)
    c = (a0 + a1) / 2
    c[2] = p1_sole
    d = (b0 + b1) / 2
    d[2] = mh_sole
    new_co[sel] = (sco[sel] - c) * k + d
    say('shoe', s, 'scale', k.round(3))
shoe_sock = (sco[:, 2] - p1_sole) > SOCK_FROM
shoe_src.data.vertices.foreach_set('co', new_co.ravel())
shoe_src.data.update()
shoes = shoe_src
shoes.name = 'shoes'
bpy.data.objects.remove(p1, do_unlink=True)
sock_top = new_co[:, 2].max()

# Shoes take the weights of the nearest skin (the foot, the ankle).
kd = KDTree(len(bco))
for i, c in enumerate(bco):
    kd.insert(c, i)
kd.balance()
rigid(shoes, None)
vg = {n: shoes.vertex_groups[P + n] for n in BONES}
for i, c in enumerate(new_co):
    _, j, _ = kd.find(c)
    for n, w in bw[j].items():
        vg[n].add([i], w, 'REPLACE')

# ---------------------------------------------------------------- tank, skirt, band or visor ------------------------------------
# The kit the MPFB players have and MetaHuman's garment hasn't (spec kit, as person_kit.py makes it there; the game draws the
# rest in kit.ts):
# - a tank: the T-shirt's sleeves off along kit.ts's tankCut plane (from the LeftArm joint), its armhole laid on the skin;
# - a skirt: person_kit's rings round the body from under the shirt's hem down to kit.skirt, over MetaHuman's shorts with
#   their top off and their legs cut where the old inner shorts ended (spec shorts_hem);
# - a band or a visor: person_kit's, round the head on the skin or on the hair's helmet.
KIT = spec.get('kit', {})
# How far inside the armhole's plane the skin stays (person_kit's TANK_SKIN): the shader cuts it 2 cm in (kit.ts
# UNDER_ARMHOLE), and a vertex removed takes its triangles with it, so at 3.5 cm the skin ended a few millimetres in, in
# places, and the armpit showed a dark gap under the edge.
TANK_SKIN = 0.06
chest_x = J['Spine2'].x
arm_j = J['LeftArm']
arm_x0 = abs(arm_j.x - chest_x)
ARMHOLE_FROM = arm_j.z - 0.25  # the sleeve and the armpit are above this; the shirt's sides and hem below it
dominant = [max(w, key=w.get) if w else '' for w in bw]
on_arm = np.array([('Arm' in d or 'Hand' in d) for d in dominant])  # (person_kit's test: upper arm, forearm, hand)


def bisect(o, co, no, inner=False, outer=False, lowest=None):
    """o cut by a plane, the side its normal points to (outer) or the other (inner) cleared; only geometry above `lowest`."""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    vs = lambda g: [g] if isinstance(g, bmesh.types.BMVert) else g.verts
    geom = [g for g in list(bm.verts) + list(bm.edges) + list(bm.faces) if lowest is None or all(v.co.z > lowest for v in vs(g))]
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=no, clear_inner=inner, clear_outer=outer)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(o.data)
    bm.free()
    o.data.update()


tank_planes = []
if KIT.get('top') == 'tank':
    n0 = len(shirt.data.polygons)
    for side in (1, -1):
        a = Vector((chest_x + side * (arm_x0 - 0.035), 0, arm_j.z + 0.07))
        b = Vector((chest_x + side * (arm_x0 - 0.01), 0, arm_j.z - 0.15))
        no = Vector((0, 1, 0)).cross((b - a).normalized()) * side
        if no.x * side < 0:
            no = -no
        tank_planes.append((a, no))
        bisect(shirt, a, no, outer=True, lowest=ARMHOLE_FROM)
    say('tank: sleeves off, shirt faces', n0, '->', len(shirt.data.polygons))
    # The armhole on the skin (person_kit.hug_armholes): the tee stood off the shoulder and the torso is hollow under it, so
    # the cut edge goes to ARMHOLE_LIFT off the skin, in the cut's plane (where the shader's binding and skin cut are), with
    # the nearest skin's weights; the shirt eases to it over ARMHOLE_REACH.
    ARMHOLE_LIFT, ARMHOLE_REACH = 0.002, 0.04
    skin_tree = BVHTree.FromPolygons([v.co.copy() for v in body.data.vertices], [tuple(p.vertices) for p in body.data.polygons])
    me = shirt.data
    uses = {}
    for p in me.polygons:
        for k in p.edge_keys:
            uses[k] = uses.get(k, 0) + 1
    rim = {i for k, c in uses.items() if c == 1 for i in k}
    moved, gap = {}, []
    for a, no in tank_planes:
        for i in rim:
            co = me.vertices[i].co
            if co.z < ARMHOLE_FROM or abs((co - a).dot(no)) > 0.012:
                continue
            p = co.copy()
            for _ in range(4):
                q, n, _, _ = skin_tree.find_nearest(p)
                step = q + n * ARMHOLE_LIFT - p
                p = p + step - no * step.dot(no)
            gap.append((p - co).length)
            moved[i] = p - co
    ids = list(moved)
    kd_rim = KDTree(len(ids))
    for k, i in enumerate(ids):
        kd_rim.insert(me.vertices[i].co, k)
    kd_rim.balance()
    ease = {}
    for v in me.vertices:
        if v.index in moved:
            continue
        _, k, d = kd_rim.find(v.co)
        if d < ARMHOLE_REACH:
            ease[v.index] = moved[ids[k]] * (1 - d / ARMHOLE_REACH) ** 2
    for i, dv in list(moved.items()) + list(ease.items()):
        me.vertices[i].co += dv
    svg = {n: shirt.vertex_groups[P + n] for n in BONES}
    for i in ids:
        _, j, _ = kd.find(me.vertices[i].co)
        for g in svg.values():
            g.remove([i])
        for n, w in bw[j].items():
            svg[n].add([i], w, 'REPLACE')
    me.update()
    say('tank: armhole on the skin,', len(ids), 'vertices, moved up to', round(max(gap) * 1000, 1), 'mm, median',
        round(float(np.median(gap)) * 1000, 1), 'mm')

skirt, skirt_hang = None, None
if KIT.get('bottom') in ('pleated', 'aline'):
    pleated = KIT['bottom'] == 'pleated'
    shirt_co = coords(shirt)
    shirt_hem = shirt_co[:, 2].min()
    top, hem = shirt_hem + pk.SKIRT_TUCK, KIT['skirt']
    # (the shorts' top came through the shirt's back in a bend, and the skirt covers it)
    bisect(shorts, Vector((0, 0, shirt_hem - 0.03)), Vector((0, 0, 1)), outer=True)
    if spec.get('shorts_hem'):
        bisect(shorts, Vector((0, 0, spec['shorts_hem'])), Vector((0, 0, 1)), inner=True)
    shorts_co = coords(shorts)
    say('skirt over shorts from', round(float(shorts_co[:, 2].min()), 3), 'to', round(float(shorts_co[:, 2].max()), 3))
    # (the outline it hangs round: the body without its arms, and the shorts, which stand off MetaHuman's legs as MPFB's
    # fitted ones didn't)
    cols = pk.PLEATS if pleated else pk.ALINE_COLS
    R, c, th, zs = pk.skirt_rings(np.concatenate([bco[~on_arm], shorts_co]), shirt_co, top, hem, 0.15 if pleated else 0.11,
                                  cols, cx=J['Hips'].x)
    sme, sverts, skirt_hang, bad = pk.skirt_mesh(R, c, th, zs, pleated, cols)
    skirt = bpy.data.objects.new('skirt', sme)
    bpy.context.scene.collection.objects.link(skirt)
    rigid(skirt, None)
    # (person_kit's weighting: the hips at the top, more and more the thigh on its side by the hem)
    hx, side = J['Hips'].x, (1 if J['LeftUpLeg'].x > J['Hips'].x else -1)
    for i, (co, h) in enumerate(zip(sverts, skirt_hang)):
        w = 0.85 * max(0.0, min(1.0, (h - 0.1) / 0.75)) ** 1.2
        s = max(0.0, min(1.0, 0.5 + (co[0] - hx) * side / 0.13))
        skirt.vertex_groups[P + 'Hips'].add([i], 1 - w, 'REPLACE')
        if w > 0:
            skirt.vertex_groups[P + 'LeftUpLeg'].add([i], w * s, 'REPLACE')
            skirt.vertex_groups[P + 'RightUpLeg'].add([i], w * (1 - s), 'REPLACE')
    say('skirt', KIT['bottom'], 'top', round(top, 3), 'hem', hem, 'shirt hem', round(float(shirt_hem), 3), 'radius at the hem',
        round(float(R[-1].min()), 3), '..', round(float(R[-1].max()), 3), 'faces', len(sme.polygons), 'wrong way', bad)

head_piece, head_shade = None, None
if KIT.get('head'):
    hb = bmesh.new()
    hb.from_mesh(head_skin.data)
    head_tree = BVHTree.FromBMesh(hb)
    hb.free()
    on = helmet or hair
    hair_tree = BVHTree.FromPolygons([v.co.copy() for v in on.data.vertices], [tuple(p.vertices) for p in on.data.polygons])
    hverts, hfaces, head_shade, rad = pk.head_piece_mesh(head_tree, hair_tree, [v.co.copy() for v in eyes.data.vertices],
                                                         KIT['head'], cx=J['Head'].x)
    hme = bpy.data.meshes.new('head_piece')
    hme.from_pydata(hverts, [], hfaces)
    hme.update()
    hbm = bmesh.new()
    hbm.from_mesh(hme)
    bmesh.ops.recalc_face_normals(hbm, faces=hbm.faces)
    hbm.to_mesh(hme)
    hbm.free()
    # (one UV everywhere: a new layer's default gives each face its own corners, which splits every vertex in the export)
    for d in hme.uv_layers.new(name='uv').data:
        d.uv = (0, 0)
    head_piece = bpy.data.objects.new('head_piece', hme)
    bpy.context.scene.collection.objects.link(head_piece)
    rigid(head_piece, 'Head')
    say('head piece', KIT['head'], 'band radius', round(float(rad.min()), 3), '..', round(float(rad.max()), 3), 'faces', len(hfaces))

# ---------------------------------------------------------------- skin under the kit out ---------------------------------------------
# Skin that sees cloth within 3 cm straight out from it goes, except a 2.5 cm band next to skin that stays: looking into a
# sleeve or a leg of the shorts never shows a hole. Inside the shoes and socks everything goes below the sock's top.
cloth_bm = bmesh.new()
for o in (shirt, shorts):
    tmp = bmesh.new()
    tmp.from_mesh(o.data)
    m = bpy.data.meshes.new('t')
    tmp.to_mesh(m)
    cloth_bm.from_mesh(m)
    bpy.data.meshes.remove(m)
    tmp.free()
bvh = BVHTree.FromBMesh(cloth_bm)
body.data.update()
covered = np.zeros(len(bco), dtype=bool)
for v in body.data.vertices:
    hit = bvh.ray_cast(v.co + v.normal * 0.001, v.normal, 0.03)
    covered[v.index] = hit[0] is not None
kd_open = KDTree(int((~covered).sum()))
for i in np.nonzero(~covered)[0]:
    kd_open.insert(bco[i], int(i))
kd_open.balance()
for i in np.nonzero(covered)[0]:
    if kd_open.find(bco[i])[2] < 0.025:
        covered[i] = False
# The skin behind the neckline stays, as finish-player.py keeps it: the game opens the collar lower than the garment's own
# neck hole (kit.ts personFrame, a smooth cut in the shader), and with this skin gone the opening showed the shirt's
# dark inside in jagged pieces. (finish-player's box in this file's axes, z up and forward -y, but reaching the chest's
# front: MetaHuman's neck joint stands further back in the neck than MPFB's, and 3 cm in front of it kept no chest)
nk = J['Neck']
# (and out to where the shoulders start, 16 cm: a loose crew neck seen from above showed the void past 10.5 cm as a dark
# wedge at the side of the neck)
behind_collar = ((np.abs(bco[:, 0] - nk.x) < 0.16) & (-bco[:, 1] > -nk.y - 0.1) & (-bco[:, 1] < -nk.y + 0.2)
                 & (bco[:, 2] > nk.z - 0.16) & (bco[:, 2] < nk.z + 0.025))
covered &= ~behind_collar
if tank_planes:
    # A tank: the arms are bare, and the skin under the armhole stays TANK_SKIN in (the shader cuts it at 2 cm), in the band
    # the shader's skin cut covers (kit.ts kitDetail: out from armX - 0.09, from the plane's top down to over the hem).
    # (outside the plane the arm's skin all stays: from the inside of the arm the torso's shirt is within the ray's reach)
    ax = np.abs(bco[:, 0] - chest_x)
    hem_z = coords(shirt)[:, 2].min()
    for a, no in tank_planes:
        d = (bco[:, 0] - a.x) * no.x + (bco[:, 2] - a.z) * no.z
        this_side = (bco[:, 0] - chest_x) * no.x > 0
        cut_band = (bco[:, 2] < a.z + 0.005) & (bco[:, 2] > hem_z + 0.06) & (ax > arm_x0 - 0.09)
        covered &= ~(this_side & (((d > 0) & on_arm) | ((d > -TANK_SKIN) & cut_band)))
in_shoe = bco[:, 2] < sock_top - 0.015
say('skin removed: under the kit', int(covered.sum()), 'in the shoes', int((in_shoe & ~covered).sum()), 'of', len(bco))
delete_verts(body, covered | in_shoe)
cloth_bm.free()

# ---------------------------------------------------------------- rig, posed into the game's T-pose ------------------------------
bpy.ops.object.armature_add(enter_editmode=True)
rig = bpy.context.object
rig.name = 'rig'
eb = rig.data.edit_bones
eb.remove(eb[0])
for n in BONES:
    b = eb.new(P + n)
    b.head = J[n]
    if n in MAIN_CHILD:
        b.tail = J[MAIN_CHILD[n]]
    else:
        d = J[n] - J[PARENT[n]] if PARENT[n] else Vector((0, 0, 1))
        b.tail = J[n] + d.normalized() * 0.02
    if (b.tail - b.head).length < 1e-4:
        b.tail = b.head + Vector((0, 0, 0.01))
for n in BONES:
    if PARENT[n]:
        eb[P + n].parent = eb[P + PARENT[n]]
bpy.ops.object.mode_set(mode='OBJECT')

skinned = [body, head_skin, eyes, teeth, lashes, shirt, shorts, shoes, hair] + [o for o in (brows, helmet, skirt, head_piece) if o]
for o in skinned:
    o.parent = rig
    m = o.modifiers.new('rig', 'ARMATURE')
    m.object = rig

# As finish-player.py: bone -> (the joint its direction points to, 'min' the smallest turn or 'palm' also rolled so the
# palm faces as the game skeleton's does). Everything else keeps the modelled pose's world rotation.
select_only(rig)
bpy.ops.object.mode_set(mode='POSE')
pb = rig.pose.bones
rest = {b.name[len(P):]: b.matrix_local.copy() for b in rig.data.bones}


def head(n):
    return pb[P + n].head.copy()


def yb_joint(n):
    return Vector(YB[n]['head'])


AIM = {}
for s, _ in SIDES:
    AIM[s + 'UpLeg'] = (s + 'Leg', 'min')
    AIM[s + 'Leg'] = (s + 'Foot', 'min')
    AIM[s + 'Arm'] = (s + 'ForeArm', 'min')
    AIM[s + 'ForeArm'] = (s + 'Hand', 'palm')
    AIM[s + 'Hand'] = (s + 'HandMiddle1', 'palm')
    for F, _ in FINGERS:
        for k in (1, 2, 3):
            AIM[f'{s}Hand{F}{k}'] = (f'{s}Hand{F}{k + 1}', 'min' if F == 'Thumb' else 'palm')


def palm(s, joint):
    return joint(s + 'HandIndex1') - joint(s + 'HandPinky1')


def frame(d, e):
    x = d.normalized()
    y = e - x * e.dot(x)
    y.normalize()
    return Matrix((x, y, x.cross(y))).transposed()


order = []


def visit(b):
    order.append(b.name[len(P):])
    for c in b.children:
        visit(c)


for b in rig.data.bones:
    if b.parent is None:
        visit(b)
for n in order:
    b = pb[P + n]
    h = head(n)
    if n in AIM:
        to, how = AIM[n]
        d0 = head(to) - h
        d1 = yb_joint(to) - yb_joint(n)
        if how == 'palm':
            s = 'Left' if n.startswith('Left') else 'Right'
            R = frame(d1, palm(s, yb_joint)) @ frame(d0, palm(s, head)).transposed()
        else:
            R = d0.rotation_difference(d1).to_matrix()
        b.matrix = Matrix.Translation(h) @ R.to_4x4() @ Matrix.Translation(-h) @ b.matrix
    else:
        b.matrix = Matrix.Translation(h) @ rest[n].to_3x3().to_4x4()
    bpy.context.view_layer.update()
worst = max(math.degrees((head(to) - head(n)).angle(yb_joint(to) - yb_joint(n))) for n, (to, _) in AIM.items())
say('aligned: worst posed bone direction', round(worst, 3), 'deg')
move = {n: pb[P + n].matrix @ rest[n].inverted() for n in order}
joints = {n: head(n) for n in BONES}
for n in ('Hips', 'LeftUpLeg', 'LeftFoot', 'Spine2', 'Neck', 'Head', 'HeadTop_End', 'LeftArm', 'LeftHand'):
    say('joint', n.ljust(12), 'body', [round(x, 3) for x in joints[n]], 'game', [round(x, 3) for x in yb_joint(n)])
bpy.ops.object.mode_set(mode='OBJECT')

# ---------------------------------------------------------------- atlases ---------------------------------------------------------
def load_px(path, size=None):
    im = bpy.data.images.load(path)
    if size and tuple(im.size) != tuple(size):
        im.scale(size[0], size[1])
    w, h = im.size
    px = np.array(im.pixels[:], dtype=np.float32).reshape(h, w, 4)
    bpy.data.images.remove(im)
    return px


def paste(atlas, rect, px):
    x, y, w, h = rect
    atlas[y:y + h, x:x + w] = px


def save(atlas, path, name):
    h, w = atlas.shape[:2]
    im = bpy.data.images.new(name, w, h, alpha=True)
    im.pixels.foreach_set(atlas.ravel())
    im.file_format = 'WEBP'
    im.filepath_raw = path
    bpy.context.scene.render.image_settings.quality = 92
    im.save(filepath=path, quality=92)
    bpy.data.images.remove(im)


SCALP_REACH, SCALP_SHADE, SCALP_COVER = 0.03, 0.6, 0.9


def scalp_mask(head_o, shell, cov_path, size):
    """Per texel of `head_o`'s UV square (rows from the bottom): the coverage of `shell` found within SCALP_REACH out from it."""
    scn = bpy.context.scene
    engine = scn.render.engine
    scn.render.engine = 'CYCLES'
    scn.cycles.samples = 1
    scn.cycles.device = 'CPU'
    img = bpy.data.images.new('scalp', size[0], size[1], alpha=False, float_buffer=True)
    cov_img = bpy.data.images.load(cov_path)
    cov_img.colorspace_settings.name = 'Non-Color'
    sm = bpy.data.materials.new('shell_bake')
    sm.use_nodes = True
    nt = sm.node_tree
    nt.nodes.clear()
    tx = nt.nodes.new('ShaderNodeTexImage')
    tx.image = cov_img
    em = nt.nodes.new('ShaderNodeEmission')
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(tx.outputs['Alpha'], em.inputs['Color'])
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    hm = bpy.data.materials.new('head_bake')
    hm.use_nodes = True
    ht = hm.node_tree.nodes.new('ShaderNodeTexImage')
    ht.image = img
    hm.node_tree.nodes.active = ht
    saved = {o: list(o.data.materials) for o in (head_o, shell)}
    for o, m in ((shell, sm), (head_o, hm)):
        o.data.materials.clear()
        o.data.materials.append(m)
    # (the head's UVs as the export reads them: its own first layer)
    head_o.data.uv_layers.active_index = 0
    for o in bpy.data.objects:
        o.select_set(o in (head_o, shell))
    bpy.context.view_layer.objects.active = head_o
    shell.hide_render = head_o.hide_render = False
    bpy.ops.object.bake(type='EMIT', use_selected_to_active=True, cage_extrusion=SCALP_REACH, max_ray_distance=SCALP_REACH * 2,
                        margin=4, use_clear=True)
    px = np.empty(size[0] * size[1] * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    for o, ms in saved.items():
        o.data.materials.clear()
        for m in ms:
            o.data.materials.append(m)
    scn.render.engine = engine
    return px.reshape(size[1], size[0], 4)[..., 0]


EAR_X, EAR_FEATHER = 0.072, 6


def ears_out(head_o, eyes_o, size):
    """Per texel of the head's UV square: 0 on each ear's own triangles (skin more than EAR_X out from the eyes' middle,
    between the jaw and the brow), rising to 1 over EAR_FEATHER texels round them. The helmet's sideburns lie within
    reach of the ears' rims, and the bake painted them in the hair's colour."""
    eco, hco = coords(eyes_o), coords(head_o)
    ez, ex = float(eco[:, 2].mean()), float(eco[:, 0].mean())
    ear = (hco[:, 2] > ez - 0.08) & (hco[:, 2] < ez + 0.03) & (np.abs(hco[:, 0] - ex) > EAR_X)
    me = head_o.data
    me.calc_loop_triangles()
    uvl = me.uv_layers[0].data
    w, h = size
    hit = np.zeros((h, w), dtype=bool)
    n = 0
    for tri in me.loop_triangles:
        if not all(ear[v] for v in tri.vertices):
            continue
        n += 1
        p = np.array([(uvl[li].uv[0] * w, uvl[li].uv[1] * h) for li in tri.loops])
        x0, y0 = np.floor(p.min(0)).astype(int)
        x1, y1 = np.ceil(p.max(0)).astype(int)
        x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, w - 1), min(y1, h - 1)
        if x1 < x0 or y1 < y0:
            continue
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        (ax, ay), (bx, by), (cx, cy) = p
        d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(d) < 1e-12:
            continue
        l1 = ((by - cy) * (gx - cx) + (cx - bx) * (gy - cy)) / d
        l2 = ((cy - ay) * (gx - cx) + (ax - cx) * (gy - cy)) / d
        inside = (l1 >= -0.02) & (l2 >= -0.02) & (1 - l1 - l2 >= -0.02)
        hit[y0:y1 + 1, x0:x1 + 1] |= inside
    dist = np.full((h, w), float(EAR_FEATHER), dtype=np.float32)
    cur = hit
    for i in range(EAR_FEATHER):
        dist[cur & (dist == EAR_FEATHER)] = i
        grown = cur.copy()
        grown[1:] |= cur[:-1]
        grown[:-1] |= cur[1:]
        grown[:, 1:] |= cur[:, :-1]
        grown[:, :-1] |= cur[:, 1:]
        cur = grown
    say('ears kept clear of the scalp paint:', n, 'triangles,', int(hit.sum()), 'texels')
    return np.clip(dist / EAR_FEATHER, 0, 1)


MAPS = os.path.join(SRC, spec['maps'])
op = np.zeros((OPAQUE_SIZE[1], OPAQUE_SIZE[0], 4), dtype=np.float32)
op[..., 3] = 1
# The skin from the build's baked textures: the DCC export's Head_Basecolor can come out as a placeholder checker.
BROW_TINT, BROW_WEIGHT = 0.65, 0.8
head_px = load_px(os.path.join(SRC, spec['head_bc']), RECT['head'][2:])
if spec.get('head_brows'):
    # Brows painted in, from the far LODs' head texture (Unreal's brow cards use an atlas the build doesn't export):
    # its texels that differ from the near head's, in the brows' band only, feathered.
    far = load_px(os.path.join(SRC, spec['head_brows']), RECT['head'][2:])
    diff = np.abs(far[..., :3] - head_px[..., :3]).sum(-1)
    hh, ww = diff.shape
    vv, uu = np.mgrid[0:hh, 0:ww]
    band = ((vv / hh > 0.63) & (vv / hh < 0.75) & (uu / ww > 0.22) & (uu / ww < 0.78)).astype(np.float32)
    k = np.clip((diff - 0.03) / 0.08, 0, 1) * band
    # (in the hair's colour: the far texture paints this MetaHuman's own brows, lighter than the hair given here; the
    # strokes keep their shading as the far texels' brightness over the brows' mean)
    brow_tone = np.array(spec.get('hair_rgb', [0.24, 0.16, 0.1]), dtype=np.float32)
    on = k > 0.5
    # (toward that colour, not all the way, and at BROW_WEIGHT: a full brow groom painted solid in a dark hair's colour
    # read as drawn on)
    if on.any():
        far[..., :3] = far[..., :3] * (1 - BROW_TINT + BROW_TINT * brow_tone / np.maximum(far[on][:, :3].mean(0), 1e-3))
    k = k * BROW_WEIGHT
    head_px[..., :3] = head_px[..., :3] * (1 - k[..., None]) + far[..., :3] * k[..., None]
    say('brows painted', int((k > 0.5).sum()), 'texels')
if helmet:
    # The scalp under the hair in the hair's colour, as finish-player.py paints the MakeHuman scalps: between thin cards
    # the bare scalp showed as bright patches through a fringe. Where the helmet (its coverage) lies within SCALP_REACH
    # out from the head, baked onto the head's UVs by Cycles (selected to active), darkened to the hair's shade in
    # shadow, and feathered with the helmet's own coverage.
    cov_mask = scalp_mask(head_skin, helmet, os.path.join(SRC, spec['helmet_cov']), RECT['head'][2:])
    cov_mask *= ears_out(head_skin, eyes, RECT['head'][2:])
    scalp = np.array(spec.get('hair_rgb', [0.24, 0.16, 0.1]), dtype=np.float32) * SCALP_SHADE
    m = np.clip(cov_mask * SCALP_COVER, 0, 1)[..., None]
    head_px[..., :3] = head_px[..., :3] * (1 - m) + scalp * m
    say('scalp painted', int((cov_mask > 0.5).sum()), 'texels')
paste(op, RECT['head'], head_px)
paste(op, RECT['body'], load_px(os.path.join(SRC, spec['body_bc']), RECT['body'][2:]))
paste(op, RECT['eye'], load_px(os.path.join(MAPS, 'Eyes_Color.png'), RECT['eye'][2:]))
paste(op, RECT['teeth'], load_px(os.path.join(MAPS, 'Teeth_Color.png'), RECT['teeth'][2:]))
for k in ('shirt', 'shorts'):
    x, y, w, h = RECT[k]
    op[y:y + h, x:x + w] = 1.0  # the kit's occlusion: none baked yet
if skirt:
    # (person_kit's: darker up under the shirt, in each pleat's valley and on the lining; drawn square and halved across)
    sao = pk.skirt_ao(RECT['skirt'][3], KIT['bottom'] == 'pleated')
    w = RECT['skirt'][2]
    paste(op, RECT['skirt'], sao.reshape(sao.shape[0], w, -1, 4).mean(2))
op[..., 3] = 1
save(op, os.path.join(OUT, 'opaque.webp'), 'opaque')

al = np.zeros((ALPHA_SIZE[1], ALPHA_SIZE[0], 4), dtype=np.float32)
cards = load_px(os.path.join(SRC, spec['hair_atlas']))
tone = np.array(spec.get('hair_rgb', [0.24, 0.16, 0.1]), dtype=np.float32)


HELMET_FEATHER = 14


def rim_feather(o, size, radius):
    """Per texel of `o`'s UV square: 0 where the mesh's open rim runs in UV, rising to 1 `radius` texels in from it."""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    uvl = bm.loops.layers.uv[0]
    w, h = size
    rim = np.zeros((h, w), dtype=bool)
    edges = 0
    for e in bm.edges:
        if not e.is_boundary:
            continue
        edges += 1
        lp = e.link_loops[0]
        a, b = lp[uvl].uv.copy(), lp.link_loop_next[uvl].uv.copy()
        for t in np.linspace(0, 1, int(max(abs(a.x - b.x) * w, abs(a.y - b.y) * h)) + 2):
            x, y = a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t
            rim[min(max(int((y % 1) * h), 0), h - 1), min(max(int((x % 1) * w), 0), w - 1)] = True
    bm.free()
    dist = np.full((h, w), float(radius), dtype=np.float32)
    cur = rim
    for i in range(radius):
        dist[cur & (dist == radius)] = i
        grown = cur.copy()
        grown[1:] |= cur[:-1]
        grown[:-1] |= cur[1:]
        grown[:, 1:] |= cur[:, :-1]
        grown[:, :-1] |= cur[:, 1:]
        cur = grown
    say('helmet rim', edges, 'edges,', int(rim.sum()), 'texels')
    f = np.clip(dist / radius, 0, 1)
    return f * f * (3 - 2 * f)


def hair_px(size):
    c = cards if (cards.shape[1], cards.shape[0]) == tuple(size) else None
    if c is None:
        im = bpy.data.images.new('c', cards.shape[1], cards.shape[0], alpha=True)
        im.pixels.foreach_set(cards.ravel())
        im.scale(size[0], size[1])
        c = np.array(im.pixels[:], dtype=np.float32).reshape(size[1], size[0], 4)
        bpy.data.images.remove(im)
    px = np.zeros_like(c)
    px[..., :3] = tone * (0.8 + 0.4 * c[..., 1:2])  # strand to strand variation from the atlas's second channel
    px[..., 3] = c[..., 0]  # coverage
    return px


paste(al, RECT['hair'], hair_px(RECT['hair'][2:]))
paste(al, RECT['brow'], hair_px(RECT['brow'][2:]))
lash = load_px(os.path.join(MAPS, 'Eyelashes_Color.png'), RECT['lash'][2:])
# (one colour; the strands are the alpha)
lash[..., :3] = np.minimum(lash[..., :3], 0.08)
paste(al, RECT['lash'], lash)
if helmet:
    cov = load_px(os.path.join(SRC, spec['helmet_cov']), RECT['helmet'][2:])
    hp = np.zeros_like(cov)
    # (its alpha is coverage; its green, a seed per strand, gives the strand-to-strand shade the cards' atlas does)
    hp[..., :3] = tone * (0.75 + 0.35 * cov[..., 1:2] / max(float(cov[..., 1].max()), 1e-3))
    # (fading out over HELMET_FEATHER texels in from the shell's open rim, the hairline, sideburns and nape: cut off at full
    # coverage it drew a hard line across the forehead)
    hp[..., 3] = np.clip(cov[..., 3] * 1.15, 0, 1) * rim_feather(helmet, RECT['helmet'][2:], HELMET_FEATHER)
    paste(al, RECT['helmet'], hp)
save(al, os.path.join(OUT, 'alpha.webp'), 'alpha')
flat = np.zeros((256, 256, 4), dtype=np.float32)
flat[..., 0] = flat[..., 1] = 0.5
flat[..., 2] = flat[..., 3] = 1
save(flat, os.path.join(OUT, 'cloth-flat.webp'), 'cloth')

# ---------------------------------------------------------------- neck seam normals --------------------------------------------------
# Head and body are two meshes meeting at the neck; each one's normals stop at the seam. Coinciding seam vertices get one.
for o in (body, head_skin):
    o.data.update()
seam = {}
hco = coords(head_skin)
kdh = KDTree(len(hco))
for i, c in enumerate(hco):
    kdh.insert(c, i)
kdh.balance()
for v in body.data.vertices:
    _, j, dist = kdh.find(v.co)
    if dist < 2e-4:
        n = (v.normal + head_skin.data.vertices[j].normal).normalized()
        seam[('body', v.index)] = n
        seam[('head', j)] = n
near = sorted(kdh.find(v.co)[2] for v in body.data.vertices if v.co.z > 1.35)[:40]
say('neck seam vertices', len(seam) // 2, 'closest body-to-head distances (mm)', [round(d * 1000, 2) for d in near[::5]])

# ---------------------------------------------------------------- export ----------------------------------------------------------
bone_ix = {n: i for i, n in enumerate(BONES)}
KINDS = [(body, 'skin', 'body'), (head_skin, 'skin', 'head'), (eyes, 'eye', 'eye'), (teeth, 'teeth', 'teeth'),
         (shirt, 'shirt', 'shirt'), (shorts, 'shorts', 'shorts'), (shoes, None, None), (lashes, 'lash', 'lash'),
         (hair, 'hair', 'hair'), (brows, 'brow', 'brow'), (helmet, 'hair', 'helmet'), (skirt, 'shorts', 'skirt'),
         (head_piece, 'sock', None)]


def uv_to(rect, size, u, v):
    x0, y0, w, h = rect
    return ((x0 + min(max(u, 0), 1) * w) / size[0], (y0 + min(max(v, 0), 1) * h) / size[1])


def fresh():
    return {'pos': [], 'nrm': [], 'uv': [], 'si': [], 'sw': [], 'part': [], 'index': [], 'ao': [], 'mask': [], 'morph': []}


buffers = {'opaque': fresh(), 'alpha': fresh()}
for o, part, rect in KINDS:
    if o is None:
        continue
    me = o.data
    me.calc_loop_triangles()
    uvl = me.uv_layers[0].data
    gname = {g.index: g.name[len(P):] for g in o.vertex_groups}
    kind = 'alpha' if part in ALPHA_PARTS else 'opaque'
    size = ALPHA_SIZE if kind == 'alpha' else OPAQUE_SIZE
    B = buffers[kind]
    base = len(B['part'])
    seen = {}
    tag = 'body' if o is body else 'head' if o is head_skin else None
    # (MetaHuman's body UVs sit in the next tile over, u 1-2, UDIM style: each mesh is brought back into 0-1)
    allu = np.empty(len(uvl) * 2, dtype=np.float32)
    uvl.foreach_get('uv', allu)
    tile = np.floor(np.median(allu.reshape(-1, 2), axis=0))
    if tile.any():
        say('uv tile', o.name, tile.tolist())
    for tri in me.loop_triangles:
        for li, vi in zip(tri.loops, tri.vertices):
            u, v = uvl[li].uv
            u, v = u - tile[0], v - tile[1]
            key = (vi, round(u, 5), round(v, 5))
            if key in seen:
                B['index'].append(seen[key])
                continue
            vert = me.vertices[vi]
            if o is shoes:
                pt, uv = ('sock' if shoe_sock[vi] else 'shoe'), (0.0, 0.0)
            elif o is head_piece:
                pt, uv = 'sock', (0.0, 0.0)  # (kit.ts: a sock above the hips takes the trim colour)
            else:
                pt, uv = part, uv_to(RECT[rect], size, u, v)
            ws = sorted(((g.weight, gname[g.group]) for g in vert.groups if g.weight > 1e-4), reverse=True)[:4]
            tot = sum(w for w, _ in ws) or 1
            si = [bone_ix[n] for _, n in ws] + [0] * (4 - len(ws))
            sw = [w / tot for w, _ in ws] + [0] * (4 - len(ws))
            if not ws:
                si, sw = [bone_ix['Hips'], 0, 0, 0], [1, 0, 0, 0]
            nrm = seam.get((tag, vi), vert.normal)
            co = vert.co
            seen[key] = base + len(seen)
            B['pos'] += [co.x, co.z, -co.y]
            B['nrm'] += [nrm.x, nrm.z, -nrm.y]
            B['uv'] += list(uv)
            B['si'] += si
            B['sw'] += sw
            B['part'].append(PART[pt])
            B['ao'].append(float(head_shade[vi]) if o is head_piece else 1.0)
            # (a skirt's hang, 0 at its top to 1 at the hem, in the mask's x: kit.ts swings it and keeps it off the thighs)
            B['mask'] += [float(skirt_hang[vi]) if o is skirt else 0.0, 0.0, 0.0, 0.0]
            B['index'].append(seen[key])
    say('mesh', o.name, len(seen), 'vertices', len(me.loop_triangles), 'triangles')

C = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))


def game_m(m):
    g = C @ m @ C.transposed()
    return [g[r][c] for c in range(4) for r in range(4)]  # column-major (THREE.Matrix4.fromArray)


skin_top = max(coords(head_skin)[:, 2].max(), 0)
height = skin_top - min(bco[:, 2].min(), new_co[:, 2].min())
blob = bytearray()
header = {'name': spec['name'], 'height': round(float(height), 4), 'bones': BONES,
          'joints': [[joints[n].x, joints[n].z, -joints[n].y] for n in BONES],
          'move': [game_m(move[n]) for n in BONES],
          'textures': {'opaque': 'opaque.webp', 'alpha': 'alpha.webp', 'cloth': spec['name'] + '-cloth.webp'},
          'parts': PART, 'morphs': [], 'kit': spec.get('kit', {}), 'meshes': {}}
for kind, B in buffers.items():
    ent = {'vertices': len(B['part']), 'indices': len(B['index'])}
    for key, fmt in (('pos', 'f'), ('nrm', 'f'), ('uv', 'f'), ('si', 'B'), ('sw', 'f'), ('part', 'B'), ('index', 'I'),
                     ('ao', 'f'), ('mask', 'f'), ('morph', 'f')):
        data = np.asarray(B[key], dtype={'f': '<f4', 'B': 'u1', 'I': '<u4'}[fmt]).tobytes()
        ent[key] = [len(blob), len(data)]
        blob += data
        blob += b'\0' * ((4 - len(blob) % 4) % 4)
    header['meshes'][kind] = ent
open(os.path.join(OUT, 'body.bin'), 'wb').write(bytes(blob))
json.dump(header, open(os.path.join(OUT, 'body.json'), 'w'))
os.replace(os.path.join(OUT, 'cloth-flat.webp'), os.path.join(OUT, spec['name'] + '-cloth.webp'))
say('wrote', OUT, 'height', round(float(height), 3), {k: v['vertices'] for k, v in header['meshes'].items()}, 'vertices')

# ---------------------------------------------------------------- preview (T-pose, Eevee) -------------------------------------------
if PREVIEW:
    def mat(name, color=None, image=None, alpha=False):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        bsdf = m.node_tree.nodes['Principled BSDF']
        if image:
            t = m.node_tree.nodes.new('ShaderNodeTexImage')
            t.image = bpy.data.images.load(image)
            m.node_tree.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
            if alpha:
                m.node_tree.links.new(t.outputs['Alpha'], bsdf.inputs['Alpha'])
        else:
            bsdf.inputs['Base Color'].default_value = color
        if alpha:
            m.blend_method = 'HASHED' if hasattr(m, 'blend_method') else m.blend_method
        return m

    looks = {body: mat('b', image=os.path.join(SRC, spec['body_bc'])),
             head_skin: mat('h', image=os.path.join(SRC, spec['head_bc'])),
             eyes: mat('e', image=os.path.join(MAPS, 'Eyes_Color.png')),
             teeth: mat('t', (0.8, 0.78, 0.7, 1)), lashes: mat('l', (0.05, 0.04, 0.03, 1)),
             shirt: mat('s', (0.75, 0.15, 0.12, 1)), shorts: mat('sh', (0.08, 0.1, 0.2, 1)),
             shoes: mat('sho', (0.9, 0.9, 0.88, 1)), hair: mat('ha', (0.12, 0.08, 0.05, 1))}
    if brows:
        looks[brows] = mat('br', (0.08, 0.06, 0.04, 1))
    if helmet:
        looks[helmet] = mat('hm', (0.12, 0.08, 0.05, 1))
    if skirt:
        looks[skirt] = mat('sk', (0.08, 0.1, 0.2, 1))
    if head_piece:
        looks[head_piece] = mat('hp', (0.9, 0.9, 0.88, 1))
    for o, m in looks.items():
        o.data.materials.clear()
        o.data.materials.append(m)
    scn = bpy.context.scene
    eng = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
    scn.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in eng else 'BLENDER_EEVEE'
    scn.render.image_settings.file_format = 'PNG'
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
    scn.collection.objects.link(cam)
    scn.camera = cam
    for tag, ang, dist, z, lens in (('tpose', 0, 5.5, 0.95, 50), ('tpose3', 40, 5.5, 0.95, 50), ('face', 20, 1.2, 1.6, 85)):
        a = math.radians(ang)
        cam.data.lens = lens
        cam.location = (dist * math.sin(a), -dist * math.cos(a), z)
        d = Vector((0, 0, z)) - cam.location
        cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        scn.render.filepath = os.path.join(OUT, f"{spec['name']}-{tag}.png")
        bpy.ops.render.render(write_still=True)
    say('preview written')
