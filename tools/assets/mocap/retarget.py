# FreeMoCap's 3D points (MediaPipe body + hands) as a clip on the game skeleton (public/assets/player.bnz's 65 bones).
#   ~/bandeja-mocap/venv/bin/python -I tools/assets/mocap/retarget.py <freemocap output_data folder> <out.json> [name]
#
# Each bone's world rotation is the turn that takes its rest direction (to its child joint) and a rest "roll" direction
# onto the same two measured from the points: the trunk and the head as frames (left, up, forward), the limbs aimed
# joint to joint, each rolled by something the points show (an elbow's bend, the knuckles' line, the foot's sole). The
# spine shares the turn from the pelvis to the chest; the clavicles go with the chest (MediaPipe has no sternum, so a
# shrug isn't seen). Rotations only: a captured person's limb lengths never reach the game, the hips' path is scaled by
# their leg length to the game's. Out: JSON {name, fps, frames, bones, quat (frames x bones x 4, local), hips (m)}.
import gzip, json, struct, sys, os
import numpy as np
from scipy.spatial.transform import Rotation as Rot, Slerp

src, out = sys.argv[1], sys.argv[2]
name = sys.argv[3] if len(sys.argv) > 3 else os.path.basename(os.path.dirname(os.path.abspath(src)))
FPS = float(os.environ.get('FPS', 30))
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..')

# ---- the game skeleton at rest (model space: +y up, facing +z, +x its left) ----
raw = gzip.open(os.path.join(ROOT, 'public/assets/player.bnz')).read()
assert raw[:4] == b'BNDJ'
hl = struct.unpack('<I', raw[8:12])[0]
bones = json.loads(raw[12:12 + hl])['bones']
NB = len(bones)
IX = {b['name']: i for i, b in enumerate(bones)}
PAR = [b['parent'] for b in bones]
restW = [None] * NB  # world rotation (Rot) and position
restP = np.zeros((NB, 3))
for i, b in enumerate(bones):
    lq, lp = Rot.from_quat(b['quat']), np.array(b['pos'])
    if PAR[i] < 0:
        restW[i], restP[i] = lq, lp
    else:
        restW[i], restP[i] = restW[PAR[i]] * lq, restP[PAR[i]] + restW[PAR[i]].apply(lp)

# ---- the points ----
body = np.load(os.path.join(src, 'mediapipe_body_3d_xyz.npy'))  # frames x 33 x 3
hands = {}
for s, f in (('Left', 'mediapipe_left_hand_3d_xyz.npy'), ('Right', 'mediapipe_right_hand_3d_xyz.npy')):
    p = os.path.join(src, f)
    hands[s] = np.load(p) if os.path.exists(p) else None
F = body.shape[0]
B = {'nose': 0, 'Lear': 7, 'Rear': 8, 'Lsh': 11, 'Rsh': 12, 'Lel': 13, 'Rel': 14, 'Lwr': 15, 'Rwr': 16, 'Lpi': 17, 'Rpi': 18,
     'Lin': 19, 'Rin': 20, 'Lhip': 23, 'Rhip': 24, 'Lkn': 25, 'Rkn': 26, 'Lan': 27, 'Ran': 28, 'Lhe': 29, 'Rhe': 30, 'Lto': 31, 'Rto': 32}
P = lambda k: body[:, B[k]]


def unit(v):
    return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-9)


def perp(v, d):
    """v without its part along unit d, and that length."""
    w = v - (v * d).sum(-1, keepdims=True) * d
    return w, np.linalg.norm(w, axis=-1)


# The capture's frame to the model's: up from the trunk on average, forward from the hips' line and up.
up_c = unit(np.nanmean(unit((P('Lsh') + P('Rsh')) / 2 - (P('Lhip') + P('Rhip')) / 2), axis=0))
left_c, _ = perp(np.nanmean(unit(P('Lhip') - P('Rhip')), axis=0), up_c)
left_c = unit(left_c)
fwd_c = np.cross(left_c, up_c)
M = np.stack([left_c, up_c, fwd_c])  # rows: capture -> model x, y, z
body = body @ M.T
for s in hands:
    if hands[s] is not None:
        hands[s] = hands[s] @ M.T
scale = 1.0 / np.nanmedian(np.linalg.norm(P('Lhip') - P('Lkn'), axis=-1))  # captured thigh = 1, then rescaled below


def frame(d, h):
    """Rotations (frames) whose columns are d, h made square to d, and d x h."""
    d = unit(d)
    h, _ = perp(h, d)
    h = unit(h)
    return Rot.from_matrix(np.stack([d, h, np.cross(d, h)], axis=-1))


def aim(i, child, d, h, h0):
    """World rotation of bone i: its rest direction (to `child`) and the rest roll h0 onto d and h."""
    d0 = restP[IX[child]] - restP[i]
    return frame(d, h) * frame(np.broadcast_to(d0, d.shape), np.broadcast_to(h0, h.shape)).inv() * restW[i]


def blend_hint(bent, fallback, d, full=0.3):
    """A roll from a bend where there is one (its share grows with how bent), else from a steadier direction."""
    hb, nb = perp(bent, unit(d))
    hf, _ = perp(fallback, unit(d))
    w = np.clip(nb / np.maximum(np.linalg.norm(bent, axis=-1), 1e-9) / full, 0, 1)[:, None]
    return unit(unit(hb) * w + unit(hf) * (1 - w))


X, Y, Z = np.eye(3)
W = [None] * NB
# Trunk: the pelvis from the hips' line and a third of the trunk's lean; the chest from the shoulders' line and the trunk.
hipC, shC = (P('Lhip') + P('Rhip')) / 2, (P('Lsh') + P('Rsh')) / 2
trunk = unit(shC - hipC)
pelvis_up = unit(np.broadcast_to(Y, trunk.shape) * 0.7 + trunk * 0.3)
pelvis = frame(P('Lhip') - P('Rhip'), pelvis_up)  # columns: left, up, (left x up = forward)
chest = frame(P('Lsh') - P('Rsh'), trunk)
ears = (P('Lear') + P('Rear')) / 2
# up = forward x left (left x forward points down: it built the head upside down and facing back). The ears' points are
# at the tragus and the nose's at its tip, which is lower: the line between them runs about 13 degrees under the face's
# level line (Frankfort plane through the tragus and the eye socket's floor; the tip some 2.5 cm under that, 11 cm on),
# so the head is lifted by that about its own left.
HEAD_TILT = np.radians(13)
head = frame(P('Lear') - P('Rear'), np.cross(P('nose') - ears, P('Lear') - P('Rear'))) * Rot.from_rotvec([-HEAD_TILT, 0, 0])
rest_frame = Rot.identity(F)
W[IX['Hips']] = pelvis * restW[IX['Hips']]
for n, t in (('Spine', 1 / 3), ('Spine1', 2 / 3), ('Spine2', 1.0)):
    rel = pelvis.inv() * chest
    W[IX[n]] = pelvis * Rot.from_rotvec(rel.as_rotvec() * t) * restW[IX[n]]
rel = chest.inv() * head
W[IX['Neck']] = chest * Rot.from_rotvec(rel.as_rotvec() * 0.5) * restW[IX['Neck']]
W[IX['Head']] = head * restW[IX['Head']]
chest_fwd = chest.apply(np.tile(Z, (F, 1)))
for s, c in (('Left', 'L'), ('Right', 'R')):
    W[IX[s + 'Shoulder']] = chest * restW[IX[s + 'Shoulder']]
    sh, el, wr = P(c + 'sh'), P(c + 'el'), P(c + 'wr')
    hd = hands[s]
    ok = hd is not None and np.isfinite(hd).all(axis=(1, 2))
    # the knuckles' line (index base minus little-finger base) and the hand's direction: from the hand's points where
    # tracked, else from the body's index and pinky points
    across = P(c + 'in') - P(c + 'pi')
    hand_dir = (P(c + 'in') + P(c + 'pi')) / 2 - wr
    if hd is not None:
        across = np.where(ok[:, None], hd[:, 5] - hd[:, 17], across)
        hand_dir = np.where(ok[:, None], hd[:, 9] - hd[:, 0], hand_dir)
    across0 = restP[IX[s + 'HandIndex1']] - restP[IX[s + 'HandPinky1']]
    W[IX[s + 'Arm']] = aim(IX[s + 'Arm'], s + 'ForeArm', el - sh, blend_hint(wr - el, chest_fwd, el - sh), Z)
    W[IX[s + 'ForeArm']] = aim(IX[s + 'ForeArm'], s + 'Hand', wr - el, across, across0)
    W[IX[s + 'Hand']] = aim(IX[s + 'Hand'], s + 'HandMiddle1', hand_dir, across, across0)
    for f, base in (('Index', 5), ('Middle', 9), ('Ring', 13), ('Pinky', 17), ('Thumb', 1)):
        for k in (1, 2, 3):
            i = IX[f'{s}Hand{f}{k}']
            if hd is None:
                W[i] = W[IX[s + 'Hand']] * restW[IX[s + 'Hand']].inv() * restW[i]
                continue
            d = hd[:, base + k] - hd[:, base + k - 1]
            if f == 'Thumb':
                h, h0 = hd[:, 5] - hd[:, 1], restP[IX[s + 'HandIndex1']] - restP[IX[s + 'HandThumb1']]
            else:
                h, h0 = across, across0
            r = aim(i, f'{s}Hand{f}{k + 1}', d, h, h0)
            # (an untracked hand keeps the fingers as the hand carries them at rest)
            keep = W[IX[s + 'Hand']] * restW[IX[s + 'Hand']].inv() * restW[i]
            W[i] = Rot.from_quat(np.where(ok[:, None], r.as_quat(), keep.as_quat()))
    hip, kn, an, he, to = P(c + 'hip'), P(c + 'kn'), P(c + 'an'), P(c + 'he'), P(c + 'to')
    foot_fwd = to - he
    W[IX[s + 'UpLeg']] = aim(IX[s + 'UpLeg'], s + 'Leg', kn - hip, blend_hint(-(an - kn), foot_fwd, kn - hip), Z)
    W[IX[s + 'Leg']] = aim(IX[s + 'Leg'], s + 'Foot', an - kn, foot_fwd, Z)
    # the foot by its sole (heel to toe) against the rest's flat foot, rolled by the shin
    W[IX[s + 'Foot']] = frame(foot_fwd, kn - an) * frame(np.tile(Z, (F, 1)), np.tile(Y, (F, 1))).inv() * restW[IX[s + 'Foot']]
    W[IX[s + 'ToeBase']] = W[IX[s + 'Foot']] * restW[IX[s + 'Foot']].inv() * restW[IX[s + 'ToeBase']]
# Ends and anything not set: carried by their parent as at rest.
for i in range(NB):
    if W[i] is None:
        W[i] = W[PAR[i]] * restW[PAR[i]].inv() * restW[i]

# Local rotations, on one hemisphere frame to frame.
quat = np.zeros((F, NB, 4), dtype=np.float32)
for i in range(NB):
    q = (W[i] if PAR[i] < 0 else W[PAR[i]].inv() * W[i]).as_quat()
    for t in range(1, F):
        if np.dot(q[t], q[t - 1]) < 0:
            q[t] = -q[t]
    quat[:, i] = q

# The hips' path: the captured thigh to the game's, the floor under the lowest heels and toes, x and z from the start.
thigh0 = np.linalg.norm(restP[IX['LeftUpLeg']] - restP[IX['LeftLeg']])
k = thigh0 * scale
floor = np.nanpercentile(np.minimum.reduce([P('Lhe')[:, 1], P('Rhe')[:, 1], P('Lto')[:, 1], P('Rto')[:, 1]]), 2)
hips = np.stack([(hipC[:, 0] - hipC[0, 0]) * k, (hipC[:, 1] - floor) * k + 0.04, (hipC[:, 2] - hipC[0, 2]) * k], axis=-1)
bad = ~np.isfinite(quat).all(axis=(1, 2)) | ~np.isfinite(hips).all(axis=1)
json.dump({'name': name, 'fps': FPS, 'frames': F, 'bones': [b['name'] for b in bones],
           'quat': np.nan_to_num(quat).round(5).ravel().tolist(), 'hips': np.nan_to_num(hips).round(4).ravel().tolist()},
          open(out, 'w'))
print('RETARGET', name, F, 'frames,', int(bad.sum()), 'with gaps; hips height', np.round(np.nanmedian(hips[:, 1]), 3),
      'm (game rest', round(float(restP[0, 1]), 3), '); hands tracked',
      {s: (0 if hands[s] is None else int(np.isfinite(hands[s]).all(axis=(1, 2)).sum())) for s in hands})
