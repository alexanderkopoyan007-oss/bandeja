# A converted stroke (retarget.py's clip, with its contact time) as the numbers strokes.ts keys a Family with: at any
# moments of the stroke, the racket face's centre, the handle's line (to the tip), the face's normal, the elbow (the
# "pole"), the shoulders' turn (+ to the left) and the free hand, in the model's frame (+z the net, +x the player's
# left, y up from the floor) about the stance (under the hips, on the floor).
#   ~/bandeja-mocap/venv/bin/python -I tools/assets/mocap/keys.py <clip.json> [t1,t2,... seconds from contact; default a sweep]
# The racket sits in the hand as grip.ts puts it; its face's centre from the wrist as strokes.ts has it (WRIST_IN_RACKET).
import gzip, json, os, struct, sys
import numpy as np
from scipy.spatial.transform import Rotation as Rot

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..')
clip = json.load(open(sys.argv[1]))
raw = gzip.open(os.path.join(ROOT, 'public/assets/player.bnz')).read()
hl = struct.unpack('<I', raw[8:12])[0]
bones = json.loads(raw[12:12 + hl])['bones']
NB = len(bones)
IX = {b['name']: i for i, b in enumerate(bones)}
PAR = [b['parent'] for b in bones]
LP = np.array([b['pos'] for b in bones])
restW, restP = [None] * NB, np.zeros((NB, 3))
for i, b in enumerate(bones):
    lq = Rot.from_quat(b['quat'])
    restW[i], restP[i] = (lq, LP[i]) if PAR[i] < 0 else (restW[PAR[i]] * lq, restP[PAR[i]] + restW[PAR[i]].apply(LP[i]))
F, fps = clip['frames'], clip['fps']
q = np.array(clip['quat']).reshape(F, NB, 4)
hips = np.array(clip['hips']).reshape(F, 3)
W, pos = [None] * NB, np.zeros((F, NB, 3))
for i in range(NB):
    lq = Rot.from_quat(q[:, i])
    W[i], pos[:, i] = (lq, hips) if PAR[i] < 0 else (W[PAR[i]] * lq, pos[:, PAR[i]] + W[PAR[i]].apply(LP[i]))
side = os.environ.get('HAND', 'Right')
free = 'Left' if side == 'Right' else 'Right'


def unit(v):
    return v / np.linalg.norm(v)


# the grip at rest (grip.ts, as retarget.py's racket_hand has it)
ih = IX[side + 'Hand']
Fh = unit(restP[IX[side + 'HandMiddle1']] - restP[ih])
kn = restP[IX[side + 'HandIndex1']] - restP[IX[side + 'HandPinky1']]
Kh = unit(kn - Fh * (kn @ Fh))
Nh = np.cross(Fh, Kh)
if Nh @ (restP[IX[side + 'HandThumb2']] - restP[ih]) < 0:
    Nh = -Nh
kd = kn @ Kh
A0 = unit(Fh * np.tan(np.radians(31)) * kd + Kh * kd + Nh * 0.007)
Np = unit(Nh - A0 * (Nh @ A0))
S0 = np.cross(A0, Np)
if S0 @ Kh < 0:
    S0 = -S0
Z0 = unit(Np * np.cos(np.pi / 4) + S0 * np.sin(np.pi / 4))
R0 = np.stack([np.cross(A0, Z0), A0, Z0], -1)
WRIST_IN_RACKET = np.array([0.08, -0.3, 0.04])
turn = (W[ih] * restW[ih].inv()).as_matrix()  # frames x 3 x 3
R = turn @ R0
axis, normal = R[:, :, 1], R[:, :, 2]
centre = pos[:, ih] - np.einsum('fij,j->fi', R, WRIST_IN_RACKET)
stance = hips * [1, 0, 1]
sh = pos[:, IX['LeftArm']] - pos[:, IX['RightArm']]
yaw = np.arctan2(-sh[:, 2], sh[:, 0])  # + turned to the left (the left shoulder back)
hp = pos[:, IX['LeftUpLeg']] - pos[:, IX['RightUpLeg']]
hyaw = np.arctan2(-hp[:, 2], hp[:, 0])
elbow = pos[:, IX[side + 'ForeArm']]
off = pos[:, IX[free + 'Hand']]
tc = clip.get('contact', (F - 1) / fps)
speed = np.linalg.norm(np.gradient(centre, axis=0), axis=1) * fps
ts = [float(x) for x in sys.argv[2].split(',')] if len(sys.argv) > 2 else [-1.2, -0.9, -0.6, -0.4, -0.25, -0.13, -0.08, -0.04, 0, 0.04, 0.08, 0.15, 0.25, 0.34]
f3 = lambda v: '(' + ', '.join('%.2f' % x for x in v) + ')'
print('contact at %.3f s of %.3f; the face\'s centre fastest %.1f m/s at %+.3f s' % (tc, (F - 1) / fps, speed.max(), speed.argmax() / fps - tc))
print('   t     centre about the stance   axis               normal             elbow              shoulders hips  free hand         speed  hips up')
for t in ts:
    f = int(round((tc + t) * fps))
    if not 0 <= f < F:
        continue
    print('%+.2f  %s  %s  %s  %s  %+5.2f  %+5.2f  %s  %4.1f  %.2f' % (t, f3(centre[f] - stance[f]), f3(axis[f]), f3(normal[f]), f3(elbow[f] - stance[f]),
                                                                yaw[f], hyaw[f], f3(off[f] - stance[f]), speed[f], hips[f, 1]))

# TRACK=<out.json>: the same, every frame, for the game to draw the swing by (src/render/avatar/clipStroke.ts): the racket
# (its face's centre about the stance and its turn: +y the handle's line to the tip, +z the face's normal on the palm's
# side, as strokes.ts racketQuat), the elbow, the racket shoulder, the shoulders' turn, the free hand, and the trunk's lean in the chest's own
# frame (tilt: the free shoulder up, about the chest's forward; bow: forward, about the shoulders' line). LEAD and FOLLOW
# (s): how long before the contact the forward swing is taken from, and how long after it the follow-through runs.
if os.environ.get('TRACK'):
    lead, follow = float(os.environ.get('LEAD', 0.2)), float(os.environ.get('FOLLOW', 0.4))
    neck = pos[:, IX['Neck']]
    xc = np.array([unit(v) for v in sh])
    upc = np.array([unit(u - x * (u @ x)) for u, x in zip(neck - hips, xc)])
    fw = np.cross(xc, upc)
    sgn = 1 if side == 'Right' else -1
    tilt = np.arcsin(np.clip(xc[:, 1], -1, 1)) * sgn  # the free shoulder up
    bow = np.arcsin(np.clip(-fw[:, 1], -1, 1))
    a, b = int(round((tc - lead) * fps)), int(round((tc + follow) * fps))
    assert a >= 0 and b < F, ('the clip runs %.2f s before the contact and %.2f after' % (tc, (F - 1) / fps - tc))
    yaw, hyaw = np.unwrap(yaw), np.unwrap(hyaw)
    # TURN=back,ball,finish[,bow at the ball]: the player turned to another heading: the shoulders' turn re-based to the given
    # turns at the take-back's end, the ball and the finish (the clip's own turn kept as the change between them), the
    # trunk's bow taken to the given one at the ball, and everything the trunk carries (the racket arm, the racket, the
    # free hand) turned about the stance with it, frame by frame: the arm stays where the clip has it on the chest. For a
    # clip whose body meets its ball elsewhere than the game's does: a kick smash is hit side-on, leaning back, the ball
    # over the head (yRiT052FmVw: 85 degrees from the net at the ball), the game's smash 0.6 m out in front; as the clip
    # has it the racket shoulder was 1.06 m from that ball (reach 0.87). Turning the shoulders alone (11 Nov, the first
    # go) left the arm where the side-on player had it while the chest came round under it: through the drop the upper
    # arm stood 80-100 degrees behind the chest's plane, the hand half a metre behind the spine, the racket at the far hip.
    if os.environ.get('TURN'):
        from scipy.interpolate import PchipInterpolator
        tn = [float(x) for x in os.environ['TURN'].split(',')]
        ic = int(round(tc * fps))
        # (into the ball the clip's turn plus a smooth extra; after it the clip's own turn, which mostly comes then, scaled
        # onto the way left: an extra on top of that one went 50 degrees past the finish and back)
        fr = np.arange(F)
        dy = PchipInterpolator([a, ic], [tn[0] - yaw[a], tn[1] - yaw[ic]])(np.clip(fr, a, ic))
        after = tn[1] + (tn[2] - tn[1]) * np.clip((yaw - yaw[ic]) / (yaw[b] - yaw[ic]), 0, 1)
        dy = np.where(fr > ic, after - yaw, dy)
        yaw, hyaw = yaw + dy, hyaw + dy
        about = Rot.from_euler('y', dy)  # (+ to the left, as the turn is counted)
        centre, elbow, off = stance + about.apply(centre - stance), stance + about.apply(elbow - stance), stance + about.apply(off - stance)
        pos[:, IX[side + 'Arm']] = stance + about.apply(pos[:, IX[side + 'Arm']] - stance)
        R = about.as_matrix() @ R
        print('TRACK turn re-based: %+.2f, %+.2f, %+.2f rad added at the take-back, the ball, the finish' % (dy[a], dy[ic], dy[b]))
        if len(tn) > 3:
            x = np.clip(np.where(fr <= ic, (fr - a) / max(ic - a, 1), (b - fr) / max(b - ic, 1)), 0, 1)
            bow = bow + (tn[3] - bow[ic]) * x * x * (3 - 2 * x)
    quat = Rot.from_matrix(R).as_quat()
    for f in range(1, F):  # one sign all the way (q and -q are one turn; a slerp between them is not)
        if quat[f] @ quat[f - 1] < 0:
            quat[f] = -quat[f]
    rnd = lambda x, n=4: np.round(np.asarray(x, float), n).reshape(-1).tolist()
    sl = slice(a, b + 1)
    json.dump({'name': os.path.basename(sys.argv[1]).replace('.json', ''), 'hand': side, 'fps': fps, 'frames': b - a + 1, 'lead': (int(round(tc * fps)) - a) / fps,
               'follow': (b - int(round(tc * fps))) / fps, 'p': rnd(centre[sl] - stance[sl]), 'q': rnd(quat[sl], 5), 'pole': rnd(elbow[sl] - stance[sl]), 'sh': rnd(pos[sl, IX[side + 'Arm']] - stance[sl]),
               'yaw': rnd(yaw[sl]), 'off': rnd(off[sl] - stance[sl]), 'tilt': rnd(tilt[sl]), 'bow': rnd(bow[sl]), 'hipsY': rnd(hips[sl, 1]),
               'hipYaw': rnd(hyaw[sl]), 'speed': rnd(speed[sl], 2)}, open(os.environ['TRACK'], 'w'))
    print('TRACK', os.environ['TRACK'], b - a + 1, 'frames: %.3f s before the contact, %.3f after; tilt %.2f..%.2f, bow %.2f..%.2f at the contact %.2f, %.2f'
          % ((int(round(tc * fps)) - a) / fps, (b - int(round(tc * fps))) / fps, tilt[sl].min(), tilt[sl].max(), bow[sl].min(), bow[sl].max(), tilt[int(round(tc * fps))], bow[int(round(tc * fps))]))
