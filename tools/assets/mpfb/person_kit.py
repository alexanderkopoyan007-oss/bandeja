# What a person wears beyond the MakeHuman suit (finish-player.py imports it), and the tape measure.
#
# All of it is generated here, from the body it goes on, so it is ours (CC0): a skirt, a headband or a visor, a polo's
# collar. `spec["kit"]`: {"top": "tee"|"polo"|"tank", "bottom": "shorts"|"pleated"|"aline", "head": null|"band"|"visor",
# "mark": 0..3}. Bones are the rig's, in the modelled pose; the game skeleton's bind goes through the same weights as the
# body's.
import math
import bpy, bmesh
import numpy as np
from mathutils import Vector

P = 'mixamorig:'
N_BODY = 13380  # the first vertices of the body are skin; helpers follow


def _dominant_bones(body):
    """Each body vertex's main bone's name (without the rig's prefix), '' for none."""
    names = {g.index: g.name for g in body.vertex_groups}
    out = []
    for v in body.data.vertices[:N_BODY]:
        best, w = '', 0.0
        for e in v.groups:
            n = names.get(e.group, '')
            if n.startswith(P) and e.weight > w:
                best, w = n[len(P):], e.weight
        out.append(best)
    return out


def _body_co(body):
    a = np.empty(len(body.data.vertices) * 3)
    body.data.vertices.foreach_get('co', a)
    return a.reshape(-1, 3)[:N_BODY]


def _hull(pts):
    """Convex hull of (n, 2) points, in order."""
    p = sorted(set(map(tuple, np.round(pts, 5))))
    if len(p) < 3:
        return np.array(p)
    def half(seq):
        h = []
        for q in seq:
            while len(h) >= 2 and (h[-1][0] - h[-2][0]) * (q[1] - h[-2][1]) - (h[-1][1] - h[-2][1]) * (q[0] - h[-2][0]) <= 0:
                h.pop()
            h.append(q)
        return h
    a, b = half(p), half(p[::-1])
    return np.array(a[:-1] + b[:-1])


def _perimeter(pts):
    if len(pts) < 3:
        return 0.0
    h = _hull(pts)
    return float(np.linalg.norm(h - np.roll(h, 1, axis=0), axis=1).sum())


def _girth(co, at, axis, half=0.008, within=0.3):
    """Tape round the points in the slice through `at` square to `axis` (a tape bridges hollows: the convex hull)."""
    axis = np.asarray(axis) / np.linalg.norm(axis)
    rel = co - at
    h = rel @ axis
    keep = np.abs(h) < half
    r = rel[keep] - np.outer(h[keep], axis)
    r = r[np.linalg.norm(r, axis=1) < within]
    if len(r) < 6:
        return 0.0
    e1 = np.cross(axis, [0.31, 0.17, 0.93])
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(axis, e1)
    return _perimeter(np.stack([r @ e1, r @ e2], axis=1))


def body_build(body, rig, name):
    """The body's measures from the baked mesh (metres), before anything is masked away. A dict; the build prints it."""
    co = _body_co(body)
    dom = np.array(_dominant_bones(body))
    arm = np.array([('Arm' in d or 'Hand' in d) for d in dom])
    j = lambda n: np.array(rig.data.bones[P + n].head_local)
    tail = lambda n: np.array(rig.data.bones[P + n].tail_local)
    floor = 0.0
    top = co[:, 2].max()
    H = top - floor
    mid = np.abs(co[:, 0]) < 0.02
    head_v = np.array([d.startswith('Head') for d in dom])
    # The chin's underside: vertex 747 of the base mesh (its middle line under the chin's tip, found from the profile).
    chin = co[747, 2]
    crotch = co[mid & (np.array([d == 'Hips' or d.endswith('UpLeg') for d in dom])), 2].min()
    torso = co[~arm & ~head_v]
    level = lambda z: _girth(torso, np.array([0, np.median(torso[:, 1]), z]), (0, 0, 1))
    hz = j('Hips')[2]
    zs = np.arange(hz - 0.12, hz + 0.36, 0.01)
    gs = np.array([level(z) for z in zs])
    up = zs > hz + 0.06
    waist_i = np.argmin(np.where(up & (zs < hz + 0.3), gs, 9))
    hip_i = np.argmax(np.where(zs < hz + 0.08, gs, 0))
    chest_z = j('Spine2')[2] + 0.02
    # (the armpit band: the arms' root is in the torso's slice higher up)
    chest = max(level(z) for z in (chest_z - 0.06, chest_z - 0.03, chest_z))
    limb = lambda bone, f, side, within: _girth(co[np.sign(co[:, 0]) == side], j(side_n[side] + bone) + (tail(side_n[side] + bone) - j(side_n[side] + bone)) * f,
                                                 tail(side_n[side] + bone) - j(side_n[side] + bone), within=within)
    side_n = {1.0: 'Left', -1.0: 'Right'}
    s = 1.0 if j('LeftArm')[0] > 0 else -1.0
    thigh = max(limb('UpLeg', f, s, 0.12) for f in (0.2, 0.3, 0.4))
    calf = max(limb('Leg', f, s, 0.1) for f in (0.2, 0.3, 0.4))
    upper = max(limb('Arm', f, s, 0.08) for f in (0.4, 0.5, 0.6))
    fore = max(limb('ForeArm', f, s, 0.07) for f in (0.15, 0.25, 0.35))
    delt = co[(co[:, 2] > j('LeftArm')[2] - 0.075) & (co[:, 2] < j('LeftArm')[2] - 0.045), 0]
    out = {
        'name': name, 'H': H, 'head': top - chin, 'H/head': H / (top - chin),
        'crotch': crotch, 'crotch/H': crotch / H, 'hipJ': hz, 'knee': j('LeftLeg')[2],
        'acromial': float(np.linalg.norm(j('LeftArm') - j('RightArm'))), 'deltoid': float(delt.max() - delt.min()),
        'chestDeep': float(np.ptp(torso[np.abs(torso[:, 2] - chest_z) < 0.02, 1])), 'chest': chest, 'waist': float(gs[waist_i]), 'waistZ': float(zs[waist_i]), 'hip': float(gs[hip_i]), 'hipZ': float(zs[hip_i]),
        'thigh': thigh, 'calf': calf, 'upperArm': upper, 'forearm': fore,
        'shoulderZ': j('LeftArm')[2], 'armLen': float(np.linalg.norm(j('LeftForeArm') - j('LeftArm')) + np.linalg.norm(j('LeftHand') - j('LeftForeArm'))),
    }
    return {k: (v if isinstance(v, str) else round(float(v), 3)) for k, v in out.items()}


# ---------------------------------------------------------------------------------------------------------------
# The top cut to a tank: the sleeves off along a plane from the shoulder's top to under the arm.
def cut_tank(suit, body, rig, women, shirt_polys):
    bm = bmesh.new()
    bm.from_mesh(suit.data)
    bm.faces.ensure_lookup_table()
    n_faces0 = len(bm.faces)
    arm = rig.data.bones[P + 'LeftArm'].head_local
    x0, z0 = abs(arm.x), arm.z
    shirt_f = [f for f, s in zip(bm.faces, shirt_polys) if s]
    shirt_v = list({v for f in shirt_f for v in f.verts})
    shirt_e = list({e for f in shirt_f for e in f.edges})
    planes = []
    for side in (1, -1):
        a = Vector((side * (x0 - 0.035), 0, z0 + 0.07))
        b = Vector((side * (x0 - 0.01), 0, z0 - 0.15))
        along = (b - a).normalized()
        no = Vector((0, 1, 0)).cross(along) * side
        if no.x * side < 0:
            no = -no
        planes.append((a, no))
        geom = [g for g in shirt_v + shirt_e + shirt_f if g.is_valid]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=a, plane_no=no, clear_outer=True)
        bm.faces.ensure_lookup_table()
        shirt_f = [f for f in bm.faces if f.is_valid and min(v.co.z for v in f.verts) > arm.z - 0.6]
        shirt_v = list({v for f in shirt_f for v in f.verts})
        shirt_e = list({e for f in shirt_f for e in f.edges})
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(suit.data)
    bm.free()
    suit.data.update()
    # The arm's skin is shown again from a little inside the cut (the mask for the suit is by vertex group).
    g = body.vertex_groups.get('Delete.' + suit.name.split('.')[-1])
    if g:
        out = []
        for v in body.data.vertices[:N_BODY]:
            for a, no in planes:
                if (v.co - a).dot(no) > -0.02:
                    out.append(v.index)
                    break
        g.remove(out)
    print('TANK sleeves off, faces', n_faces0, '->', len(suit.data.polygons))


# ---------------------------------------------------------------------------------------------------------------
# A skirt: rings round the pelvis from under the shirt's hem down, each no narrower than the body it passes nor than the ring
# above (cloth hangs from the widest place it has been), and then flaring. Knife pleats below a smooth yoke, each pleat a
# strip of its own so it shades flat; or an A-line with soft folds. A plain inner lining closes it from below, and all of it
# is weighted to the hips at the top and more and more to the thighs by the hem. `hang` (0 at the top, 1 at the hem) goes to
# the game: the swing and the thighs pushing the cloth out are done in the vertex shader (kit.ts).
SKIRT_RINGS = (0.0, 0.11, 0.22, 0.34, 0.47, 0.6, 0.73, 0.87, 1.0)
SKIRT_YOKE = 0.3
SKIRT_GAP = 0.005
SKIRT_TUCK = 0.05  # how far up under the shirt's hem the skirt's top goes
PLEATS = 34
ALINE_COLS = 60
LINING_V = 0.97
SKIRT_V = 0.92


def _skirt_shape(body, rig, top, hem, flare, cols):
    """Rings (nrings, cols) of radii about the pelvis's centre, and that centre; the body's outline as a support function."""
    co = _body_co(body)
    dom = _dominant_bones(body)
    keep = np.array([not ('Arm' in d or 'Hand' in d) for d in dom])
    pts = co[keep]
    pelvis = pts[np.abs(pts[:, 2] - (top + hem) / 2) < 0.04]
    c = np.array([0.0, (pelvis[:, 1].min() + pelvis[:, 1].max()) / 2])
    th = np.arange(cols) * 2 * math.pi / cols
    dirs = np.stack([np.cos(th), np.sin(th)], axis=1)
    zs = [top + (hem - top) * u for u in SKIRT_RINGS]
    R = np.zeros((len(zs), cols))
    for i, z in enumerate(zs):
        band = pts[np.abs(pts[:, 2] - z) < 0.016]
        h = ((band[:, :2] - c) @ dirs.T).max(axis=0)
        R[i] = h + SKIRT_GAP
        if i:
            dz = zs[i - 1] - z
            R[i] = np.maximum(R[i], R[i - 1] + flare * dz * (1 if SKIRT_RINGS[i] > SKIRT_YOKE else 0.2))
    return R, c, th, zs


def make_skirt(body, suit, rig, spec, women):
    k = spec['kit']
    style = k['bottom']
    hem = k['skirt']
    top_piece = _shirt_verts(suit, women)
    shirt_hem = min(suit.data.vertices[i].co.z for i in top_piece)
    top = shirt_hem + SKIRT_TUCK
    pleated = style == 'pleated'
    cols = PLEATS if pleated else ALINE_COLS
    R, c, th, zs = _skirt_shape(body, rig, top, hem, 0.15 if pleated else 0.11, cols)
    nr = len(zs)
    verts, faces, uvs, hang, leg_w = [], [], [], [], []

    def add(theta, r, z, u, v, h):
        verts.append((c[0] + r * math.cos(theta), c[1] + r * math.sin(theta), z))
        uvs.append((u, v))
        hang.append(h)
        return len(verts) - 1

    pleat = lambda u: 0.0 if u <= SKIRT_YOKE else min(1.0, (u - SKIRT_YOKE) / 0.35)
    if pleated:
        depth = 0.009
        for p in range(cols):
            a, b = th[p], th[p] + 2 * math.pi / cols
            q = (p + 1) % cols
            s0, s1, t0, t1 = [], [], [], []
            for i, u in enumerate(SKIRT_RINGS):
                d = depth * pleat(u)
                sag = 0.0
                z = zs[i] - sag
                rq = R[i, q]
                s0.append(add(a, R[i, p], z, p / cols, u * SKIRT_V, u))
                s1.append(add(b, rq - d, z, (p + 0.92) / cols, u * SKIRT_V, u))
                t0.append(add(b, rq - d, z, (p + 0.96) / cols, u * SKIRT_V, u))
                t1.append(add(b + 0.0005, rq, z, (p + 0.99) / cols, u * SKIRT_V, u))
            for i in range(nr - 1):
                faces.append((s0[i], s0[i + 1], s1[i + 1], s1[i]))
                faces.append((t0[i], t0[i + 1], t1[i + 1], t1[i]))
    else:
        rows = []
        for i, u in enumerate(SKIRT_RINGS):
            row = []
            for j in range(cols + 1):
                t = 2 * math.pi * j / cols
                a = pleat(u) * 0.012
                fold = a * (0.62 * math.sin(7 * t + 0.6) + 0.38 * math.sin(13 * t + 2.1))
                row.append(add(t, R[i, j % cols] + fold, zs[i], j / cols, u * SKIRT_V, u))
            rows.append(row)
        for i in range(nr - 1):
            for j in range(cols):
                faces.append((rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1]))
    # The lining: seen only up under the hem.
    n_lin = 36
    ltheta = np.arange(n_lin) * 2 * math.pi / n_lin
    rows = []
    lining_rings = [i for i, u in enumerate(SKIRT_RINGS) if u >= 0.47]
    for i in lining_rings:
        row = []
        for j in range(n_lin):
            idx = int(round(ltheta[j] / (2 * math.pi) * cols)) % cols
            row.append(add(ltheta[j], R[i, idx] - 0.012, zs[i], (j + 0.5) / n_lin, LINING_V, SKIRT_RINGS[i]))
        rows.append(row)
    for i in range(len(rows) - 1):
        for j in range(n_lin):
            k2 = (j + 1) % n_lin
            faces.append((rows[i][j], rows[i][k2], rows[i + 1][k2], rows[i + 1][j]))

    me = bpy.data.meshes.new('Skirt')
    me.from_pydata(verts, [], faces)
    me.update()
    # (windings, as built, run outwards for the outside and inwards for the lining; checked here)
    bad = 0
    n_out = len(faces) - (len(rows) - 1) * n_lin
    for pi, po in enumerate(me.polygons):
        cen = po.center
        radial = Vector((cen.x - c[0], cen.y - c[1], 0))
        want = 1 if pi < n_out else -1
        if po.normal.dot(radial) * want < -0.05 and abs(po.normal.z) < 0.9:
            bad += 1
    uvl = me.uv_layers.new(name='uv')
    for lo in me.loops:
        uvl.data[lo.index].uv = uvs[lo.vertex_index]
    at = me.attributes.new('hang', 'FLOAT', 'POINT')
    at.data.foreach_set('value', np.array(hang, dtype=np.float32))
    o = bpy.data.objects.new('Skirt', me)
    for coll in body.users_collection:
        coll.objects.link(o)
    hips_g = o.vertex_groups.new(name=P + 'Hips')
    lg = o.vertex_groups.new(name=P + 'LeftUpLeg')
    rg = o.vertex_groups.new(name=P + 'RightUpLeg')
    lx = rig.data.bones[P + 'LeftUpLeg'].head_local.x
    for i, (co, h) in enumerate(zip(verts, hang)):
        w = 0.85 * max(0.0, min(1.0, (h - 0.1) / 0.75)) ** 1.2
        s = max(0.0, min(1.0, 0.5 + co[0] * (1 if lx > 0 else -1) / 0.13))
        hips_g.add([i], 1 - w, 'REPLACE')
        if w > 0:
            lg.add([i], w * s, 'REPLACE')
            rg.add([i], w * (1 - s), 'REPLACE')
    m = o.modifiers.new('Armature', 'ARMATURE')
    m.object = rig
    print('SKIRT', style, 'top', round(top, 3), 'hem', hem, 'shirt hem', round(shirt_hem, 3), 'radius at the hem', round(float(R[-1].min()), 3), '..', round(float(R[-1].max()), 3),
          'faces', len(faces), 'wrong way', bad)
    return o


def skirt_ao(size, pleated):
    """The skirt's shading in the atlas (grey): darker up under the shirt, in each pleat's valley and on the lining."""
    v = (np.arange(size) + 0.5) / size
    u = (np.arange(size) + 0.5) / size
    px = np.ones((size, size, 4), dtype=np.float32)
    uv_u, uv_v = np.meshgrid(u, v)
    h = np.clip(uv_v / SKIRT_V, 0, 1)
    under = 0.55 + 0.45 * np.clip(h / 0.12, 0, 1)
    if pleated:
        t = (uv_u * PLEATS) % 1
        valley = 1 - 0.42 * np.clip((h - SKIRT_YOKE) / 0.3, 0, 1) * np.clip((t - 0.45) / 0.5, 0, 1) ** 1.5
    else:
        a = uv_u * 2 * math.pi
        fold = 0.62 * np.sin(7 * a + 0.6) + 0.38 * np.sin(13 * a + 2.1)
        valley = 1 - 0.2 * np.clip((h - SKIRT_YOKE) / 0.3, 0, 1) * np.clip(-fold, 0, 1)
    g = under * valley
    g[uv_v > (SKIRT_V + LINING_V) / 2 - 0.02] = 0.3
    for k in range(3):
        px[:, :, k] = g
    return px


def _shirt_verts(suit, women):
    import person_face as face
    sm = suit.data
    out = set()
    for p, s in zip(sm.polygons, face.shirt_polygons(sm, women)):
        if s:
            out.update(p.vertices)
    return out


# ---------------------------------------------------------------------------------------------------------------
# A headband or a visor: a band round the head above the brows, low at the back, on the skin or the hair that lies on it; a
# visor's bill is a curved peak out of the band's lower edge. Bound to the head alone.
def make_head_piece(body, hair, rig, eye_pts, style):
    from mathutils.bvhtree import BVHTree
    dg = bpy.context.evaluated_depsgraph_get()
    skin = BVHTree.FromPolygons([v.co.copy() for v in body.data.vertices],
                                [tuple(p.vertices) for p in body.data.polygons if max(p.vertices) < N_BODY])
    hair_tree = BVHTree.FromPolygons([v.co.copy() for v in hair.data.vertices], [tuple(p.vertices) for p in hair.data.polygons]) if hair else None
    eye = Vector((0, sum(c.y for c in eye_pts) / len(eye_pts), sum(c.z for c in eye_pts) / len(eye_pts)))
    head = rig.data.bones[P + 'Head'].head_local
    # The band's plane: from the upper forehead to under the back of the crown.
    front_z, back_z = eye.z + 0.052, eye.z + 0.02
    cy = eye.y + 0.095
    centre = Vector((0, cy, (front_z + back_z) / 2))
    tilt = math.atan2(front_z - back_z, 0.18)
    ey = Vector((0, -math.cos(tilt), math.sin(tilt)))   # forward (the model faces -y) and up the slope
    ex = Vector((1, 0, 0))
    up = ey.cross(ex).normalized()
    if up.z < 0:
        up = -up
    width = 0.03 if style == 'band' else 0.026
    cols = 44
    rows_u = (-0.5, 0.0, 0.5)

    def surface(a, offs):
        d = ex * math.sin(a) + ey * math.cos(a)
        p0 = centre + up * offs
        far = p0 + d * 0.3
        r_skin = 0.1
        hit = skin.ray_cast(far, -d, 0.3)
        if hit[0] is not None:
            r_skin = (hit[0] - p0).length
        r = r_skin + 0.004
        if hair_tree is not None:
            h2 = hair_tree.ray_cast(far, -d, 0.3)
            if h2[0] is not None:
                rh = (h2[0] - p0).length
                r = max(r, min(rh, r_skin + 0.03) + 0.002)
        return r, d, p0

    rad = np.zeros((len(rows_u), cols))
    for i, u in enumerate(rows_u):
        for j in range(cols):
            rad[i, j] = surface(2 * math.pi * j / cols, u * width)[0]
    # A band is a tight loop: smooth round the head, and one radius across its width near enough.
    for _ in range(4):
        rad = (np.roll(rad, 1, axis=1) + 2 * rad + np.roll(rad, -1, axis=1)) / 4
    rad = np.maximum(rad, rad.mean(axis=0, keepdims=True))
    rad[1] += 0.0015
    verts, faces, shade = [], [], []
    rows = []
    for i, u in enumerate(rows_u):
        row = []
        for j in range(cols):
            a = 2 * math.pi * j / cols
            d = ex * math.sin(a) + ey * math.cos(a)
            p = centre + up * (u * width) + d * rad[i, j]
            verts.append(tuple(p))
            shade.append(1.0)
            row.append(len(verts) - 1)
        rows.append(row)
    for i in range(len(rows_u) - 1):
        for j in range(cols):
            k = (j + 1) % cols
            faces.append((rows[i][j], rows[i][k], rows[i + 1][k], rows[i + 1][j]))
    if style == 'visor':
        # From the band's lower edge, front ±80 degrees: out, slightly down, curved across.
        arc = math.radians(68)
        n = 20
        L = 0.062
        top_row, und_row = [], []
        rings = (0.0, 0.35, 0.7, 1.0)
        tops = []
        for s, f in enumerate(rings):
            row_t, row_b = [], []
            for j in range(n + 1):
                a = -arc + 2 * arc * j / n
                aa = a if a >= 0 else a + 2 * math.pi
                jj = aa / (2 * math.pi) * cols
                j0, j1 = int(jj) % cols, (int(jj) + 1) % cols
                r = rad[0, j0] + (rad[0, j1] - rad[0, j0]) * (jj - int(jj))
                d = ex * math.sin(a) + ey * math.cos(a)
                reach = L * max(0.0, math.cos(a / arc * math.pi / 2)) ** 0.55 * f
                out = d * (r + reach) + ey * reach * 0.35
                drop = -0.28 * reach - 0.012 * f * (a / arc) ** 2 * 3
                p = centre + up * (-0.5 * width + drop) + out
                row_t.append(len(verts)); verts.append(tuple(p)); shade.append(1.0)
                row_b.append(len(verts)); verts.append(tuple(p - up * (0.0035 - 0.0015 * f))); shade.append(0.5)
            tops.append((row_t, row_b))
        for s in range(len(rings) - 1):
            a_t, a_b = tops[s]
            b_t, b_b = tops[s + 1]
            for j in range(n):
                faces.append((a_t[j], a_t[j + 1], b_t[j + 1], b_t[j]))
                faces.append((a_b[j + 1], a_b[j], b_b[j], b_b[j + 1]))
        lt, lb = tops[-1]
        for j in range(n):
            faces.append((lt[j], lt[j + 1], lb[j + 1], lb[j]))
    me = bpy.data.meshes.new('HeadPiece')
    me.from_pydata(verts, [], faces)
    me.update()
    # Outward: the band's faces away from the head's axis, the bill's up.
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    me.update()
    # (one UV everywhere: a new layer's default gives every face its own corners, which splits every vertex in the export)
    uv0 = me.uv_layers.new(name='uv')
    for d in uv0.data:
        d.uv = (0, 0)
    at = me.attributes.new('shade', 'FLOAT', 'POINT')
    at.data.foreach_set('value', np.array(shade, dtype=np.float32))
    o = bpy.data.objects.new('HeadPiece', me)
    for coll in body.users_collection:
        coll.objects.link(o)
    g = o.vertex_groups.new(name=P + 'Head')
    g.add(list(range(len(verts))), 1.0, 'REPLACE')
    m = o.modifiers.new('Armature', 'ARMATURE')
    m.object = rig
    print('HEADPIECE', style, 'band radius', round(float(rad.min()), 3), '..', round(float(rad.max()), 3), 'faces', len(faces))
    return o


# ---------------------------------------------------------------------------------------------------------------
# A polo's collar: a stand round the neck, open at the throat, and a leaf folded down over it onto the shoulders, its points
# spread at the front. The shirt's own neckline (the game cuts it, kit.ts) stays under it. `drop`: how far under the Neck joint
# the front opens (about the game's collarDrop).
def make_collar(body, rig, drop=0.075):
    from mathutils.bvhtree import BVHTree
    skin = BVHTree.FromPolygons([v.co.copy() for v in body.data.vertices],
                                [tuple(p.vertices) for p in body.data.polygons if max(p.vertices) < N_BODY])
    neck = rig.data.bones[P + 'Neck'].head_local.copy()
    head = rig.data.bones[P + 'Head'].head_local.copy()
    axis = (head - neck).normalized()
    # Round from one front point by the back to the other: `a` is the angle from straight forward (the model faces -y).
    open_a = math.radians(28)
    cols = 30
    verts, faces, shade = [], [], []
    rows = {k: [] for k in range(4)}
    for j in range(cols + 1):
        t = j / cols
        a = open_a + (2 * math.pi - 2 * open_a) * t
        d = Vector((math.sin(a), -math.cos(a), 0))
        back = (1 - math.cos(a)) / 2  # 0 in front, 1 at the nape
        # The fold's height over the Neck joint: low at the throat, up the sides, a little up the nape.
        z = neck.z - drop * (1 - back) ** 1.4 + 0.022 * back + 0.015
        p0 = neck + axis * ((z - neck.z) / max(axis.z, 0.5))
        far = p0 + d * 0.3
        hit = skin.ray_cast(far, -d, 0.3)
        r = (hit[0] - p0).length if hit[0] is not None else 0.065
        fold = Vector((p0.x, p0.y, z)) + d * (r + 0.007)
        point = max(0.0, 1 - min(t, 1 - t) / 0.18)  # 1 at a collar point
        reach = 0.03 + 0.016 * point
        fall = 0.036 + 0.02 * point
        leaf = fold + d * reach + Vector((0, 0, -fall))
        mid = fold * 0.45 + leaf * 0.55 + d * 0.004
        stand = fold + Vector((0, 0, -0.03)) - d * 0.004
        for k, (p, sh) in enumerate(((stand, 0.55), (fold, 1.0), (mid, 1.0), (leaf, 0.92))):
            rows[k].append(len(verts))
            verts.append(tuple(p))
            shade.append(sh)
    for k in range(3):
        for j in range(cols):
            faces.append((rows[k][j], rows[k + 1][j], rows[k + 1][j + 1], rows[k][j + 1]))
    # The leaf is a fold, so its edge has thickness underneath: a row turned back in under it.
    under = []
    for j in range(cols + 1):
        p = Vector(verts[rows[3][j]]) + Vector((0, 0, 0.004))
        n = Vector(verts[rows[1][j]]) - Vector(verts[rows[3][j]])
        p = p + n.normalized() * 0.012
        under.append(len(verts))
        verts.append(tuple(p))
        shade.append(0.5)
    for j in range(cols):
        faces.append((rows[3][j], under[j], under[j + 1], rows[3][j + 1]))
    me = bpy.data.meshes.new('Collar')
    me.from_pydata(verts, [], faces)
    me.update()
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    me.update()
    # recalc points outwards from the shape's middle; the leaf must face out and up.
    if sum(1 for po in me.polygons if po.normal.z > 0) < len(me.polygons) / 2:
        me.flip_normals()
        me.update()
    # (one UV everywhere: a new layer's default gives every face its own corners, which splits every vertex in the export)
    uv0 = me.uv_layers.new(name='uv')
    for d in uv0.data:
        d.uv = (0, 0)
    at = me.attributes.new('shade', 'FLOAT', 'POINT')
    at.data.foreach_set('value', np.array(shade, dtype=np.float32))
    o = bpy.data.objects.new('Collar', me)
    for coll in body.users_collection:
        coll.objects.link(o)
    gn = o.vertex_groups.new(name=P + 'Neck')
    gs = o.vertex_groups.new(name=P + 'Spine2')
    for k, wn in ((0, 0.5), (1, 0.4), (2, 0.2), (3, 0.05)):
        for i in rows[k]:
            gn.add([i], wn, 'REPLACE')
            gs.add([i], 1 - wn, 'REPLACE')
    for i in under:
        gn.add([i], 0.1, 'REPLACE')
        gs.add([i], 0.9, 'REPLACE')
    m = o.modifiers.new('Armature', 'ARMATURE')
    m.object = rig
    print('COLLAR faces', len(faces))
    return o
