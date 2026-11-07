# The cuts a player can choose (M5 phase C step 3b: data/cosmetics.json `paint` items of the top, bottom and socks slots), each
# built here on the body it goes on, as the modelled tank, collar and skirt are (person_kit.py); finish-player.py exports them all
# in the one mesh and the game draws the ones a player wears (src/render/avatar/wardrobe.ts). The skin under every garment
# stays: each skin vertex carries a mask of the pieces that hide it (`hide_masks`), so whatever is worn, the skin it leaves
# bare is there and the skin it covers isn't drawn.
#
# - Tops: the suit's shirt, cut and fitted as the modelled ones are (person_face.fit_suit), so they hang alike. A tank and a
#   sleeveless shirt are cut along a plane and their armholes laid on the skin (person_kit.hug_armholes); a V-neck is a tee
#   whose chest lies on the skin round the V (the game cuts the V itself and draws its rib, kit.ts); long sleeves carry a
#   tee's sleeves on down the arm in rings that close to a cuff at the wrist. The polo's collar goes with the modelled tee.
# - Tights: rings round each leg on the skin, from inside the shorts' hem into the shoe.
# - Socks: shoes05's own crew tube; an ankle sock is it cut low with a rib at the top; a knee sock carries it on up the shin.
# Generated cloth (the sleeves past a tee's hem, the tights) has no texels in the suit's atlas: its baked occlusion goes in its
# UVs, as a place along a grey ramp in the atlas (finish-player.py RECT 'ramp'), u + 2 marking it until the export.
import math
import bpy, bmesh
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

import person_kit as kit
import person_face as face

P = 'mixamorig:'
N_BODY = kit.N_BODY
# Piece ids (the export's per-vertex `piece`; bit i of a skin vertex's `hide` is piece i). 'body' is always drawn (skin, eyes,
# mouth, a modelled head piece), and so is the shoe.
PIECES = ('body', 'shoe', 'tee', 'tank', 'sleeveless', 'vneck', 'long', 'collar', 'shorts', 'skirt', 'tights', 'crew', 'ankle', 'knee')
TOPS = ('tee', 'tank', 'sleeveless', 'vneck', 'long')
SOCKS = ('crew', 'ankle', 'knee')
# How far out the suit stands off the skin once fitted (finish-player.py pushes the suit the same).
PUSH = 0.003
# A sleeveless shirt's armhole: from the shoulder's end down to under the arm (m from the shoulder joint, out and up), as
# person_kit.cut_tank's tank (-0.035, 0.07) to (-0.01, -0.15). kit.ts sleevelessCut draws its binding on the same plane.
SLEEVELESS = ((0.018, 0.05), (-0.004, -0.16))
# A V-neck: its point under the Neck joint, and how fast it rises to the sides (m per m); kit.ts VNECK_DROP, VNECK_SLOPE.
VNECK_DROP = {False: 0.15, True: 0.135}
VNECK_SLOPE = 2.0
VNECK_HUG = 0.045
# Rings: their spacing along a limb (m); cloth off the skin at a long sleeve's cuff, round the forearm, on a sock, tights (m).
RING = 0.018
CUFF_EASE = 0.0025
FOREARM_EASE = 0.005
SOCK_EASE = 0.0022
CREW_MIN = 0.0024
TIGHTS_EASE = 0.0012
# A turned edge's thickness and depth (m): the cloth folds back in at a cuff or a sock's top.
TURN_IN = 0.0018
TURN_BACK = 0.011
# Where things end: the long sleeve's cuff short of the wrist joint; an ankle sock's top over the shoe's; a knee sock's under
# the knee joint; the tights' top inside the shorts' hem, their foot inside the shoe (m).
CUFF_BACK = 0.012
ANKLE_UP = 0.032
ANKLE_RIB = 0.012
KNEE_DOWN = 0.07
KNEE_RIB = 0.025
TIGHTS_IN = 0.05
TIGHTS_SHOE = 0.012


# ---------------------------------------------------------------------------------------------------------------- helpers
def skin_tree(body):
    return BVHTree.FromPolygons([v.co.copy() for v in body.data.vertices],
                                [tuple(p.vertices) for p in body.data.polygons if max(p.vertices) < N_BODY])


def new_object(name, like):
    me = bpy.data.meshes.new(name)
    o = bpy.data.objects.new(name, me)
    for coll in like.users_collection:
        coll.objects.link(o)
    return o


def copy_of(src, name, keep=None):
    """A copy of `src` (mesh, groups, modifiers); `keep(poly) -> bool` drops the rest of its faces."""
    o = src.copy()
    o.data = src.data.copy()
    o.name = name
    o.data.name = name
    for coll in src.users_collection:
        coll.objects.link(o)
    if keep is not None:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bm.faces.ensure_lookup_table()
        flags = [keep(p) for p in o.data.polygons]
        bmesh.ops.delete(bm, geom=[f for f, k in zip(bm.faces, flags) if not k], context='FACES')
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
        bm.to_mesh(o.data)
        bm.free()
        o.data.update()
    return o


def push(o, d=PUSH):
    o.data.update()
    for v in o.data.vertices:
        v.co += v.normal * d
    o.data.update()


class SkinWeights:
    """The skin's own weights at a point, from its nearest vertices by inverse square distance, among those on `bones`
    (a vertex alone jumps between triangles; one near the armpit or the crotch must not take the trunk's or the other leg's)."""

    def __init__(self, body):
        self.body = body
        self.names = {g.index: g.name for g in body.vertex_groups}
        self.dom = kit._dominant_bones(body)
        self.trees = {}

    def tree(self, ok):
        key = ok.__name__ if hasattr(ok, '__name__') else id(ok)
        if key not in self.trees:
            ids = [i for i, d in enumerate(self.dom) if ok(d, self.body.data.vertices[i].co)]
            kd = KDTree(len(ids))
            for i in ids:
                kd.insert(self.body.data.vertices[i].co, i)
            kd.balance()
            self.trees[key] = kd
        return self.trees[key]

    def at(self, p, ok):
        out, total = {}, 0.0
        found = self.tree(ok).find_n(Vector(p), 4)
        if not found:
            raise ValueError(f'no skin for {ok.__name__}')
        for _, i, d in found:
            s = 1 / max(d, 0.002) ** 2
            total += s
            for e in self.body.data.vertices[i].groups:
                n = self.names.get(e.group, '')
                if n.startswith(P):
                    out[n] = out.get(n, 0.0) + e.weight * s
        return {n: w / total for n, w in out.items()}

    def bind(self, o, ids, pts, ok):
        for i, p in zip(ids, pts):
            for g in o.vertex_groups:
                if g.name.startswith(P):
                    g.remove([i])
            for n, w in self.at(p, ok).items():
                (o.vertex_groups.get(n) or o.vertex_groups.new(name=n)).add([i], w, 'REPLACE')


def limb_ok(side, lr, parts):
    """A predicate for SkinWeights: skin on this side (x's sign) whose main bone is one of `parts` (Arm, ForeArm, UpLeg...) of
    the `lr` ('Left' or 'Right') limb."""
    def ok(d, co):
        return co.x * side > 0 and any(d == lr + p for p in parts)
    ok.__name__ = f'{side}:{lr}:{",".join(parts)}'
    return ok


class Axis:
    """A limb's bones as a polyline (joint heads), by arc length, with frames carried along it."""

    def __init__(self, pts):
        self.p = [Vector(x) for x in pts]
        self.len = [0.0]
        for a, b in zip(self.p, self.p[1:]):
            self.len.append(self.len[-1] + (b - a).length)

    @property
    def total(self):
        return self.len[-1]

    def at(self, s):
        s = min(max(s, 0.0), self.total)
        for k in range(len(self.p) - 1):
            if s <= self.len[k + 1] or k == len(self.p) - 2:
                t = (s - self.len[k]) / max(1e-9, self.len[k + 1] - self.len[k])
                return self.p[k].lerp(self.p[k + 1], t)

    def tangent(self, s, blend=0.04):
        """Unit direction, eased between segments over `blend` either side of a joint."""
        def seg(k):
            return (self.p[k + 1] - self.p[k]).normalized()
        s = min(max(s, 0.0), self.total)
        for k in range(len(self.p) - 1):
            if s <= self.len[k + 1] or k == len(self.p) - 2:
                t = seg(k)
                if k + 1 < len(self.p) - 1 and s > self.len[k + 1] - blend:
                    u = (s - (self.len[k + 1] - blend)) / (2 * blend)
                    t = t.lerp(seg(k + 1), u)
                if k > 0 and s < self.len[k] + blend:
                    u = (s - (self.len[k] - blend)) / (2 * blend)
                    t = seg(k - 1).lerp(t, u)
                return t.normalized()

    def project(self, q):
        """Arc length of the point on the axis nearest `q`."""
        best, bs = 1e9, 0.0
        for k in range(len(self.p) - 1):
            a, b = self.p[k], self.p[k + 1]
            ab = b - a
            t = max(0.0, min(1.0, (q - a).dot(ab) / max(1e-12, ab.length_squared)))
            d = (a + ab * t - q).length
            if d < best:
                best, bs = d, self.len[k] + t * ab.length
        return bs

    def carry(self, u, s0, s1):
        """Direction `u` (square to the axis at s0) carried to s1: turned as the axis turns."""
        t0, t1 = self.tangent(s0), self.tangent(s1)
        v = t0.rotation_difference(t1) @ u
        v = v - t1 * v.dot(t1)
        return v.normalized()


def joint(rig, n):
    return rig.data.bones[P + n].head_local.copy()


def side_of(rig):
    """+1 if the Left bones are at +x."""
    return 1.0 if joint(rig, 'LeftArm').x > 0 else -1.0


def skin_at(skin, a, u, far=0.25):
    """Distance from the axis point `a` out along `u` to the skin (its first surface)."""
    hit = skin.ray_cast(a, u, far)
    return (hit[0] - a).length if hit[0] is not None else None


def boundary_loops(bm, faces=None):
    """The open edges' loops, each as an ordered list of BMVerts."""
    edges = [e for e in bm.edges if e.is_boundary and (faces is None or e.link_faces[0] in faces)]
    nb = {}
    for e in edges:
        a, b = e.verts
        nb.setdefault(a, []).append(b)
        nb.setdefault(b, []).append(a)
    seen, loops = set(), []
    for v0 in nb:
        if v0 in seen:
            continue
        loop, prev, v = [v0], None, v0
        seen.add(v0)
        while True:
            nxt = [w for w in nb[v] if w is not prev and w not in seen]
            if not nxt:
                break
            prev, v = v, nxt[0]
            seen.add(v)
            loop.append(v)
        loops.append(loop)
    return loops


def extend_loop(bm, loop, axis, skin, s_end, ease, rib=0.0, rib_len=0.0, turn=True, uv=None):
    """
    Carries an open edge loop on along a limb in rings to `s_end` (arc length on `axis`), each column keeping its bearing
    round the limb, laid `ease(f, s, e0)` off the skin (f: 0 at the loop, 1 at the end; e0 the column's standoff at the loop);
    the last `rib_len` stands `rib` further out, and the end is turned back in (`turn`). New faces wind as the faces they
    join, and take `uv(f)` per corner if given (the ramp), else (0, 0). Returns the new BMVerts.
    """
    uvl = bm.loops.layers.uv.active
    n = len(loop)
    closed = bm.edges.get((loop[0], loop[-1])) is not None
    # The faces joined wind the other way along the loop's edges.
    flip = False
    e = bm.edges.get((loop[0], loop[1]))
    if e is not None and e.link_faces:
        for l in e.link_faces[0].loops:
            if l.vert is loop[0]:
                flip = l.link_loop_next.vert is loop[1]
    cols = []
    for v in loop:
        q = v.co.copy()
        s0 = axis.project(q)
        a = axis.at(s0)
        t = axis.tangent(s0)
        off = q - a
        off = off - t * off.dot(t)
        u = off.normalized()
        r = skin_at(skin, a, u)
        cols.append((s0, u, max(off.length - r, 0.0) if r is not None else 0.01))
    s_start = sum(c[0] for c in cols) / n
    J = max(1, int(math.ceil(abs(s_end - s_start) / RING)))
    rings, fs, new = [list(loop)], [0.0], []
    last_e = [0.0] * n
    for j in range(1, J + 1):
        f = j / J
        ring = []
        for k, (s0, u0, e0) in enumerate(cols):
            s = s0 + (s_end - s0) * f
            a = axis.at(s)
            u = axis.carry(u0, s0, s)
            r = skin_at(skin, a, u)
            e = ease(f, s, e0) + (rib if rib and abs(s_end - s) < rib_len else 0.0)
            last_e[k] = e
            v = bm.verts.new(a + u * ((r if r is not None else 0.04) + e))
            ring.append(v)
        new += ring
        rings.append(ring)
        fs.append(f)
    if turn:
        back = s_end - math.copysign(TURN_BACK, s_end - s_start)
        t1, t2 = [], []
        for k, (s0, u0, e0) in enumerate(cols):
            u = axis.carry(u0, s0, s_end)
            t1.append(bm.verts.new(rings[-1][k].co - u * TURN_IN))
            a2, u2 = axis.at(back), axis.carry(u0, s0, back)
            r2 = skin_at(skin, a2, u2)
            r2 = r2 if r2 is not None else 0.04
            t2.append(bm.verts.new(a2 + u2 * (r2 + max(0.0006, last_e[k] - TURN_IN))))
        new += t1 + t2
        rings += [t1, t2]
        fs += [1.0, 1.0]
    f_of = {}
    for r, f in zip(rings, fs):
        for v in r:
            f_of.setdefault(v, f)
    for j in range(len(rings) - 1):
        A, B = rings[j], rings[j + 1]
        for k in range(n if closed else n - 1):
            k2 = (k + 1) % n
            quad = (A[k], B[k], B[k2], A[k2]) if flip else (A[k], A[k2], B[k2], B[k])
            if len(set(quad)) < 4:
                continue
            try:
                face_ = bm.faces.new(quad)
            except ValueError:
                continue
            if uvl is not None:
                for l in face_.loops:
                    l[uvl].uv = uv(f_of[l.vert]) if uv else (0.0, 0.0)
    return new


def ramp_uv(f):
    """A spot on the grey ramp (u + 2 marks it; the AO bake sets where along it later)."""
    return (2.5, 2.1 + 0.8 * f)


# ---------------------------------------------------------------------------------------------------------------- tops
def shirt_only(suit, women, name):
    flags = face.shirt_polygons(suit.data, women)
    i = iter(flags)
    return copy_of(suit, name, keep=lambda p: next(i))


def cut_sleeves(o, planes, floor):
    """
    Each sleeve off on its plane (a, outward normal): what lies past the plane and reaches over `floor` (the armhole's bottom,
    z). A sleeveless shirt's plane leans in under the arm, and past it, well down, lie the shirt's sides at the waist: cut there
    too, they opened a slit each side, and the shader's cut under the armhole took the skin behind it (a way through four of the
    men, kit.test, 7 Nov). Those stay. Returns the faces taken off and kept past each plane.
    """
    bm = bmesh.new()
    bm.from_mesh(o.data)
    counts = []
    for a, no in planes:
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=a, plane_no=no)
        order = [f for f in bm.faces if (f.calc_center_median() - a).dot(no) > 0]
        past = set(order)
        seen, doomed, kept = set(), [], 0
        for f in order:
            if f in seen:
                continue
            seen.add(f)
            part, stack = [f], [f]
            while stack:
                for e in stack.pop().edges:
                    for g in e.link_faces:
                        if g in past and g not in seen:
                            seen.add(g)
                            part.append(g)
                            stack.append(g)
            if max(v.co.z for g in part for v in g.verts) > floor:
                doomed += part
            else:
                kept += len(part)
        counts.append((len(doomed), kept))
        bmesh.ops.delete(bm, geom=doomed, context='FACES_ONLY')
        bmesh.ops.delete(bm, geom=[e for e in bm.edges if not e.link_faces], context='EDGES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(o.data)
    bm.free()
    o.data.update()
    return counts


def armhole_planes(rig, pts):
    arm = joint(rig, 'LeftArm')
    x0, z0 = abs(arm.x), arm.z
    (ax, az), (bx, bz) = pts
    out = []
    for side in (1, -1):
        a = Vector((side * (x0 + ax), 0, z0 + az))
        b = Vector((side * (x0 + bx), 0, z0 + bz))
        no = Vector((0, 1, 0)).cross((b - a).normalized()) * side
        if no.x * side < 0:
            no = -no
        out.append((a, no))
    return out


def fit(o, body, rig, women, spec, hang_from=None):
    face.fit_suit(body, o, joint(rig, 'Hips').z, joint(rig, 'LeftArm').z, women, seed=sum(ord(c) for c in spec['name']),
                  folds=spec.get('kit', {}).get('bottom', 'shorts') == 'shorts', hang_from=hang_from)


def make_tops(body, raw, rig, spec, women, modelled, base):
    """
    Every top but the modelled one (`base`, the suit itself), from `raw` (the suit's shirt as MakeHuman fitted it, before any of
    this body's own fitting). Returns {name: object}.
    """
    skin = skin_tree(body)
    sw = SkinWeights(body)
    out = {}
    if modelled in ('tee', 'polo'):
        tee_copy = lambda name: shirt_only(base, women, name)
    else:
        tee = copy_of(raw, 'Wear.tee')
        fit(tee, body, rig, women, spec)
        push(tee)
        out['tee'] = tee
        tee_copy = lambda name: copy_of(tee, name)
    if modelled != 'tank':
        o = copy_of(raw, 'Wear.tank')
        planes = kit.cut_tank(o, body, rig, women, [True] * len(o.data.polygons))
        fit(o, body, rig, women, spec, hang_from=face.HANG_FROM_TANK)
        push(o)
        kit.hug_armholes(o, body, planes, women)
        out['tank'] = o
    o = copy_of(raw, 'Wear.sleeveless')
    planes = armhole_planes(rig, SLEEVELESS)
    floor = joint(rig, 'LeftArm').z + SLEEVELESS[1][1]
    print('WEAR sleeveless faces off, kept past the plane', cut_sleeves(o, planes, floor))
    fit(o, body, rig, women, spec, hang_from=face.HANG_FROM_TANK)
    push(o)
    kit.hug_armholes(o, body, planes, women, floor=floor - 0.02)
    out['sleeveless'] = o
    out['vneck'] = make_vneck(body, tee_copy('Wear.vneck'), rig, women, skin)
    out['long'] = make_long(body, tee_copy('Wear.long'), rig, skin, sw)
    for k, o in out.items():
        print('WEAR', k, len(o.data.vertices), 'vertices', len(o.data.polygons), 'faces')
    return out


def vneck_field(rig, women):
    """How far above the V's line a point is (m, the front only matters): its edge is the zero."""
    nk = joint(rig, 'Neck')
    drop = VNECK_DROP[women]
    return lambda c: c.z - (nk.z - drop + VNECK_SLOPE * abs(c.x - nk.x))


def make_vneck(body, o, rig, women, skin):
    """A tee (a copy, `o`) whose chest lies on the skin round the V, so the V's edge (cut in the game) has no gap under it; what
    is well inside the V goes."""
    me = o.data
    nk = joint(rig, 'Neck')
    field = vneck_field(rig, women)
    k = math.sqrt(1 + VNECK_SLOPE ** 2)
    front = lambda c: c.y < nk.y - 0.01 and abs(c.x - nk.x) < 0.16  # (the model faces -y)
    moved = 0
    for v in me.vertices:
        c = v.co
        if not front(c):
            continue
        d = field(c) / k  # signed distance across the V's edge, + inside it
        if d < -VNECK_HUG:
            continue
        w = 1.0 if d > 0 else (1 + d / VNECK_HUG) ** 2
        q, n, _, _ = skin.find_nearest(c)
        if q is None:
            continue
        v.co = c.lerp(q + n * (PUSH * 0.8), w)
        moved += 1
    bm = bmesh.new()
    bm.from_mesh(me)
    dead = [f for f in bm.faces if all(front(v.co) and field(v.co) / k > 0.03 for v in f.verts)]
    bmesh.ops.delete(bm, geom=dead, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(me)
    bm.free()
    me.update()
    print('VNECK chest on the skin:', moved, 'vertices;', len(dead), 'faces inside the V out')
    return o


def make_long(body, o, rig, skin, sw):
    """A tee (a copy, `o`) with its sleeves carried on to cuffs at the wrists: rings round each forearm, easing from the
    sleeve's own hang to a close cuff, the cuff turned in."""
    me = o.data
    bm = bmesh.new()
    bm.from_mesh(me)
    if bm.loops.layers.uv.active is None:
        bm.loops.layers.uv.new('uv')
    x0 = abs(joint(rig, 'LeftArm').x)
    zs = joint(rig, 'LeftArm').z
    side0 = side_of(rig)
    loops = [l for l in boundary_loops(bm) if abs(sum(v.co.x for v in l) / len(l)) > x0 + 0.04 and sum(v.co.z for v in l) / len(l) < zs]
    added = []
    for loop in loops:
        sx = 1.0 if sum(v.co.x for v in loop) > 0 else -1.0
        lr = 'Left' if sx == side0 else 'Right'
        axis = Axis([joint(rig, lr + 'Arm'), joint(rig, lr + 'ForeArm'), joint(rig, lr + 'Hand')])
        s_end = axis.total - CUFF_BACK

        def ease(f, s, e0, s_end=s_end):
            # From the sleeve's own hang to a forearm's ease by halfway, closing to the cuff over the last 6 cm.
            u = min(1.0, f * 2.0)
            u = u * u * (3 - 2 * u)
            c = min(1.0, max(0.0, (s - (s_end - 0.06)) / 0.06))
            return (e0 * (1 - u) + FOREARM_EASE * u) * (1 - c) + CUFF_EASE * c
        new = extend_loop(bm, loop, axis, skin, s_end, ease, rib=0.0006, rib_len=0.016, uv=ramp_uv)
        added.append((new, limb_ok(sx, lr, ('Arm', 'ForeArm', 'Hand'))))
    bm.to_mesh(me)
    bm.free()
    me.update()
    # (new vertices are the last ones in the mesh, in the order they were made)
    n_new = sum(len(a[0]) for a in added)
    first = len(me.vertices) - n_new
    i = first
    for new, ok in added:
        ids = list(range(i, i + len(new)))
        sw.bind(o, ids, [me.vertices[j].co.copy() for j in ids], ok)
        i += len(new)
    me.update()
    print('LONG sleeves:', len(loops), 'cuffs,', n_new, 'vertices added')
    return o


# ---------------------------------------------------------------------------------------------------------------- legs
def split_crew(shoe, name='Wear.crew'):
    """shoes05's crew sock is a loose tube per foot: moved out of the shoe into a piece of its own."""
    me = shoe.data
    par = list(range(len(me.vertices)))

    def find(a):
        while par[a] != a:
            par[a] = par[par[a]]
            a = par[a]
        return a
    for e in me.edges:
        par[find(e.vertices[0])] = find(e.vertices[1])
    top = {}
    for v in me.vertices:
        r = find(v.index)
        top[r] = max(top.get(r, -1), v.co.z)
    hi = max(top.values())
    sock_roots = {r for r, z in top.items() if z > hi - 0.03}
    is_sock = lambda p: find(p.vertices[0]) in sock_roots
    flags = [is_sock(p) for p in me.polygons]
    crew = copy_of(shoe, name, keep=(lambda it: lambda p: next(it))(iter(flags)))
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f, s in zip(bm.faces, flags) if s], context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(me)
    bm.free()
    me.update()
    # (never closer to the skin than CREW_MIN above the shoe, so tights fit under it)
    from mathutils.bvhtree import BVHTree as _B
    body = next(o for o in bpy.data.objects if o.name == 'Human')
    skin = skin_tree(body)
    top_shoe = shoe_top(shoe)
    pushed = 0
    for v in crew.data.vertices:
        if v.co.z < top_shoe - 0.04:
            continue
        q, n, _, d = skin.find_nearest(v.co)
        if q is not None and (v.co - q).dot(n) < CREW_MIN:
            v.co = q + n * CREW_MIN
            pushed += 1
    crew.data.update()
    zs = [v.co.z for v in crew.data.vertices]
    print('CREW sock tubes', len(sock_roots), 'vertices', len(crew.data.vertices), 'z', round(min(zs), 3), round(max(zs), 3), '; pushed out to', CREW_MIN, ':', pushed)
    return crew


def shoe_top(shoe):
    return max(v.co.z for v in shoe.data.vertices)


LEG = ('UpLeg', 'Leg', 'Foot', 'ToeBase')


def skin_shell(body, rig, name, z_lo, z_hi, ease, outer=(), rib=0.0, rib_len=0.0, turn=False, uv=None):
    """
    The legs' own skin from z_lo to z_hi, cut level at both, laid `ease` out along its normals (`rib` more over the top
    `rib_len`): cloth that follows the leg exactly and moves with it as the skin does (the skin's own weights; a ring of
    columns round the leg cut under the shin's edge between them, and the skin came through in streaks). It stays a millimetre and
    a half under `outer` (the shoe's lining; the crew sock, over tights). `turn`: the top folded back in. `uv(f)`: per corner, f 0 at the top to 1 at the foot.
    """
    o = body.copy()
    o.data = body.data.copy()
    o.name = o.data.name = name
    for coll in body.users_collection:
        coll.objects.link(o)
    if o.data.shape_keys:
        o.shape_key_clear()
    dom = kit._dominant_bones(body)
    leg = [any(d.endswith(x) for x in LEG) for d in dom]
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.verts.ensure_lookup_table()
    dead = [f for f in bm.faces if not all(v.index < N_BODY and leg[v.index] for v in f.verts)
            or max(v.co.z for v in f.verts) < z_lo - 0.02 or min(v.co.z for v in f.verts) > z_hi + 0.02]
    bmesh.ops.delete(bm, geom=dead, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    n_old = len(bm.verts)
    old = set(bm.verts)
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, z_hi), plane_no=(0, 0, 1), clear_outer=True)
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, z_lo), plane_no=(0, 0, 1), clear_inner=True)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    made = {v for v in bm.verts if v not in old}
    bm.normal_update()
    skin = skin_tree(body)
    outs = [BVHTree.FromPolygons([v.co.copy() for v in x.data.vertices], [tuple(p.vertices) for p in x.data.polygons]) for x in outer]
    for v in bm.verts:
        e = ease + (rib if v.co.z > z_hi - rib_len else 0.0)
        n = v.normal.copy()
        for t in outs:
            hit = t.ray_cast(v.co + n * 0.0002, n, e + 0.003)
            if hit[0] is not None:
                e = max(0.0003, min(e, (hit[0] - v.co).length - 0.0015))
        v.co = v.co + n * e
    turned = []
    if turn:
        uvl = bm.loops.layers.uv.active
        for loop in boundary_loops(bm):
            if sum(v.co.z for v in loop) / len(loop) < (z_lo + z_hi) / 2:
                continue
            flip = False
            ed = bm.edges.get((loop[0], loop[1]))
            if ed is not None and ed.link_faces:
                for l in ed.link_faces[0].loops:
                    if l.vert is loop[0]:
                        flip = l.link_loop_next.vert is loop[1]
            t1, t2 = [], []
            for v in loop:
                n = v.normal.copy()
                p1 = v.co - n * TURN_IN
                q, qn, _, _ = skin.find_nearest(p1 - Vector((0, 0, TURN_BACK)))
                p2 = q + qn * 0.0006 if q is not None else p1 - Vector((0, 0, TURN_BACK))
                t1.append(bm.verts.new(p1))
                t2.append(bm.verts.new(p2))
            turned += t1 + t2
            m = len(loop)
            for A, B in ((loop, t1), (t1, t2)):
                for k in range(m):
                    k2 = (k + 1) % m
                    quad = (A[k], B[k], B[k2], A[k2]) if flip else (A[k], A[k2], B[k2], B[k])
                    try:
                        f = bm.faces.new(quad)
                    except ValueError:
                        continue
                    if uvl is not None:
                        for l in f.loops:
                            l[uvl].uv = (0.0, 0.0)
    if uv is not None:
        uvl = bm.loops.layers.uv.active
        for f in bm.faces:
            for l in f.loops:
                l[uvl].uv = uv(min(1.0, max(0.0, (z_hi - l.vert.co.z) / max(1e-6, z_hi - z_lo))))
    elif bm.loops.layers.uv.active is not None:
        uvl = bm.loops.layers.uv.active
        for f in bm.faces:
            for l in f.loops:
                l[uvl].uv = (0.0, 0.0)
    rebind = [v for v in bm.verts if v in made or v in turned]
    pts = [(v.co.copy(), v.co.x) for v in rebind]
    bm.verts.index_update()
    ids = [v.index for v in rebind]
    bm.to_mesh(o.data)
    bm.free()
    o.data.update()
    # Cut and turned vertices are new: they take the skin's weights where they are.
    sw = SkinWeights(body)
    side0 = side_of(rig)
    for i, (p, x) in zip(ids, pts):
        sx = 1.0 if x > 0 else -1.0
        sw.bind(o, [i], [p], limb_ok(sx, 'Left' if sx == side0 else 'Right', LEG))
    for attr in [a.name for a in o.data.attributes if a.name.startswith('mask_') or a.name == 'hide']:
        o.data.attributes.remove(o.data.attributes[attr])
    zs = [v.co.z for v in o.data.vertices]
    print('SHELL', name, len(o.data.vertices), 'vertices from', round(min(zs), 3), 'to', round(max(zs), 3), ';', len(ids), 'rebound')
    return o


def crew_bottom(crew):
    return min(v.co.z for v in crew.data.vertices)


def make_socks(body, crew, shoe, rig):
    """Ankle and knee socks: the leg's skin from where the crew sock starts inside the shoe, a rib at the top, turned in."""
    lo = crew_bottom(crew)
    top_shoe = shoe_top(shoe)
    knee = joint(rig, 'LeftLeg').z
    return {
        'ankle': skin_shell(body, rig, 'Wear.ankle', lo, top_shoe + ANKLE_UP, SOCK_EASE, (shoe,), rib=0.0008, rib_len=ANKLE_RIB, turn=True),
        'knee': skin_shell(body, rig, 'Wear.knee', lo, knee - KNEE_DOWN, SOCK_EASE, (shoe,), rib=0.0008, rib_len=KNEE_RIB, turn=True),
    }


def make_tights(body, rig, hem, shoe, crew):
    """The legs' skin from inside the shorts' hem down into the shoe."""
    return skin_shell(body, rig, 'Wear.tights', crew_bottom(crew), hem + TIGHTS_IN, TIGHTS_EASE, (shoe, crew), uv=ramp_uv)


# ---------------------------------------------------------------------------------------------------------------- skin
SKIN_BAND = 0.025
REACH = 0.03


def covered_by(body, o, polys=None):
    """Skin vertices that see `o` (or those of its polygons) within REACH straight out from them."""
    me = o.data
    tree = BVHTree.FromPolygons([v.co.copy() for v in me.vertices],
                                [tuple(p.vertices) for p in me.polygons if polys is None or polys[p.index]])
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.normal_update()
    out = np.zeros(N_BODY, dtype=bool)
    for v in bm.verts:
        if v.index >= N_BODY:
            break
        if tree.ray_cast(v.co + v.normal * 0.0005, v.normal, REACH)[0] is not None:
            out[v.index] = True
    bm.free()
    return out


def hide_masks(body, cover, mask, union_of, keep_always, keep_in_hem, keep_for=None):
    """
    Per skin vertex, the pieces that hide it (bit = PIECES index). `cover[name]`: skin each piece covers (covered_by); `mask[name]`:
    skin MakeHuman's delete groups give the modelled pieces outright; `union_of[name]`: the pieces whose coverage counts with it
    when finding skin that shows (the modelled pieces of the other slots and the shoe): a covered vertex is hidden only more
    than SKIN_BAND from skin that shows, so the skin just inside a hem stays and looking in never finds a hole. `keep_always`:
    never hidden (behind the collar); `keep_in_hem`: never but by the tights (the thigh inside the shorts' legs); `keep_for[name]`:
    never by that piece.
    """
    co = np.array([body.data.vertices[i].co[:] for i in range(N_BODY)])
    out = np.zeros(N_BODY, dtype=np.uint16)
    for name, cov in cover.items():
        hid = mask.get(name, np.zeros(N_BODY, dtype=bool)).copy()
        under = cov.copy()
        for other in union_of[name]:
            under |= cover[other] | mask.get(other, False)
        under |= mask.get(name, False)
        open_ids = np.nonzero(~under)[0]
        kd = KDTree(len(open_ids))
        for i in open_ids:
            kd.insert(co[i], int(i))
        kd.balance()
        for i in np.nonzero(cov)[0]:
            if kd.find(co[i])[2] > SKIN_BAND:
                hid[i] = True
        hid &= ~keep_always
        if keep_for and name in keep_for:
            hid &= ~keep_for[name]
        if name != 'tights':
            hid &= ~keep_in_hem
        out[hid] |= np.uint16(1 << PIECES.index(name))
        print('HIDE', name, int(hid.sum()), 'skin vertices of', int(cov.sum()), 'covered')
    return out


def rasterize(size, tri_uv, tri_val):
    """Per-vertex values over UV triangles into a size x size image (rows from v = 0), linear across each triangle."""
    img = np.zeros((size, size), dtype=np.float32)
    has = np.zeros((size, size), dtype=bool)
    for (a, b, c), (va, vb, vc) in zip(tri_uv * size, tri_val):
        x0, x1 = int(max(0, math.floor(min(a[0], b[0], c[0])))), int(min(size - 1, math.ceil(max(a[0], b[0], c[0]))))
        y0, y1 = int(max(0, math.floor(min(a[1], b[1], c[1])))), int(min(size - 1, math.ceil(max(a[1], b[1], c[1]))))
        if x1 < x0 or y1 < y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(d) < 1e-12:
            continue
        l1 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / d
        l2 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / d
        l3 = 1 - l1 - l2
        inside = (l1 >= -0.02) & (l2 >= -0.02) & (l3 >= -0.02)
        val = l1 * va + l2 * vb + l3 * vc
        sub = img[y0:y1 + 1, x0:x1 + 1]
        hs = has[y0:y1 + 1, x0:x1 + 1]
        sub[inside] = np.maximum(sub[inside], val[inside])
        hs[inside] = True
    return img, has
