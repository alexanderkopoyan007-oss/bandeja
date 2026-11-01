# Step 2 of the Meshy pilot: rigs the decimated mesh (decimate-bake.py's low.npz) on the game skeleton, in Blender's Python.
#   Blender -b --python tools/assets/meshy/rig.py -- <low-dir> <person-dir (read-person.mjs)> <out-dir> <marks.json> <name>
#
# The person is not in p1's pose (arms about 18 degrees off the body, not 42; longer arms, shorter legs), so p1's skeleton can't
# just be laid over it. What happens instead:
# - Its joints in its own pose are marks/<name>.json, from slices through the mesh (fit.py; the first person's were set by hand, and fit.py is
#   calibrated on them; mirrored: these bodies are symmetric to about a centimetre). A person made with its arms out is bound as it stands. Hands: p1's fitted by the palm's frame, each finger's chain
#   then aimed at that fingertip.
# - p1's body is moved onto those joints, bone by bone, and each vertex here takes the weights of the nearest point on it.
# - The arms are then raised to p1's angle with those weights and the mesh is bound there: a bind with the arms down has
#   to swing 165 degrees overhead, and linear blend skinning collapses a shoulder at that (p1's 139 are what it was made for).
# - The moves to the T-pose are finish-player.py's, so body.json is what build-people.mjs reads from any person.
import json, os, sys
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

args = sys.argv[sys.argv.index('--') + 1:]
LOW, P1, OUT, MARKS, NAME = args[0], args[1], args[2], args[3], args[4]
os.makedirs(OUT, exist_ok=True)

SIDES = ('Left', 'Right')
FINGERS = ('Thumb', 'Index', 'Middle', 'Ring', 'Pinky')

# ---------- the person's joints in its own pose (game axes: y up, faces +z, +x its left; the left side, mirrored for the right) ----------
M = json.load(open(MARKS))
LM = {n: tuple(p) for n, p in M['joints'].items()}
# The hand's frame: fingers' direction, across towards the thumb; and the fingertips.
HAND_F = np.array(M['handF'])
HAND_K = np.array(M['handK'])
TIPS = {n: tuple(p) for n, p in M['tips'].items()}
TIP_IN = 0.007  # how far inside the tip the last joint stands
THUMB_SMOOTH = 10
RAISE = np.radians(M['raise'])  # the arms up to p1's angle
ARMPIT_SMOOTH = M.get('armpit', 14)  # (arms held out have no fused armpit to spread)
PART_SOURCE_OUT = (4, 9, 10)  # p1's eyes, teeth and tongue give no weights

# ---------- p1 ----------
j = json.load(open(f'{P1}/p1.json'))
names = [b['name'] for b in j['bones']]
nb = len(names)
ix = {n: i for i, n in enumerate(names)}
parent = [b['parent'] for b in j['bones']]
bind_p = np.array(j['bindPose']).reshape(-1, 4, 4).transpose(0, 2, 1)
A_p = bind_p[:, :3, 3].copy()
rest_p = np.array(j['restWorld']).reshape(-1, 4, 4).transpose(0, 2, 1)
J1 = rest_p[:, :3, 3].copy()  # p1's T-pose joints: their directions are the game skeleton's
nv_p = j['parts']['opaque']['vertices']
P = np.fromfile(f'{P1}/p1-opaque-pos.f32', dtype=np.float32).reshape(-1, 3).astype(np.float64)
SI_p = np.fromfile(f'{P1}/p1-opaque-si.u8', dtype=np.uint8).reshape(-1, 4)
SW_p = np.fromfile(f'{P1}/p1-opaque-sw.f32', dtype=np.float32).reshape(-1, 4)
PART_p = np.fromfile(f'{P1}/p1-opaque-part.u8', dtype=np.uint8)
TRI_p = np.fromfile(f'{P1}/p1-opaque-index.u32', dtype=np.uint32).reshape(-1, 3).astype(np.int64)
TRI_p = TRI_p[~np.isin(PART_p[TRI_p].max(axis=1), PART_SOURCE_OUT) & ~np.isin(PART_p[TRI_p].min(axis=1), PART_SOURCE_OUT)]
W_p = np.zeros((nv_p, nb), dtype=np.float64)
np.add.at(W_p, (np.arange(nv_p)[:, None].repeat(4, 1), SI_p), SW_p)

# ---------- the person ----------
d = np.load(f'{LOW}/low.npz')
B = d['co'].astype(np.float64)
V = np.stack([B[:, 0] - M['cx'], B[:, 2], -B[:, 1]], 1)  # (on the body's own middle: the marks are mirrored about it)
TRI = d['tri'].astype(np.int64)
UV = d['uv']
HI = d['hico']
HI = np.stack([HI[:, 0] - M['cx'], HI[:, 2], -HI[:, 1]], 1)
print('RIG person', len(V), 'verts', len(TRI), 'tris, p1 source tris', len(TRI_p))


def unit(v):
    return v / np.linalg.norm(v)


def mirror(p):
    return np.array((-p[0], p[1], p[2]))


def rot_between(a, b):
    a, b = unit(a), unit(b)
    v = np.cross(a, b)
    c = float(a @ b)
    s = np.linalg.norm(v)
    if s < 1e-9:
        return np.eye(3)
    k = v / s
    K = np.array(((0, -k[2], k[1]), (k[2], 0, -k[0]), (-k[1], k[0], 0)))
    return np.eye(3) + s * K + (1 - c) * K @ K


def frame(d_, e):
    x = unit(d_)
    y = e - x * (e @ x)
    y = unit(y)
    return np.stack((x, y, np.cross(x, y)), axis=1)


def sim(p_from, p_to, R, s=1.0):
    """A similarity carrying p_from to p_to."""
    m = np.eye(4)
    m[:3, :3] = R * s
    m[:3, 3] = p_to - m[:3, :3] @ p_from
    return m


# The left foot: its long axis from the sole's outline.
sole = HI[(HI[:, 1] < 0.03) & (HI[:, 0] > 0)]
c = sole.mean(0)
u, s_, vt = np.linalg.svd((sole - c)[:, [0, 2]], full_matrices=False)
fd = vt[0] * np.sign(vt[0][1])
foot_dir = np.array((fd[0], 0, fd[1]))
foot_len = float(np.ptp((sole - c)[:, [0, 2]] @ vt[0]))
print('RIG foot axis', foot_dir.round(3), 'length', round(foot_len, 3), 'toe-out', round(float(np.degrees(np.arctan2(fd[0], fd[1]))), 1), 'deg')
heel_pt = c - foot_dir * (foot_len / 2)
p_foot_len = 0.283

A = np.zeros((nb, 3))
for n, p in LM.items():
    A[ix[n]] = p
    if n.startswith('Left'):
        A[ix['Right' + n[4:]]] = mirror(p)
f0 = A[ix['LeftFoot']]
ft = foot_len / p_foot_len
for n, along, y in (('LeftToeBase', 0.149, 0.048), ('LeftToe_End', 0.204, 0.031)):
    q = f0 + foot_dir * along * ft
    q[1] = y
    A[ix[n]] = q
    A[ix['Right' + n[4:]]] = mirror(q)

# ---------- the bones' moves from p1's bind pose onto those joints ----------
X = np.tile(np.eye(4), (nb, 1, 1))
kids = {i: [k for k in range(nb) if parent[k] == i] for i in range(nb)}
TO = {}
for s in SIDES:
    TO.update({s + 'Shoulder': s + 'Arm', s + 'Arm': s + 'ForeArm', s + 'ForeArm': s + 'Hand', s + 'UpLeg': s + 'Leg', s + 'Leg': s + 'Foot', s + 'Foot': s + 'ToeBase', s + 'ToeBase': s + 'Toe_End'})
TO.update({'Spine': 'Spine1', 'Spine1': 'Spine2', 'Spine2': 'Neck', 'Neck': 'Head', 'Head': 'HeadTop_End'})

# Left hand first (the right is its mirror image).
WR = A[ix['LeftHand']]
F_m = unit(HAND_F)
K_m = unit(HAND_K - F_m * (HAND_K @ F_m))
wp = A_p[ix['LeftHand']]
F_p = unit(A_p[ix['LeftHandMiddle1']] - wp)
K_p = A_p[ix['LeftHandIndex1']] - A_p[ix['LeftHandPinky1']]
K_p = unit(K_p - F_p * (K_p @ F_p))
Rh = np.stack((F_m, K_m, np.cross(F_m, K_m)), 1) @ np.stack((F_p, K_p, np.cross(F_p, K_p)), 1).T
tip_len = np.linalg.norm(np.array(TIPS['Middle']) - WR)
p_len = np.linalg.norm(A_p[ix['LeftHandMiddle4']] - wp) + TIP_IN
sh = float(tip_len / p_len)
Xh = sim(wp, WR, Rh, sh)
print('RIG hand scale', round(sh, 3), 'tip', round(float(tip_len), 3))
Xleft = {}
Xleft['Hand'] = Xh


def tf(m, p):
    return m[:3, :3] @ p + m[:3, 3]


for f in FINGERS:
    a = np.array(TIPS[f])
    j1 = tf(Xh, A_p[ix[f'LeftHand{f}1']])
    j4 = tf(Xh, A_p[ix[f'LeftHand{f}4']])
    # (the finger's own knuckle, where fit.py could follow the finger in)
    to = np.array(M['knuckles'][f]) if f in M.get('knuckles', {}) else j1
    goal = a - unit(a - to) * TIP_IN
    R = rot_between(j4 - j1, goal - to)
    k = float(np.linalg.norm(goal - to) / np.linalg.norm(j4 - j1))
    Xf = sim(j1, to, R, k) @ Xh
    print('RIG finger', f, 'aim', round(float(np.degrees(np.arccos(np.clip(unit(j4 - j1) @ unit(goal - j1), -1, 1)))), 1), 'deg, length x', round(k, 3))
    for q in (1, 2, 3, 4):
        n = f'LeftHand{f}{q}'
        A[ix[n]] = tf(Xf, A_p[ix[n]])
        A[ix['Right' + n[4:]]] = mirror(A[ix[n]])
        Xleft[f'Hand{f}{q}'] = Xf
Mx = np.diag((-1.0, 1, 1, 1))
for n, m in Xleft.items():
    X[ix['Left' + n]] = m
    # (p1's right hand is close to his left mirrored: the mirrored move would need his joints mirrored, so it maps his own)
    X[ix['Right' + n]] = Mx @ m @ Mx

for n, to in TO.items():
    i, c_ = ix[n], ix[to]
    v_p = A_p[c_] - A_p[i]
    v_m = A[c_] - A[i]
    k = float(np.linalg.norm(v_m) / max(np.linalg.norm(v_p), 1e-9))
    X[i] = sim(A_p[i], A[i], rot_between(v_p, v_m), k)
X[ix['Hips']] = sim(A_p[ix['Hips']], A[ix['Hips']], np.eye(3))
for s in SIDES:  # the toe's tip has nothing to aim at: as its parent
    X[ix[s + 'Toe_End']] = X[ix[s + 'ToeBase']]
X[ix['HeadTop_End']] = X[ix['Head']]

# p1 on the person's joints.
hp = np.c_[P, np.ones(len(P))]
Pm = np.zeros_like(P)
for b in range(nb):
    w = W_p[:, b]
    if w.max() > 0:
        Pm += w[:, None] * (hp @ X[b].T)[:, :3]

# ---------- weights: the nearest point on him ----------
tree = BVHTree.FromPolygons([Vector(p) for p in Pm], [tuple(int(x) for x in t) for t in TRI_p])
W = np.zeros((len(V), nb), dtype=np.float64)
dist = np.zeros(len(V))
for v, p in enumerate(V):
    loc, _, ti, d_ = tree.find_nearest(Vector(p))
    t = TRI_p[ti]
    a, b_, c_ = Pm[t[0]], Pm[t[1]], Pm[t[2]]
    loc = np.array(loc)
    v0, v1, v2 = b_ - a, c_ - a, loc - a
    d00, d01, d11, d20, d21 = v0 @ v0, v0 @ v1, v1 @ v1, v2 @ v0, v2 @ v1
    den = d00 * d11 - d01 * d01
    if abs(den) < 1e-14:
        bary = (1.0, 0.0, 0.0)
    else:
        q = (d11 * d20 - d01 * d21) / den
        r = (d00 * d21 - d01 * d20) / den
        bary = (1 - q - r, q, r)
    W[v] = bary[0] * W_p[t[0]] + bary[1] * W_p[t[1]] + bary[2] * W_p[t[2]]
    dist[v] = d_
print('RIG nearest p1 surface, cm: median', round(float(np.median(dist)) * 100, 2), 'p95', round(float(np.percentile(dist, 95)) * 100, 2), 'max', round(float(dist.max()) * 100, 2))
fit_parts = np.zeros(len(V), dtype=np.uint8)

# ---------- a little smoothing over the mesh: nearest-surface weights jump across the medial lines (armpit, between fingers) ----------
edges = np.unique(np.sort(np.concatenate((TRI[:, [0, 1]], TRI[:, [1, 2]], TRI[:, [2, 0]])), axis=1), axis=0)
deg = np.bincount(edges.ravel(), minlength=len(V)).astype(np.float64)[:, None]
for _ in range(3):
    acc = np.zeros_like(W)
    np.add.at(acc, edges[:, 0], W[edges[:, 1]])
    np.add.at(acc, edges[:, 1], W[edges[:, 0]])
    W = 0.5 * W + 0.5 * acc / np.maximum(deg, 1)

# The fused armpit: the sleeve's underside is one surface with the ribs, in a crease that unfolds when the arm lifts. Left at the nearest
# surface's hard edge, all of that went into one thin strip; a wider blend spreads it over the crease's neighbours.
ax_, ay_ = LM['LeftArm'][:2]
big = M['height'] / 1.80
for side_ in (1, -1):
    zone = (V[:, 0] * side_ > ax_ - 0.10 * big) & (V[:, 0] * side_ < ax_ + 0.11 * big) & (V[:, 1] > ay_ - 0.275 * big) & (V[:, 1] < ay_ + 0.025 * big)
    for _ in range(ARMPIT_SMOOTH):
        acc = np.zeros_like(W)
        np.add.at(acc, edges[:, 0], W[edges[:, 1]])
        np.add.at(acc, edges[:, 1], W[edges[:, 0]])
        W[zone] = 0.4 * W[zone] + 0.6 * (acc / np.maximum(deg, 1))[zone]

# The thumb: a person modelled with it lying along the fingers swings it further into the grip than p1's, and all of that went into the first row of skin off the palm, a thin
# ridge to the wrist and a sheet across the web. Blended over the base of the thumb it spreads out.
for s_ in ('Left', 'Right'):
    zone = W[:, ix[s_ + 'HandThumb1']] > 0.004
    for _ in range(3):
        grown = np.zeros(len(V), dtype=bool)
        grown[edges[zone[edges[:, 0]], 1]] = True
        grown[edges[zone[edges[:, 1]], 0]] = True
        zone |= grown
    for _ in range(THUMB_SMOOTH):
        acc = np.zeros_like(W)
        np.add.at(acc, edges[:, 0], W[edges[:, 1]])
        np.add.at(acc, edges[:, 1], W[edges[:, 0]])
        W[zone] = 0.4 * W[zone] + 0.6 * (acc / np.maximum(deg, 1))[zone]

# ---------- raised to p1's angle, and bound there ----------
Xr = np.tile(np.eye(4), (nb, 1, 1))
subtree = {}


def under(i):
    return [i] + [k for c_ in kids[i] for k in under(c_)]


for s, sg in (('Left', 1), ('Right', -1)):
    S = A[ix[s + 'Arm']]
    a = RAISE * sg
    R = np.array(((np.cos(a), -np.sin(a), 0), (np.sin(a), np.cos(a), 0), (0, 0, 1)))
    for i in under(ix[s + 'Arm']):
        Xr[i] = sim(S, S, R)
hv = np.c_[V, np.ones(len(V))]
Vb = np.zeros_like(V)
for b in range(nb):
    w = W[:, b]
    if w.max() > 0:
        Vb += w[:, None] * (hv @ Xr[b].T)[:, :3]
Ab = np.array([tf(Xr[i], A[i]) for i in range(nb)])
sa = unit(Ab[ix['LeftForeArm']] - Ab[ix['LeftArm']])
print('RIG upper arm off the body at the bind', round(float(np.degrees(np.arccos(-sa[1]))), 1), 'deg; p1',
      round(float(np.degrees(np.arccos(-unit(A_p[ix['LeftForeArm']] - A_p[ix['LeftArm']])[1]))), 1))
sa0 = unit(A[ix['LeftForeArm']] - A[ix['LeftArm']])
print('RIG upper arm as modelled', round(float(np.degrees(np.arccos(-sa0[1]))), 1), 'deg')

# ---------- prune to four ----------
order = np.argsort(-W, axis=1)[:, :4]
row = np.arange(len(V))[:, None]
sw = W[row, order]
sw[sw < 1e-4] = 0
sw /= np.maximum(sw.sum(1, keepdims=True), 1e-9)
si = order.astype(np.uint8)
W4 = np.zeros_like(W)
W4[row, order] = sw

# ---------- the moves to the T-pose: finish-player.py's, on the game skeleton's directions ----------
AIM = {}
for s in SIDES:
    AIM[s + 'UpLeg'] = (s + 'Leg', 'min')
    AIM[s + 'Leg'] = (s + 'Foot', 'min')
    AIM[s + 'Arm'] = (s + 'ForeArm', 'min')
    AIM[s + 'ForeArm'] = (s + 'Hand', 'palm')
    AIM[s + 'Hand'] = (s + 'HandMiddle1', 'palm')
    for f in FINGERS:
        for q in (1, 2, 3):
            AIM[f'{s}Hand{f}{q}'] = (f'{s}Hand{f}{q + 1}', 'min' if f == 'Thumb' else 'palm')
Mv = np.tile(np.eye(4), (nb, 1, 1))
ends = {'HeadTop_End', 'LeftToe_End', 'RightToe_End'} | {f'{s}Hand{f}4' for s in SIDES for f in FINGERS}
for i in range(nb):  # parents come first
    n = names[i]
    pm = Mv[parent[i]] if parent[i] >= 0 else np.eye(4)
    if n in ends:
        Mv[i] = pm
        continue
    h = tf(pm, Ab[i])
    if n in AIM:
        to, how = AIM[n]
        d0 = tf(pm, Ab[ix[to]]) - h
        d1 = J1[ix[to]] - J1[i]
        if how == 'palm':
            s = 'Left' if n.startswith('Left') else 'Right'
            e0 = tf(pm, Ab[ix[s + 'HandIndex1']]) - tf(pm, Ab[ix[s + 'HandPinky1']])
            e1 = J1[ix[s + 'HandIndex1']] - J1[ix[s + 'HandPinky1']]
            R = frame(d1, e1) @ frame(d0, e0).T
        else:
            R = rot_between(d0, d1)
        Mv[i] = sim(h, h, R) @ pm
    else:
        Mv[i] = sim(Ab[i], h, np.eye(3))
Jt = np.array([tf(Mv[i], Ab[i]) for i in range(nb)])
worst = 0.0
for n, (to, how) in AIM.items():
    i = ix[n]
    worst = max(worst, float(np.degrees(np.arccos(np.clip(unit(Jt[ix[to]] - Jt[i]) @ unit(J1[ix[to]] - J1[i]), -1, 1)))))
print('RIG worst posed bone direction', round(worst, 3), 'deg')
for n in ('Hips', 'Neck', 'Head', 'LeftArm', 'LeftForeArm', 'LeftHand', 'LeftHandMiddle4', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToe_End'):
    print('RIG joint', n.ljust(16), 'bind', Ab[ix[n]].round(3), 'T', Jt[ix[n]].round(3), 'p1 T', J1[ix[n]].round(3))

# Edge stretch into the T-pose: what skinning does to the triangles on the way to the rest pose.
hb = np.c_[Vb, np.ones(len(Vb))]
Vt = np.zeros_like(Vb)
for b in range(nb):
    w = W4[:, b]
    if w.max() > 0:
        Vt += w[:, None] * (hb @ Mv[b].T)[:, :3]
e0 = np.linalg.norm(Vb[edges[:, 0]] - Vb[edges[:, 1]], axis=1)
e1 = np.linalg.norm(Vt[edges[:, 0]] - Vt[edges[:, 1]], axis=1)
ratio = e1 / np.maximum(e0, 1e-5)
print('RIG T-pose edge stretch p1/p50/p99/max', np.percentile(ratio, [1, 50, 99, 100]).round(2), 'T min', Vt.min(0).round(3), 'max', Vt.max(0).round(3))
top = np.argsort(-W4, axis=1)[:, 0]
bad = ratio > 1.6
tally = {}
for a_, b__ in edges[bad]:
    n_ = names[top[a_]]
    tally[n_] = tally.get(n_, 0) + 1
print('RIG stretched edges by bone', len(edges), sorted(tally.items(), key=lambda kv: -kv[1])[:14])

# ---------- normals of the bound shape ----------
fn = np.cross(Vb[TRI[:, 1]] - Vb[TRI[:, 0]], Vb[TRI[:, 2]] - Vb[TRI[:, 0]])
Nv = np.zeros_like(Vb)
for c_ in range(3):
    np.add.at(Nv, TRI[:, c_], fn)
Nv /= np.maximum(np.linalg.norm(Nv, axis=1, keepdims=True), 1e-12)

# ---------- occlusion per vertex (as modelled, arms down): the creases get no ambient light; without it a fold in a white shirt
# opened by a lifted arm shone the blue of the court ----------
fn0 = np.cross(V[TRI[:, 1]] - V[TRI[:, 0]], V[TRI[:, 2]] - V[TRI[:, 0]])
Nm = np.zeros_like(V)
for c_ in range(3):
    np.add.at(Nm, TRI[:, c_], fn0)
Nm /= np.maximum(np.linalg.norm(Nm, axis=1, keepdims=True), 1e-12)
occ_tree = BVHTree.FromPolygons([Vector(p) for p in V], [tuple(int(x) for x in t) for t in TRI])
rng = np.random.default_rng(1)
AO_RAYS, AO_REACH = 48, 0.22
dirs = rng.normal(size=(AO_RAYS, 3))
dirs /= np.linalg.norm(dirs, axis=1, keepdims=True)
ao = np.ones(len(V), dtype=np.float32)
for v in range(len(V)):
    n_ = Nm[v]
    o_ = Vector(V[v] + n_ * 0.002)
    seen_, sum_ = 0.0, 0.0
    for q in dirs:
        c_ = float(q @ n_)
        if c_ < 0:
            q, c_ = -q, -c_
        sum_ += c_
        if occ_tree.ray_cast(o_, Vector(q), AO_REACH)[0] is None:
            seen_ += c_
    ao[v] = seen_ / max(sum_, 1e-6)
print('RIG occlusion mean', round(float(ao.mean()), 3), 'p5', round(float(np.percentile(ao, 5)), 3))
fit_parts[:] = 5  # (the part whose occlusion the file keeps per vertex: bodyX.x)

# ---------- split at the UV seams, out ----------
seen = {}
pos, nrm, uv_o, si_o, sw_o, part, index, ao_o, from_v = [], [], [], [], [], [], [], [], []
for t in range(len(TRI)):
    for c_ in range(3):
        v = int(TRI[t, c_])
        u_, v_ = float(UV[t, c_, 0]), float(UV[t, c_, 1])
        key = (v, round(u_, 5), round(v_, 5))
        if key not in seen:
            seen[key] = len(seen)
            pos.append(Vb[v])
            nrm.append(Nv[v])
            uv_o.append((u_, v_))
            si_o.append(si[v])
            sw_o.append(sw[v])
            part.append(fit_parts[v])
            ao_o.append(ao[v])
            from_v.append(v)
        index.append(seen[key])
print('RIG game vertices', len(seen), 'triangles', len(TRI), 'source vertices', len(V))

# ---------- the face's keys: p1's, carried across by nearest surface as the weights were ----------
# The head is one painted surface: no lids to close and no gap between the lips, so a blink and the inside of an open mouth are drawn
# (kit.ts bakedMaterial, at `eye` and `mouth` in the header) and those keys carry only the skin round them. The eyes can't look anywhere,
# so the gaze keys stay behind too.
KEYS = ('squint', 'browDown', 'browInnerUp', 'browUp', 'jawOpen', 'mouthPress', 'smile', 'grimace', 'sneer', 'neckTense')
KEY_NEAREST = 6
KEY_DEPTH = 0.4  # how much a surface's depth counts against its place on the face: the two heads' profiles differ most
LIPS_WIDE, LIPS_TALL = 0.032, 0.03  # round the mouth the lips part: skin over the line takes its keys only from skin over it, and under from under
F = json.load(open(f'{LOW}/face.json'))
fv_p = np.fromfile(f'{P1}/p1-face-verts.u32', dtype=np.uint32)
kd = np.fromfile(f'{P1}/p1-morph.f32', dtype=np.float32).reshape(len(j['morphs']), len(fv_p), 6)
D_p = np.zeros((len(KEYS), nv_p, 6), dtype=np.float32)
for k_, n_ in enumerate(KEYS):
    D_p[k_, fv_p] = kd[j['morphs'].index(n_)]
del kd


def in_bind(p):
    i = int(np.argmin(((V - p) ** 2).sum(1)))
    return np.asarray(p, dtype=np.float64) + Vb[i] - V[i]


eye_m = in_bind(F['eye'])
mouth_m = in_bind((0, F['mouth'][0], F['mouth'][1]))
balls = P[PART_p == 4]
eye_p = np.array((balls[balls[:, 0] > 0, 0].mean(), balls[:, 1].mean(), balls[:, 2].max()))
# p1's mouth: where the jaw's move jumps, going up the face's middle.
m_ = (np.abs(P[:, 0]) < 0.012) & (P[:, 1] < eye_p[1] - 0.035) & (P[:, 1] > eye_p[1] - 0.13) & (PART_p == 0) & (P[:, 2] > eye_p[2] - 0.04)
o_ = np.argsort(P[m_, 1])
ys_, dy_ = P[m_, 1][o_], np.abs(D_p[KEYS.index('jawOpen'), m_, 1])[o_]
i_ = int(np.argmax(np.abs(np.diff(dy_))))
mouth_p = (ys_[i_] + ys_[i_ + 1]) / 2
sx_, sy_ = eye_p[0] / eye_m[0], (eye_p[1] - mouth_p) / (eye_m[1] - mouth_m[1])
print('RIG face: eye', eye_m.round(4), 'mouth', mouth_m.round(4), '| p1 eye', eye_p.round(4), 'mouth', round(float(mouth_p), 4), '| scale', round(sx_, 3), round(sy_, 3))
laid = np.stack((Vb[:, 0] * sx_, eye_p[1] + (Vb[:, 1] - eye_m[1]) * sy_, eye_p[2] + (Vb[:, 2] - eye_m[2]) * sx_), 1)
src = np.nonzero((PART_p == 0) & (P[:, 1] > eye_p[1] - 0.3))[0]
tgt = np.nonzero((laid[:, 1] > eye_p[1] - 0.3) & (np.abs(laid[:, 0]) < 0.16))[0]
S_ = P[src] * (1, 1, KEY_DEPTH)
T_ = laid[tgt] * (1, 1, KEY_DEPTH)
D_m = np.zeros((len(KEYS), len(V), 6), dtype=np.float32)
for at in range(0, len(tgt), 400):
    t_ = T_[at:at + 400]
    d2 = ((t_[:, None] - S_[None]) ** 2).sum(2)
    by_lips = (np.abs(t_[:, 0]) < LIPS_WIDE) & (np.abs(t_[:, 1] - mouth_p) < LIPS_TALL)
    d2[by_lips] += 1e3 * ((t_[by_lips, 1, None] > mouth_p) != (S_[:, 1] > mouth_p))
    near = np.argpartition(d2, KEY_NEAREST, axis=1)[:, :KEY_NEAREST]
    w_ = 1 / (np.take_along_axis(d2, near, 1) + 2e-6) ** 1.5
    w_ /= w_.sum(1, keepdims=True)
    D_m[:, tgt[at:at + 400]] = (D_p[:, src[near]] * w_[None, :, :, None]).sum(2)
D_m[:, :, :3] /= sx_
print('RIG face keys over', int((np.abs(D_m).max((0, 2)) > 1e-5).sum()), 'vertices; largest moves (mm)', {n_: round(float(np.linalg.norm(D_m[k_, :, :3], axis=1).max() * 1000), 1) for k_, n_ in enumerate(KEYS)})

PARTS = {'skin': 0, 'shirt': 1, 'shorts': 2, 'shoe': 3, 'eye': 4, 'sock': 5, 'hair': 6, 'brow': 7, 'lash': 8, 'teeth': 9, 'tongue': 10}
blob = bytearray()


def put(arr, kind):
    data = np.asarray(arr, dtype=kind).tobytes()
    at = [len(blob), len(data)]
    blob.extend(data)
    blob.extend(b'\0' * ((4 - len(blob) % 4) % 4))
    return at


def mesh(pos_, nrm_, uv_, si_, sw_, part_, index_, ao_=None):
    out = {'vertices': len(part_), 'indices': len(index_), 'pos': put(pos_, '<f4'), 'nrm': put(nrm_, '<f4'), 'uv': put(uv_, '<f4'),
           'si': put(si_, 'u1'), 'sw': put(sw_, '<f4'), 'part': put(part_, 'u1'), 'index': put(index_, '<u4')}
    if ao_ is not None:
        out['ao'] = put(ao_, '<f4')
    return out


meshes = {'opaque': mesh(pos, nrm, uv_o, si_o, sw_o, part, index, ao_o)}
meshes['opaque']['morph'] = put(D_m.transpose(1, 0, 2)[np.array(from_v)], '<f4')
# No hair cards: one speck inside the head, so that everything that expects a second mesh has one.
hd = Ab[ix['Head']] + np.array((0, 0.09, 0))
meshes['alpha'] = mesh([hd, hd + (0.001, 0, 0), hd + (0, 0.001, 0)], [(0, 1, 0)] * 3, [(0, 0)] * 3, [[ix['Head'], 0, 0, 0]] * 3, [[1, 0, 0, 0]] * 3, [6] * 3, [0, 1, 2])

header = {
    'name': NAME, 'height': M['height'], 'bones': names, 'joints': Jt.tolist(), 'move': [Mv[i].flatten(order='F').tolist() for i in range(nb)],
    'textures': {'opaque': 'opaque.webp', 'alpha': 'alpha.webp', 'cloth': f'{NAME}-normal.webp'}, 'parts': PARTS, 'morphs': list(KEYS),
    'kit': {'baked': True, 'top': 'tee', 'bottom': 'shorts', 'mark': 0, **json.load(open(f'{LOW}/kit.json')),
            'eye': eye_m.tolist(), 'mouth': mouth_m.tolist(), 'lid': F['lid']}, 'meshes': meshes,
}
open(f'{OUT}/body.bin', 'wb').write(bytes(blob))
json.dump(header, open(f'{OUT}/body.json', 'w'))
print('RIG wrote', OUT, len(blob) // 1024, 'KB')
