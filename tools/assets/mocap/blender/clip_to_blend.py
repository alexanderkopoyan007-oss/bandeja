# A converted stroke (retarget.py's clip: the game's 65 bones, local turns and the hips' place, 60 a second) put into a
# Blender file on the game's own skeleton and mannequin, to be looked at and changed by hand there, and re-fitted to where
# the game meets that stroke's ball. blend_to_clip.py writes the file's action back out as a clip the game's tools read.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/assets/mocap/blender/clip_to_blend.py -- \
#       <clip.json> <out.blend> [BALL=left,up,fwd] [HAND=Right] [STILL=<png prefix>]
#
# BALL: where the game's ball is at the contact, from the hips (the model's frame: +x the player's left, +y up, +z the net;
# m). With it the file gets two actions: `<name>_clip`, the stroke as measured, and `<name>_game`, the same stroke with the
# whole body above the hips turned (one turn, all through) so that at the contact the racket's face centre is on that
# line from the hips; the legs are left as they were. The game hangs the arm from the shoulder and stretches it to the
# ball (avatar.ts trackKey), so the turn is what matters and the last centimetres of reach are its own.
#
# In the file: the armature `Player` (turned so that Blender's +z is up and the net is at -y), the mannequin skinned to it,
# `Racket` in the racket hand as grip.ts holds it, `Ball` where the racket must be at the marker `contact`.
import bpy, gzip, json, math, os, struct, sys
from mathutils import Matrix, Quaternion, Vector

argv = sys.argv[sys.argv.index('--') + 1:]
clip_path, out_path = argv[0], argv[1]
opt = dict(a.split('=', 1) for a in argv[2:])
side = opt.get('HAND', 'Right')
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', '..')

clip = json.load(open(clip_path))
raw = gzip.open(os.path.join(ROOT, 'public/assets/player.bnz')).read()
hl = struct.unpack('<I', raw[8:12])[0]
head = json.loads(raw[12:12 + hl])
base = 12 + hl
bones = head['bones']
NB = len(bones)
IX = {b['name']: i for i, b in enumerate(bones)}
PAR = [b['parent'] for b in bones]
assert clip['bones'] == [b['name'] for b in bones], 'the clip is on another skeleton'
Q = lambda v: Quaternion((v[3], v[0], v[1], v[2]))  # the game's (x, y, z, w)
restL = [Q(b['quat']) for b in bones]
LP = [Vector(b['pos']) for b in bones]
restW, restP = [None] * NB, [None] * NB
for i in range(NB):
    restW[i], restP[i] = (restL[i], LP[i]) if PAR[i] < 0 else (restW[PAR[i]] @ restL[i], restP[PAR[i]] + restW[PAR[i]] @ LP[i])
F, fps = clip['frames'], clip['fps']
quat = [[Q(clip['quat'][(f * NB + i) * 4:(f * NB + i) * 4 + 4]) for i in range(NB)] for f in range(F)]
hips = [Vector(clip['hips'][f * 3:f * 3 + 3]) for f in range(F)]
ic = int(round(clip.get('contact', (F - 1) / fps) * fps))


def fk(q, h):
    W, P = [None] * NB, [None] * NB
    for i in range(NB):
        W[i], P[i] = (q[i], h) if PAR[i] < 0 else (W[PAR[i]] @ q[i], P[PAR[i]] + W[PAR[i]] @ LP[i])
    return W, P


# the racket in the hand at rest (grip.ts, as keys.py has it): columns x, the handle's line to the tip, the face's normal
ih = IX[side + 'Hand']
Fh = (restP[IX[side + 'HandMiddle1']] - restP[ih]).normalized()
kn = restP[IX[side + 'HandIndex1']] - restP[IX[side + 'HandPinky1']]
Kh = (kn - Fh * kn.dot(Fh)).normalized()
Nh = Fh.cross(Kh)
if Nh.dot(restP[IX[side + 'HandThumb2']] - restP[ih]) < 0:
    Nh = -Nh
kd = kn.dot(Kh)
A0 = (Fh * math.tan(math.radians(31)) * kd + Kh * kd + Nh * 0.007).normalized()
Np = (Nh - A0 * Nh.dot(A0)).normalized()
S0 = A0.cross(Np)
if S0.dot(Kh) < 0:
    S0 = -S0
Z0 = (Np * math.cos(math.pi / 4) + S0 * math.sin(math.pi / 4)).normalized()
R0 = Matrix((A0.cross(Z0), A0, Z0)).transposed()
WRIST_IN_RACKET = Vector((0.08, -0.3, 0.04))


def racket(W, P):
    R = (W[ih] @ restW[ih].inverted()).to_matrix() @ R0
    return R, P[ih] - R @ WRIST_IN_RACKET


# ---- the stroke re-fitted to the game's ball
game = None
if 'BALL' in opt:
    ball = Vector([float(x) for x in opt['BALL'].split(',')])
    W, P = fk(quat[ic], hips[ic])
    R, c = racket(W, P)
    v0 = c - hips[ic]
    turn = v0.rotation_difference(ball)
    print('REFIT the racket at the contact from the hips: clip (%.2f, %.2f, %.2f) |%.2f|, the game\'s ball (%.2f, %.2f, %.2f) |%.2f|: the body turned %.1f degrees about (%.2f, %.2f, %.2f)'
          % (*v0, v0.length, *ball, ball.length, math.degrees(turn.angle), *turn.axis))
    game = []
    legs = [IX['LeftUpLeg'], IX['RightUpLeg']]
    for f in range(F):
        q = list(quat[f])
        h0 = q[0]
        q[0] = turn @ h0
        for l in legs:
            q[l] = q[0].inverted() @ (h0 @ q[l])
        game.append(q)
    W, P = fk(game[ic], hips[ic])
    R, c = racket(W, P)
    n = R.col[2]
    sh = P[IX['LeftArm']] - P[IX['RightArm']]
    up = (P[IX['Neck']] - P[0]).normalized()
    print('REFIT after it: racket from the hips (%.2f, %.2f, %.2f), its face\'s normal (%.2f, %.2f, %.2f), shoulders\' turn %.2f rad, spine %.0f degrees off upright (the clip %.0f)'
          % (*(c - hips[ic]), *n, math.atan2(-sh.z, sh.x), math.degrees(math.acos(up.y)),
             math.degrees(math.acos(((fk(quat[ic], hips[ic])[1][IX['Neck']] - hips[ic]).normalized()).y))))

# ---- the file
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = int(round(fps))
scene.frame_start, scene.frame_end = 1, F
arm = bpy.data.armatures.new('Player')
ob = bpy.data.objects.new('Player', arm)
scene.collection.objects.link(ob)
bpy.context.view_layer.objects.active = ob
bpy.ops.object.mode_set(mode='EDIT')
kids = {}
for i, p in enumerate(PAR):
    kids.setdefault(p, []).append(i)
for i, b in enumerate(bones):
    eb = arm.edit_bones.new(b['name'])
    L = max([(restP[k] - restP[i]).length for k in kids.get(i, [])] + [0.0]) or 0.03
    L = max(L, 0.02) if kids.get(i) else 0.03
    eb.head = restP[i]
    eb.tail = restP[i] + restW[i] @ Vector((0, L, 0))
    eb.matrix = Matrix.LocRotScale(restP[i], restW[i], None)
    eb.length = L
    if PAR[i] >= 0:
        eb.parent = arm.edit_bones[bones[PAR[i]]['name']]
        eb.use_connect = False
bpy.ops.object.mode_set(mode='OBJECT')
ob.rotation_euler = (math.pi / 2, 0, 0)  # the game's +y up is Blender's +z
ob.show_in_front = True
arm.display_type = 'STICK'

# the mannequin, skinned
m = head['mesh']
nv = m['vertices']
pos = struct.unpack_from('<%dH' % (nv * 3), raw, base + m['pos'][0])
verts = [tuple(m['min'][k] + pos[v * 3 + k] / 65535 * (m['max'][k] - m['min'][k]) for k in range(3)) for v in range(nv)]
idx = struct.unpack_from('<%d%s' % (m['indices'], 'I' if m['index32'] else 'H'), raw, base + m['index'][0])
me = bpy.data.meshes.new('Body')
me.from_pydata(verts, [], [idx[t:t + 3] for t in range(0, len(idx), 3)])
me.update()
for p in me.polygons:
    p.use_smooth = True
body = bpy.data.objects.new('Body', me)
scene.collection.objects.link(body)
body.parent = ob
si = raw[base + m['skinIndex'][0]:base + m['skinIndex'][0] + nv * 4]
sw = raw[base + m['skinWeight'][0]:base + m['skinWeight'][0] + nv * 4]
groups = [body.vertex_groups.new(name=b['name']) for b in bones]
for v in range(nv):
    for k in range(4):
        w = sw[v * 4 + k]
        if w:
            groups[si[v * 4 + k]].add([v], w / 255, 'ADD')
body.modifiers.new('Armature', 'ARMATURE').object = ob

# the racket in the hand: a face and a handle in the racket's own frame, held as grip.ts holds it
rv, rf = [], []
N = 24
for k in range(N):
    a = 2 * math.pi * k / N
    rv.append((0.115 * math.cos(a), 0.135 * math.sin(a), 0.019))
    rv.append((0.115 * math.cos(a), 0.135 * math.sin(a), -0.019))
for k in range(N):
    a, b2 = 2 * k, 2 * ((k + 1) % N)
    rf.append((a, b2, b2 + 1, a + 1))
rf.append(tuple(2 * k for k in range(N)))
rf.append(tuple(2 * k + 1 for k in reversed(range(N))))
o = len(rv)
for x in (-0.017, 0.017):
    for z in (-0.015, 0.015):
        rv += [(x, -0.13, z), (x, -0.34, z)]
rf += [(o, o + 1, o + 3, o + 2), (o + 4, o + 6, o + 7, o + 5), (o, o + 4, o + 5, o + 1), (o + 2, o + 3, o + 7, o + 6)]
rme = bpy.data.meshes.new('Racket')
rme.from_pydata(rv, [], rf)
rk = bpy.data.objects.new('Racket', rme)
scene.collection.objects.link(rk)
rk.parent, rk.parent_type, rk.parent_bone = ob, 'BONE', side + 'Hand'
bpy.context.view_layer.update()
rk.matrix_world = ob.matrix_world @ Matrix.LocRotScale(restP[ih] - R0 @ WRIST_IN_RACKET, R0.to_quaternion(), None)


def key(name, frames):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    ad = ob.animation_data_create()
    ad.action = act
    was = [None] * NB
    for f in range(F):
        for i, b in enumerate(bones):
            pb = ob.pose.bones[b['name']]
            r = restL[i].inverted() @ frames[f][i]
            if was[i] is not None and was[i].dot(r) < 0:
                r = -r
            was[i] = r.copy()
            pb.rotation_quaternion = r
            pb.keyframe_insert('rotation_quaternion', frame=f + 1)
        pb = ob.pose.bones[bones[0]['name']]
        pb.location = restW[0].inverted() @ (hips[f] - restP[0])
        pb.keyframe_insert('location', frame=f + 1)
    return act


name = os.path.basename(clip_path).replace('.json', '').replace('yt-', '')
key(name + '_clip', quat)
if game:
    key(name + '_game', game)
scene.timeline_markers.new('contact', frame=ic + 1)
if game:
    e = bpy.data.objects.new('Ball', None)
    e.empty_display_type, e.empty_display_size = 'SPHERE', 0.032
    scene.collection.objects.link(e)
    e.parent = ob
    e.location = hips[ic] + ball

# a light and a camera on the net's side, for a still
sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
scene.collection.objects.link(sun)
sun.rotation_euler = (math.radians(50), 0, math.radians(30))
cam = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
scene.collection.objects.link(cam)
cam.location = (2.0, -5.2, 1.6)
cam.rotation_euler = (math.radians(88), 0, math.radians(21))
cam.data.lens = 50
scene.camera = cam
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(out_path))
print('SAVED', out_path, 'actions', [a.name for a in bpy.data.actions], 'contact at frame', ic + 1)

if 'STILL' in opt:
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.render.resolution_x, scene.render.resolution_y = 640, 800
    scene.display.shading.light = 'STUDIO'
    for f in [int(x) for x in opt.get('FRAMES', str(ic + 1)).split(',')]:
        scene.frame_set(f)
        scene.render.filepath = '%s%03d.png' % (opt['STILL'], f)
        bpy.ops.render.render(write_still=True)
        print('STILL', scene.render.filepath)
