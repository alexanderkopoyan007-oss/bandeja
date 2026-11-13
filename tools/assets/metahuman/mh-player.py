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
#   still). The garments' cloth map is drawn from their own meshes (folds, seams, hems); the skin's occlusion is baked into
#   the opaque atlas's alpha and the eyes' per vertex, as the MPFB players' are; the garments' isn't yet.
import bpy, bmesh, json, math, os, sys
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'mpfb'))
import person_kit as pk  # the skirt's and the band's geometry, shared with the MPFB players
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mh_shoe  # the trainer, modelled round each foot
import person_wear as pw  # the wardrobe's cuts and the skin each hides, shared with the MPFB players
from mathutils.interpolate import poly_3d_calc
import ao_bake  # the occlusion bakes, shared with the MPFB players

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


# MetaHuman's joint helpers (a finger's `_half_` joints, the bones under a `correctiveRoot` at the elbow, knee, shoulder
# and hip) sit on a joint and are turned by Unreal's rig logic, about halfway between the two bones there. The export has
# no rig logic, so the skin they carry goes half to each side of the joint. Going all to the bone below (up the chain),
# a finger's knuckles stayed with the next segment and every bent finger came apart at them (6 Nov sheet: the free hand
# a claw of loose pieces). Twist bones lie along one bone and stay with it.
HELPER_KEYS = ('_half_', 'correctiveRoot')


def game_shares(arm, name):
    """[(game bone, share)] for a MetaHuman group: its own game bone, or half each across the joint for a helper."""
    b = arm.data.bones.get(name)
    helper = False
    while b is not None:
        if b.name in DIRECT:
            g = DIRECT[b.name]
            if not helper:
                return [(g, 1.0)]
            p = b.parent
            while p is not None and (p.name not in DIRECT or DIRECT[p.name] == g):
                p = p.parent
            return [(g, 0.5), (DIRECT[p.name], 0.5)] if p is not None else [(g, 1.0)]
        helper = helper or any(k in b.name for k in HELPER_KEYS)
        b = b.parent
    return [('Hips', 1.0)]


def remap(o, arm):
    """MetaHuman's groups summed onto the game bones (up each joint's chain, a helper's split across its joint), the four
    largest kept, normalised."""
    gmap = {g.index: game_shares(arm, g.name) for g in o.vertex_groups}
    acc = []
    for v in o.data.vertices:
        d = {}
        for g in v.groups:
            if g.weight > 1e-5 and g.group in gmap:
                for n, s in gmap[g.group]:
                    d[n] = d.get(n, 0.0) + g.weight * s
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
def atlas_uv_first(o):
    """Keep only a card group's first UV layer, the atlas's, under one name for every group. Unreal names a group's UV channels
    by what else it exports: L_Straight's Group1 at LOD1 has a single channel, its atlas UVs, called LightMapUV, where Group0's
    is UVmap_0, and join() matches layers by name, so Group1's 13,393 vertices sat at UV (0, 0), a clear texel: from hair pass
    1 (LOD1, 7 Nov) on, 60% of p9mh's hair drew nothing, and what was left read as one thin black mass with her nape through it."""
    layers = o.data.uv_layers
    while len(layers) > 1:
        layers.remove(layers[-1])
    layers[0].name = 'UVMap'
    return o


# (a groom's cards can come in groups, L_Straight's two: all of them, as one mesh)
hair = join([atlas_uv_first(imp(h)[0]) for h in (spec['hair'] if isinstance(spec['hair'], list) else [spec['hair']])], 'hair')
_huv = np.empty(len(hair.data.uv_layers[0].data) * 2, dtype=np.float32)
hair.data.uv_layers[0].data.foreach_get('uv', _huv)
say('hair cards with no UVs (loops at 0, 0):', round(float((np.abs(_huv.reshape(-1, 2)).sum(1) == 0).mean()), 4))
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


def drop_sleeve_insides(ob):
    """What Epic puts inside a sleeve, out of the shirt as it is read. Returns (fans, lining faces).
    - A fan of triangles from one vertex in the middle closes each sleeve (so nobody sees up an empty one). Here an arm
      fills the sleeve, the fan lies through it, and on one woman its middle stood 4 cm out through her left sleeve, a dark
      chip on the cloth. (The fan that closes the hem, on the body's axis, stays.)
    - The sleeve's end is turned in and runs 6 cm back up inside as a lining, a millimetre or two under the cloth. Put 3 mm
      off the skin with the rest (below), lining and cloth lie in the one place, and as an arm bent the lining came through
      in dark scraps. Cloth on the arm that faces the arm's own line goes; the game draws the inside of a sleeve from the
      back of its outside."""
    dom = [max(w, key=w.get) if w else '' for w in weights(ob)]
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.normal_update()
    out_x = 0.6 * abs(MHJ['upperarm_l'].x)
    mids = [v for v in bm.verts if len(v.link_edges) >= 12 and not v.is_boundary and abs(v.co.x) > out_x
            and sum(e.other_vert(v).is_boundary for e in v.link_edges) >= 0.8 * len(v.link_edges)]
    left = 1.0 if MHJ['upperarm_l'].x > 0 else -1.0
    lining = []
    for f in bm.faces:
        c = f.calc_center_median()
        lr, s_ = ('Left', '_l') if c.x * left > 0 else ('Right', '_r')
        if not all(dom[v.index] in (lr + 'Arm', lr + 'ForeArm', lr + 'Shoulder') for v in f.verts):
            continue
        a0 = MHJ['upperarm' + s_]
        t = (MHJ['lowerarm' + s_] - a0).normalized()
        out = c - (a0 + t * (c - a0).dot(t))
        if (c - a0).dot(t) > 0.03 and out.length > 1e-4 and f.normal.dot(out.normalized()) < -0.3:
            lining.append(f)
    n = (len(mids), len(lining))
    bmesh.ops.delete(bm, geom=lining, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in mids if v.is_valid], context='VERTS')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    return n


say('sleeve fans and lining faces out of the shirt', drop_sleeve_insides(shirt))
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
    # (and under the cards. Unreal's helmet is the hair's outside, the far head's stand-in for the cards; near, it stood over
    # them, and a bob (p10mh, no coverage map, so all of the shell drawn) read as a black plastic shell with its cards'
    # strands, parting and shine hidden. Along each vertex's line out of the skin, the cards are hit in layers; the vertex
    # now sits HELMET_UNDER inside the hit HELMET_Q of the way out, under most of them, filling the gaps between the
    # strands as the hair's mass without covering them, and never nearer the skin than HELMET_OFF. Over the face (skin
    # facing within HELMET_FRONT of straight ahead, the forehead under a fringe) the shell goes where cards cover it: what
    # shows between a fringe's strands is the forehead, and sunk onto it the shell was a dark band under the fringe's
    # edge and a notch at its end, behind cards 3-4 mm off the skin. It sinks at most HELMET_SINK: an afro's cards fill a
    # deep volume (p8mh's quarter-depth hit is 3-8 cm in), and sunk to it the afro lost its mass and read as a sparse
    # spiky halo; held 1.5 cm under its outside, its outer cards are a fuzz over the dark mass.)
    HELMET_Q, HELMET_UNDER, HELMET_REACH, HELMET_FRONT, HELMET_SINK = 0.25, 0.0015, 0.08, 0.7, 0.015
    ahead = Vector((0, -1, 0))
    cb = bmesh.new()
    cb.from_mesh(hair.data)
    card_bvh = BVHTree.FromBMesh(cb)
    cb.free()
    sink, over_face = [], set()
    for v in helmet.data.vertices:
        loc, nrm, _, _ = head_bvh.find_nearest(v.co)
        if loc is None:
            continue
        s = (v.co - loc).dot(nrm)
        if s <= HELMET_OFF:
            continue
        hits, t0 = [], 0.0005
        while t0 < s + HELMET_REACH:
            hit = card_bvh.ray_cast(loc + nrm * t0, nrm, s + HELMET_REACH - t0)
            if hit[0] is None:
                break
            t = (hit[0] - loc).dot(nrm)
            hits.append(t)
            t0 = t + 0.0002
        if not hits:
            continue
        if nrm.dot(ahead) > HELMET_FRONT:
            over_face.add(v.index)
            continue
        want = max(HELMET_OFF, s - HELMET_SINK, min(s, float(np.quantile(hits, HELMET_Q)) - HELMET_UNDER))
        if want < s - 1e-4:
            v.co = v.co - nrm * (s - want)
            sink.append(s - want)
    helmet.data.update()
    n_shell = len(helmet.data.vertices)
    hb = bmesh.new()
    hb.from_mesh(helmet.data)
    gone = [f for f in hb.faces if all(v.index in over_face for v in f.verts)]
    bmesh.ops.delete(hb, geom=gone, context='FACES')
    bmesh.ops.delete(hb, geom=[v for v in hb.verts if not v.link_faces], context='VERTS')
    hb.to_mesh(helmet.data)
    hb.free()
    helmet.data.update()
    say('helmet vertices sunk under the cards', len(sink), 'of', n_shell,
        'by (mm) percentile 10/50/90', [round(float(np.percentile(sink, q)) * 1000, 1) for q in (10, 50, 90)] if sink else [],
        '; faces over the face under cards dropped', len(gone))

# ---------------------------------------------------------------- joints ----------------------------------------------------------
J = {}
for g, mh in JOINT_OF.items():
    J[g] = MHJ[mh].copy()
bw = weights(body)
bco = coords(body)

# The exported skeleton isn't refitted to the body after conform: from the elbow and knee out it has the template's
# limbs (p3: the forearm 29 cm where its skin's is 25, as the MPFB body it was conformed to; the wrist 10 cm and every
# finger joint 11-12 cm off the skin, the ankle 6.5 cm). Turned about those joints, each finger came off its knuckle
# and the hand swung round a point in the air (6 Nov sheet). So the joints from the wrist and the ankle out come from
# the skin's own weights instead: the ring where a joint's two bones share the skin, its centre weighted by the lesser
# share. The shoulder, elbow, hip and knee stay: within 1.5-4 cm, and their rings lean (the knee's sits 4 cm high).
CREASE_MIN, CREASE_VERTS = 0.15, 6


def crease(a, b):
    w = np.array([min(d.get(a, 0.0), d.get(b, 0.0)) for d in bw])
    on = w > CREASE_MIN
    if on.sum() < CREASE_VERTS:
        return None
    return Vector((bco[on] * w[on, None]).sum(0) / w[on].sum())


moved_joints = []
for s, _ in SIDES:
    pairs = [(s + 'ForeArm', s + 'Hand'), (s + 'Leg', s + 'Foot'), (s + 'Foot', s + 'ToeBase')]
    for F, _ in FINGERS:
        pairs += [(s + 'Hand', f'{s}Hand{F}1'), (f'{s}Hand{F}1', f'{s}Hand{F}2'), (f'{s}Hand{F}2', f'{s}Hand{F}3')]
    for a, b in pairs:
        c = crease(a, b)
        if c is None:
            raise ValueError(f'no crease between {a} and {b} to place {b} on')
        moved_joints.append(((c - J[b]).length, b))
        J[b] = c
say('joints from the skin: moved (cm)', [(n, round(d * 100, 1)) for d, n in sorted(moved_joints, reverse=True)[:8]])


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


def foot_frame(co, sole, side):
    """A foot as it stands: its middle on the floor, the unit vector along it (heel to toe, level) and its length, width
    and height box in that frame, from the skin under FOOT_TOP. The axis is the footprint's long axis (its points'
    principal direction), not the model's: a MetaHuman stands with its feet turned out 10 degrees or so, and the box round a
    turned foot in the model's axes is a good deal wider than the foot (p1mh: 15%, and the trainer made that much too wide
    stood a finger off the ankle all round)."""
    m = (co[:, 2] < sole + FOOT_TOP) & ((co[:, 0] > 0) if side == 'Left' else (co[:, 0] < 0))
    pts = co[m]
    low = pts[pts[:, 2] < sole + 0.03][:, :2]
    c = low.mean(0)
    w, v = np.linalg.eigh(np.cov((low - c).T))
    ax = v[:, int(np.argmax(w))]
    if ax[1] > 0:  # (forward is -y)
        ax = -ax
    across = np.array([-ax[1], ax[0]])
    u, t = (pts[:, :2] - c) @ ax, (pts[:, :2] - c) @ across
    lo = np.array([u.min(), t.min()])
    hi = np.array([u.max(), t.max()])
    mid = c + ax * (lo[0] + hi[0]) / 2 + across * (lo[1] + hi[1]) / 2
    return mid, ax, across, hi - lo


sco = coords(shoe_src)
new_co = sco.copy()
FOOT_FRAME = {}
for s, _ in SIDES:
    c0, ax0, ac0, d0 = foot_frame(p1co, p1_sole, s)
    c1, ax1, ac1, d1 = foot_frame(bco, mh_sole, s)
    k = d1 / d0
    kz = (k[0] + k[1]) / 2  # the foot's height in the shoe goes with its size
    sel = (sco[:, 0] > 0) if s == 'Left' else (sco[:, 0] < 0)
    rel = sco[sel, :2] - c0
    u, t = rel @ ax0 * k[0], rel @ ac0 * k[1]
    new_co[sel, :2] = c1 + u[:, None] * ax1 + t[:, None] * ac1
    new_co[sel, 2] = (sco[sel, 2] - p1_sole) * kz + mh_sole
    FOOT_FRAME[s] = (c1, ax1, ac1, d1)
    say('shoe', s, 'scale along, across, up', [round(float(x), 3) for x in (k[0], k[1], kz)], 'turned',
        round(math.degrees(math.atan2(ax1[0], -ax1[1]) - math.atan2(ax0[0], -ax0[1])), 1), 'deg; foot', (d1 * 100).round(1), 'cm')
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

# ---------------------------------------------------------------- the crew sock, from the leg's own skin ---------------------------
# (13 Nov 2026, the owner, of a close still: "the limbs aren't even attached".) shoes05's sock is a tube made round p1's
# MakeHuman leg. Scaled by the foot's box onto a MetaHuman it stood a centimetre and more off the calf all round, a stovepipe
# with the leg loose in it and the dark of its inside showing at the top, and the game's trainer (shoe.ts) fits its collar
# round the sock, so the shoe gaped as wide. A sock is the leg's own shape: this body's skin from the sock's top down over the
# foot, laid SOCK_EASE out along its normals (SOCK_RIB more over the cuff), its top turned back in onto the skin, moving with
# the skin's own weights (as person_wear.py's skin_shell makes the MPFB players' ankle and knee socks). The tube goes.
SOCK_EASE, SOCK_RIB, SOCK_RIB_LEN, TURN_IN, TURN_BACK, SOCK_TOES = 0.0022, 0.0008, 0.05, 0.0018, 0.011, 0.7
LEG_BONES = ('UpLeg', 'Leg', 'Foot', 'ToeBase')


def skin_shell(name, z_hi, ease, rib, rib_len):
    leg_tree = BVHTree.FromPolygons([v.co.copy() for v in body.data.vertices], [tuple(p_.vertices) for p_ in body.data.polygons])
    dom = [max(d, key=d.get) if d else '' for d in bw]
    leg = [any(n.endswith(x) for x in LEG_BONES) for n in dom]
    bm = bmesh.new()
    bm.from_mesh(body.data)
    orig = bm.verts.layers.int.new('orig')
    for v in bm.verts:
        v[orig] = v.index + 1

    def toes(co):
        # (past SOCK_TOES of the foot's length: always under the toe box, and a sock drawn over five toes came out through it)
        c, ax, _, d = FOOT_FRAME['Left' if co.x > 0 else 'Right']
        return co.z < mh_sole + FOOT_TOP and (co.x - c[0]) * ax[0] + (co.y - c[1]) * ax[1] > (SOCK_TOES - 0.5) * d[0]
    dead = [f for f in bm.faces if not all(leg[v.index] for v in f.verts) or min(v.co.z for v in f.verts) > z_hi + 0.02
            or all(toes(v.co) for v in f.verts)]
    bmesh.ops.delete(bm, geom=dead, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    # (Unreal's export has the skin's vertices doubled along its UV seams: pushed out along two different normals, a seam
    # opened as a dark line down the sock)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, z_hi), plane_no=(0, 0, 1), clear_outer=True)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    # (a vertex the cut made carries a number mixed from its edge's two ends: some vertex elsewhere on the body, and with
    # that one's weights the cuff's ring flew off as spikes. It takes the nearest skin's instead, as the turned rings do)
    for v in bm.verts:
        if abs(v.co.z - z_hi) < 1e-5:
            v[orig] = 0
    bm.normal_update()
    for v in bm.verts:
        t = min(1.0, max(0.0, (v.co.z - (z_hi - rib_len)) / 0.006))
        v.co = v.co + v.normal * (ease + rib * t)
    # The top, turned back in: a ring TURN_IN under the cuff's edge, and one on the skin TURN_BACK further down.
    bm.edges.ensure_lookup_table()
    rim = [e for e in bm.edges if e.is_boundary and min(v.co.z for v in e.verts) > z_hi - 0.004]
    ring1, ring2 = {}, {}
    for e in rim:
        for v in e.verts:
            if v in ring1:
                continue
            p1 = v.co - v.normal * TURN_IN
            q, qn, _, _ = leg_tree.find_nearest(p1 - Vector((0, 0, TURN_BACK)))
            ring1[v] = bm.verts.new(p1)
            ring2[v] = bm.verts.new(q + qn * 0.0006)
    for e in rim:
        a, b = e.verts
        # (wound as the face the edge belongs to, turned over the edge)
        l = e.link_loops[0]
        if l.vert is not a:
            a, b = b, a
        for A, B in ((lambda v: v, ring1.get), (ring1.get, ring2.get)):
            bm.faces.new((A(b), A(a), B(a), B(b)))
    bm.normal_update()
    bm.verts.index_update()
    src = [v[orig] - 1 for v in bm.verts]
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    rigid(o, None)
    g = {n: o.vertex_groups[P + n] for n in BONES}
    made = 0
    for i, v in enumerate(me.vertices):
        j = src[i]
        if j < 0:
            _, j, _ = kd.find(v.co)
            made += 1
        for n, w in bw[j].items():
            g[n].add([i], w, 'REPLACE')
    for p_ in me.polygons:
        p_.use_smooth = True
    say('sock', name, len(me.vertices), 'vertices', len(me.polygons), 'faces to', round(z_hi - mh_sole, 3), 'm over the sole;', made, 'cut or turned')
    return o


sock = skin_shell('sock', sock_top, SOCK_EASE, SOCK_RIB, SOCK_RIB_LEN)
# shoes05's own tubes out of the trainer: every piece that reaches the sock's height.
bm = bmesh.new()
bm.from_mesh(shoes.data)
bm.verts.ensure_lookup_table()
seen_v, tube = set(), []
for v0 in bm.verts:
    if v0 in seen_v:
        continue
    piece, stack = [], [v0]
    seen_v.add(v0)
    while stack:
        v = stack.pop()
        piece.append(v)
        for e in v.link_edges:
            w = e.other_vert(v)
            if w not in seen_v:
                seen_v.add(w)
                stack.append(w)
    if any(shoe_sock[v.index] for v in piece):
        tube += piece
say('shoes05 sock tubes out:', len(tube), 'of', len(bm.verts), 'vertices')
bmesh.ops.delete(bm, geom=tube, context='VERTS')
bm.to_mesh(shoes.data)
bm.free()
shoes.data.update()
shoe_sock = None  # (the trainer alone is left)

# ---------------------------------------------------------------- the trainers, modelled round the feet ---------------------------
# (mh_shoe.py; spec trainer 0 keeps shoes05 for the game's own builder, shoe.ts, to remake.) Each vertex's (occlusion, where
# on the shoe, along, across) goes into the file for kit.ts, with the fit it laces by; the sole moves with the foot and the toes
# (it bends at their joint), the collar and the tongue's top with the sock in them.
TRAINER = int(spec.get('trainer', 1))
shoe_x, shoe_fit = None, None
if TRAINER:
    leg_polys = [tuple(p_.vertices) for p_ in body.data.polygons]
    leg_bvh = BVHTree.FromPolygons([v.co.copy() for v in body.data.vertices], leg_polys)
    all_co, all_faces, all_x, all_w, fits = [], [], [], [], []
    for s, _ in SIDES:
        c1, ax1, ac1, d1 = FOOT_FRAME[s]
        lat = ac1 * (1.0 if s == 'Left' else -1.0)
        heel0 = Vector((c1[0] - ax1[0] * d1[0] / 2, c1[1] - ax1[1] * d1[0] / 2, mh_sole))
        ft = mh_shoe.Foot(heel0, ax1, lat, float(d1[0]), leg_bvh)
        a_ball = ft.local(J[s + 'ToeBase'])[0]
        t = mh_shoe.build(ft, J[s + 'Foot'].z - mh_sole, a_ball, say)
        # Faces outward: made in the foot's frame, each shell turned to face out, then into the model's (a mirror for one foot).
        tb = bmesh.new()
        tv = [tb.verts.new(c) for c in t['co']]
        for f in t['faces']:
            try:
                tb.faces.new([tv[i] for i in f])
            except ValueError:
                pass
        bmesh.ops.recalc_face_normals(tb, faces=tb.faces[:])
        tb.normal_update()
        tb.faces.ensure_lookup_table()
        down = sum(f.normal.z for f in tb.faces if all(t['where'][v.index] < 0.25 and v.co.z < t['lowest'] + 0.004 for v in f.verts))
        if down > 0:
            for f in tb.faces:
                f.normal_flip()
        tongue = [f for f in tb.faces if all(15 < t['where'][v.index] < 35 for v in f.verts)]
        if sum(f.normal.z + 0.5 * f.normal.x for f in tongue) < 0:
            for f in tongue:
                f.normal_flip()
        mirrored = ax1[0] * lat[1] - ax1[1] * lat[0] < 0
        base = len(all_co)
        for f in tb.faces:
            ids = [v.index + base for v in f.verts]
            all_faces.append(ids[::-1] if mirrored else ids)
        tb.free()
        for i, c in enumerate(t['co']):
            pw_ = ft.world(*c)
            all_co.append(pw_)
            all_x.append((t['ao'][i], t['where'][i], t['along'][i], t['across'][i]))
            wt = mh_shoe.smooth(a_ball - 0.035, a_ball + 0.02, c[0])
            d = {s + 'Foot': 1 - wt, s + 'ToeBase': wt}
            hd = float(t['hold'][i])
            if hd > 0:
                q, _, fi, _ = leg_bvh.find_nearest(pw_)
                vs = leg_polys[fi]
                ws = poly_3d_calc([body.data.vertices[j].co for j in vs], q)
                d = {n: w * (1 - hd) for n, w in d.items()}
                for j, wj in zip(vs, ws):
                    for n, w in bw[j].items():
                        d[n] = d.get(n, 0.0) + hd * wj * w
            all_w.append(d)
        fits.append(t['fit'])
    me = bpy.data.meshes.new('trainers')
    me.from_pydata([tuple(c) for c in all_co], [], all_faces)
    me.update()
    for p_ in me.polygons:
        p_.use_smooth = True
    bpy.data.objects.remove(shoes, do_unlink=True)
    shoes = bpy.data.objects.new('shoes', me)
    bpy.context.scene.collection.objects.link(shoes)
    rigid(shoes, None)
    vg = {n: shoes.vertex_groups[P + n] for n in BONES}
    for i, d in enumerate(all_w):
        for n, w in d.items():
            if w > 1e-4:
                vg[n].add([i], w, 'REPLACE')
    shoe_x = np.array(all_x, dtype=np.float32)
    shoe_fit = {key: (True if key == 'modelled' else round(float(np.mean([f[key] for f in fits])), 5)) for key in fits[0]}
    new_co = np.array([tuple(c) for c in all_co])
    say('trainers', len(all_co), 'vertices', len(all_faces), 'faces; soles', round(float(mh_sole - new_co[:, 2].min()) * 1000, 1), 'mm under the bare feet')
if os.environ.get('MH_STOP') == 'feet':
    # A look at the feet alone (the trainer's zones as flat colours), from a few sides.
    def flat(name, rgb, rough=0.6):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*rgb, 1)
        m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = rough
        return m
    body.data.materials.append(flat('skin', (0.62, 0.42, 0.32)))
    sock.data.materials.append(flat('sock', (0.9, 0.9, 0.9), 0.9))
    if TRAINER:
        zones = [(0.25, flat('outsole', (0.12, 0.11, 0.1))), (0.75, flat('midsole', (0.93, 0.93, 0.9))), (15, flat('upper', (0.85, 0.87, 0.9))),
                 (35, flat('tongue', (0.85, 0.5, 0.2) if os.environ.get('MH_DEBUG') else (0.7, 0.72, 0.76))), (42.5, flat('lace', (0.2, 0.25, 0.6))),
                 (99, flat('lining', (0.2, 0.6, 0.3) if os.environ.get('MH_DEBUG') else (0.55, 0.57, 0.62), 0.9))]
        for _, m in zones:
            shoes.data.materials.append(m)
        for p_ in shoes.data.polygons:
            w = float(np.mean([shoe_x[v, 1] for v in p_.vertices]))
            p_.material_index = next(i for i, (lim, _) in enumerate(zones) if w < lim)
    else:
        shoes.data.materials.append(flat('shoe', (0.85, 0.87, 0.9)))
    scn = bpy.context.scene
    eng = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
    scn.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in eng else 'BLENDER_EEVEE'
    scn.render.image_settings.file_format = 'PNG'
    scn.render.resolution_x, scn.render.resolution_y = 1100, 800
    scn.world = scn.world or bpy.data.worlds.new('w')
    scn.world.use_nodes = True
    scn.world.node_tree.nodes['Background'].inputs[0].default_value = (0.5, 0.52, 0.56, 1)
    scn.world.node_tree.nodes['Background'].inputs[1].default_value = 0.9
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(48), 0, math.radians(35))
    scn.collection.objects.link(sun)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scn.collection.objects.link(cam)
    scn.camera = cam
    cam.data.lens = 70
    c1, ax1, ac1, d1 = FOOT_FRAME['Left']
    at = Vector((c1[0], c1[1], mh_sole + 0.045))
    fa, fc = Vector((ax1[0], ax1[1], 0)), Vector((ac1[0], ac1[1], 0))
    for tag, d, dist in (('out', (0.1, 1, 0.12), 1.0), ('front34', (0.8, 0.62, 0.42), 0.95), ('front', (1, 0.08, 0.35), 0.95), ('in', (0.1, -1, 0.12), 1.0),
                         ('back34', (-0.8, 0.55, 0.3), 0.95), ('top', (0.3, 0.12, 1), 0.95), ('laces', (0.45, 0.25, 1), 0.5)):
        if os.environ.get('MH_VIEWS') and tag not in os.environ['MH_VIEWS'].split(','):
            continue
        v = (fa * d[0] + fc * d[1] + Vector((0, 0, d[2]))).normalized()
        cam.location = at + v * dist
        cam.rotation_euler = (at - cam.location).to_track_quat('-Z', 'Y').to_euler()
        scn.render.filepath = os.path.join(OUT, f'feet-{tag}.png')
        bpy.ops.render.render(write_still=True)
    say('feet preview written')
    sys.exit(0)

# ---------------------------------------------------------------- tank, skirt, band or visor ------------------------------------
# The kit the MPFB players have and MetaHuman's garment hasn't (spec kit, as person_kit.py makes it there; the game draws the
# rest in kit.ts):
# - a tank: the T-shirt's sleeves off along kit.ts's tankCut plane (from the LeftArm joint), its armhole laid on the skin;
# - a skirt: person_kit's rings round the body from under the shirt's hem down to kit.skirt, over MetaHuman's shorts with
#   their top off and their legs cut where the old inner shorts ended (spec shorts_hem);
# - a band or a visor: person_kit's, round the head on the skin or on the hair's helmet.
KIT = spec.get('kit', {})
# The garment off the skin first, as finish-player.py puts the MPFB suit 3 mm out: Epic's tee lies on the skin over the
# shoulders, and in places under it (a tenth of it within 1 mm, by the armholes), where nothing showed while the skin under it
# was cut away. Where the skin stays under the cloth (behind the collar, round a tank's armholes) it came through in a jagged
# line. Every vertex nearer than GARMENT_OFF, or under the skin by less than GARMENT_DEEP (deeper is the far side of a limb),
# goes out along the skin's normal to GARMENT_OFF.
GARMENT_OFF, GARMENT_DEEP = 0.003, 0.03
# (the skin is the body and the head: MetaHuman's head mesh comes down over the neck to the collar line, and measured from the
# body alone the shirt's shoulders by the neck were 6-9 cm from any skin)
nb = len(body.data.vertices)
skin_tree = BVHTree.FromPolygons([v.co.copy() for v in body.data.vertices] + [v.co.copy() for v in head_skin.data.vertices],
                                 [tuple(p.vertices) for p in body.data.polygons] + [tuple(i + nb for i in p.vertices) for p in head_skin.data.polygons])
for o in (shirt, shorts):
    out = set()
    # (a few passes: in a hollow, the shoulder into the neck, out along one triangle's normal is nearer the next one)
    for _ in range(4):
        for v in o.data.vertices:
            q, n, _, _ = skin_tree.find_nearest(v.co)
            if q is None:
                continue
            s = (v.co - q).dot(n)
            if -GARMENT_DEEP < s < GARMENT_OFF - 1e-4:
                v.co = v.co + n * (GARMENT_OFF - s)
                out.add(v.index)
    out = len(out)
    o.data.update()
    say('garment off the skin:', o.name, out, 'of', len(o.data.vertices), 'vertices out to', GARMENT_OFF * 1000, 'mm')

# The shirt hangs from the chest. Epic's tee follows the body in under the pectorals and in at the waist, and lit from
# above the men read as having a bust and a waist (7 Nov sheet: p1, p4, p5). Cloth bridges a hollow: below the armpits
# the shirt, round the trunk, may come in no faster than DRAPE_SLOPE (m in per m down) from where it is widest above.
# Seen on p1 from fixed angles (tools/mocap-view): without it the tee pinches in towards the hem and dips under the chest;
# at 0.08 it hangs straight and boxy, as the MPFB players' plumb line (slope 0) did; 0.15 reads as a fitted sports tee.
# The men only (spec 'drape', cast-spec.mjs): the women's tops are cut to the body, as women's padel tops are.
if spec.get('drape'):
    DRAPE_SLOPE, DRAPE_BINS, DRAPE_FROM, DRAPE_MIN_R, DRAPE_FACING, DRAPE_SMOOTH = 0.15, 72, 0.08, 0.04, 0.2, 8
    trunk_bones = ('Hips', 'Spine', 'Spine1', 'Spine2')
    sw_ = weights(shirt)
    sco = coords(shirt)
    ax, ay = J['Spine1'].x, J['Spine1'].y
    top = J['LeftArm'].z - DRAPE_FROM
    on_trunk = np.array([bool(w) and max(w, key=w.get) in trunk_bones for w in sw_]) & (sco[:, 2] < top)
    th = np.arctan2(sco[:, 1] - ay, sco[:, 0] - ax)
    r = np.hypot(sco[:, 0] - ax, sco[:, 1] - ay)
    b = ((th + np.pi) / (2 * np.pi) * DRAPE_BINS).astype(int) % DRAPE_BINS
    want = r.copy()
    # Only cloth facing out from the trunk is judged (the rest follows it, below). The fan that closes the hem inside the
    # body has its centre on the axis, where 'out' has no direction (it was flung 13 cm sideways): within DRAPE_MIN_R it
    # stays where it is.
    nrm = np.array([v.normal[:] for v in shirt.data.vertices])
    radial = (nrm[:, 0] * (sco[:, 0] - ax) + nrm[:, 1] * (sco[:, 1] - ay)) / np.maximum(r, 1e-6)
    idx = np.nonzero(on_trunk & (r > DRAPE_MIN_R) & (radial > DRAPE_FACING))[0]
    for k in range(DRAPE_BINS):
        # this bearing only, highest first. (With its neighbours' bins too, the waist's section, which isn't round, came
        # in: its radius changes 5-8 mm over 8 degrees, so a hem vertex just under a wider neighbour went out 7 mm and the
        # one above it not at all, and the hem crinkled into teeth. The bins' edges are evened out below instead.)
        mine = idx[b[idx] == k]
        if not len(mine):
            continue
        order = mine[np.argsort(-sco[mine, 2])]
        reach = r[order] - DRAPE_SLOPE * sco[order, 2]  # r(z') - slope (z' - z) = reach(z') + slope z
        best = np.maximum.accumulate(reach)
        zs = -sco[order, 2]
        for v in mine:
            j = np.searchsorted(zs, -sco[v, 2], side='right') - 1  # the highest-first prefix down to this height
            if j >= 0:
                want[v] = max(r[v], best[j] + DRAPE_SLOPE * sco[v, 2])
    # The push (not the radius) evened out over the cloth's edges, DRAPE_SMOOTH rounds of half its own and half its
    # neighbours' mean, so neighbouring bearings move together and no bin's edge shows as a step.
    out_ = np.zeros(len(r), bool); out_[idx] = True
    ev = np.array([e.vertices[:] for e in shirt.data.edges])
    ev = ev[out_[ev[:, 0]] & out_[ev[:, 1]]]
    pu = np.where(out_, want - r, 0.0)
    deg = np.zeros(len(r)); np.add.at(deg, ev[:, 0], 1); np.add.at(deg, ev[:, 1], 1)
    for _ in range(DRAPE_SMOOTH):
        acc = np.zeros(len(r)); np.add.at(acc, ev[:, 0], pu[ev[:, 1]]); np.add.at(acc, ev[:, 1], pu[ev[:, 0]])
        pu = np.where(out_ & (deg > 0), 0.5 * pu + 0.5 * acc / np.maximum(deg, 1), pu)
    want[idx] = r[idx] + pu[idx]
    # The tee's hem is a turned-up band: its inside faces in (377 vertices on p3, all within a few mm of the hem) and its
    # bottom edge down. Each goes out by as much as the nearest outward-facing cloth, so the band keeps its thickness;
    # left where it was, the band opened under the moved outside and the hem showed teeth.
    lining = np.nonzero(on_trunk & (r > DRAPE_MIN_R) & ~(radial > DRAPE_FACING))[0]
    if len(lining) and len(idx):
        tree = KDTree(len(idx))
        for n_, v in enumerate(idx):
            tree.insert(sco[v], n_)
        tree.balance()
        for v in lining:
            u = idx[tree.find(sco[v])[1]]
            want[v] = r[v] + (want[u] - r[u])
    moved = 0
    for v in np.concatenate([idx, lining]):
        if want[v] > r[v] + 1e-4:
            k = want[v] / max(r[v], 1e-6)
            co = shirt.data.vertices[v].co
            co.x = ax + (co.x - ax) * k
            co.y = ay + (co.y - ay) * k
            moved += 1
    shirt.data.update()
    push = want - r
    worst = int(np.argmax(push))
    say('shirt draped from the chest:', moved, 'vertices out; mm by percentile 50/90/99/max',
        [round(float(np.percentile(push[idx], q)) * 1000, 1) for q in (50, 90, 99, 100)],
        '| most at height', round(float(sco[worst, 2] - J['Hips'].z), 3), 'm over the hips, bearing', round(float(np.degrees(th[worst]))),
        'deg, r', round(float(r[worst]), 3), '->', round(float(want[worst]), 3))
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


# The women's tops end where the MPFB women's did, level with the Hips joint (theirs 1-3 mm under it): Epic's tee hangs 4 cm
# lower, and the skirt, which starts SKIRT_TUCK above the top's hem, sat on the hips with its waist 3 cm over the thigh joint.
TOP_HEM_UNDER_HIPS = 0.002
if spec.get('top_hem') == 'hips':
    bisect(shirt, Vector((0, 0, J['Hips'].z - TOP_HEM_UNDER_HIPS)), Vector((0, 0, 1)), inner=True)
    say('top cut level with the hips at', round(J['Hips'].z - TOP_HEM_UNDER_HIPS, 3))

# The wardrobe (13 Nov 2026, the owner: "build the wardrobe on the detailed bodies"): every cut a player can choose, built on
# this body as person_wear.py builds them on the MPFB players, so costumes.ts bodyFor can draw a MetaHuman whatever they wear.
# The tops are Epic's tee cut again (tank, sleeveless), laid on the chest round a V (vneck), or carried on to the wrists (long);
# both skirts; ankle and knee socks and tights from the legs' own skin; a polo's collar. The skin stays whole under them, with
# the garments that hide each vertex (asset.ts Wardrobe: `piece`, `tpiece`, `hide`), where a build with one cut dropped it.
WARDROBE = int(os.environ.get('MH_WARDROBE', spec.get('wardrobe', 1)))
WOMEN = not spec.get('drape')
pw.N_BODY = pk.N_BODY = 10 ** 9  # (MakeHuman's count of skin vertices before its helpers: here a body is all skin)
# (the armhole's line by the LeftArm joint, out and up: kit.ts tankCut; person_wear.SLEEVELESS for the wider cut)
TANK_PTS = ((-0.035, 0.07), (-0.01, -0.15))
tee_whole = pw.copy_of(shirt, 'Wear.tee') if WARDROBE and KIT.get('top') == 'tank' else None


def cut_armholes(shirt, pts, what):
    """A top's sleeves off on the planes through `pts` (out from the arm joint, up from it: top and bottom of each armhole), the
    armholes laid on the skin. Returns the planes (a point, the outward normal)."""
    tank_planes = []
    n0 = len(shirt.data.polygons)
    for side in (1, -1):
        a = Vector((chest_x + side * (arm_x0 + pts[0][0]), 0, arm_j.z + pts[0][1]))
        b = Vector((chest_x + side * (arm_x0 + pts[1][0]), 0, arm_j.z + pts[1][1]))
        no = Vector((0, 1, 0)).cross((b - a).normalized()) * side
        if no.x * side < 0:
            no = -no
        tank_planes.append((a, no))
        bisect(shirt, a, no, outer=True, lowest=ARMHOLE_FROM)
    say(what + ': sleeves off, shirt faces', n0, '->', len(shirt.data.polygons))
    # The armhole on the skin (person_kit.hug_armholes): the tee stood off the shoulder and the torso is hollow under it, so
    # the cut edge goes to ARMHOLE_LIFT off the skin, in the cut's plane (where the shader's binding and skin cut are), with
    # the nearest skin's weights; the shirt eases to it over ARMHOLE_REACH.
    ARMHOLE_LIFT, ARMHOLE_REACH = 0.002, 0.04
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
            ease[v.index] = (moved[ids[k]] * (1 - d / ARMHOLE_REACH) ** 2, d / ARMHOLE_REACH)
    for i, dv in moved.items():
        me.vertices[i].co += dv
    # (each eased vertex stays off the skin by its own measure, from ARMHOLE_LIFT at the edge to ARMHOLE_EASE at the reach: the
    # edge moves up to 2.5 cm in on MetaHuman's loose tee, and the shirt next to it, dragged as far, went into the body and the
    # skin came through it in a jagged line round the shoulder)
    ARMHOLE_EASE = 0.006
    pushed = 0
    for i, (dv, t) in ease.items():
        p = me.vertices[i].co + dv
        q, n, _, _ = skin_tree.find_nearest(p)
        floor = ARMHOLE_LIFT + (ARMHOLE_EASE - ARMHOLE_LIFT) * t
        s = (p - q).dot(n)
        if s < floor:
            p = p + n * (floor - s)
            pushed += 1
        me.vertices[i].co = p
    svg = {n: shirt.vertex_groups[P + n] for n in BONES}
    for i in ids:
        _, j, _ = kd.find(me.vertices[i].co)
        for g in svg.values():
            g.remove([i])
        for n, w in bw[j].items():
            svg[n].add([i], w, 'REPLACE')
    me.update()
    def near_plane(co):
        return max(((co.x - a.x) * no.x + (co.z - a.z) * no.z) if (co.x - chest_x) * no.x > 0 else -1 for a, no in tank_planes)
    offs = [((lambda q, n: (v.co - q).dot(n))(*skin_tree.find_nearest(v.co)[:2]), near_plane(v.co), v.co.z) for v in me.vertices]
    inside = sum(1 for o, _, _ in offs if o < 0.001)
    band = [o for o, d, z in offs if d > -TANK_SKIN and z > arm_j.z - 0.25]
    say('tank: shirt offsets in the kept-skin band (mm) by percentile', [round(float(np.percentile(band, q)) * 1000, 1) for q in (0, 5, 10, 25, 50)],
        'of', len(band), '; under 3 mm', sum(1 for o in band if o < 0.003))
    lows = [(round(z - arm_j.z, 2), round(d, 3)) for o, d, z in offs if o < 0.001]
    say('tank: where the shirt is on the skin (z from the arm joint, plane distance) sample', lows[::max(1, len(lows) // 25)])
    say(what + ': armhole on the skin,', len(ids), 'vertices, moved up to', round(max(gap) * 1000, 1), 'mm, median',
        round(float(np.median(gap)) * 1000, 1), 'mm;', pushed, 'eased vertices kept off the skin;', inside,
        'shirt vertices within 1 mm of the skin or under it')
    return tank_planes


tank_planes = cut_armholes(shirt, TANK_PTS, 'tank') if KIT.get('top') == 'tank' else []

def make_skirt(style, top, hem, band):
    """A skirt (person_kit's rings and mesh) from `top` to `hem` round the body without its arms and the shorts, which stand off
    MetaHuman's legs as MPFB's fitted ones didn't; `band`: its strip of the atlas (person_kit.SKIRT_BANDS), None the whole of it."""
    pleated = style == 'pleated'
    shirt_co = coords(shirt)
    shorts_co = coords(shorts)
    cols = pk.PLEATS if pleated else pk.ALINE_COLS
    R, c, th, zs = pk.skirt_rings(np.concatenate([bco[~on_arm], shorts_co]), shirt_co, top, hem, 0.15 if pleated else 0.11,
                                  cols, cx=J['Hips'].x)
    sme, sverts, hang, bad = pk.skirt_mesh(R, c, th, zs, pleated, cols, *([band] if band else []))
    o = bpy.data.objects.new('Skirt.' + style, sme)
    bpy.context.scene.collection.objects.link(o)
    rigid(o, None)
    # (person_kit's weighting: the hips at the top, more and more the thigh on its side by the hem)
    hx, side = J['Hips'].x, (1 if J['LeftUpLeg'].x > J['Hips'].x else -1)
    for i, (co, h) in enumerate(zip(sverts, hang)):
        w = 0.85 * max(0.0, min(1.0, (h - 0.1) / 0.75)) ** 1.2
        s = max(0.0, min(1.0, 0.5 + (co[0] - hx) * side / 0.13))
        o.vertex_groups[P + 'Hips'].add([i], 1 - w, 'REPLACE')
        if w > 0:
            o.vertex_groups[P + 'LeftUpLeg'].add([i], w * s, 'REPLACE')
            o.vertex_groups[P + 'RightUpLeg'].add([i], w * (1 - s), 'REPLACE')
    say('skirt', style, 'top', round(top, 3), 'hem', round(hem, 3), 'radius at the hem',
        round(float(R[-1].min()), 3), '..', round(float(R[-1].max()), 3), 'faces', len(sme.polygons), 'wrong way', bad)
    return o, hang


SKIRT_STYLE = KIT.get('bottom') if KIT.get('bottom') in ('pleated', 'aline') else None
shirt_hem = float(coords(shirt)[:, 2].min())
# (kit.skirt and shorts_hem are the MPFB player's heights over the shoes' soles; here the bare feet stand at 0)
sole_z = float(new_co[:, 2].min())
if SKIRT_STYLE:
    # (the shorts' top came through the shirt's back in a bend, and the skirt covers it)
    # (with a wardrobe the skirt can come off, and cut 3 cm under the top's hem the shorts left a band of bare skin round the
    # hips: there they keep 2 cm up inside the hem, which the skirt's top, 5 cm up, still covers)
    bisect(shorts, Vector((0, 0, shirt_hem + (0.02 if WARDROBE else -0.03))), Vector((0, 0, 1)), outer=True)
    if spec.get('shorts_hem'):
        bisect(shorts, Vector((0, 0, spec['shorts_hem'] + sole_z)), Vector((0, 0, 1)), inner=True)
    say('skirt over shorts from', round(float(coords(shorts)[:, 2].min()), 3), 'to', round(float(coords(shorts)[:, 2].max()), 3))
    skirt_top, skirt_hem = shirt_hem + pk.SKIRT_TUCK, KIT['skirt'] + sole_z
else:
    # (a skirt chosen over shorts: its hem SKIRT_BELOW under theirs, finish-player.py)
    skirt_top, skirt_hem = shirt_hem + pk.SKIRT_TUCK, float(coords(shorts)[:, 2].min()) - pk.SKIRT_BELOW
skirts = {}  # style: (object, hang); with a wardrobe both, each on its band of the atlas
for style in ('pleated', 'aline'):
    if WARDROBE or style == SKIRT_STYLE:
        skirts[style] = make_skirt(style, skirt_top, skirt_hem, pk.SKIRT_BANDS[style] if WARDROBE else None)
skirt, skirt_hang = skirts.get(SKIRT_STYLE, (None, None))

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

# ---------------------------------------------------------------- the wardrobe's other cuts -----------------------------------------
wear = {}      # piece name: its object (the modelled top, shorts, trainers and crew sock aside)
collar = None
TOP0 = 'tank' if KIT.get('top') == 'tank' else 'tee'
sleeveless_planes, wear_tank_planes = [], []
if WARDROBE:
    # (person_wear and person_kit read joints off a rig: a stand-in with this body's joints, the real one is made further down)
    bpy.ops.object.armature_add(enter_editmode=True)
    wear_rig = bpy.context.object
    wear_rig.name = 'wear_rig'
    eb = wear_rig.data.edit_bones
    eb.remove(eb[0])
    for n in BONES:
        b = eb.new(P + n)
        b.head = J[n]
        b.tail = J[n] + Vector((0, 0, 0.02))
    bpy.ops.object.mode_set(mode='OBJECT')
    tee = tee_whole or shirt
    if tee_whole:
        wear['tee'] = tee_whole
    else:
        wear['tank'] = pw.copy_of(shirt, 'Wear.tank')
        wear_tank_planes = cut_armholes(wear['tank'], TANK_PTS, 'tank (wardrobe)')
    wear['sleeveless'] = pw.copy_of(tee, 'Wear.sleeveless')
    sleeveless_planes = cut_armholes(wear['sleeveless'], pw.SLEEVELESS, 'sleeveless')
    wear['vneck'] = pw.make_vneck(None, pw.copy_of(tee, 'Wear.vneck'), wear_rig, WOMEN, skin_tree)

    # Long sleeves: the tee's sleeves carried on to cuffs at the wrists (person_wear.make_long). New cloth takes one plain
    # place on the sleeve in the atlas.
    lo = pw.copy_of(tee, 'Wear.long')
    # (a plain place: the sleeve's cloth nearest halfway down the upper arm, on top)
    uvl = lo.data.uv_layers[0].data
    mid = (J['LeftArm'] + J['LeftForeArm']) / 2 + Vector((0, 0, 0.05))
    best = min(lo.data.loops, key=lambda l: (lo.data.vertices[l.vertex_index].co - mid).length)
    plain = tuple(uvl[best.index].uv)
    # (and how much of the atlas a metre of that cloth takes)
    bp = next(p_ for p_ in lo.data.polygons if best.index in p_.loop_indices)
    li = list(bp.loop_indices)
    dens = [(Vector(uvl[a_].uv) - Vector(uvl[b_].uv)).length / max(1e-6, (lo.data.vertices[lo.data.loops[a_].vertex_index].co - lo.data.vertices[lo.data.loops[b_].vertex_index].co).length)
            for a_, b_ in zip(li, li[1:] + li[:1])]
    UV_PER_M, UV_PATCH = float(np.median(dens)), 0.03
    fold_uv = lambda x: UV_PATCH * 2 * abs(x / (2 * UV_PATCH) - math.floor(x / (2 * UV_PATCH) + 0.5)) - UV_PATCH / 2
    arm_tree = BVHTree.FromPolygons([v.co.copy() for v in body.data.vertices], [tuple(p_.vertices) for p_ in body.data.polygons])
    sw_ = pw.SkinWeights(body)
    ldom = [max(w, key=w.get) if w else '' for w in weights(lo)]
    bm = bmesh.new()
    bm.from_mesh(lo.data)
    dom_l, ext_l = bm.verts.layers.int.new('dom'), bm.verts.layers.int.new('ext')
    for v in bm.verts:
        v[dom_l] = {'LeftArm': 1, 'LeftForeArm': 1, 'RightArm': 2, 'RightForeArm': 2}.get(ldom[v.index], 0)
    # Epic's sleeve is a panel of its own: its seam under the arm and round the shoulder are two rows of vertices in the
    # one place, not one. Unsewn, the sleeve's open edge was the cuff, up the seam, round the armhole and back, and carried
    # on to the wrist it made two sleeves in the one place, the armhole's inside out: the blotches the game drew.
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=0.0001)
    added, loops_n = [], 0
    for lr in ('Left', 'Right'):
        sx = 1.0 if J[lr + 'Arm'].x > chest_x else -1.0
        axis = pw.Axis([J[lr + 'Arm'], J[lr + 'ForeArm'], J[lr + 'Hand']])
        # The sleeve's end comes off first, 1.2 cm of it: Epic hems a sleeve by turning the cloth in (a woman's), or lines it
        # (a man's, the lining cut out above), and the open edge that leaves is inside the sleeve, a centimetre or six up;
        # carried on from there the long sleeve came out of a short one like a vest under a tee. Cut square, the cloth's own
        # edge is the widest loop at the cut.
        # (the arm's cloth by its weights, not by how near the arm's line it lies: a woman's tee passes within 13 cm of it
        # under the arm, and the cut took a bite out of her side and carried a ribbon of it to the wrist)
        arm_f = [f for f in bm.faces if all(v[dom_l] == (1 if lr == 'Left' else 2) for v in f.verts)]
        s_cut = max(axis.project(v.co) for f in arm_f for v in f.verts) - 0.012
        geom = list({v for f in arm_f for v in f.verts}) + list({e for f in arm_f for e in f.edges}) + arm_f
        bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-5, plane_co=axis.at(s_cut), plane_no=axis.tangent(s_cut), clear_outer=True)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
        radius = lambda l: sum((v.co - axis.at(axis.project(v.co))).length for v in l) / len(l)
        mine = [l for l in pw.boundary_loops(bm) if len(l) > 8 and (sum(v.co.x for v in l) / len(l) - chest_x) * sx > 0
                and max(abs(axis.project(v.co) - s_cut) for v in l) < 0.001]
        loops_n += len(mine)
        if not mine:
            continue
        loop = max(mine, key=radius)
        s_end = axis.total - pw.CUFF_BACK

        def ease(f, s_, e0, s_end=s_end):
            # (person_wear.make_long's: from the sleeve's own hang to a forearm's ease by halfway, closing to the cuff)
            u = min(1.0, f * 2.0)
            u = u * u * (3 - 2 * u)
            c = min(1.0, max(0.0, (s_ - (s_end - 0.06)) / 0.06))
            return (e0 * (1 - u) + pw.FOREARM_EASE * u) * (1 - c) + pw.CUFF_EASE * c
        # (rings 3 cm apart: the cut leaves some 46 vertices round the sleeve, and at person_wear's 1.8 cm two were 2,000)
        ring_was, pw.RING = pw.RING, 0.03
        new = pw.extend_loop(bm, loop, axis, arm_tree, s_end, ease, rib=0.0006, rib_len=0.016, uv=lambda f: plain)
        pw.RING = ring_was
        # The new cloth's place in the atlas: a patch UV_PATCH across round the plain place, walked over at the sleeve's own
        # scale round the arm and along it, folded back at its edges. (All of it at the one point, the folds' normal map had no
        # direction to lie in, kit.ts takes its frame from how the UVs change across a pixel, and the sleeves came out blotched.)
        for v in new:
            v[ext_l] = 1 if lr == 'Left' else 2
        uvb = bm.loops.layers.uv.active
        fresh_v = set(new)
        # (and facing out, whatever the face its first edge joins: inside out, the game draws it as the sleeve's inside)
        fresh_f = [f for f in bm.faces if any(v in fresh_v for v in f.verts)]
        bm.normal_update()
        facing = sum(1 for f in fresh_f if f.normal.dot(f.calc_center_median() - axis.at(axis.project(f.calc_center_median()))) > 0)
        if facing < len(fresh_f) / 2:
            bmesh.ops.reverse_faces(bm, faces=fresh_f)
        for f in fresh_f:
            th0 = None
            for l in f.loops:
                s_ = axis.project(l.vert.co)
                t_ = axis.tangent(s_)
                ref = (Vector((0, 1, 0)) - t_ * t_.y).normalized()
                off = l.vert.co - axis.at(s_)
                th = math.atan2(off.dot(t_.cross(ref)), off.dot(ref))
                if th0 is None:
                    th0 = th
                th += 2 * math.pi * round((th0 - th) / (2 * math.pi))
                l[uvb].uv = (plain[0] + fold_uv(th * 0.05 * UV_PER_M), plain[1] + fold_uv(s_ * UV_PER_M))
        added.append((1 if lr == 'Left' else 2, pw.limb_ok(sx, lr, ('Arm', 'ForeArm', 'Hand'))))
    bm.to_mesh(lo.data)
    bm.free()
    lo.data.update()
    # (the new cloth by its mark, not by its place at the end of the list: the cut's own new vertices lie among it, and
    # counted from the end each arm's cloth was bound as the other's, to tear apart the moment an arm moved)
    ext = [d.value for d in lo.data.attributes['ext'].data]
    for mark, ok in added:
        ids = [k for k, e in enumerate(ext) if e == mark]
        sw_.bind(lo, ids, [lo.data.vertices[j_].co.copy() for j_ in ids], ok)
    for p_ in lo.data.polygons:
        p_.use_smooth = True
    # (which way the new cloth faces: out from the arm's line, or the game draws it as the sleeve's inside)
    faces_out, faces_new = 0, 0
    for p_ in lo.data.polygons:
        if not all(ext[k] for k in p_.vertices):
            continue
        lr = 'Left' if ext[p_.vertices[0]] == 1 else 'Right'
        ax_ = pw.Axis([J[lr + 'Arm'], J[lr + 'ForeArm'], J[lr + 'Hand']])
        faces_new += 1
        faces_out += p_.normal.dot(p_.center - ax_.at(ax_.project(p_.center))) > 0
    say('long sleeves: new faces facing out', faces_out, 'of', faces_new)
    n_added = sum(1 for e in ext if e)
    for name in ('ext', 'dom'):
        lo.data.attributes.remove(lo.data.attributes[name])
    wear['long'] = lo
    say('long sleeves: open loops on the arms', loops_n, '; vertices added', n_added,
        '; new cloth at uv', [round(x, 3) for x in plain])

    # A polo's collar on the tee (person_kit.make_collar), measured on the skin of the body and the neck together.
    sk_me = bpy.data.meshes.new('skin_all')
    sk_me.from_pydata([v.co.copy() for v in body.data.vertices] + [v.co.copy() for v in head_skin.data.vertices], [],
                      [tuple(p_.vertices) for p_ in body.data.polygons] + [tuple(i + nb for i in p_.vertices) for p_ in head_skin.data.polygons])
    sk_me.update()
    skin_all = bpy.data.objects.new('skin_all', sk_me)
    bpy.context.scene.collection.objects.link(skin_all)
    collar = pk.make_collar(skin_all, tee, wear_rig, WOMEN, whole=True)
    for m in list(collar.modifiers):
        collar.modifiers.remove(m)
    bpy.data.objects.remove(skin_all)

    # Ankle and knee socks and tights: the legs' skin again (skin_shell above, person_wear's heights).
    shoe_top = float(new_co[:, 2].max())
    wear['ankle'] = skin_shell('Wear.ankle', shoe_top + pw.ANKLE_UP, SOCK_EASE, 0.0008, pw.ANKLE_RIB)
    wear['knee'] = skin_shell('Wear.knee', min(J['LeftLeg'].z, J['RightLeg'].z) - pw.KNEE_DOWN, SOCK_EASE, 0.0008, pw.KNEE_RIB)
    wear['tights'] = skin_shell('Wear.tights', float(coords(shorts)[:, 2].min()) + pw.TIGHTS_IN, pw.TIGHTS_EASE, 0.0, 0.0)
    for o in list(wear.values()) + [collar]:
        for m in list(o.modifiers):
            o.modifiers.remove(m)
    for k, o in wear.items():
        say('wear', k, len(o.data.vertices), 'vertices', len(o.data.polygons), 'faces')
    bpy.data.objects.remove(wear_rig)

if os.environ.get('MH_STOP') == 'wear':
    # (a look at each cut on the body, in Blender: MH_VIEWS=tank,long... picks)
    scn = bpy.context.scene
    scn.render.engine = 'BLENDER_EEVEE'
    scn.render.resolution_x, scn.render.resolution_y = 900, 1100
    scn.world = bpy.data.worlds.new('w')
    scn.world.use_nodes = True
    scn.world.node_tree.nodes['Background'].inputs[0].default_value = (0.62, 0.63, 0.66, 1)
    scn.world.node_tree.nodes['Background'].inputs[1].default_value = 1.0
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 2.5
    sun.rotation_euler = (math.radians(50), 0, math.radians(-30))
    scn.collection.objects.link(sun)

    def flat(name, rgb):
        m = bpy.data.materials.new(name)
        m.diffuse_color = (*rgb, 1)
        m.use_nodes = True
        m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*rgb, 1)
        m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.8
        return m
    everything = [o for o in bpy.data.objects if o.type == 'MESH']
    tones = {'skin': flat('skin', (0.75, 0.55, 0.45)), 'top': flat('top', (0.75, 0.12, 0.2)), 'bottom': flat('bottom', (0.1, 0.12, 0.3)),
             'white': flat('white', (0.9, 0.9, 0.9)), 'trim': flat('trim', (0.95, 0.8, 0.2))}

    def dress(o, tone):
        o.data.materials.clear()
        o.data.materials.append(tones[tone])
        for p_ in o.data.polygons:
            p_.use_smooth = True
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scn.collection.objects.link(cam)
    scn.camera = cam
    cam.data.lens = 85
    tops_all = {TOP0: shirt, **{k: v for k, v in wear.items() if k in pw.TOPS}}
    looks_ = {}
    for k in tops_all:
        looks_[k] = [(tops_all[k], 'top'), (shorts, 'bottom'), (sock, 'white')]
    looks_['polo'] = [(tops_all['tee'], 'top'), (collar, 'trim'), (shorts, 'bottom'), (sock, 'white')] if collar else []
    for st, (so, _) in skirts.items():
        looks_[st] = [(shirt, 'top'), (shorts, 'bottom'), (so, 'bottom'), (sock, 'white')]
    for k in ('ankle', 'knee'):
        if k in wear:
            looks_[k] = [(shirt, 'top'), (shorts, 'bottom'), (wear[k], 'white')]
    if 'tights' in wear:
        looks_['tights'] = [(shirt, 'top'), (shorts, 'bottom'), (wear['tights'], 'trim'), (sock, 'white')]
    pick = [x for x in os.environ.get('MH_VIEWS', '').split(',') if x]
    for k, parts in looks_.items():
        if not parts or (pick and k not in pick):
            continue
        for o in everything:
            o.hide_render = True
        for o, tone in parts + [(body, 'skin'), (head_skin, 'skin'), (shoes, 'white')]:
            o.hide_render = False
            dress(o, tone)
        for tag, at, look in (('front', (0.6, -3.6, 1.25), (0, 0, 1.0)), ('side', (-3.4, -1.2, 1.25), (0, 0, 1.0))):
            cam.location = Vector(at)
            cam.rotation_euler = (Vector(look) - cam.location).to_track_quat('-Z', 'Y').to_euler()
            scn.render.filepath = os.path.join(OUT, f'wear-{k}-{tag}.png')
            bpy.ops.render.render(write_still=True)
    say('wear preview written')
    sys.exit(0)

# ---------------------------------------------------------------- skin under the kit out ---------------------------------------------
# Skin that sees cloth within 3 cm straight out from it goes, except a 2.5 cm band next to skin that stays: looking into a
# sleeve or a leg of the shorts never shows a hole. Inside the shoes and socks everything goes below the sock's top.
TANK_SKIN_IN = 0.09


def armhole_keep(planes, top_dx, co, arm):
    """Skin a tank or a sleeveless top leaves bare or its armhole's shader cut uncovers (kit.ts kitDetail: out from armX -
    0.09 for a tank, from the plane's top down to over the hem; outside the plane the arm's skin all stays: from the inside
    of the arm the torso's shirt is within a ray's reach)."""
    keep = np.zeros(len(co), dtype=bool)
    ax = np.abs(co[:, 0] - chest_x)
    hem_z = coords(shirt)[:, 2].min()
    for a, no in planes:
        d = (co[:, 0] - a.x) * no.x + (co[:, 2] - a.z) * no.z
        this_side = (co[:, 0] - chest_x) * no.x > 0
        cut_band = (co[:, 2] < a.z + 0.005) & (co[:, 2] > hem_z + 0.06) & (ax > arm_x0 + top_dx - 0.055)
        keep |= this_side & (((d > 0) & arm) | ((d > -TANK_SKIN) & cut_band))
    return keep


hide = None
if WARDROBE:
    # The skin stays, but for what no cut ever shows: the feet and ankles from 3 cm under the trainer's collar down (a
    # no-show sock leaves the ankle bare into the collar). Cut level, as the sock's line was: the shin's rings are far apart.
    SKIN_IN_SHOE = 0.03
    z_cut = min(J['LeftFoot'].z, J['RightFoot'].z) - 0.024 - SKIN_IN_SHOE
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, z_cut), plane_no=(0, 0, 1), clear_inner=True)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(body.data)
    bm.free()
    body.data.update()
    # Which garments hide each skin vertex (person_wear.hide_masks: skin that sees a garment within 3 cm straight out from it,
    # except a 2.5 cm band next to skin that shows, so looking into a sleeve or a leg of the shorts never shows a hole).
    co2 = coords(body)
    pw.N_BODY = pk.N_BODY = len(co2)
    dom2 = [max(w, key=w.get) if w else '' for w in weights(body)]
    arm2 = np.array([('Arm' in d or 'Hand' in d) for d in dom2])
    leg2 = np.array([('Leg' in d) for d in dom2])
    piece_obj = {**wear, 'crew': sock, 'shoe': shoes}
    cover = {TOP0: pw.covered_by(body, shirt), 'shorts': pw.covered_by(body, shorts)}
    for name, o in piece_obj.items():
        cover[name] = pw.covered_by(body, o)
    nk = J['Neck']
    # (the skin behind the neckline stays, as before: the game opens the collar lower than the garment's own neck hole)
    keep_always = ((np.abs(co2[:, 0] - nk.x) < 0.16) & (-co2[:, 1] > -nk.y - 0.1) & (-co2[:, 1] < -nk.y + 0.2)
                   & (co2[:, 2] > nk.z - 0.16) & (co2[:, 2] < nk.z + 0.025))
    hem_z = float(coords(shorts)[:, 2].min())
    keep_in_hem = leg2 & (co2[:, 2] > hem_z - 0.05) & (co2[:, 2] < hem_z + 0.06)
    vfield = pw.vneck_field(type('R', (), {'data': type('D', (), {'bones': {P + 'Neck': type('B', (), {'head_local': nk})()}})()})(), WOMEN)
    keep_for = {'vneck': np.array([vfield(Vector(c)) > -0.02 and c[1] < nk.y - 0.01 for c in co2]),
                'tank': armhole_keep(tank_planes or wear_tank_planes, TANK_PTS[0][0], co2, arm2),
                'sleeveless': armhole_keep(sleeveless_planes, pw.SLEEVELESS[0][0], co2, arm2)}
    base_others = {'top': ['shorts', 'crew', 'shoe'], 'shorts': [TOP0, 'crew', 'shoe'], 'tights': ['shorts', TOP0, 'crew', 'shoe'],
                   'socks': [TOP0, 'shorts', 'shoe'], 'shoe': [TOP0, 'shorts']}
    union_of = {name: base_others['top' if name in pw.TOPS else 'socks' if name in pw.SOCKS else name] for name in cover}
    hide = pw.hide_masks(body, cover, {}, union_of, keep_always, keep_in_hem, keep_for)
    worn_bits = sum(1 << pw.PIECES.index(n) for n in ('shoe', TOP0, 'shorts', 'crew'))
    say('skin kept whole:', len(co2), 'vertices; hidden as modelled', int(((hide & worn_bits) != 0).sum()))
else:
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
    say('skin removed: under the kit', int(covered.sum()), 'of', len(bco))
    delete_verts(body, covered)
    cloth_bm.free()
    # Inside the sock the skin goes, cut level SOCK_SKIN under the sock's top (the turned edge lies on it to TURN_BACK). Cut, not
    # dropped by vertex: the shin's rings are 2-3 cm apart, and losing every triangle that touched a vertex below the line could
    # leave the skin's edge above the sock's.
    SOCK_SKIN = 0.015
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, sock_top - SOCK_SKIN), plane_no=(0, 0, 1), clear_inner=True)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(body.data)
    bm.free()
    body.data.update()

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

skinned = ([body, head_skin, eyes, teeth, lashes, shirt, shorts, shoes, sock, hair] + [o for o in (brows, helmet, head_piece, collar) if o]
           + [so for so, _ in skirts.values()] + list(wear.values()))
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


GUTTER_REACH = 64


def fill_gutters(atlas, rects):
    """The atlas's unused texels in the colour of the nearest used ones (grown out GUTTER_REACH texels, the rest the mean).
    Left black, they bled into a picture at its rectangle's edge as the texture shrank with distance: MetaHuman's
    fingertips lie at the top of the body's, under an unused strip, and every hand in the 6 Nov sheet had black tips."""
    H, W = atlas.shape[:2]
    used = np.zeros((H, W), dtype=bool)
    for x, y, w, h in rects:
        used[y:y + h, x:x + w] = True
    if used.all():
        return
    ys, xs = np.nonzero(~used)
    y0, y1 = max(0, ys.min() - GUTTER_REACH), min(H, ys.max() + 1 + GUTTER_REACH)
    x0, x1 = max(0, xs.min() - GUTTER_REACH), min(W, xs.max() + 1 + GUTTER_REACH)
    on = used[y0:y1, x0:x1].copy()
    col = atlas[y0:y1, x0:x1, :3] * on[..., None]
    for _ in range(GUTTER_REACH):
        if on.all():
            break
        s = np.zeros_like(col)
        n = np.zeros(on.shape, dtype=np.float32)
        for d, ax in ((1, 0), (-1, 0), (1, 1), (-1, 1)):
            s += np.roll(col, d, ax)
            n += np.roll(on, d, ax)
        new = ~on & (n > 0)
        col[new] = s[new] / n[new][:, None]
        on |= new
    if not on.all():
        col[~on] = col[on].mean(0)
    gap = ~used[y0:y1, x0:x1]
    atlas[y0:y1, x0:x1, :3][gap] = col[gap]
    say('gutters filled', int(gap.sum()), 'texels')


def save(atlas, path, name, quality=92):
    h, w = atlas.shape[:2]
    im = bpy.data.images.new(name, w, h, alpha=True)
    im.pixels.foreach_set(atlas.ravel())
    im.file_format = 'WEBP'
    im.filepath_raw = path
    bpy.context.scene.render.image_settings.quality = quality
    im.save(filepath=path, quality=quality)
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


HELMET_FEATHER = 14
# Volume (the owner's realism list, 7 Nov: "helmet hair"). The cards' atlas (Unreal's CardsAtlas_Attribute) holds coverage in
# red, a value per strand in green (mean 0.48 over a whole atlas: the strand's seed) and another in blue (mean 0.25, flat from
# root to tip: the strand's depth in its card). A strand deeper in its card is darker by up to HAIR_DEPTH_SHADE at
# depth 1 (about the hair's own tone on average), and under the denser cards (cast.json hairLod 1) the helmet, the shell
# under every card, by the spec's helmet_shade (cast.json helmetShade): a head of hair is lit on its outer strands and
# dark between them, where the old even tone over shell and cards read as one painted surface. Not under short cuts,
# whose helmet is most of the hair the game shows: their measured colour stays.
HAIR_DEPTH_SHADE = 0.9
HELMET_SHADE = float(spec.get('helmet_shade', 1.0))


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


# The helmet's coverage: its own texture's alpha, or, for a groom whose build writes none (L_Straight), the whole shell, fading
# in from its open rim (the hairline, sideburns and nape) as the texture's would.
HELMET_COV = os.path.join(SRC, spec['helmet_cov']) if spec.get('helmet_cov') else None
if helmet and not (HELMET_COV and os.path.exists(HELMET_COV)):
    cov_px = np.ones((512, 512, 4), dtype=np.float32)
    cov_px[..., 3] = rim_feather(helmet, (512, 512), HELMET_FEATHER)
    # (its green, the strand seed the shade comes from, at none: the shell in the darkest strand shade, the mass in shadow
    # under the cards; in one even lighter shade, p10's bob read as a shiny helmet)
    cov_px[..., 1] = 0
    HELMET_COV = os.path.join(OUT, 'helmet-cov.png')
    im = bpy.data.images.new('helmet_cov', 512, 512, alpha=True)
    im.pixels.foreach_set(cov_px.ravel())
    im.filepath_raw = HELMET_COV
    im.file_format = 'PNG'
    im.save()
    bpy.data.images.remove(im)
    say('no coverage texture for the helmet: the whole shell, feathered at its rim')


# Ambient occlusion, baked with Cycles in the game's T-pose as finish-player.py bakes the MPFB players': the skin's into the
# opaque atlas's alpha, where kit.ts reads it (creases darker and duller: the lids' rims, the nostrils, the corners of the
# mouth, the ears' hollows, between the fingers, under the shirt's hem), and the eyes' per vertex, the shade the lids put
# on the eyeball (Unreal draws it with an occlusion shell over the eye). Without it every crease and the eyes were lit as
# the cheek is: the owner's realism list, 7 Nov, "flat face". The cards stay out of it, as finish-player's: Cycles' AO
# sees a card's whole quad. Baked at most AO_TEX square, the occlusion being soft, and scaled to the rectangle.
AO_TEX = 1024


def resized(a, w, h):
    if a.shape == (h, w):
        return a
    im = bpy.data.images.new('rs', a.shape[1], a.shape[0], alpha=False, float_buffer=True)
    px = np.repeat(a[..., None], 4, -1)
    im.pixels.foreach_set(px.ravel())
    im.scale(w, h)
    out = np.array(im.pixels[:], dtype=np.float32).reshape(h, w, 4)[..., 0].copy()
    bpy.data.images.remove(im)
    return out


def bake_skin_ao(o, rect):
    """The mesh's occlusion over its own UV square (first layer; the body's sit in the next tile, u 1-2, brought back for
    the bake), at the rectangle's size."""
    me = o.data
    me.uv_layers.active_index = 0
    uv = np.empty(len(me.uv_layers[0].data) * 2, dtype=np.float32)
    me.uv_layers[0].data.foreach_get('uv', uv)
    tile = np.floor(np.median(uv.reshape(-1, 2), axis=0))
    me.uv_layers[0].data.foreach_set('uv', (uv.reshape(-1, 2) - tile).ravel())
    a = ao_bake.bake_ao_image(o, min(rect[2], AO_TEX), 'ao_' + o.name)
    me.uv_layers[0].data.foreach_set('uv', uv)
    # (the texels no triangle covers, as the skin under the kit, whose triangles are gone, take the nearest baked value: left
    # at the bake's black they darkened the arms at a distance, where the texture shrinks and they mix in)
    on = a > 1e-4
    while not on.all():
        s, n = np.zeros_like(a), np.zeros_like(a)
        for d, ax in ((1, 0), (-1, 0), (1, 1), (-1, 1)):
            s += np.roll(a * on, d, ax)
            n += np.roll(on, d, ax)
        new = ~on & (n > 0)
        if not new.any():
            a[~on] = a[on].mean() if on.any() else 1
            break
        a[new] = s[new] / n[new]
        on |= new
    return resized(a, rect[2], rect[3])


cards_out = [o for o in (hair, brows, lashes, helmet) if o]
if WARDROBE:
    # (and no garment: the skin is whole under every cut, and baked under the modelled tee a player in a tank had dark shoulders,
    # as finish-player.py keeps its unworn cuts out of every bake)
    cards_out += [shirt, shorts, sock, shoes] + [o for o in (collar, head_piece) if o] + [so for so, _ in skirts.values()] + list(wear.values())
for o in cards_out:
    o.hide_render = True
ao_bake.cycles_setup()
skin_ao = {'head': bake_skin_ao(head_skin, RECT['head']), 'body': bake_skin_ao(body, RECT['body'])}
eye_ao = ao_bake.bake_ao_vertices(eyes)
for o in cards_out:
    o.hide_render = False
say('occlusion: head mean', round(float(skin_ao['head'].mean()), 3), 'body', round(float(skin_ao['body'].mean()), 3),
    'eyes', round(float(eye_ao.mean()), 3), 'min', round(float(eye_ao.min()), 3))

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
    cov_mask = scalp_mask(head_skin, helmet, HELMET_COV, RECT['head'][2:])
    cov_mask *= ears_out(head_skin, eyes, RECT['head'][2:])
    scalp = np.array(spec.get('hair_rgb', [0.24, 0.16, 0.1]), dtype=np.float32) * SCALP_SHADE
    m = np.clip(cov_mask * SCALP_COVER, 0, 1)[..., None]
    head_px[..., :3] = head_px[..., :3] * (1 - m) + scalp * m
    say('scalp painted', int((cov_mask > 0.5).sum()), 'texels')
def skin_regions():
    """Per head vertex (lips, T-zone, eyelids, ears) in 0..1, the regions finish-player.py gives the MPFB players and kit.ts
    shades (wet lips and lids, the oily T-zone's sheen, ears that glow red against the light). MetaHuman's head has no masks
    for them: the lids are the skin within LID_REACH of the eyeball; the lips the skin within LIP_REACH of the teeth that is
    redder than most of it; the T-zone the nose's ridge and the middle of the forehead, from the eyes; the ears as
    ears_out finds them."""
    co = coords(head_skin)
    eco = coords(eyes)
    ez, ex, ey = float(eco[:, 2].mean()), float(eco[:, 0].mean()), float(eco[:, 1].mean())
    dx, dz = np.abs(co[:, 0] - ex), co[:, 2] - ez

    def near(o):
        t = BVHTree.FromPolygons([v.co.copy() for v in o.data.vertices], [tuple(p.vertices) for p in o.data.polygons])
        return np.array([(lambda h: h[3] if h[0] is not None else 1.0)(t.find_nearest(Vector(c), 0.2)) for c in co])
    d_eye, d_teeth = near(eyes), near(teeth)
    lids = np.clip((LID_REACH - d_eye) / 0.006, 0, 1) * (dz > -0.03) * (dz < 0.025)
    # (the colour under each vertex: its first corner's UV in the head's painted square)
    me = head_skin.data
    uvl = me.uv_layers[0].data
    vuv = np.zeros((len(co), 2), dtype=np.float32)
    for lp in reversed(me.loops):
        vuv[lp.vertex_index] = uvl[lp.index].uv
    hh, hw = head_px.shape[:2]
    c = head_px[np.clip((vuv[:, 1] * hh).astype(int), 0, hh - 1), np.clip((vuv[:, 0] * hw).astype(int), 0, hw - 1), :3]
    red = c[:, 0] - 0.5 * (c[:, 1] + c[:, 2])
    # (both references from the skin round the teeth itself, mostly skin and about a third lips: a ring further out lay on
    # another colour on some heads (p10's jaw), and half her cheeks came out lips)
    mouth = d_teeth < LIP_REACH
    r_skin = float(np.percentile(red[mouth], 20)) if mouth.any() else float(np.median(red))
    r_lip = float(np.percentile(red[mouth], 90)) if mouth.any() else r_skin + 0.1
    lips = np.clip((red - r_skin) / max(r_lip - r_skin, 1e-3) * 2 - 0.6, 0, 1) * np.clip((LIP_REACH - d_teeth) / 0.006, 0, 1)
    # (the nose stands in front of the eyes; the forehead, sloping back above them, by facing forward: MetaHuman faces -y)
    nrm = np.empty(len(co) * 3)
    me.vertices.foreach_get('normal', nrm)
    facing = np.clip((-nrm.reshape(-1, 3)[:, 1] - 0.5) / 0.2, 0, 1)
    nose = np.clip((0.02 - dx) / 0.008, 0, 1) * (dz < 0.0) * (dz > -0.065) * (co[:, 1] < ey - 0.004)
    brow = np.clip((0.045 - dx) / 0.015, 0, 1) * np.clip((dz - 0.025) / 0.01, 0, 1) * np.clip((0.09 - dz) / 0.015, 0, 1) * facing
    tz = np.maximum(nose, brow) * (1 - lips)
    ears = np.clip((dx - EAR_X) / 0.01, 0, 1) * (dz > -0.08) * (dz < 0.03)
    say('skin regions (vertices over 0.5): lips', int((lips > 0.5).sum()), 'T-zone', int((tz > 0.5).sum()), 'lids',
        int((lids > 0.5).sum()), 'ears', int((ears > 0.5).sum()), '; redness skin', round(r_skin, 3), 'lips', round(r_lip, 3))
    return np.stack([lips, tz, lids, ears], axis=1).astype(np.float32)


LID_REACH, LIP_REACH = 0.009, 0.022
regions = skin_regions()


def vertex_raster(o, values, size, keep):
    """Per texel of `o`'s UV square (rows from the bottom), its vertices' `values` interpolated over the triangles for which
    `keep(values of its three vertices)` holds; NaN elsewhere."""
    me = o.data
    me.calc_loop_triangles()
    uvl = me.uv_layers[0].data
    w, h = size
    out = np.full((h, w), np.nan, dtype=np.float32)
    for tri in me.loop_triangles:
        vals = values[list(tri.vertices)]
        if not keep(vals):
            continue
        pt = np.array([(uvl[li].uv[0] * w, uvl[li].uv[1] * h) for li in tri.loops])
        x0, y0 = np.floor(pt.min(0)).astype(int)
        x1, y1 = np.ceil(pt.max(0)).astype(int)
        x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, w - 1), min(y1, h - 1)
        if x1 < x0 or y1 < y0:
            continue
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        (ax, ay), (bx, by), (cx, cy) = pt
        d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(d) < 1e-12:
            continue
        l1 = ((by - cy) * (gx - cx) + (cx - bx) * (gy - cy)) / d
        l2 = ((cy - ay) * (gx - cx) + (ax - cx) * (gy - cy)) / d
        l3 = 1 - l1 - l2
        inside = (l1 >= -0.01) & (l2 >= -0.01) & (l3 >= -0.01)
        v = l1 * vals[0] + l2 * vals[1] + l3 * vals[2]
        sub = out[y0:y1 + 1, x0:x1 + 1]
        sub[inside] = v[inside]
    return out


# The eye's occlusion: Unreal lays a shell over each eye that darkens the eyeball's edge and the lids' rims, where the lashes
# and the eyeball shade them; without it the lower lid's rim, facing the overhead key, drew a white line under every eye
# (7 Nov). The rims are the skin between the eye's hole in the head (its open edge, round the eyeball) and the lash line,
# 3 to 10 mm from the eyeball itself, as far as much of the lid, so they are found along the skin from that edge: the head's
# colour and its occlusion (which kit.ts takes the skin's shine and wetness down by: the line was mostly the key's
# highlight) lower by up to EYE_SHELL within EYE_SHELL_IN of the edge, easing off by EYE_SHELL_REACH.
EYE_SHELL, EYE_SHELL_IN, EYE_SHELL_REACH = 0.7, 0.003, 0.007


def from_eye_holes():
    """Per head vertex, the distance along the skin (m, over its edges) to the open edge of either eye's hole; 1 past 2 cm."""
    import heapq
    bm = bmesh.new()
    bm.from_mesh(head_skin.data)
    bm.verts.ensure_lookup_table()
    eco = coords(eyes)
    centres = [eco[eco[:, 0] > 0].mean(0), eco[eco[:, 0] <= 0].mean(0)]
    dist = np.full(len(bm.verts), 1.0)
    heap = []
    for e in bm.edges:
        if not e.is_boundary:
            continue
        for v in e.verts:
            if min(np.linalg.norm(np.array(v.co) - c) for c in centres) < 0.025 and dist[v.index] > 0:
                dist[v.index] = 0.0
                heap.append((0.0, v.index))
    n_edge = len(heap)
    heapq.heapify(heap)
    while heap:
        dv, i = heapq.heappop(heap)
        if dv > dist[i] or dv > 0.02:
            continue
        for e in bm.verts[i].link_edges:
            j = e.other_vert(bm.verts[i]).index
            nd = dv + e.calc_length()
            if nd < dist[j]:
                dist[j] = nd
                heapq.heappush(heap, (nd, j))
    bm.free()
    say('eye holes: open-edge vertices', n_edge)
    return dist


head_from_hole = from_eye_holes()
d_tex = vertex_raster(head_skin, head_from_hole, RECT['head'][2:], lambda v: v.min() < EYE_SHELL_REACH)
t = np.clip((EYE_SHELL_REACH - np.nan_to_num(d_tex, nan=1.0)) / (EYE_SHELL_REACH - EYE_SHELL_IN), 0, 1)
shade = 1 - EYE_SHELL * t * t * (3 - 2 * t)
head_px[..., :3] *= shade[..., None]
skin_ao['head'] *= shade
say('eye shell: texels darkened', int((shade < 0.9).sum()), '; vertices within 3/5/7 mm of the eyes\' holes',
    [int((head_from_hole < r).sum()) for r in (0.003, 0.005, 0.007)])
if os.environ.get('MH_DEBUG'):
    dbg = np.ones(shade.shape + (4,), dtype=np.float32)
    dbg[..., :3] = shade[..., None]
    save(dbg, os.path.join(OUT, 'debug-eye-shell.webp'), 'dbg')

paste(op, RECT['head'], head_px)
paste(op, RECT['body'], load_px(os.path.join(SRC, spec['body_bc']), RECT['body'][2:]))
paste(op, RECT['eye'], load_px(os.path.join(MAPS, 'Eyes_Color.png'), RECT['eye'][2:]))
paste(op, RECT['teeth'], load_px(os.path.join(MAPS, 'Teeth_Color.png'), RECT['teeth'][2:]))
for k in ('shirt', 'shorts'):
    x, y, w, h = RECT[k]
    op[y:y + h, x:x + w] = 1.0  # the kit's occlusion: none baked yet
if skirts:
    # (person_kit's: darker up under the shirt, in each pleat's valley and on the lining; drawn square and halved across.
    # With a wardrobe both skirts, each on its band)
    sao = pk.skirts_ao(RECT['skirt'][3]) if WARDROBE else pk.skirt_ao(RECT['skirt'][3], KIT['bottom'] == 'pleated')
    w = RECT['skirt'][2]
    paste(op, RECT['skirt'], sao.reshape(sao.shape[0], w, -1, 4).mean(2))
op[..., 3] = 1
for k, a in skin_ao.items():
    x, y, w, h = RECT[k]
    op[y:y + h, x:x + w, 3] = a
fill_gutters(op, [RECT[k] for k in ('head', 'body', 'eye', 'teeth', 'shirt', 'shorts')] + ([RECT['skirt']] if skirts else []))
save(op, os.path.join(OUT, 'opaque.webp'), 'opaque')


# The skin's detail normals: pores, the creases round the eyes and mouth, the lips' lines, knuckles. The build's own maps,
# on the opaque atlas's layout at 1/SKIN_DIV of its size (the creases keep; the finest pores go, which only a close camera
# would show). Their green runs down the texture, as DirectX's does (their slope field has a third of the curl with it
# flipped), and kit.ts reads up v, as OpenGL's. Flat everywhere else.
SKIN_DIV, SKIN_QUALITY = 2, 96
skin_n = np.zeros((OPAQUE_SIZE[1] // SKIN_DIV, OPAQUE_SIZE[0] // SKIN_DIV, 4), dtype=np.float32)
skin_n[..., :3] = (0.5, 0.5, 1)
skin_n[..., 3] = 1
for key, part in (('head_n', 'head'), ('body_n', 'body')):
    if not spec.get(key):
        continue
    x, y, w, h = (r // SKIN_DIV for r in RECT[part])
    n = load_px(os.path.join(SRC, spec[key]), (w, h))[..., :3] * 2 - 1
    n[..., 1] *= -1
    n /= np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-6)
    skin_n[y:y + h, x:x + w, :3] = n * 0.5 + 0.5
    say('skin normals', part, (w, h), 'slope sd', [round(float(v), 4) for v in (n[..., :2] / np.maximum(n[..., 2:], 0.2)).reshape(-1, 2).std(0)])
save(skin_n, os.path.join(OUT, 'skin.webp'), 'skin', SKIN_QUALITY)

# The hands at the sources' own resolution (owner, 7 Nov: "add knuckles, nails and skin detail on the hands"). In the opaque
# atlas the body's 8192 colour is 768 across, 0.65 texels a millimetre on a hand, and skin.webp's normals half that: the nails'
# edges and the knuckles' creases MetaHuman draws were gone. hands.webp is the body colour's rectangle round both hands' UVs
# (the vertices weighted at least half to a hand's bones) HANDS_W across, the skin's occlusion in its alpha; hands-n.webp the
# body normals' same rectangle (green flipped as skin.webp's). kit.ts samples them in place of the atlas inside that rectangle
# (the header's handsBox, atlas UVs): the same pictures, sharper, so nothing shows where it hands over.
HANDS_W, HANDS_MARGIN = 2048, 0.01


def hands_box(o):
    me = o.data
    hand = {g.index for g in o.vertex_groups if g.name.startswith(P) and 'Hand' in g.name[len(P):]}
    game = {g.index for g in o.vertex_groups if g.name.startswith(P)}
    hw = np.zeros(len(me.vertices), dtype=np.float32)
    for v in me.vertices:
        tot = sum(g.weight for g in v.groups if g.group in game)
        if tot > 0:
            hw[v.index] = sum(g.weight for g in v.groups if g.group in hand) / tot
    vi = np.empty(len(me.loops), dtype=np.int32)
    me.loops.foreach_get('vertex_index', vi)
    uv = np.empty(len(me.uv_layers[0].data) * 2, dtype=np.float32)
    me.uv_layers[0].data.foreach_get('uv', uv)
    uv = uv.reshape(-1, 2)
    uv -= np.floor(np.median(uv, axis=0))
    on = uv[hw[vi] >= 0.5]
    lo = np.clip(on.min(0) - HANDS_MARGIN, 0, 1)
    hi = np.clip(on.max(0) + HANDS_MARGIN, 0, 1)
    return float(lo[0]), float(lo[1]), float(hi[0]), float(hi[1]), int(len(on))


# The nails: hands-n.webp's alpha (the owner's realism list, 7 Nov, point 6: "hands need knuckles and nails"). The sharper
# hands show each nail's shape, but it shone as the skin round it does: MetaHuman's T_Body_SRMF, where its roughness would
# be, came out all zeros, and its scatter map is 512 square. So the plate is found in the colour: on each finger's last
# bone (at least half its skin), on the side the nail faces (the back of the hand: the finger crossed with the knuckles'
# line, index to pinky; the thumb's turned halfway towards the index), where the colour is lighter and the normals tilt
# more (the plate's dome and its edge; the skin round it is flat at this size) than over the rest of that side, smoothed
# (NAIL_BLUR texels), its largest piece kept, closed and its edge softened. (Not by redness: the plate is a shade pinker
# than the skin round it. p7mh's index: lighter by 0.06, tilt 0.06-0.07 against 0.02.)
# Written as 1 - NAIL_ALPHA x the plate, never 0: WebP drops the colour under a fully clear texel, and an alpha of 0 off the
# nails left hands-n.webp flat everywhere else (p8mh's went from 264 to 11 KB).
NAIL_SIDE, NAIL_BLUR, NAIL_OVER, NAIL_MIN, NAIL_ALPHA = 0.2, 2, 0.6, 40, 0.5


def mean_blur(a, r):
    """The mean over a (2r+1)-square round each texel, the edges clamped."""
    k = 2 * r + 1
    c = np.pad(np.pad(a, r, mode='edge'), ((1, 0), (1, 0))).cumsum(0).cumsum(1)
    return (c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]) / (k * k)


def largest_piece(on):
    """The largest 4-connected piece of a boolean picture."""
    seen = np.zeros_like(on)
    best = []
    for y, x in zip(*np.nonzero(on)):
        if seen[y, x]:
            continue
        seen[y, x] = True
        stack, piece = [(y, x)], []
        while stack:
            cy, cx = stack.pop()
            piece.append((cy, cx))
            for ny, nx in ((cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)):
                if 0 <= ny < on.shape[0] and 0 <= nx < on.shape[1] and on[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    stack.append((ny, nx))
        if len(piece) > len(best):
            best = piece
    out = np.zeros_like(on)
    if best:
        ys, xs = zip(*best)
        out[list(ys), list(xs)] = True
    return out


def nail_mask(o, full, x0, y0, x1, y1, colour, normal):
    """Per texel of the hands' rectangle (colour's and normal's size, rows from the bottom; normal in -1..1): 1 on a nail,
    0 off, softened at the edge."""
    h, w = colour.shape[:2]
    bwn = weights(o)
    nrm = np.empty(len(o.data.vertices) * 3)
    o.data.vertices.foreach_get('normal', nrm)
    nrm = nrm.reshape(-1, 3)
    finger = np.zeros(len(bwn), dtype=np.int32)
    names = {}
    for s, sign in (('Left', -1), ('Right', 1)):
        across = J[s + 'HandIndex1'] - J[s + 'HandPinky1']
        mid = (J[s + 'HandMiddle4'] - J[s + 'HandMiddle3']).normalized()
        back = mid.cross(across) * sign
        back.normalize()
        say('nails:', s, 'back of the hand', [round(t, 2) for t in back])
        for F, _ in FINGERS:
            k = len(names) + 1
            names[k] = s + F
            d = (J[f'{s}Hand{F}4'] - J[f'{s}Hand{F}3']).normalized()
            way = back + across.normalized() if F == 'Thumb' else d.cross(across) * sign
            way = way - d * way.dot(d)
            way.normalize()
            last = (f'{s}Hand{F}3', f'{s}Hand{F}4')
            for i, wv in enumerate(bwn):
                tot = sum(wv.values())
                if tot > 0 and sum(wv.get(b, 0.0) for b in last) >= 0.5 * tot and float(np.dot(nrm[i], way)) > NAIL_SIDE:
                    finger[i] = k
    me = o.data
    me.calc_loop_triangles()
    uv = np.empty(len(me.uv_layers[0].data) * 2, dtype=np.float32)
    me.uv_layers[0].data.foreach_get('uv', uv)
    uv = uv.reshape(-1, 2)
    uv -= np.floor(np.median(uv, axis=0))
    sx, sy = w / (x1 - x0), h / (y1 - y0)
    ids = np.zeros((h, w), dtype=np.int32)
    for tri in me.loop_triangles:
        f = finger[list(tri.vertices)]
        if f[0] == 0 or f[0] != f[1] or f[0] != f[2]:
            continue
        pt = (uv[list(tri.loops)] * full - (x0, y0)) * (sx, sy)
        lo, hi = np.floor(pt.min(0)).astype(int), np.ceil(pt.max(0)).astype(int)
        lo, hi = np.maximum(lo, 0), np.minimum(hi, (w - 1, h - 1))
        if (hi < lo).any():
            continue
        gx, gy = np.meshgrid(np.arange(lo[0], hi[0] + 1) + 0.5, np.arange(lo[1], hi[1] + 1) + 0.5)
        (ax, ay), (bx, by), (cx, cy) = pt
        dd = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(dd) < 1e-12:
            continue
        l1 = ((by - cy) * (gx - cx) + (cx - bx) * (gy - cy)) / dd
        l2 = ((cy - ay) * (gx - cx) + (ax - cx) * (gy - cy)) / dd
        inside = (l1 >= -0.01) & (l2 >= -0.01) & (1 - l1 - l2 >= -0.01)
        ids[lo[1]:hi[1] + 1, lo[0]:hi[0] + 1][inside] = f[0]
    lum = colour[..., :3] @ np.array([0.3, 0.59, 0.11], dtype=np.float32)
    tilt = np.hypot(normal[..., 0], normal[..., 1])
    plate = np.zeros((h, w), dtype=bool)
    found = []
    for k, name in names.items():
        on = ids == k
        if on.sum() < NAIL_MIN:
            found.append((name, int(on.sum()), 0))
            continue
        ys, xs = np.nonzero(on)
        ya, yb, xa, xb = max(ys.min() - 4, 0), min(ys.max() + 5, h), max(xs.min() - 4, 0), min(xs.max() + 5, w)
        sub = on[ya:yb, xa:xb]
        L, T = lum[ya:yb, xa:xb], tilt[ya:yb, xa:xb]
        z = (L - L[sub].mean()) / max(L[sub].std(), 1e-4) + (T - T[sub].mean()) / max(T[sub].std(), 1e-4)
        z[~sub] = 0
        keep = largest_piece(sub & (mean_blur(z, NAIL_BLUR) > NAIL_OVER))
        keep = largest_piece(sub & (mean_blur(keep.astype(np.float32), 1) > 0.3))
        plate[ya:yb, xa:xb] |= keep
        found.append((name, int(sub.sum()), int(keep.sum())))
    say('nails: texels on the side / on the plate', found)
    return np.clip(mean_blur(plate.astype(np.float32), 1) * 1.5 - 0.25, 0, 1)


hands = None
if spec.get('body_n'):
    u0, v0, u1, v1, n_on = hands_box(body)
    full = int(round(HANDS_W / (u1 - u0)))
    x0, x1, y0, y1 = (int(round(t * full)) for t in (u0, u1, v0, v1))
    hh = int(round(HANDS_W * (y1 - y0) / (x1 - x0)))
    def crop(px):
        c = px[y0:y1, x0:x1]
        if c.shape[:2] == (hh, HANDS_W):
            return c
        out = np.zeros((hh, HANDS_W, c.shape[2]), dtype=np.float32)
        for k in range(c.shape[2]):
            out[..., k] = resized(np.ascontiguousarray(c[..., k]), HANDS_W, hh)
        return out
    hc = crop(load_px(os.path.join(SRC, spec['body_bc']), (full, full)))
    ao_full = resized(skin_ao['body'], full, full)
    hc[..., 3] = ao_full[y0:y1, x0:x1] if ao_full[y0:y1, x0:x1].shape == (hh, HANDS_W) else resized(np.ascontiguousarray(ao_full[y0:y1, x0:x1]), HANDS_W, hh)
    save(hc, os.path.join(OUT, 'hands.webp'), 'hands', 92)
    hn = crop(load_px(os.path.join(SRC, spec['body_n']), (full, full)))[..., :3] * 2 - 1
    hn[..., 1] *= -1
    hn /= np.maximum(np.linalg.norm(hn, axis=-1, keepdims=True), 1e-6)
    hn4 = np.ones((hh, HANDS_W, 4), dtype=np.float32)
    hn4[..., :3] = hn * 0.5 + 0.5
    nails = nail_mask(body, full, x0, y0, x1, y1, hc, hn)
    hn4[..., 3] = 1 - NAIL_ALPHA * nails
    if os.environ.get('MH_DEBUG'):
        dbg = hc.copy()
        dbg[..., 3] = 1
        dbg[..., 1] = np.maximum(dbg[..., 1], nails)
        save(dbg, os.path.join(OUT, 'debug-nails.webp'), 'dbg')
    save(hn4, os.path.join(OUT, 'hands-n.webp'), 'hands-n', SKIN_QUALITY)
    # (read back: the file must keep the normals' relief off the nails, as an alpha of 0 once flattened them)
    back = load_px(os.path.join(OUT, 'hands-n.webp'))[..., :2] * 2 - 1
    kept = float(np.hypot(back[..., 0], back[..., 1]).mean() / max(np.hypot(hn[..., 0], hn[..., 1]).mean(), 1e-6))
    say('hands-n relief kept in the file', round(kept, 3))
    if kept < 0.8:
        raise ValueError(f'hands-n.webp lost its normals ({kept:.2f} of the relief kept)')
    bx, by, bw, bh = RECT['body']
    hands = [round((bx + t * bw) / OPAQUE_SIZE[0], 6) if k % 2 == 0 else round((by + t * bh) / OPAQUE_SIZE[1], 6)
             for k, t in enumerate((u0, v0, u1, v1))]
    say('hands', n_on, 'uvs; box', [round(t, 4) for t in (u0, v0, u1, v1)], 'at', (HANDS_W, hh), 'from', full, 'atlas', hands)

al = np.zeros((ALPHA_SIZE[1], ALPHA_SIZE[0], 4), dtype=np.float32)
cards = load_px(os.path.join(SRC, spec['hair_atlas']))
_seen = cards[..., 0] > 0.5
DEPTH_MEAN = float(np.clip(1 - HAIR_DEPTH_SHADE * cards[..., 2][_seen], 0.35, 1).mean()) if _seen.any() else 1.0
say('hair depth: mean shade', round(DEPTH_MEAN, 3))
tone = np.array(spec.get('hair_rgb', [0.24, 0.16, 0.1]), dtype=np.float32)


def hair_px(size):
    c = cards if (cards.shape[1], cards.shape[0]) == tuple(size) else None
    if c is None:
        im = bpy.data.images.new('c', cards.shape[1], cards.shape[0], alpha=True)
        im.pixels.foreach_set(cards.ravel())
        im.scale(size[0], size[1])
        c = np.array(im.pixels[:], dtype=np.float32).reshape(size[1], size[0], 4)
        bpy.data.images.remove(im)
    px = np.zeros_like(c)
    # (strand to strand from the seed, darker deeper in the card: about the head's own tone on average, so front strands
    # come out lighter than it and deep ones darker)
    px[..., :3] = tone * (0.8 + 0.4 * c[..., 1:2]) * np.clip(1 - HAIR_DEPTH_SHADE * c[..., 2:3], 0.35, 1) / DEPTH_MEAN
    px[..., 3] = c[..., 0]  # coverage
    return px


paste(al, RECT['hair'], hair_px(RECT['hair'][2:]))
paste(al, RECT['brow'], hair_px(RECT['brow'][2:]))
lash = load_px(os.path.join(MAPS, 'Eyelashes_Color.png'), RECT['lash'][2:])
# (one colour; the strands are the alpha)
lash[..., :3] = np.minimum(lash[..., :3], 0.08)
paste(al, RECT['lash'], lash)
if helmet:
    cov = load_px(HELMET_COV, RECT['helmet'][2:])
    hp = np.zeros_like(cov)
    # (its alpha is coverage; its green, a seed per strand, gives the strand-to-strand shade the cards' atlas does)
    hp[..., :3] = tone * (0.75 + 0.35 * cov[..., 1:2] / max(float(cov[..., 1].max()), 1e-3)) * HELMET_SHADE
    # (fading out over HELMET_FEATHER texels in from the shell's open rim, the hairline, sideburns and nape: cut off at full
    # coverage it drew a hard line across the forehead)
    hp[..., 3] = np.clip(cov[..., 3] * 1.15, 0, 1) * rim_feather(helmet, RECT['helmet'][2:], HELMET_FEATHER)
    paste(al, RECT['helmet'], hp)
save(al, os.path.join(OUT, 'alpha.webp'), 'alpha')
# ---------------------------------------------------------------- the garments' folds, seams and hems -------------------------------
# The owner's realism list, 7 Nov: "clothes painted on". kit.ts reads the cloth map over the kit's rectangle (shirt over shorts, as
# RECT) as a tangent-space normal map along each garment's u and v; it was flat, so a MetaHuman's shirt and shorts had no fold at all.
# Now each garment's own mesh draws it, at its UVs:
# - folds: wrinkles mostly across the body (crests level, a few slanting), CLOTH_FOLD deep, from waves over the garment in
#   space, so they run on across its UV panels;
# - seams: where two of its UV panels meet (the pattern's sewing lines): a groove with a line of stitching beside it;
# - hems: along its open edges (neck, armholes, sleeves, waist, legs): a turned-up band, raised, stitched near its inner edge.
CLOTH_GRID = 1024
CLOTH_FOLD = 0.0022
CLOTH_WAVES = ((0.06, 0.0, 1.0, 0.0, 0.0, 0.40), (0.085, 0.25, 1.0, 0.1, 1.3, 0.30), (0.05, -0.3, 1.0, 0.2, 2.1, 0.25),
               (0.12, 0.15, 1.0, -0.2, 0.7, 0.35), (0.035, 0.6, 1.0, 0.4, 2.9, 0.12), (0.02, -0.1, 1.0, 0.5, 4.0, 0.06),
               (0.07, 0.9, 0.6, 0.3, 5.1, 0.15), (0.045, -0.8, 0.7, -0.4, 0.4, 0.12))
# (the folds come in patches: two slow waves, about a hand and a forearm long, scale them between CLOTH_PATCH and 1)
CLOTH_ENVELOPE = ((0.22, 0.7, 0.3, 0.6, 0.9), (0.31, -0.4, 0.8, 0.5, 2.3))
CLOTH_PATCH = 0.15
SEAM_W, SEAM_DEPTH, STITCH_AT, STITCH_W, STITCH_H = 0.0015, 0.0005, 0.004, 0.0006, 0.00025
HEM_W, HEM_H = 0.02, 0.0005


def uv_lines(o, n):
    """`o`'s hems (its open edges) and seams (edges its UV panels split along), drawn on an n x n grid of its UV square."""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    uvl = bm.loops.layers.uv[0]
    allu = np.array([l[uvl].uv[:] for f in bm.faces for l in f.loops], dtype=np.float32)
    tile = np.floor(np.median(allu, axis=0))
    hem = np.zeros((n, n), dtype=bool)
    seam = np.zeros((n, n), dtype=bool)

    def draw(mask, a, b):
        a, b = (a[0] - tile[0], a[1] - tile[1]), (b[0] - tile[0], b[1] - tile[1])
        for t in np.linspace(0, 1, int(max(abs(a[0] - b[0]), abs(a[1] - b[1])) * n) + 2):
            x, y = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
            mask[min(max(int(y * n), 0), n - 1), min(max(int(x * n), 0), n - 1)] = True
    # (the garment's panels come as separate pieces of mesh, split where their UVs are: an open edge lying on another open edge,
    # midpoint within 0.5 mm, is a seam; one with no partner is a real hem)
    opens = [e for e in bm.edges if e.is_boundary]
    kd = KDTree(len(opens))
    for i, e in enumerate(opens):
        kd.insert((e.verts[0].co + e.verts[1].co) / 2, i)
    kd.balance()
    for i, e in enumerate(opens):
        lp = e.link_loops[0]
        near = kd.find_n((e.verts[0].co + e.verts[1].co) / 2, 2)
        sewn = any(j != i and d < 0.0005 for _, j, d in near)
        draw(seam if sewn else hem, lp[uvl].uv[:], lp.link_loop_next[uvl].uv[:])
    for e in bm.edges:
        if e.is_boundary:
            continue
        elif len(e.link_loops) == 2:
            l0, l1 = e.link_loops
            a0, b0 = l0[uvl].uv, l0.link_loop_next[uvl].uv
            a1, b1 = l1.link_loop_next[uvl].uv, l1[uvl].uv  # (the other face runs the edge the other way)
            if (a0 - a1).length > 1e-4 or (b0 - b1).length > 1e-4:
                draw(seam, a0[:], b0[:])
                draw(seam, a1[:], b1[:])
    bm.free()
    return hem, seam, tile


def grow_dist(mask, reach):
    """Texels from the nearest set texel (4-neighbour steps), up to `reach`."""
    dist = np.full(mask.shape, float(reach), dtype=np.float32)
    cur = mask
    for i in range(reach):
        dist[cur & (dist == reach)] = i
        grown = cur.copy()
        grown[1:] |= cur[:-1]
        grown[:-1] |= cur[1:]
        grown[:, 1:] |= cur[:, :-1]
        grown[:, :-1] |= cur[:, 1:]
        cur = grown
    return dist


def garment_normals(o, w, h):
    """`o`'s folds, seams and hems as a tangent-space normal map (RGBA, w x h, rows from the bottom) of its UV square."""
    n = CLOTH_GRID
    hem, seam, tile = uv_lines(o, n)
    me = o.data
    me.calc_loop_triangles()
    uvl = me.uv_layers[0].data
    co = np.array([(v.co.x, v.co.z, -v.co.y) for v in me.vertices], dtype=np.float64)
    pos = np.zeros((n, n, 3), dtype=np.float64)
    hit = np.zeros((n, n), dtype=bool)
    area3 = areauv = 0.0
    for tri in me.loop_triangles:
        P = co[list(tri.vertices)]
        U = np.array([uvl[li].uv[:] for li in tri.loops], dtype=np.float64) - tile
        area3 += np.linalg.norm(np.cross(P[1] - P[0], P[2] - P[0])) / 2
        d = (U[1, 0] - U[0, 0]) * (U[2, 1] - U[0, 1]) - (U[2, 0] - U[0, 0]) * (U[1, 1] - U[0, 1])
        areauv += abs(d) / 2
        if abs(d) < 1e-12:
            continue
        x0, x1 = max(int(U[:, 0].min() * n), 0), min(int(U[:, 0].max() * n) + 1, n - 1)
        y0, y1 = max(int(U[:, 1].min() * n), 0), min(int(U[:, 1].max() * n) + 1, n - 1)
        if x1 < x0 or y1 < y0:
            continue
        gx, gy = np.meshgrid((np.arange(x0, x1 + 1) + 0.5) / n, (np.arange(y0, y1 + 1) + 0.5) / n)
        l1 = ((gx - U[0, 0]) * (U[2, 1] - U[0, 1]) - (U[2, 0] - U[0, 0]) * (gy - U[0, 1])) / d
        l2 = ((U[1, 0] - U[0, 0]) * (gy - U[0, 1]) - (gx - U[0, 0]) * (U[1, 1] - U[0, 1])) / d
        inside = (l1 >= -0.002) & (l2 >= -0.002) & (l1 + l2 <= 1.002)
        if not inside.any():
            continue
        l0 = 1 - l1 - l2
        p = l0[..., None] * P[0] + l1[..., None] * P[1] + l2[..., None] * P[2]
        sub = (slice(y0, y1 + 1), slice(x0, x1 + 1))
        pos[sub][inside] = p[inside]
        hit[sub] |= inside
    px_m = math.sqrt(area3 / max(areauv, 1e-9)) / n  # (metres a texel of the UV square covers)
    # Folds: waves through space (wavelength, then the direction's x, y, z, a phase and a weight), crests mostly level.
    H = np.zeros((n, n), dtype=np.float64)
    for lam, kx, ky, kz, ph, a in CLOTH_WAVES:
        k = np.array([kx, ky, kz]) / np.linalg.norm([kx, ky, kz]) * (2 * math.pi / lam)
        H += a * np.sin(pos @ k + ph)
    env = np.ones((n, n), dtype=np.float64)
    for lam, kx, ky, kz, ph in CLOTH_ENVELOPE:
        k = np.array([kx, ky, kz]) / np.linalg.norm([kx, ky, kz]) * (2 * math.pi / lam)
        env *= 0.5 + 0.5 * np.sin(pos @ k + ph)
    H *= CLOTH_FOLD / sum(a for *_, a in CLOTH_WAVES) * (CLOTH_PATCH + (1 - CLOTH_PATCH) * np.sqrt(env)) * 1.6
    # Seams: a groove, and stitching STITCH_AT to one side (both sides of the line: the panel either side has it).
    ds = grow_dist(seam, int(STITCH_AT * 2 / px_m) + 2) * px_m
    H -= SEAM_DEPTH * np.exp(-(ds / SEAM_W) ** 2)
    H += STITCH_H * np.exp(-((ds - STITCH_AT) / STITCH_W) ** 2)
    # Hems: raised over HEM_W from the edge (rounded at the edge itself), stitched near its inner side.
    dh = grow_dist(hem, int(HEM_W * 1.5 / px_m) + 2) * px_m
    band = np.clip(dh / 0.002, 0, 1) * np.clip((HEM_W - dh) / 0.002, 0, 1)
    H += HEM_H * band
    H -= STITCH_H * 1.5 * np.exp(-((dh - (HEM_W - 0.004)) / STITCH_W) ** 2)
    # Slopes along u and v (metres over metres), then to the garment's rectangle's size.
    gy_, gx_ = np.gradient(H, px_m)
    nrm = np.stack([-gx_, -gy_, np.ones_like(H)], -1)
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    nrm[~hit] = (0, 0, 1)
    img = np.ones((n, n, 4), dtype=np.float32)
    img[..., :3] = nrm * 0.5 + 0.5
    ys = (np.arange(h) * n / h).astype(int)
    xs = (np.arange(w) * n / w).astype(int)
    say('cloth', o.name, 'texel', round(px_m * 1000, 2), 'mm; hems', int(hem.sum()), 'seams', int(seam.sum()), 'texels; covered', round(float(hit.mean()), 3))
    return img[ys][:, xs]


# (the kit's rectangle of the opaque atlas, shirt over shorts as RECT, at the cloth map's own size)
cloth = np.zeros((CLOTH_GRID, CLOTH_GRID, 4), dtype=np.float32)
cloth[..., 0] = cloth[..., 1] = 0.5
cloth[..., 2] = cloth[..., 3] = 1
half = CLOTH_GRID // 2
cloth[half:, :] = garment_normals(shirt, CLOTH_GRID, half)
cloth[:half, :] = garment_normals(shorts, CLOTH_GRID, half)
save(cloth, os.path.join(OUT, 'cloth.webp'), 'cloth')

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
def uv_to(rect, size, u, v):
    x0, y0, w, h = rect
    return ((x0 + min(max(u, 0), 1) * w) / size[0], (y0 + min(max(v, 0), 1) * h) / size[1])


KINDS = [(body, 'skin', 'body'), (head_skin, 'skin', 'head'), (eyes, 'eye', 'eye'), (teeth, 'teeth', 'teeth'),
         (shirt, 'shirt', 'shirt'), (shorts, 'shorts', 'shorts'), (shoes, 'shoe', None), (sock, 'sock', None), (lashes, 'lash', 'lash'),
         (hair, 'hair', 'hair'), (brows, 'brow', 'brow'), (helmet, 'hair', 'helmet'), (head_piece, 'sock', None)]
KINDS += [(so, 'shorts', 'skirt') for so, _ in skirts.values()]
# The wardrobe's cuts (person_wear.PIECES; the game draws the ones worn): a top is the shirt's part on the shirt's atlas, tights
# the shorts' part at one plain place on the shorts (a skin shell has no UVs), socks and the collar the sock's part.
KINDS += [(o, 'shirt' if k in pw.TOPS else 'shorts' if k == 'tights' else 'sock', 'shirt' if k in pw.TOPS else None) for k, o in wear.items()]
if collar:
    KINDS.append((collar, 'sock', None))
PIECE_OF = {shirt: TOP0, shorts: 'shorts', shoes: 'shoe', sock: 'crew', **{o: k for k, o in wear.items()}, **{so: st for st, (so, _) in skirts.items()}}
if collar:
    PIECE_OF[collar] = 'collar'
HANG = {so: hg for so, hg in skirts.values()}
collar_shade = [d.value for d in collar.data.attributes['shade'].data] if collar else None
tights_uv = None
if 'tights' in wear:
    # (the shorts' cloth at the front of the thigh, halfway down a leg)
    suv = shorts.data.uv_layers[0].data
    at = Vector((J['LeftUpLeg'].x, coords(shorts)[:, 1].min(), (J['LeftUpLeg'].z + coords(shorts)[:, 2].min()) / 2))
    l0 = min(shorts.data.loops, key=lambda l: (shorts.data.vertices[l.vertex_index].co - at).length)
    u_, v_ = suv[l0.index].uv
    tights_uv = uv_to(RECT['shorts'], OPAQUE_SIZE, u_ - math.floor(u_), v_ - math.floor(v_))


def fresh():
    return {'pos': [], 'nrm': [], 'uv': [], 'si': [], 'sw': [], 'part': [], 'index': [], 'ao': [], 'mask': [], 'morph': [],
            'piece': [], 'tpiece': [], 'hide': []}


buffers = {'opaque': fresh(), 'alpha': fresh()}
shoe_out, shoe_first = [], 0
for o, part, rect in KINDS:
    if o is None:
        continue
    me = o.data
    me.calc_loop_triangles()
    uvl = me.uv_layers[0].data if rect else None
    gname = {g.index: g.name[len(P):] for g in o.vertex_groups}
    kind = 'alpha' if part in ALPHA_PARTS else 'opaque'
    size = ALPHA_SIZE if kind == 'alpha' else OPAQUE_SIZE
    B = buffers[kind]
    base = len(B['part'])
    seen = {}
    if o is shoes:
        shoe_first = base
    tag = 'body' if o is body else 'head' if o is head_skin else None
    # (MetaHuman's body UVs sit in the next tile over, u 1-2, UDIM style: each mesh is brought back into 0-1)
    tile = np.zeros(2)
    if uvl is not None:
        allu = np.empty(len(uvl) * 2, dtype=np.float32)
        uvl.foreach_get('uv', allu)
        tile = np.floor(np.median(allu.reshape(-1, 2), axis=0))
    if tile.any():
        say('uv tile', o.name, tile.tolist())
    piece_ix = pw.PIECES.index(PIECE_OF.get(o, 'body'))
    for tri in me.loop_triangles:
        B['tpiece'].append(piece_ix)
        for li, vi in zip(tri.loops, tri.vertices):
            u, v = uvl[li].uv if uvl is not None else (0.0, 0.0)
            u, v = u - tile[0], v - tile[1]
            key = (vi, round(u, 5), round(v, 5))
            if key in seen:
                B['index'].append(seen[key])
                continue
            vert = me.vertices[vi]
            if rect is None:
                # (the trainer, the socks; a head piece: kit.ts, a sock above the hips takes the trim colour)
                pt, uv = part, (tights_uv if part == 'shorts' and tights_uv else (0.0, 0.0))
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
            B['ao'].append(float(head_shade[vi]) if o is head_piece else float(eye_ao[vi]) if o is eyes else
                           float(shoe_x[vi, 0]) if o is shoes and shoe_x is not None else
                           float(collar_shade[vi]) if o is collar else 1.0)
            B['piece'].append(piece_ix)
            B['hide'].append(int(hide[vi]) if o is body and hide is not None else 0)
            if o is shoes and shoe_x is not None:
                shoe_out.append(shoe_x[vi])
            # (a skirt's hang, 0 at its top to 1 at the hem, in the mask's x: kit.ts swings it and keeps it off the thighs)
            B['mask'] += ([float(x) for x in regions[vi]] if o is head_skin else
                          [float(HANG[o][vi]) if o in HANG else 0.0, 0.0, 0.0, 0.0])
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
          'textures': {'opaque': 'opaque.webp', 'alpha': 'alpha.webp', 'cloth': spec['name'] + '-cloth.webp', 'skin': 'skin.webp',
                       **({'hands': 'hands.webp', 'handsN': 'hands-n.webp'} if hands else {})},
          **({'handsBox': hands} if hands else {}),
          'parts': PART, 'morphs': [], 'kit': spec.get('kit', {}), 'meshes': {}}
if WARDROBE:
    worn = ['body', 'shoe', TOP0, 'shorts', 'crew'] + (['collar'] if KIT.get('top') == 'polo' else []) + ([SKIRT_STYLE] if SKIRT_STYLE else [])
    header['wardrobe'] = {'pieces': list(pw.PIECES), 'worn': worn, 'vneck': [pw.VNECK_DROP[WOMEN], pw.VNECK_SLOPE]}
for kind, B in buffers.items():
    ent = {'vertices': len(B['part']), 'indices': len(B['index'])}
    for key, fmt in (('pos', 'f'), ('nrm', 'f'), ('uv', 'f'), ('si', 'B'), ('sw', 'f'), ('part', 'B'), ('index', 'I'),
                     ('ao', 'f'), ('mask', 'f'), ('morph', 'f')) + ((('piece', 'B'), ('tpiece', 'B'), ('hide', 'H')) if WARDROBE else ()):
        data = np.asarray(B[key], dtype={'f': '<f4', 'B': 'u1', 'I': '<u4', 'H': '<u2'}[fmt]).tobytes()
        ent[key] = [len(blob), len(data)]
        blob += data
        blob += b'\0' * ((4 - len(blob) % 4) % 4)
    if kind == 'opaque' and shoe_out:
        # (the modelled trainers: bodyX for their vertices, which follow one another from `first`, and the fit kit.ts laces by)
        data = np.asarray(shoe_out, dtype='<f4').tobytes()
        ent['shoe'] = {'first': shoe_first, 'count': len(shoe_out), 'x': [len(blob), len(data)], 'fit': shoe_fit}
        blob += data
    header['meshes'][kind] = ent
open(os.path.join(OUT, 'body.bin'), 'wb').write(bytes(blob))
json.dump(header, open(os.path.join(OUT, 'body.json'), 'w'))
os.replace(os.path.join(OUT, 'cloth.webp'), os.path.join(OUT, spec['name'] + '-cloth.webp'))
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
             shoes: mat('sho', (0.9, 0.9, 0.88, 1)), sock: mat('so', (0.95, 0.95, 0.95, 1)), hair: mat('ha', (0.12, 0.08, 0.05, 1))}
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
