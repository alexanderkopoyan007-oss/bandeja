# FreeMoCap's 3D points (MediaPipe body + hands) as a clip on the game skeleton (public/assets/player.bnz's 65 bones).
#   ~/bandeja-mocap/venv/bin/python -I tools/assets/mocap/retarget.py <freemocap output_data folder> <out.json> [name]
#
# Each bone's world rotation is the turn that takes its rest direction (to its child joint) and a rest "roll" direction
# onto the same two measured from the points: the trunk and the head as frames (left, up, forward), the limbs aimed
# joint to joint, each rolled by something the points show (an elbow's bend, the knuckles' line, the foot's sole). The
# spine shares the turn from the pelvis to the chest; the clavicles go with the chest (MediaPipe has no sternum, so a
# shrug isn't seen). Rotations only: a captured person's limb lengths never reach the game, the hips' path is scaled by
# their leg length to the game's. Out: JSON {name, fps, frames, bones, quat (frames x bones x 4, local), hips (m)}.
#
# One camera's strokes (one_camera.py) bring three more files, each used if it is there:
#   floor.json        the points are already in the floor's frame (y up from the floor): no floor is looked for;
#   plants.json       when each foot stood: those feet are held where they stood (the hips' path gives way a little,
#                     the legs are bent to reach), and a foot standing flat lies flat;
#   racket_keys.json  the racket read off the clip's frames at a few moments: its hand takes the racket's direction
#                     from them through the game's own grip, each key's mirror-image readings settled by what a wrist
#                     and forearm can do and by the keys either side.
# CONTACT=<s> is written into the clip as the moment of contact.
import gzip, json, struct, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from floor import floor_up  # noqa: E402
import numpy as np
from scipy.spatial.transform import Rotation as Rot, RotationSpline

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


def aux(f):
    p = os.path.join(src, f)
    return json.load(open(p)) if os.path.exists(p) else None


FLOOR, PLANTS, RKEYS = aux('floor.json'), aux('plants.json'), aux('racket_keys.json')
B = {'nose': 0, 'Lear': 7, 'Rear': 8, 'Lsh': 11, 'Rsh': 12, 'Lel': 13, 'Rel': 14, 'Lwr': 15, 'Rwr': 16, 'Lpi': 17, 'Rpi': 18,
     'Lin': 19, 'Rin': 20, 'Lhip': 23, 'Rhip': 24, 'Lkn': 25, 'Rkn': 26, 'Lan': 27, 'Ran': 28, 'Lhe': 29, 'Rhe': 30, 'Lto': 31, 'Rto': 32}
P = lambda k: body[:, B[k]]


def unit(v):
    return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-9)


def perp(v, d):
    """v without its part along unit d, and that length."""
    w = v - (v * d).sum(-1, keepdims=True) * d
    return w, np.linalg.norm(w, axis=-1)




# The capture's frame to the model's: up from the floor (from the trunk if the feet don't give it), forward from the
# hips' line and up.
up_trunk = unit(np.nanmean(unit((P('Lsh') + P('Rsh')) / 2 - (P('Lhip') + P('Rhip')) / 2), axis=0))
up_c, floor_note, _ = floor_up(body, FPS)
# One camera (a stroke measured on a clip's page, from_page.py): its depth is too poor to find the floor from the feet,
# so up is given, the picture's own (UP=0,1,0: a level camera).
if FLOOR:
    up_c = unit(np.array(FLOOR['up'], float))
    print('RETARGET in the floor\'s frame:', FLOOR.get('note', ''))
elif os.environ.get('UP'):
    up_c = unit(np.array([float(x) for x in os.environ['UP'].split(',')]))
    print('RETARGET up as given:', up_c)
elif up_c is None:
    up_c = up_trunk
    print('RETARGET up from the trunk:', floor_note)
else:
    print('RETARGET up from the floor:', floor_note, '| the trunk leans %.1f deg off it on average'
          % np.degrees(np.arccos(np.clip(np.dot(up_c, up_trunk), -1, 1))))
# (a stroke off a clip starts in the ready position, facing the net: that is the clip's forward, not the stroke's
# average, which is half turned)
facing = slice(0, max(2, F // 16)) if FLOOR else slice(None)
left_c, _ = perp(np.nanmean(unit(P('Lhip') - P('Rhip'))[facing], axis=0), up_c)
left_c = unit(left_c)
if FLOOR and FLOOR.get('forward'):
    left_c = unit(np.cross(up_c, np.array(FLOOR['forward'], float)))
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
# One camera, front on, reads the head further up than that: against the ready position of the clip it was tried on
# (he looks level, at a camera at his own eye height) by 16 degrees: its ear point is the middle of the ear it can see,
# not the tragus, and the depth of a nose is a guess. one_camera.py hands that over as head_tilt_deg.
HEAD_TILT = np.radians(FLOOR.get('head_tilt_deg', 13) if FLOOR else 13)
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


def racket_hand(rk):
    """The racket hand's turn from rest, frame by frame, from keys read off the clip (one_camera.py): each key gives
    the handle's line in the picture, how much shorter than life it looks (its lean to or from the camera, either way
    unless the key says), and how wide the head looks (how far the face is turned from the camera, either way, either
    face unless the key says which is seen). Every reading of a key is a racket in space; the game's grip (grip.ts) makes it a hand; and the hand must be
    one a wrist can hold on that forearm (bend, side bend, the forearm's own turn against the elbow), near the keys
    either side of it. The cheapest chain of readings is kept and splined."""
    side = rk['hand']
    c = side[0]
    ih = IX[side + 'Hand']
    # the grip at rest: grip.ts's frame (F along the fingers, K along the knuckles to the index, N out of the palm)
    Fh = unit(restP[IX[side + 'HandMiddle1']] - restP[ih])
    kn = restP[IX[side + 'HandIndex1']] - restP[IX[side + 'HandPinky1']]
    Kh = unit(kn - Fh * (kn @ Fh))
    Nh = np.cross(Fh, Kh)
    if Nh @ (restP[IX[side + 'HandThumb2']] - restP[ih]) < 0:
        Nh = -Nh
    kd = kn @ Kh
    A0 = unit(Fh * np.tan(np.radians(31)) * kd + Kh * kd + Nh * 0.007)  # HANDLE_TILT, PALM_SINK_FAR - PALM_SINK
    Np = unit(Nh - A0 * (Nh @ A0))
    S0 = np.cross(A0, Np)
    if S0 @ Kh < 0:
        S0 = -S0
    Z0 = unit(Np * np.cos(np.pi / 4) + S0 * np.sin(np.pi / 4))  # GRIP_BEVEL
    R0 = np.stack([np.cross(A0, Z0), A0, Z0], -1)
    # keys at the same moment (read in a held frame, or either side of one) are one key
    keys = []
    for k in rk['keys']:
        if keys and abs(k['t'] - keys[-1][0]['t']) < 1e-3:
            keys[-1].append(k)
        else:
            keys.append([k])
    sgn = 1 if side == 'Right' else -1
    times, cands = [], []
    for grp in keys:
        t = grp[0]['t']
        th = np.arctan2(np.mean([np.sin(k['theta']) for k in grp]), np.mean([np.cos(k['theta']) for k in grp]))
        cc = float(np.mean([k['c'] for k in grp]))
        w = float(np.mean([k['w'] for k in grp]))
        near = max((k['near'] for k in grp), key=abs)
        seen = max((k.get('face', 0) for k in grp), key=abs)  # which face the camera sees, where the key says: +1 the palm's
        x, y, z = (M @ np.array(grp[0][a]) for a in 'xyz')  # the picture's right and up and the way to the camera
        f0 = min(F - 1, max(0, int(round(t * FPS))))
        fr = slice(max(0, f0 - 1), min(F, f0 + 2))
        u = unit(np.nanmean(P(c + 'wr')[fr] - P(c + 'el')[fr], axis=0))
        e = unit(np.nanmean(P(c + 'el')[fr] - P(c + 'sh')[fr], axis=0))
        hinge = np.cross(e, u)
        bent = np.linalg.norm(hinge)
        r0 = -sgn * unit(hinge)  # where the palm faces with the forearm unturned (thumb up): across the body
        out = []
        for lean in ([near] if near else ([1] if cc > 0.995 else [1, -1])):
            a = cc * (np.cos(th) * x - np.sin(th) * y) + lean * np.sqrt(max(0, 1 - cc * cc)) * z
            n0, m0 = perp(z, a)
            n0 = unit(n0) if m0 > 0.15 else unit(perp(y, a)[0])
            if w > 0 and cc > 0.6:
                rolls = [(sg * np.arccos(min(1, w)), f) for sg in ((1,) if w >= 0.99 else (1, -1)) for f in (1, -1)]
            else:
                rolls = [(np.radians(d), 1) for d in range(0, 360, 30)]
            for rho, face in rolls:
                n = face * (np.cos(rho) * n0 + np.sin(rho) * np.cross(a, n0))
                if seen and (n @ z) * seen < 0.05:
                    continue
                D = np.stack([np.cross(a, n), a, n], -1) @ R0.T  # rest -> this racket, so this hand
                Fw, Kw, Nw = D @ Fh, D @ Kh, D @ Nh
                flex = np.degrees(np.arcsin(np.clip(-u @ Nw, -1, 1)))  # + to the palm
                dev = np.degrees(np.arcsin(np.clip(-u @ Kw, -1, 1)))  # + to the thumb
                cost = ((flex + 20) / 40) ** 2 + ((dev + 5) / 22) ** 2 + (25 if Fw @ u < 0 else 0)
                npp, nm = perp(Nw, u)
                if nm > 0.2 and bent > 0.05:
                    tw = np.degrees(np.arctan2(u @ np.cross(r0, npp / nm), r0 @ (npp / nm)))
                    cost += min(1, bent / 0.25) * (max(0, abs(tw) - 80) / 15) ** 2
                out.append((cost, Rot.from_matrix(D)))
                if os.environ.get('RK_DEBUG'):
                    print('RK %.3f cost %5.1f flex %4.0f dev %4.0f fwd %5.2f | forearm in the picture (right, up, to the camera) %s upper arm %s | handle %s normal %s'
                          % (t, cost, flex, dev, Fw @ u, np.round([u @ x, u @ y, u @ z], 2), np.round([e @ x, e @ y, e @ z], 2), np.round([a @ x, a @ y, a @ z], 2), np.round([n @ x, n @ y, n @ z], 2)))
        times.append(t)
        cands.append(out)
    # the cheapest chain: each key's own cost and the turn between neighbours
    TURN = 0.5  # per rad^2
    best = [np.array([o[0] for o in cands[0]])]
    back = []
    for k in range(1, len(cands)):
        step = np.array([[(a[1].inv() * b[1]).magnitude() ** 2 * TURN for a in cands[k - 1]] for b in cands[k]])
        tot = step + best[-1][None, :]
        back.append(tot.argmin(1))
        best.append(tot.min(1) + np.array([o[0] for o in cands[k]]))
    pick = [int(best[-1].argmin())]
    for b in reversed(back):
        pick.append(int(b[pick[-1]]))
    pick.reverse()
    rots = Rot.concatenate([cands[k][i][1] for k, i in enumerate(pick)])
    print('RETARGET racket hand: %d keys, each one\'s own cost' % len(times), np.round([cands[k][i][0] for k, i in enumerate(pick)], 1).tolist())
    tt = np.clip(np.arange(F) / FPS, times[0], times[-1])
    return side, RotationSpline(np.array(times), rots)(tt), Kh


RK = racket_hand(RKEYS) if RKEYS else None
for s, c in (('Left', 'L'), ('Right', 'R')):
    W[IX[s + 'Shoulder']] = chest * restW[IX[s + 'Shoulder']]
    sh, el, wr = P(c + 'sh'), P(c + 'el'), P(c + 'wr')
    hd = hands[s]
    # (a hand may come as its wrist, direction and knuckles' line only: points 0, 5, 9, 17)
    ok = hd is not None and np.isfinite(hd[:, [0, 5, 9, 17]]).all(axis=(1, 2))
    okf = hd is not None and np.isfinite(hd).all(axis=(1, 2))
    if hd is not None and not okf.any():
        hd = None
    elif hd is not None:
        hd = np.where(okf[:, None, None], hd, hd[np.argmax(okf)])
    # the knuckles' line (index base minus little-finger base) and the hand's direction: from the hand's points where
    # tracked, else from the body's index and pinky points
    across = P(c + 'in') - P(c + 'pi')
    hand_dir = (P(c + 'in') + P(c + 'pi')) / 2 - wr
    hdo = hands[s]
    if hdo is not None:
        across = np.where(ok[:, None], hdo[:, 5] - hdo[:, 17], across)
        hand_dir = np.where(ok[:, None], hdo[:, 9] - hdo[:, 0], hand_dir)
    if RK and RK[0] == s:
        across = RK[1].apply(RK[2])
    across0 = restP[IX[s + 'HandIndex1']] - restP[IX[s + 'HandPinky1']]
    W[IX[s + 'Arm']] = aim(IX[s + 'Arm'], s + 'ForeArm', el - sh, blend_hint(wr - el, chest_fwd, el - sh), Z)
    W[IX[s + 'ForeArm']] = aim(IX[s + 'ForeArm'], s + 'Hand', wr - el, across, across0)
    W[IX[s + 'Hand']] = aim(IX[s + 'Hand'], s + 'HandMiddle1', hand_dir, across, across0)
    if RK and RK[0] == s:
        W[IX[s + 'Hand']] = RK[1] * restW[IX[s + 'Hand']]
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
            W[i] = Rot.from_quat(np.where(okf[:, None], r.as_quat(), keep.as_quat()))
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

# The hips' path: the captured thigh to the game's, the floor under the lowest heels and toes (or the floor given), x
# and z from the start.
thigh0 = np.linalg.norm(restP[IX['LeftUpLeg']] - restP[IX['LeftLeg']])
k = thigh0 * scale
if FLOOR:
    floor = FLOOR['y']
else:
    floor = np.nanpercentile(np.minimum.reduce([P('Lhe')[:, 1], P('Rhe')[:, 1], P('Lto')[:, 1], P('Rto')[:, 1]]), 2)
hips = np.stack([(hipC[:, 0] - hipC[0, 0]) * k, (hipC[:, 1] - floor) * k + 0.04, (hipC[:, 2] - hipC[0, 2]) * k], axis=-1)

LP = np.array([b['pos'] for b in bones])  # each bone's place in its parent's frame


def fk(hip_path):
    pos = np.zeros((F, NB, 3))
    for b in range(NB):
        pos[:, b] = hip_path if PAR[b] < 0 else pos[:, PAR[b]] + W[PAR[b]].apply(LP[b])
    return pos


def turn(a, b):
    """The shortest turn taking direction a onto b, frame by frame."""
    a, b = unit(a), unit(b)
    ax = np.cross(a, b)
    n = np.linalg.norm(ax, axis=-1, keepdims=True)
    return Rot.from_rotvec(ax / np.maximum(n, 1e-9) * np.arctan2(n, (a * b).sum(-1, keepdims=True)))


def hold_feet(plants, hips):
    """Feet that stood, held where they stood (one_camera.py's plants.json: frames a..b, flat or on the ball of the
    foot). One camera's guess at a leg's depth wanders by centimetres frame to frame, so a standing foot skates. Here:
    1. the hips' path gives way, smoothly: in height freely (how high the hips are over a standing foot is the legs' to
       say, and the picture shows a leg's height well), across the floor hardly (the path is the picture's and the
       body's size in it; a leg's depth is the guess);
    2. each standing leg is bent again (hip to ankle, the knee kept in its own plane) so the ball of the foot stays
       exactly on its spot, eased in and out over EASE frames either side; a foot standing flat lies flat, turned as
       it stood on average; no foot goes under the floor."""
    EASE = max(2, int(round(0.08 * FPS)))
    pos = fk(hips)
    toe_y, ankle_y = restP[IX['LeftToeBase'], 1], restP[IX['LeftFoot'], 1]
    spans = [(s, p['a'], min(F - 1, p['b']), p['flat']) for s in ('Left', 'Right') for p in plants.get(s, [])]
    # 1. the hips: D (frames x 3) small and smooth, each span's ball of the foot near one spot (x, z) and on the floor
    D = np.zeros((F, 3))
    spot = np.zeros((len(spans), 3))
    W_SMOOTH = 3.0
    for ax in range(3):
        W_KEEP = 0.3 if ax == 1 else 3.0
        nu = F + (len(spans) if ax != 1 else 0)
        rows, rhs = [], []

        def eq(cols, vals, r):
            row = np.zeros(nu)
            row[cols] = vals
            rows.append(row)
            rhs.append(r)
        for t in range(F):
            eq([t], [W_KEEP], 0)
            if 0 < t < F - 1:
                eq([t - 1, t, t + 1], [W_SMOOTH, -2 * W_SMOOTH, W_SMOOTH], 0)
        for j, (s, a, b, flat) in enumerate(spans):
            toe = pos[:, IX[s + 'ToeBase'], ax]
            for t in range(a, b + 1):
                if ax == 1:
                    eq([t], [1], toe_y - toe[t])
                    if flat:
                        eq([t], [0.5], 0.5 * (ankle_y - pos[t, IX[s + 'Foot'], 1]))
                else:
                    eq([t, F + j], [1, -1], -toe[t])
        sol = np.linalg.lstsq(np.array(rows), np.array(rhs), rcond=None)[0]
        D[:, ax] = sol[:F]
        spot[:, ax] = sol[F:] if ax != 1 else toe_y
    hips = hips + D
    pos = pos + D[:, None]
    if os.environ.get('DEBUG'):
        print('  hips moved (mm) across/up/forward: mean', np.round(1000 * D.mean(0)).tolist(), 'range', np.round(1000 * D.min(0)).tolist(), np.round(1000 * D.max(0)).tolist())
        for j, (s_, a_, b_, fl) in enumerate(spans):
            t_ = pos[a_:b_ + 1, IX[s_ + 'ToeBase']]
            print('  ', s_, a_, b_, 'flat' if fl else 'toe', 'ball of the foot before holding: spread (mm)', np.round(1000 * t_.std(0)).tolist(), 'height', np.round(1000 * (t_[:, 1].mean() - toe_y)))
    slid, short = [], 0
    for s in ('Left', 'Right'):
        iu, il, ifo, it = IX[s + 'UpLeg'], IX[s + 'Leg'], IX[s + 'Foot'], IX[s + 'ToeBase']
        mine = [(j, a, b, flat) for j, (ss, a, b, flat) in enumerate(spans) if ss == s]
        # how held each frame is (1 standing, easing to 0 EASE frames away), on which spot, and how flat
        wgt, flatw, tgt = np.zeros(F), np.zeros(F), pos[:, it].copy()
        head = np.zeros(F)
        rest_fwd = unit((restP[it] - restP[ifo]) * [1, 0, 1])
        fwd = (W[ifo] * restW[ifo].inv()).apply(rest_fwd)
        for j, a, b, flat in mine:
            h = np.arctan2(*np.median(fwd[a:b + 1][:, [0, 2]], axis=0))
            for t in range(max(0, a - EASE), min(F, b + EASE + 1)):
                d = max(a - t, t - b, 0) / (EASE + 1)
                w = 1 - d * d * (3 - 2 * d)
                if w > wgt[t]:
                    wgt[t], tgt[t], head[t] = w, spot[j], h
                    flatw[t] = w if flat else 0
        toe = pos[:, it] + wgt[:, None] * (tgt - pos[:, it])
        toe[:, 1] = np.maximum(toe[:, 1], toe_y)
        # the foot: as captured, laid flat (turned as it stood) by how flat it stands
        base = Rot.from_euler('y', head - np.arctan2(rest_fwd[0], rest_fwd[2])) * restW[ifo]
        rel = W[ifo].inv() * base
        foot = W[ifo] * Rot.from_rotvec(rel.as_rotvec() * flatw[:, None])
        ankle = toe - foot.apply(LP[it])
        ankle[:, 1] = np.maximum(ankle[:, 1], 0.05)
        # hip to ankle with the game's thigh and shin, the knee in the plane it was in
        H, K0 = pos[:, iu], pos[:, il]
        l1, l2 = np.linalg.norm(LP[il]), np.linalg.norm(LP[ifo])
        to = ankle - H
        dist = np.linalg.norm(to, axis=-1)
        short += int((dist > l1 + l2 - 1e-3).sum())
        dist = np.clip(dist, abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3)
        u = unit(to)
        ankle = H + u * dist[:, None]
        pole = unit(perp(K0 - H, u)[0])
        ca = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)
        knee = H + l1 * (ca[:, None] * u + np.sqrt(np.maximum(0, 1 - ca * ca))[:, None] * pole)
        W[iu] = turn(K0 - H, knee - H) * W[iu]
        W[il] = turn(pos[:, ifo] - K0, ankle - knee) * W[il]
        W[ifo] = foot
        W[it] = foot * restW[ifo].inv() * restW[it]
        for j, a, b, flat in mine:
            if b > a:
                end = ankle[a:b + 1] + foot[a:b + 1].apply(LP[it])
                slid.append(float(np.linalg.norm(end - end.mean(0), axis=-1).max()))
    print('RETARGET feet held: %d spans, the hips moved up to %.0f mm for them (%.0f mm on average); a held foot now strays at most %.1f mm; leg at full stretch in %d frames'
          % (len(spans), 1000 * np.linalg.norm(D, axis=-1).max(), 1000 * np.linalg.norm(D, axis=-1).mean(), 1000 * max(slid, default=0), short))
    return hips


if PLANTS:
    hips = hold_feet(PLANTS, hips)

# Local rotations, on one hemisphere frame to frame.
quat = np.zeros((F, NB, 4), dtype=np.float32)
for i in range(NB):
    q = (W[i] if PAR[i] < 0 else W[PAR[i]].inv() * W[i]).as_quat()
    for t in range(1, F):
        if np.dot(q[t], q[t - 1]) < 0:
            q[t] = -q[t]
    quat[:, i] = q

bad = ~np.isfinite(quat).all(axis=(1, 2)) | ~np.isfinite(hips).all(axis=1)
clip = {'name': name, 'fps': FPS, 'frames': F, 'bones': [b['name'] for b in bones],
        'quat': np.nan_to_num(quat).round(5).ravel().tolist(), 'hips': np.nan_to_num(hips).round(4).ravel().tolist()}
if os.environ.get('CONTACT'):
    clip['contact'] = float(os.environ['CONTACT'])
json.dump(clip, open(out, 'w'))
print('RETARGET', name, F, 'frames,', int(bad.sum()), 'with gaps; hips height', np.round(np.nanmedian(hips[:, 1]), 3),
      'm (game rest', round(float(restP[0, 1]), 3), '); hands tracked',
      {s: (0 if hands[s] is None else int(np.isfinite(hands[s][:, [0, 5, 9, 17]]).all(axis=(1, 2)).sum())) for s in hands})
