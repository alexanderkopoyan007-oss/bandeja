# A trainer modelled round one foot (13 Nov 2026; the owner, of a close still of the game's shoe: "does that seriously look
# good to you?"). The game's own builder (src/render/avatar/shoe.ts) makes a shoe from MakeHuman's trainer's footprint and the
# sock; on a MetaHuman it had neither a real footprint nor a sock it could read, and what it drew was a slip-on: a low dish of
# a collar standing off the ankle, a tongue lying flat, laces painted on. This one is made here, where the foot itself can be
# felt (rays against the skin), and goes into the body's file as it is:
#
# - a sole under the foot (the foot stands on its insole, STACK over the floor): an outsole, a midsole with a belly and a
#   cup round the heel, toe spring;
# - an upper over the foot's own shape, never nearer the skin than a sock and a lining, boxed over the toes;
# - an opening that is the ankle's: a padded collar that passes under the ankle bones and rises to a tab behind the heel, its
#   lining on the sock; a lace slot down the instep between two eyestays;
# - a padded tongue up the instep and the shin, above the collar;
# - laces as cords: six crossings, a bar at the bottom, a bow at the top.
#
# In the foot's frame: a along it from the heel's end (m), c across (the outside +), z up from the bare sole. Each vertex
# carries what kit.ts paints by, as shoe.ts's do (bodyX): occlusion; where on the shoe (0 outsole, 0.5 midsole, 1 + cm over the
# midsole on the upper, 20 + that on the tongue, 40 a lace, 45 the lining); how far along (0-1); how far across (m).
import math
import numpy as np
from mathutils import Vector

N = 56           # points round the foot
K_UP = 11        # rings up the upper
STACK = 0.018    # the insole over the floor under the heel and ball
OUTSOLE = 0.0045
LEDGE = 0.0035   # the sole's edge out past the upper
SOCK = 0.0025    # a sock on the skin
CLEAR = 0.0062   # the upper's outside off the skin (sock, lining, the upper)
TOE_ROOM = 0.009
PAD = 0.0085     # the collar's padding
LACE_W, LACE_T = 0.0032, 0.0011   # a flat lace's half width and half thickness
EYELETS = 7
EYE_OUT = 0.0075  # an eyelet out from the slot's edge
W_OUTSOLE, W_MIDSOLE, W_UPPER, W_TONGUE, W_LACE, W_LINING = 0.0, 0.5, 1.0, 20.0, 40.0, 45.0


def smooth(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a))) if b != a else float(x >= b)
    return t * t * (3 - 2 * t)


def relax_closed(p, passes):
    for _ in range(passes):
        p = 0.25 * np.roll(p, 1, axis=0) + 0.5 * p + 0.25 * np.roll(p, -1, axis=0)
    return p


def relax_open(p, passes):
    for _ in range(passes):
        q = p.copy()
        q[1:-1] = 0.25 * p[:-2] + 0.5 * p[1:-1] + 0.25 * p[2:]
        p = q
    return p


def resample(pts, count):
    """`count` points evenly by length along the open polyline `pts` (n x d), ends included."""
    pts = np.asarray(pts, dtype=float)
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    cum = np.concatenate([[0], np.cumsum(seg)])
    want = np.linspace(0, cum[-1], count)
    out = np.empty((count, pts.shape[1]))
    for d in range(pts.shape[1]):
        out[:, d] = np.interp(want, cum, pts[:, d])
    return out


class Foot:
    """One foot's frame and its skin, felt by rays."""

    def __init__(self, heel0, ax, lat, length, bvh):
        self.o, self.ax, self.lat, self.L, self.bvh = heel0, ax, lat, length, bvh

    def world(self, a, c, z):
        return Vector((self.o.x + self.ax[0] * a + self.lat[0] * c, self.o.y + self.ax[1] * a + self.lat[1] * c, self.o.z + z))

    def local(self, p):
        d = p - self.o
        return (d.x * self.ax[0] + d.y * self.ax[1], d.x * self.lat[0] + d.y * self.lat[1], d.z)

    def vec(self, da, dc, dz):
        return Vector((self.ax[0] * da + self.lat[0] * dc, self.ax[1] * da + self.lat[1] * dc, dz))

    def cast(self, o, d, dist):
        hit = self.bvh.ray_cast(self.world(*o), self.vec(*d).normalized(), dist)
        return None if hit[0] is None else self.local(hit[0])

    def side(self, a, z, sgn):
        """The skin's c at station a and height z, met from outside (sgn: the outside +1, the inside -1)."""
        h = self.cast((a, sgn * 0.13, z), (0, -sgn, 0), 0.2)
        return None if h is None else h[1]

    def top(self, a, c, zmax=0.16):
        """The skin's height under (a, c), met from above; None where there is none, or where zmax is inside the leg."""
        if self.cast((a, c, zmax), (0, 0, 1), 0.6) is not None:
            return None
        h = self.cast((a, c, zmax), (0, 0, -1), zmax + 0.01)
        return None if h is None else h[2]

    def front(self, c, z):
        """The skin's a at height z on the line c, met from in front of the toes."""
        h = self.cast((self.L + 0.08, c, z), (-1, 0, 0), self.L + 0.2)
        return None if h is None else h[0]

    def back(self, c, z):
        h = self.cast((-0.08, c, z), (1, 0, 0), self.L + 0.2)
        return None if h is None else h[0]

    def near(self, a, c, z):
        """The nearest skin to a point: (point, normal, signed distance out of the skin), local."""
        p = self.world(a, c, z)
        q, n, _, _ = self.bvh.find_nearest(p)
        s = (p - q).dot(n)
        return self.local(q), (n.x * self.ax[0] + n.y * self.ax[1], n.x * self.lat[0] + n.y * self.lat[1], n.z), s


def build(foot, z_ankle, a_ball, say=print):
    """
    The trainer for `foot` (a Foot): z_ankle the ankle joint's height over the bare sole, a_ball the toes' joint along it.
    Returns {'co': n x 3 local, 'faces': [(i, j, k[, l])], 'where', 'ao', 'hold', 'fit'}.
    """
    L = foot.L
    k = L / 0.266  # sizes are a 26.6 cm foot's
    co, where, ao, hold, faces = [], [], [], [], []

    def add(p, w, o=1.0, h=0.0):
        co.append((float(p[0]), float(p[1]), float(p[2])))
        where.append(float(w))
        ao.append(float(o))
        hold.append(float(h))
        return len(co) - 1

    def quad(a, b, c, d):
        faces.append((a, b, c, d))

    # ---------------------------------------------------------------- the footprint ---------------------------------------------
    M = 49
    st = np.linspace(0, L, M)
    heights = (0.006, 0.012, 0.02, 0.03, 0.04)
    cl = np.full(M, np.nan)
    cm = np.full(M, np.nan)
    for j, a in enumerate(st):
        ls = [x for x in (foot.side(a, z, 1) for z in heights) if x is not None]
        ms = [x for x in (foot.side(a, z, -1) for z in heights) if x is not None]
        if ls and ms:
            cl[j], cm[j] = max(ls), min(ms)
    ok = ~np.isnan(cl)
    j0, j1 = int(np.argmax(ok)), int(M - 1 - np.argmax(ok[::-1]))
    mid = lambda a: float(np.interp(a, st[ok], (cl[ok] + cm[ok]) / 2))
    half = lambda a: float(np.interp(a, st[ok], (cl[ok] - cm[ok]) / 2))
    # The upper's outline at the sole (its feather line): the skin's, CLEAR out, with room in front of the toes and a little
    # behind the heel; the ends closed round.
    poly = [(st[j], cl[j]) for j in range(j0, j1 + 1)] + [(st[j], cm[j]) for j in range(j1, j0 - 1, -1)]
    poly = np.array(poly)
    # (closed, evenly, then smoothed: the stations' ends are flat cuts)
    dense = resample(np.vstack([poly, poly[:1]]), 241)[:-1]
    dense = relax_closed(dense, 6)
    nrm = np.roll(dense, -1, axis=0) - np.roll(dense, 1, axis=0)
    nrm = np.stack([nrm[:, 1], -nrm[:, 0]], axis=1)
    nrm /= np.linalg.norm(nrm, axis=1)[:, None] + 1e-12
    cen = dense.mean(0)
    if ((dense - cen) * nrm).sum() < 0:
        nrm = -nrm
    u_d = dense[:, 0] / L
    room = np.array([TOE_ROOM * k * smooth(0.8, 1.0, u) + 0.003 * k * (1 - smooth(0.0, 0.12, u)) for u in u_d])
    outline = dense + nrm * (CLEAR * k) + np.stack([room * np.sign(u_d - 0.5), np.zeros(len(dense))], axis=1)
    outline = relax_closed(outline, 10)
    # (from the heel's end round the outside to the toe's and back by the inside: point i of N)
    ih, it = int(np.argmin(outline[:, 0])), int(np.argmax(outline[:, 0]))
    def run(i0, i1, step):
        out, i = [], i0
        while True:
            out.append(outline[i])
            if i == i1:
                break
            i = (i + step) % len(outline)
        return np.array(out)
    A, B = run(ih, it, 1), run(ih, it, -1)
    lat_run, med_run = (A, B) if A[len(A) // 2, 1] > B[len(B) // 2, 1] else (B, A)
    H = N // 2
    lat_pts, med_pts = resample(lat_run, H + 1), resample(med_run, H + 1)
    U = np.zeros((N, 2))
    U[:H + 1] = lat_pts
    for i in range(1, H):
        U[N - i] = med_pts[i]
    heel_a, toe_a = float(U[0, 0]), float(U[H, 0])
    SL = toe_a - heel_a
    uo = lambda a: (a - heel_a) / SL
    un = np.roll(U, -1, axis=0) - np.roll(U, 1, axis=0)
    un = np.stack([un[:, 1], -un[:, 0]], axis=1)
    un /= np.linalg.norm(un, axis=1)[:, None]
    if ((U - U.mean(0)) * un).sum() < 0:
        un = -un
    say('trainer: foot', round(L * 100, 1), 'cm, sole', round(SL * 100, 1), 'cm long,', round(float(U[:, 1].max() - U[:, 1].min()) * 100, 1), 'wide')

    # ---------------------------------------------------------------- the sole ---------------------------------------------------
    def zb(u):  # the outsole's bottom: toe spring, the heel's bottom rounded up
        return -STACK * k + 0.010 * k * smooth(0.66, 1.0, u) ** 1.6 + 0.004 * k * (1 - smooth(0.0, 0.07, u)) ** 2

    def zmt(u, c_side):  # the midsole's top edge: a cup round the heel, lower along the forefoot, up again round the toes
        base = 0.016 + (0.009 - 0.016) * smooth(0.06, 0.34, u) + (0.005 - 0.009) * smooth(0.34, 0.66, u) + 0.006 * smooth(0.86, 1.0, u)
        arch = 0.004 * smooth(0.26, 0.36, u) * (1 - smooth(0.5, 0.62, u)) if c_side < 0 else 0.0
        return (base + arch) * k

    O = U + un * LEDGE * k  # the sole's own outline
    rings = []

    def ring(inset, zf, w, occ):
        ids = []
        for i in range(N):
            u = uo(U[i, 0])
            p = O[i] - un[i] * inset(u) * k
            cs = U[i, 1] - mid(U[i, 0])
            ids.append(add((p[0], p[1], zf(u, cs)), w, occ))
        rings.append(ids)
        return ids

    Hs = lambda u, cs: zmt(u, cs) - zb(u)
    bumper = lambda u: smooth(0.9, 0.96, u)  # the outsole's rubber up over the toe
    r0 = ring(lambda u: 12.0e-3, lambda u, cs: zb(u), W_OUTSOLE, 0.45)
    r1 = ring(lambda u: 3.2e-3, lambda u, cs: zb(u), W_OUTSOLE, 0.6)
    r2 = ring(lambda u: 0.6e-3, lambda u, cs: zb(u) + 0.0016 * k, W_OUTSOLE, 0.85)
    r3 = ring(lambda u: 0.0, lambda u, cs: zb(u) + OUTSOLE * k, W_OUTSOLE, 0.95)
    r4 = ring(lambda u: 1.3e-3, lambda u, cs: zb(u) + (OUTSOLE + 0.0008) * k, 0.35, 0.8)
    r5 = ring(lambda u: -1.6e-3 * (1 - smooth(0.7, 1.0, u)), lambda u, cs: zb(u) + 0.42 * Hs(u, cs), 0.46, 1.0)
    r6 = ring(lambda u: -0.4e-3, lambda u, cs: zb(u) + 0.70 * Hs(u, cs), 0.54, 1.0)
    r7 = ring(lambda u: 0.9e-3, lambda u, cs: zmt(u, cs) - 0.0014 * k, 0.6, 1.0)
    r8 = ring(lambda u: 2.3e-3, lambda u, cs: zmt(u, cs), 0.65, 0.9)
    for ids in (r4, r5, r6, r7, r8):  # (the toe's bumper is the outsole's rubber)
        for i in ids:
            if bumper(uo(co[i][0])) > 0.5:
                where[i] = W_OUTSOLE
    for lo, hi in zip(rings[:-1], rings[1:]):
        for i in range(N):
            j = (i + 1) % N
            quad(lo[i], lo[j], hi[j], hi[i])
    # (the bottom: across from the outside to the inside, by a line down the middle)
    spine = [None] * (H + 1)
    for i in range(1, H):
        a, b = co[r0[i]], co[r0[N - i]]
        spine[i] = add(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), W_OUTSOLE, 0.4)
    for i in range(1, H - 1):
        quad(r0[i + 1], r0[i], spine[i], spine[i + 1])
        quad(r0[N - i], r0[N - i - 1], spine[i + 1], spine[i])
    faces.append((r0[1], r0[0], r0[N - 1], spine[1]))
    faces.append((r0[H - 1], spine[H - 1], r0[H + 1], r0[H]))

    # ---------------------------------------------------------------- the opening ------------------------------------------------
    # The ankle: the leg's middle just over the ankle bones, and the sock's reach round it at the collar's height.
    z_side, z_back, z_front = z_ankle - 0.024 * k, z_ankle + 0.010 * k, z_ankle + 0.004 * k
    zc = z_ankle + 0.03 * k
    c0 = mid(0.2 * L)
    for _ in range(3):
        fb, ff = foot.back(c0, zc), foot.front(c0, zc)
        a0 = (fb + ff) / 2
        sl, sm = foot.side(a0, zc, 1), foot.side(a0, zc, -1)
        c0 = (sl + sm) / 2
    a_c, c_c = a0, c0
    say('trainer: ankle', round(a_c * 100, 1), 'cm from the heel,', round((ff - fb) * 100, 1), 'x', round((sl - sm) * 100, 1), 'cm at', round(zc * 100, 1))

    def rim_z(deg):  # the collar's height: a tab behind the heel, a dip under each ankle bone, up to the top eyelet
        d = abs(deg)
        return z_back + (z_side - z_back) * smooth(18, 70, d) + (z_front - z_side) * smooth(80, 122, d)

    def reach(theta, z):  # the sock's distance from the ankle's middle on this bearing (0 behind the heel, + round the outside)
        da, dc = -math.cos(theta), math.sin(theta)
        h = foot.cast((a_c + da * 0.14, c_c + dc * 0.14, z), (-da, -dc, 0), 0.14)
        return None if h is None else math.hypot(h[0] - a_c, h[1] - c_c) + SOCK

    # The throat: the top eyelet where the instep meets the collar's front, the slot from there down the foot.
    a_eye = foot.front(c_c, z_front + STACK * 0)  # the instep at that height
    a_eye = (a_eye if a_eye is not None else 0.45 * L) + 0.004 * k
    a_end = max(a_eye + 0.07 * k, toe_a - 0.08 * k)
    g_top, g_end = 0.017 * k, 0.0105 * k
    gap = lambda a: g_top + (g_end - g_top) * min(1.0, max(0.0, (a - a_eye) / (a_end - a_eye)))

    def over(a, c, extra=0.0):  # the upper's outside over the foot at (a, c)
        t = foot.top(a, c, 0.15)
        if t is None:
            return None
        return t + CLEAR * k + extra

    def ridge_c(a):  # the line down the top of the foot (the highest of a few casts across)
        best, bc = -1, mid(a)
        for d in np.linspace(-0.012, 0.012, 7):
            t = foot.top(a, mid(a) + d * k, 0.15)
            if t is not None and t > best:
                best, bc = t, mid(a) + d * k
        return bc
    rc = {}
    ra = np.linspace(a_eye - 0.01, toe_a, 40)
    rcs = relax_open(np.array([ridge_c(a) for a in ra])[:, None], 4)[:, 0]
    cmid = lambda a: float(np.interp(a, ra, rcs))

    DEG_END = 124
    rim_side = {}
    for sgn in (1, -1):
        pts = []
        # the collar, from behind the heel round to its end
        for deg in np.linspace(0, DEG_END, 27):
            th = math.radians(deg) * sgn
            z = rim_z(deg)
            r = reach(th, z)
            if r is None:
                r = 0.04 * k
            # (the rim itself 60% of the padding out: the collar's shoulder rounds in to it, below)
            pts.append((a_c - math.cos(th) * (r + PAD * 0.6 * k), c_c + math.sin(th) * (r + PAD * 0.6 * k), z, 1.0, r))
        e0 = pts[-1]
        # round into the top eyelet, heading down the slot
        ze = over(a_eye, cmid(a_eye) + sgn * g_top) or z_front
        p3 = (a_eye, cmid(a_eye) + sgn * g_top, ze)
        tan = np.array(pts[-1][:3]) - np.array(pts[-2][:3])
        tan /= np.linalg.norm(tan)
        d03 = np.linalg.norm(np.array(p3) - np.array(e0[:3]))
        p1 = np.array(e0[:3]) + tan * d03 * 0.4
        p2 = np.array(p3) - np.array([d03 * 0.4, 0, 0])
        for q in np.linspace(0, 1, 9)[1:]:
            b = (1 - q) ** 3 * np.array(e0[:3]) + 3 * (1 - q) ** 2 * q * p1 + 3 * (1 - q) * q * q * p2 + q ** 3 * np.array(p3)
            pts.append((b[0], b[1], b[2], 1.0 - q, None))
        n_collar = len(pts)
        # down the slot
        for a in np.linspace(a_eye, a_end, 15)[1:]:
            c = cmid(a) + sgn * gap(a)
            pts.append((a, c, over(a, c) or pts[-1][2], 0.0, None))
        n_slot = len(pts)
        # round the slot's end to the middle, then on down the top of the foot (the upper closed over it)
        for q in np.linspace(0, math.pi / 2, 5)[1:]:
            a, c = a_end + math.sin(q) * g_end, cmid(a_end) + sgn * math.cos(q) * g_end
            if q > math.pi / 2 - 1e-6:
                c = cmid(a)
            pts.append((a, c, over(a, c) or pts[-1][2], 0.0, None))
        a_r1 = toe_a - 0.036 * k
        for a in np.linspace(a_end + g_end, a_r1, 9)[1:]:
            c = cmid(a)
            # (one height for both sides: the highest of the foot across the middle there)
            zs = [x for x in (over(a, cmid(a) + d * k, TOE_ROOM * k * 0.3 * smooth(0.75, 0.95, uo(a))) for d in (-0.008, -0.004, 0, 0.004, 0.008)) if x is not None]
            pts.append((a, c, max(zs) if zs else pts[-1][2], 0.0, None))
        # (the eyestay's and the slot's edge evened out: the foot's top is felt point by point)
        arr = np.array([p[:3] for p in pts])
        lo_ = n_collar - 9
        arr[lo_:n_slot, 2] = relax_open(arr[lo_:n_slot, 2:3], 3)[:, 0]
        pts = [(arr[q, 0], arr[q, 1], arr[q, 2], pts[q][3], pts[q][4]) for q in range(len(pts))]
        rim_side[sgn] = (pts, n_collar, n_slot)

    # Outline point i <-> rim point: by length between three anchors a side (under the collar's end, past the slot's end, the toe).
    def side_ids(sgn):
        return list(range(0, H + 1)) if sgn > 0 else [0] + list(range(N - 1, H - 1, -1))

    T = [None] * N       # (a, c, z)
    Tw = [0.0] * N       # how much it is the collar (1) or the eyestay (0)
    Tr = [None] * N      # the sock's reach there (collar points)
    Tkind = [0] * N      # 0 collar and eyestay, 1 the closed forefoot
    for sgn in (1, -1):
        pts, n_collar, n_slot = rim_side[sgn]
        ids = side_ids(sgn)
        oa = [U[i, 0] for i in ids]
        if sgn > 0:  # (the inside takes the outside's: the forefoot's top row is one row, shared)
            iA = next(q for q, a in enumerate(oa) if a >= pts[n_collar - 9][0] - 0.004 * k)
            iB = next(q for q, a in enumerate(oa) if a >= a_end + 0.02 * k)
            iA = max(6, min(iA, H - 12))
            iB = max(iA + 6, min(iB, H - 4))
        P = np.array([p[:3] for p in pts])
        secs = [(0, iA, 0, n_collar - 9), (iA, iB, n_collar - 9, n_slot - 1), (iB, H, n_slot - 1, len(pts) - 1)]
        for q0, q1, p0, p1 in secs:
            seg = resample(P[p0:p1 + 1], q1 - q0 + 1)
            wsrc = np.array([p[3] for p in pts[p0:p1 + 1]])
            rsrc = np.array([p[4] if p[4] is not None else np.nan for p in pts[p0:p1 + 1]])
            segl = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(P[p0:p1 + 1], axis=0), axis=1))])
            want = np.linspace(0, segl[-1], q1 - q0 + 1)
            for q in range(q0, q1 + 1):
                i = ids[q]
                if sgn < 0 and (q == 0 or q == H) and T[i] is not None:
                    continue
                T[i] = tuple(seg[q - q0])
                Tw[i] = float(np.interp(want[q - q0], segl, wsrc))
                rr = float(np.interp(want[q - q0], segl, np.nan_to_num(rsrc, nan=0.0)))
                Tr[i] = rr if rr > 0 else None
                Tkind[i] = 1 if q >= iB else 0
    # (the two sides meet behind the heel and at the toe)
    T[0] = (T[0][0], c_c, T[0][2])
    T[H] = (T[H][0], cmid(T[H][0]), T[H][2])
    Tkind[H] = 1
    for i in range(1, H):
        if Tkind[i] == 1:
            T[N - i], Tkind[N - i] = T[i], 1
    # The foot's top over the forefoot as a cover (the highest within a centimetre: toes are five lumps, and an upper laid on
    # each came out creased).
    HA, HC = np.arange(0.45 * L, toe_a + 0.004, 0.004), np.arange(-0.075, 0.0751, 0.004)
    hf = np.full((len(HA), len(HC)), -1.0)
    for x, a in enumerate(HA):
        for y, c in enumerate(HC):
            t = foot.top(a, mid(min(a, st[j1])) + c, 0.15)
            if t is not None:
                hf[x, y] = t
    hf2 = hf.copy()
    for dx in (-2, -1, 0, 1, 2):
        for dy in (-2, -1, 0, 1, 2):
            if abs(dx) + abs(dy) < 4:
                hf2 = np.maximum(hf2, np.roll(np.roll(hf, dx, axis=0), dy, axis=1))
    # (and evened out: a toe box is one dome, and the dilated lumps still showed as dents between the toes; never under the foot)
    low = float(hf[hf > -0.5].min()) if (hf > -0.5).any() else 0.0
    sm_ = np.where(hf2 > -0.5, hf2, low)
    for _ in range(4):
        pad = np.pad(sm_, 1, mode='edge')
        sm_ = (pad[:-2, 1:-1] + pad[2:, 1:-1] + pad[1:-1, :-2] + pad[1:-1, 2:] + 4 * pad[1:-1, 1:-1]) / 8
    hf2 = np.maximum(sm_, hf)

    def cover(a, c):
        x = int(round((a - HA[0]) / 0.004))
        y = int(round((c - mid(min(a, st[j1])) - HC[0]) / 0.004))
        if x < 0 or y < 0 or x >= len(HA) or y >= len(HC):
            return -1.0
        return float(hf2[x, y])

    # ---------------------------------------------------------------- the upper --------------------------------------------------
    grid = np.zeros((K_UP + 1, N, 3))
    for i in range(N):
        u = uo(U[i, 0])
        cs = U[i, 1] - mid(U[i, 0])
        b = np.array([U[i, 0], U[i, 1], zmt(u, cs) - 0.0004])
        t = np.array(T[i])
        dome = 1.0 - Tw[i] * 0.85 if Tkind[i] == 0 else 1.0
        dome = max(dome, smooth(0.2, 0.5, u) * (1 - Tw[i]))
        for kk in range(K_UP + 1):
            s = kk / K_UP
            ang = s * math.pi / 2
            f = dome * (1 - math.cos(ang) ** 0.72) + (1 - dome) * (s ** 1.7)
            g = dome * (math.sin(ang) ** 0.72) + (1 - dome) * (1 - (1 - s) ** 1.25)
            grid[kk, i] = (b[0] + (t[0] - b[0]) * f, b[1] + (t[1] - b[1]) * f, b[2] + (t[2] - b[2]) * g)

    def clear(passes=1):
        moved = 0
        for kk in range(1, K_UP):
            for i in range(N):
                p = grid[kk, i]
                u = uo(p[0])
                want = (CLEAR + TOE_ROOM * 0.35 * smooth(0.78, 0.95, u)) * k
                fore = smooth(0.52, 0.64, u)
                if fore > 0:
                    # (the forefoot: lifted over the cover, never pushed sideways)
                    zc_ = cover(p[0], p[1]) + want
                    if p[2] < zc_:
                        grid[kk, i, 2] = p[2] + (zc_ - p[2]) * fore
                        moved += 1
                if fore < 1:
                    q, n, s = foot.near(*grid[kk, i])
                    if s < want and (s > -0.03):
                        t = (q[0] + n[0] * want, q[1] + n[1] * want, max(q[2] + n[2] * want, grid[0, i, 2] + 0.002 * kk))
                        grid[kk, i] = grid[kk, i] * fore + np.array(t) * (1 - fore)
                        moved += 1
        return moved
    # (the collar's shoulder: its last rows stand out round the padding before they turn in to the rim)
    for i in range(N):
        if Tkind[i] == 0 and Tw[i] > 0:
            a, c, _ = T[i]
            d = np.array([a - a_c, c - c_c])
            d /= np.linalg.norm(d) + 1e-9
            for kk, amt in ((K_UP - 1, 0.5), (K_UP - 2, 0.42), (K_UP - 3, 0.2)):
                grid[kk, i, 0] += d[0] * PAD * k * amt * Tw[i]
                grid[kk, i, 1] += d[1] * PAD * k * amt * Tw[i]
    m0 = clear()
    for _ in range(7):
        g2 = grid.copy()
        g2[1:-1] = 0.5 * grid[1:-1] + 0.125 * (grid[:-2] + grid[2:] + np.roll(grid[1:-1], 1, axis=1) + np.roll(grid[1:-1], -1, axis=1))
        grid = g2
        clear()
    say('trainer: upper points moved off the foot', m0, 'of', (K_UP - 1) * N)
    up = []
    for kk in range(K_UP + 1):
        ids = []
        for i in range(N):
            p = grid[kk, i]
            u = uo(U[i, 0])
            h_mid = p[2] - zmt(u, U[i, 1] - mid(U[i, 0]))
            # (how much it goes with the leg: the collar's top 3 cm)
            hd = Tw[i] * smooth(T[i][2] - 0.03 * k, T[i][2], p[2]) * 0.85 if Tkind[i] == 0 else 0.0
            if kk == K_UP and Tkind[i] == 1 and i > H:
                ids.append(None)  # (the forefoot's top row: the outside's vertex, below)
                continue
            ids.append(add(p, W_UPPER + max(0.0, h_mid) * 100, 0.78 + 0.22 * smooth(0, 0.012, h_mid), hd))
        for i in range(H + 1, N):
            if ids[i] is None:
                ids[i] = ids[N - i]
        up.append(ids)
    for kk in range(K_UP):
        for i in range(N):
            j = (i + 1) % N
            if up[kk + 1][i] == up[kk + 1][j]:
                faces.append((up[kk][i], up[kk][j], up[kk + 1][i]))
            else:
                quad(up[kk][i], up[kk][j], up[kk + 1][j], up[kk + 1][i])
    # (the sole's ledge to the upper's foot)
    for i in range(N):
        j = (i + 1) % N
        quad(r8[i], r8[j], up[0][j], up[0][i])
    top = up[K_UP]
    # The opening's edge: the collar's padded roll and its lining on the sock; along the eyestays a folded edge.
    def inward(i):
        a, c, z = T[i]
        if Tw[i] > 0.02:
            d = np.array([a_c - a, c_c - c])
        else:
            d = np.array([0.0, cmid(a) - c])
        n = np.linalg.norm(d)
        return d / n if n > 1e-9 else np.array([0.0, 0.0])

    open_ids = [i for i in range(N) if Tkind[i] == 0]
    e1, e2, e3 = {}, {}, {}
    for i in open_ids:
        a, c, z = T[i]
        w = Tw[i]
        d = inward(i)
        # the roll's crest; the lining's top; the lining 2.4 cm down (on the sock where it is the collar)
        up1, in1 = 0.0036 * w - 0.0012 * (1 - w), 0.003 * w + 0.0016 * (1 - w)
        p1 = (a + d[0] * in1 * k, c + d[1] * in1 * k, z + up1 * k)
        if w > 0.5 and Tr[i]:
            th = math.atan2(c - c_c, -(a - a_c))
            r_top = (reach(th, z + 0.002 * k) or Tr[i]) + 0.0012
            r_low = (reach(th, z - 0.022 * k) or Tr[i]) + 0.0012
            rim_r = math.hypot(a - a_c, c - c_c)
            r_top, r_low = min(r_top, rim_r - 0.004 * k), min(r_low, rim_r - 0.002 * k)
            p2 = (a_c - math.cos(th) * r_top, c_c + math.sin(th) * r_top, z + 0.0015 * k)
            p3 = (a_c - math.cos(th) * r_low, c_c + math.sin(th) * r_low, z - 0.022 * k)
        else:
            in2 = 0.0075 * w + 0.0022 * (1 - w)
            p2 = (a + d[0] * in2 * k, c + d[1] * in2 * k, z + (0.001 * w - 0.0036 * (1 - w)) * k)
            p3 = (a + d[0] * (in2 - 0.004 * (1 - w)) * k, c + d[1] * (in2 - 0.004 * (1 - w)) * k, z - (0.02 * w + 0.008 * (1 - w)) * k)
        hd = w * 0.85
        e1[i] = add(p1, W_LINING if w > 0.5 else where[top[i]], 0.9, hd + 0.1 * w)
        e2[i] = add(p2, W_LINING, 0.62, min(1.0, hd + 0.15 * w))
        e3[i] = add(p3, W_LINING, 0.3, min(1.0, hd + 0.15 * w))
    for i in open_ids:
        j = (i + 1) % N
        if j in e1:
            quad(top[i], top[j], e1[j], e1[i])
            quad(e1[i], e1[j], e2[j], e2[i])
            quad(e2[i], e2[j], e3[j], e3[i])

    # ---------------------------------------------------------------- the tongue -------------------------------------------------
    # Up the instep from under the vamp to the top eyelet, then up the shin over the collar's front; padded, cambered, its
    # edges tucked under the eyestays, its top rolled back onto the sock.
    z_top = z_front + 0.034 * k
    path = []
    for a in np.linspace(a_end + 0.012 * k, a_eye, 12):
        path.append(('foot', a))
    for z in np.linspace(z_front + 0.004 * k, z_top, 6):
        path.append(('shin', z))
    TR = 9
    n_foot_rows = sum(1 for kind_, _ in path if kind_ == 'foot')
    tg = np.zeros((len(path), TR, 3))
    tn = np.zeros((len(path), 3))
    for s, (kind, v) in enumerate(path):
        for r in range(TR):
            x = (r - (TR - 1) / 2) / ((TR - 1) / 2)
            if kind == 'foot':
                a = v
                w_half = gap(max(a, a_eye)) + 0.013 * k
                c = cmid(a) + x * w_half
                t = foot.top(a, c, 0.15)
                if t is None:
                    t = tg[s - 1, r, 2] if s else 0.04
                thick = (0.0035 + 0.0045 * (1 - x * x)) * k * smooth(a_end + 0.012 * k, a_end - 0.01 * k, a) + 0.0012 * k
                tg[s, r] = (a, c, t + SOCK + thick)
                tn[s] = (0, 0, 1)
            else:
                # (up the shin: round the leg's front, by its bearing from the ankle's middle)
                z = v
                w_half = g_top + 0.013 * k + 0.003 * k * smooth(z_front, z_top, z)
                r0 = reach(math.pi, z) or 0.04 * k
                th = math.pi - x * w_half / max(r0, 0.02)
                rr = reach(th, z) or r0
                thick = (0.004 + 0.005 * (1 - x * x)) * k
                tg[s, r] = (a_c - math.cos(th) * (rr + thick), c_c + math.sin(th) * (rr + thick), z)
                tn[s] = (1, 0, 0.2)
    for d in range(3):
        tg[:, :, d] = relax_open(tg[:, :, d], 4)
    say('trainer: tongue off the skin (mm) up its middle', [round(foot.near(*tg[s_, TR // 2])[2] * 1000, 1) for s_ in range(len(path))],
        'top row across', [round(foot.near(*tg[-1, r_])[2] * 1000, 1) for r_ in range(TR)], 'shin rows from', n_foot_rows)
    tid = []
    for s in range(len(path)):
        row = []
        for r in range(TR):
            x = abs((r - (TR - 1) / 2) / ((TR - 1) / 2))
            p = tg[s, r]
            u = uo(p[0])
            hd = smooth(z_front - 0.02 * k, z_front + 0.01 * k, p[2])
            row.append(add(p, W_TONGUE + max(0.0, p[2] - zmt(u, 0)) * 100, 0.95 - 0.35 * smooth(0.55, 1.0, x), hd))
        tid.append(row)
    for s in range(len(path) - 1):
        for r in range(TR - 1):
            quad(tid[s][r], tid[s + 1][r], tid[s + 1][r + 1], tid[s][r + 1])
    # (its top rolled back, and its sides turned under)
    back_top = []
    for r in range(TR):
        p = tg[-1, r]
        q = (p[0] - 0.007 * k, p[1], p[2] + 0.003 * k)
        m = (p[0] - 0.003 * k, p[1], p[2] + 0.0045 * k)
        i1 = add(m, W_TONGUE + 12, 0.85, 1.0)
        i2 = add(q, W_TONGUE + 12, 0.6, 1.0)
        back_top.append((i1, i2))
    for r in range(TR - 1):
        quad(tid[-1][r], back_top[r][0], back_top[r + 1][0], tid[-1][r + 1])
        quad(back_top[r][0], back_top[r][1], back_top[r + 1][1], back_top[r + 1][0])

    # ---------------------------------------------------------------- the laces --------------------------------------------------
    # (heights from what was made: the tongue's own middle line, the slot's own edges)
    n_foot = sum(1 for kind, _ in path if kind == 'foot')
    ta, tz = tg[:n_foot, TR // 2, 0][::-1], tg[:n_foot, TR // 2, 2][::-1]
    edge = {}
    for sgn in (1, -1):
        pts, n_collar, n_slot = rim_side[sgn]
        e = np.array([p[:3] for p in pts[n_collar - 1:n_slot]])
        edge[sgn] = (e[:, 0], e[:, 2])

    def tongue_z(a):
        return float(np.interp(a, ta, tz))

    def eyelet(kk, sgn):
        a = a_eye + 0.006 * k + kk * (a_end - a_eye - 0.012 * k) / (EYELETS - 1)
        c = cmid(a) + sgn * (gap(a) + EYE_OUT * k)
        z = float(np.interp(a, *edge[sgn])) + LACE_T * k
        return np.array([a, c, z])

    def tube(pts, radius, sides=6, cap=True, w=W_LACE, flat=None):
        pts = np.asarray(pts, dtype=float)
        rings_ = []
        prev_n = None
        for q in range(len(pts)):
            t = pts[min(q + 1, len(pts) - 1)] - pts[max(q - 1, 0)]
            t /= np.linalg.norm(t) + 1e-12
            ref = np.array([0.0, 0.0, 1.0]) if abs(t[2]) < 0.9 else np.array([1.0, 0.0, 0.0])
            n1 = np.cross(t, ref)
            n1 /= np.linalg.norm(n1)
            if prev_n is not None and np.dot(n1, prev_n) < 0:
                n1 = -n1
            prev_n = n1
            n2 = np.cross(t, n1)
            ids = []
            for s in range(sides):
                ang = 2 * math.pi * s / sides
                ids.append(add(pts[q] + (n1 * math.cos(ang) * radius + n2 * math.sin(ang) * (flat if flat is not None else radius)), w, 1.0, 0.0))
            rings_.append(ids)
        for q in range(len(pts) - 1):
            for s in range(sides):
                s2 = (s + 1) % sides
                quad(rings_[q][s], rings_[q][s2], rings_[q + 1][s2], rings_[q + 1][s])
        if cap:
            for ids, p in ((rings_[0], pts[0]), (rings_[-1], pts[-1])):
                cidx = add(p, w, 1.0, 0.0)
                for s in range(sides):
                    faces.append((ids[s], ids[(s + 1) % sides], cidx))
        return rings_

    def arc(p0, p1, lift):
        m = (p0 + p1) / 2
        m[2] = max(m[2], tongue_z(m[0]) + (LACE_T + 0.0012) * k) + lift
        out = []
        for q in np.linspace(0, 1, 7):
            out.append((1 - q) ** 2 * p0 + 2 * (1 - q) * q * (2 * m - (p0 + p1) / 2) + q * q * p1)
        # (the ends dip into their eyelets)
        out[0] = out[0] - np.array([0, 0, 0.0012 * k])
        out[-1] = out[-1] - np.array([0, 0, 0.0012 * k])
        return out

    R, RT = LACE_W * k, LACE_T * k
    for kk in range(EYELETS - 1):
        tube(arc(eyelet(kk, 1), eyelet(kk + 1, -1), 0.0004 * k), R, flat=RT)
        tube(arc(eyelet(kk, -1), eyelet(kk + 1, 1), 0.0026 * k), R, flat=RT)
    tube(arc(eyelet(EYELETS - 1, 1), eyelet(EYELETS - 1, -1), 0.0), R, flat=RT)
    # The bow, at the top eyelets: a knot over the tongue, a loop falling to each side, two ends.
    a_k = a_eye + 0.001 * k
    knot = np.array([a_k, cmid(a_k), tongue_z(a_k) + 0.0035 * k])
    for sgn in (1, -1):
        tube(arc(eyelet(0, sgn), knot + np.array([0, sgn * 0.002 * k, 0]), 0.001 * k)[:6], R, flat=RT)
        loop = []
        for q in np.linspace(0, 2 * math.pi, 15):
            out_c = 0.5 * (1 - math.cos(q))
            a = knot[0] + (0.012 * math.sin(q) + 0.010 * out_c) * k
            c = knot[1] + sgn * (0.034 * out_c + 0.002) * k
            base_z = over(a, c)
            z = max(base_z if base_z is not None else knot[2] - 0.012 * k, tongue_z(a) - 0.004 * k * out_c) + (0.0022 + 0.002 * (1 - out_c)) * k
            z = knot[2] * (1 - out_c) ** 2 + z * (1 - (1 - out_c) ** 2)
            loop.append((a, c, z))
        tube(loop, R * 0.8, cap=False, flat=RT * 1.2)
        end = []
        for q in np.linspace(0, 1, 6):
            a = knot[0] + (0.004 + 0.034 * q) * k
            c = knot[1] + sgn * (0.004 + 0.016 * q + 0.012 * q * q) * k
            base_z = over(a, c)
            z = (base_z if base_z is not None else tongue_z(a)) + 0.002 * k
            z = knot[2] * (1 - q) + z * q
            end.append((a, c, z))
        tube(end, R * 0.8, flat=RT * 1.2)
    kn = [knot + np.array([0, -0.0042 * k, 0]), knot + np.array([0, -0.002 * k, 0.0008 * k]), knot + np.array([0, 0.002 * k, 0.0008 * k]), knot + np.array([0, 0.0042 * k, 0])]
    tube(kn, R * 1.15, flat=RT * 2.6)

    co_a = np.array(co)
    fit = {'length': float(SL), 'laceFrom': float(uo(a_eye)), 'laceTo': float(uo(a_end)), 'k': float(SL / 0.285),
           'gapFrom': float(g_top), 'gapTo': float(g_end), 'eyelets': float(EYE_OUT * k), 'modelled': True}
    along = (co_a[:, 0] - heel_a) / SL
    across = co_a[:, 1] - np.array([mid(a) for a in np.clip(co_a[:, 0], st[j0], st[j1])])
    say('trainer:', len(co), 'vertices', len(faces), 'faces; laces', round(a_eye * 100, 1), 'to', round(a_end * 100, 1), 'cm; collar at',
        [round(z * 100, 1) for z in (z_back, z_side, z_front)], 'cm over the bare sole; tongue to', round(z_top * 100, 1))
    return {'co': co_a, 'faces': faces, 'where': np.array(where), 'ao': np.array(ao), 'hold': np.array(hold), 'along': along,
            'across': across, 'fit': fit, 'lowest': float(co_a[:, 2].min())}
