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
