# Step 1b of the Meshy pipeline: a person's joints, measured from slices through the full mesh (decimate-bake.py's low.npz), written
# as tools/assets/meshy/marks/<name>.json for rig.py. Runs on Blender's bundled Python (it only needs numpy).
#   python fit.py <low-dir> <out.json>
# The slices are the triangles cut by a level plane, drawn on a 5 mm grid, and the separate outlines on that grid are head, trunk, arms
# and legs. Each limb is followed up from its end.
import json, sys
import numpy as np

LOW, OUT = sys.argv[1], sys.argv[2]
d = np.load(f'{LOW}/low.npz')
B = d['hico'].astype(np.float64)
V = np.stack([B[:, 0], B[:, 2], -B[:, 1]], 1)
T = d['hitri'].astype(np.int64)
H = float(V[:, 1].max())
SPAN = {axis: (V[T, axis].min(1), V[T, axis].max(1)) for axis in (0, 1)}
GRID = 0.005
print('FIT verts', len(V), 'tris', len(T), 'height', round(H, 4), 'x', V[:, 0].min().round(3), V[:, 0].max().round(3), 'z', V[:, 2].min().round(3), V[:, 2].max().round(3))


def outlines(y0, axis=1):
    """The separate outlines cut by the level plane y = y0 (axis 1), or the upright plane x = y0 (axis 0): a list of Nx2 arrays of points on
    each, (x, z) or (y, z)."""
    lo_, hi_ = SPAN[axis]
    tr = T[(lo_ <= y0) & (hi_ >= y0)]
    if len(tr) == 0:
        return []
    y = V[tr, axis]  # (a corner exactly on the plane is nudged off it)
    side = y > y0
    keep_ = [1 - axis, 2]
    two = []
    for p, q in ((0, 1), (1, 2), (2, 0)):
        m = side[:, p] != side[:, q]
        t = ((y0 - y[:, p]) / np.where(m, y[:, q] - y[:, p], 1))[:, None]
        two.append((V[tr[:, p]] + (V[tr[:, q]] - V[tr[:, p]]) * t)[:, keep_] * m[:, None])
    # Each cut triangle crosses two edges: its chord, walked in steps, so that big triangles leave no holes in the outline.
    has = np.stack([(side[:, p] != side[:, q]) for p, q in ((0, 1), (1, 2), (2, 0))], 1)
    keep = has.sum(1) == 2
    first = has.argmax(1)[keep]
    second = 2 - has[keep, ::-1].argmax(1)
    e = np.stack(two, 1)[keep]
    r = np.arange(len(e))
    p0, p1 = e[r, first], e[r, second]
    pts = np.concatenate([p0 + (p1 - p0) * f for f in np.linspace(0, 1, 9)])
    if len(pts) == 0:
        return []
    ix = ((pts[:, 0] - pts[:, 0].min()) / GRID).astype(int)
    iz = ((pts[:, 1] - pts[:, 1].min()) / GRID).astype(int)
    NX, NZ = ix.max() + 1, iz.max() + 1
    occ = np.zeros((NX, NZ), dtype=bool)
    occ[ix, iz] = True
    lab = np.full((NX, NZ), -1, dtype=int)
    n = 0
    for sx, sz in zip(*np.nonzero(occ)):
        if lab[sx, sz] >= 0:
            continue
        st = [(sx, sz)]
        lab[sx, sz] = n
        while st:
            x, z = st.pop()
            for dx in (-2, -1, 0, 1, 2):
                for dz in (-2, -1, 0, 1, 2):
                    u, w = x + dx, z + dz
                    if 0 <= u < NX and 0 <= w < NZ and occ[u, w] and lab[u, w] < 0:
                        lab[u, w] = n
                        st.append((u, w))
        n += 1
    which = lab[ix, iz]
    return [pts[which == i] for i in range(n)]


def stats(p):
    lo, hi = p.min(0), p.max(0)
    return ((lo + hi) / 2, hi - lo)


head = outlines(H - 0.10)
cx = float(stats(max(head, key=len))[0][0])
print('FIT head centre x', round(cx, 4))


def track(y0, step, start, stop=None):
    """Follows the outline chosen by start(list of outlines) -> outline, from y0 along y, each next one the nearest to the last."""
    rows, last = [], None
    y = y0
    while 0.003 < y < H:
        o = outlines(y)
        if last is None:
            p = start(o)
            if p is None:
                y += step
                continue
        else:
            near = [q for q in o if np.hypot(*(stats(q)[0] - last)) < 0.06]
            if not near:
                break
            p = min(near, key=lambda q: np.hypot(*(stats(q)[0] - last)))
        c, w = stats(p)
        if stop and last is not None and stop(c, w):
            break
        last = c
        rows.append((y, c[0], c[1], w[0], w[1], p[:, 1].max(), p[:, 1].min()))
        y += step
    return np.array(rows)


def outermost(sg):
    def pick(o):
        q = [p for p in o if (stats(p)[0][0] - cx) * sg > 0.14 * H]
        return max(q, key=lambda p: (stats(p)[0][0] - cx) * sg) if q else None
    return pick


# Generated with its arms out, or hanging?
OUT_ARMS = float(np.abs(V[:, 0] - cx).max()) > 0.40 * H
print('FIT arms', 'out' if OUT_ARMS else 'hanging')


def track_out(sg):
    """An arm held out, followed in from the fingertips: rows of x, y, z, width in y, width in z."""
    rows, last = [], None
    x = (V[:, 0].max() if sg > 0 else V[:, 0].min()) - sg * 0.003  # (each side's own tip: a body off centre has one arm short of the other's)
    while abs(x - cx) > 0.05:
        o = outlines(x, 0)
        near = o if last is None else [q for q in o if np.hypot(*(stats(q)[0] - last)) < 0.06]
        if not near:
            break
        p = max(near, key=len)
        c, w = stats(p)
        if w[0] > 0.17:  # (into the trunk)
            break
        last = c
        rows.append((x, c[0], c[1], w[0], w[1]))
        x -= sg * 0.005
    return np.array(rows)


arms, legs = {}, {}
for sg in (1, -1):
    # From below the hand, up until the outline swells where it meets the trunk.
    arms[sg] = track_out(sg) if OUT_ARMS else track(0.30 * H, 0.005, outermost(sg), lambda c, w: w[0] > 0.17 or w[1] > 0.24)
    if OUT_ARMS:
        print('FIT arm', sg)
        for q in arms[sg][::8]:
            print('   x', round(q[0], 3), 'c', q[1:3].round(3), 'wy', round(q[3], 3), 'wz', round(q[4], 3))
    # From the sock up, until the two legs join.
    legs[sg] = track(0.13, 0.005, lambda o: next((p for p in o if (stats(p)[0][0] - cx) * sg > 0.03), None), lambda c, w: abs(c[0] - cx) < 0.02 or w[0] > 0.26)

K = H / 1.8164  # lengths below are the first person's (his hand-set joints), scaled by height


def on(rows, y, col):
    """A track's column at height y (rows run up or down), from the nearest stretch at the end."""
    o = np.argsort(rows[:, 0])
    return float(np.interp(y, rows[o, 0], rows[o, col]))


def lean(rows, y0, y1, y, col):
    """The straight line through a track's column between y0 and y1, at y (past the end of the track)."""
    m = (rows[:, 0] >= y0) & (rows[:, 0] <= y1)
    a, b = np.polyfit(rows[m, 0], rows[m, col], 1)
    return float(a * y + b)


def narrowest(rows, y0, y1):
    m = (rows[:, 0] >= y0) & (rows[:, 0] <= y1)
    t = rows[m, 3] + rows[m, 4]
    return float(np.mean(rows[m, 0][t <= t.min() + 0.004]))


# Both sides are measured and then averaged about the middle: rig.py builds one side and mirrors it.
def both(f):
    a, b = f(1), f(-1)
    return (a + b) / 2, abs(a - b)


def outline_at(y):
    # (the one round the middle: held out, one arm can join it at a height where the other doesn't, and take its centre aside)
    near = [p for p in outlines(y) if p[:, 0].min() < cx < p[:, 0].max()]
    return max(near, key=len)


def along_z(y, frac):
    p = outline_at(y)
    lo, hi = p[:, 1].min(), p[:, 1].max()
    return float(lo + (hi - lo) * frac)


# ---------- the head and neck ----------
neck_w = [(float(stats(outline_at(y))[1][0]), float(y)) for y in np.arange(0.92 * H, 0.70 * H, -0.005)]
least = min(neck_w)
base = next(y for w, y in neck_w if y < least[1] and w > 1.4 * least[0])
print('FIT neck narrowest', round(least[1], 3), 'width', round(least[0], 3), 'base', round(base, 3))
HEAD_UP = 0.040 * K
TOP_OFF = 0.0164
SHOULDER_DOWN = 0.110 * K
# ---------- the legs ----------
knee_n, _ = both(lambda g: narrowest(legs[g], 0.20 * H, 0.27 * H))
KNEE_OVER = 0.04 * K
knee = knee_n + KNEE_OVER
ankle = 0.0551 * H
THIGH_OVER_SHIN = 1.19
hip = knee + THIGH_OVER_SHIN * (knee - ankle)
hips = hip + 0.045 * K
print('FIT knee', round(knee, 3), 'ankle', round(ankle, 3), 'hip', round(hip, 3), 'hip/H', round(hip / H, 3))
pelvis = stats(outline_at(hip))[1][0] / 2
hip_x = 0.58 * pelvis
# ---------- the arms ----------
sh = base - SHOULDER_DOWN
if OUT_ARMS:
    # Arms out, so the outlines run across the arm. Wrist and elbow are its narrow places, either side of the forearm's bulge, and the
    # shoulder stands just outside where the arm runs into the trunk.
    def along(g, a_, b_, widest=False):
        r = arms[g]
        d = np.abs(r[:, 0] - cx)
        m = (d >= a_) & (d <= b_)
        t = r[m, 3] + r[m, 4]
        return float(np.mean(d[m][(t >= t.max() - 0.004) if widest else (t <= t.min() + 0.004)]))

    reach = float(np.abs(V[:, 0] - cx).max())
    wrist_d, gap = both(lambda g: along(g, reach - 0.28 * K, reach - 0.14 * K))
    bulge, _ = both(lambda g: along(g, wrist_d - 0.26 * K, wrist_d - 0.10 * K, True))
    elbow_d, elbow_gap = both(lambda g: along(g, bulge - 0.12 * K, bulge - 0.015 * K))
    sh_x, _ = both(lambda g: float(np.abs(arms[g][-1, 0] - cx)) + 0.012 * K)
    print('FIT reach', round(reach, 3), 'wrist', round(wrist_d, 3), 'bulge', round(bulge, 3), 'elbow', round(elbow_d, 3), 'shoulder', round(sh_x, 3), 'side gaps', round(gap, 3), round(elbow_gap, 3))

    def at_d(d_, col):
        return both(lambda g: on(arms[g], cx + g * d_, col))[0]

    wrist, elbow, tip = at_d(wrist_d, 1), at_d(elbow_d, 1), reach
    wx, wz, ex, ez = wrist_d, at_d(wrist_d, 2), elbow_d, at_d(elbow_d, 2)
    sh_y, sh_z = at_d(sh_x, 1), at_d(sh_x, 2)
else:
    tip, _ = both(lambda g: float(arms[g][0, 0]))
    wrist, gap = both(lambda g: narrowest(arms[g], tip + 0.14 * K, tip + 0.28 * K))
    half = stats(outline_at(sh))[1][0] / 2
    sh_x = half - 0.047 * K
    sh_y, sh_z = sh, along_z(sh, 0.44)


    def rearmost(g):
        # A hanging arm is a little flexed, and the elbow is its rearmost point; where the sleeve runs into the trunk first, by proportion.
        r = arms[g][(arms[g][:, 0] > wrist + 0.12 * K)]
        z = np.convolve(r[:, 2], np.ones(9) / 9, mode='same')[4:-4]
        y = r[4:-4, 0]
        i = int(np.argmin(z))
        return float(y[i]) if i < len(y) - 3 else wrist + 0.5146 * (sh - wrist)


    elbow, elbow_gap = both(rearmost)
    print('FIT tip', round(tip, 3), 'wrist', round(wrist, 3), 'side gap', round(gap, 3), 'elbow', round(elbow, 3), 'side gap', round(elbow_gap, 3), 'shoulder', round(sh, 3))


def limb(rows, y, g):
    return (on(rows, y, 1) - cx) * g, on(rows, y, 2)


if not OUT_ARMS:
    wx, wx_gap = both(lambda g: limb(arms[g], wrist, g)[0])
    wz, wz_gap = both(lambda g: limb(arms[g], wrist, g)[1])
    ex, _ = both(lambda g: limb(arms[g], elbow, g)[0])
    ez, _ = both(lambda g: limb(arms[g], elbow, g)[1])
kx, kx_gap = both(lambda g: limb(legs[g], knee, g)[0])
kz, _ = both(lambda g: limb(legs[g], knee, g)[1])
ax, ax_gap = both(lambda g: (lean(legs[g], 0.13, 0.17, ankle, 1) - cx) * g)
az, _ = both(lambda g: lean(legs[g], 0.13, 0.17, ankle, 2))
print('FIT side gaps, m: knee', round(kx_gap, 3), 'ankle', round(ax_gap, 3))
span = hips, base
sp = lambda f: span[0] + (span[1] - span[0]) * f
LM = {
    'Hips': (0, hips, along_z(hips, 0.43)), 'Spine': (0, sp(0.178), along_z(sp(0.178), 0.485)), 'Spine1': (0, sp(0.355), along_z(sp(0.355), 0.427)),
    'Spine2': (0, sp(0.599), along_z(sp(0.599), 0.25)), 'Neck': (0, base, along_z(base, 0.55)), 'Head': (0, base + HEAD_UP, along_z(base + HEAD_UP, 0.306)),
    'HeadTop_End': (0, H - TOP_OFF, along_z(H - TOP_OFF - 0.006, 0.37)),
    'LeftShoulder': (0.335 * sh_x, base - 0.037 * K, along_z(base, 0.55) - 0.007 * K), 'LeftArm': (sh_x, sh_y, sh_z),
    'LeftForeArm': (ex, elbow, ez), 'LeftHand': (wx, wrist, wz),
    'LeftUpLeg': (hip_x, hip, along_z(hips, 0.43) + 0.004), 'LeftLeg': (kx, knee, kz), 'LeftFoot': (ax, ankle, az),
}

# ---------- the hand: its long axis and across, then the fingertips, from the left one and the right one mirrored ----------
W = np.array(LM['LeftHand'])
pts = []
for g in (1, -1):
    if OUT_ARMS:
        for d_ in np.arange(wrist_d, tip + 0.002, 0.002):
            c = np.array((on(arms[g], cx + g * d_, 1), on(arms[g], cx + g * d_, 2)))
            for p in outlines(cx + g * d_, 0):
                if np.hypot(*(stats(p)[0] - c)) < 0.05:
                    pts.append(np.stack((np.full(len(p), d_), p[:, 0], p[:, 1]), 1))
    else:
        for y in np.arange(wrist, tip - 0.01, -0.002):
            c = np.array((on(arms[g], y, 1), on(arms[g], y, 2)))
            o = [p for p in outlines(y) if (stats(p)[0][0] - cx) * g > 0.12 * H and np.hypot(*(stats(p)[0] - c)) < 0.05]
            for p in o:
                pts.append(np.stack(((p[:, 0] - cx) * g, np.full(len(p), y), p[:, 1]), 1))
hand = np.concatenate(pts)
u, sv, vt = np.linalg.svd(hand - hand.mean(0), full_matrices=False)
F = vt[0] * (np.sign(vt[0][0]) if OUT_ARMS else -np.sign(vt[0][1]))
F_K = vt[1] - F * (vt[1] @ F)
F_K /= np.linalg.norm(F_K)
if F_K[2] < 0:
    F_K = -F_K
N = np.cross(F, F_K)
f, k = (hand - W) @ F, (hand - W) @ F_K
bins = np.floor(k / 0.004).astype(int)
ks = np.arange(bins.min(), bins.max() + 1)
reach = np.array([f[bins == b].max() if (bins == b).any() else -1 for b in ks])
peaks = [i for i in range(1, len(ks) - 1) if reach[i] >= reach[max(0, i - 4):i + 5].max() - 1e-9]
print('FIT hand axis', F.round(3), 'across', F_K.round(3), 'peaks at k', [(round(float(ks[i] * 0.004), 3), round(float(reach[i]), 3)) for i in peaks])
# The fingers of a generated hand are half fused, so which finger a bump is can't be read off it: each tip goes where the first person's
# was in the hand's frame, onto the nearest point of this hand.
TIPS_FIRST = {'Thumb': (0.388, 0.785, 0.070), 'Index': (0.425, 0.720, 0.024), 'Middle': (0.427, 0.702, -0.003), 'Ring': (0.413, 0.706, -0.030), 'Pinky': (0.397, 0.731, -0.056)}
W0 = np.array((0.355, 0.9087, -0.0352))
F0, K0 = np.array((0.365, -0.929, 0.062)), np.array((0.069, 0.093, 0.993))
N0 = np.cross(F0, K0)
LEN0 = 0.221
scale = float(f.max()) / LEN0
TIPS = {}
for n, t in TIPS_FIRST.items():
    r = np.array(t) - W0
    want = W + (F * (r @ F0) + F_K * (r @ K0) + N * (r @ N0)) * scale
    near = hand[np.argmin(np.linalg.norm(hand - want, axis=1))]
    TIPS[n] = near.round(4).tolist()
    print('FIT tip', n, 'expected', want.round(3), 'on the hand', near.round(3), 'moved', round(float(np.linalg.norm(near - want)), 3))

# Hanging arms are raised to p1's angle before binding (rig.py), or an overhead asks linear skinning for 165 degrees; arms held out are bound
# where they are, with the rest of the range either side.
P1_BIND = 38.0
sa = np.array(LM['LeftForeArm']) - np.array(LM['LeftArm'])
angle = float(np.degrees(np.arccos(-sa[1] / np.linalg.norm(sa))))
raised = 0.0 if OUT_ARMS else P1_BIND - angle
print('FIT upper arm as modelled', round(angle, 1), 'raise', round(raised, 1))
out = {'cx': cx, 'height': round(H - TOP_OFF, 3), 'raise': round(raised, 1), 'armpit': 4 if OUT_ARMS else 14, 'handF': [round(float(x), 3) for x in F], 'handK': [round(float(x), 3) for x in F_K],
       'joints': {n: [round(float(x), 4) for x in p] for n, p in LM.items()}, 'tips': TIPS}
json.dump(out, open(OUT, 'w'), indent=1)
for n, p in out['joints'].items():
    print('FIT', n.ljust(14), p)
