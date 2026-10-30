# The face of a person (finish-player.py imports it): expression shape keys, the eyes' gaze keys, per-vertex skin
# regions, the scalp and brows painted under the hair, and the ambient occlusion bakes.
#
# - Expressions are MakeHuman's expression units (CC0, MPFB's data/targets/expression/units/<race>/), weighted by the
#   body's own race mix, loaded as shape keys on the body after its shape is baked and before any vertex is deleted.
#   The proxies (lashes, brows, hair, teeth, tongue) are fitted to the body by their .mhclo files (each vertex = three
#   body vertices' weighted sum plus an offset), so their keys are the same weighted sum of the body's moves. MPFB's
#   own interpolate_targets only carries ARKit/visemes names; this does the units.
# - The eyes turn by four keys (left, right, up, down) about each eye's joint (the basemesh's joint-l/r-eye cubes),
#   with the lids following up and down as real lids do. A key's linear blend of a 30 degree turn shortens the radius
#   by under 1 % half way; the game blends at most two of them.
# - Regions from what moves in the expression units (MakeHuman's skin UVs have no region masks that match it): lips
#   (what pursing moves most), the eyelids (what closing moves), the oily T-zone (what the nose and brow units move),
#   and the ears (the head's most lateral skin), for roughness and translucency in the game's skin shader.
import os, gzip, math
import bpy, bmesh
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

import bl_ext.user_default.mpfb as MPFB
from bl_ext.user_default.mpfb.services.targetservice import TargetService
from bl_ext.user_default.mpfb.services.clothesservice import ClothesService
from bl_ext.user_default.mpfb.entities.clothes.mhclo import Mhclo

UNITS = os.path.join(os.path.dirname(MPFB.__file__), 'data', 'targets', 'expression', 'units')

# Game morph -> expression units (both sides together where the game drives them as one).
EXPRESSIONS = [
    ('blinkL', [('eye-left-closure', 1.0)]),
    ('blinkR', [('eye-right-closure', 1.0)]),
    ('squint', [('eye-left-slit', 1.0), ('eye-right-slit', 1.0)]),
    ('browDown', [('eyebrows-left-down', 1.0), ('eyebrows-right-down', 1.0)]),
    ('browInnerUp', [('eyebrows-left-inner-up', 1.0), ('eyebrows-right-inner-up', 1.0)]),
    ('browUp', [('eyebrows-left-up', 1.0), ('eyebrows-right-up', 1.0)]),
    ('jawOpen', [('mouth-open', 1.0)]),
    ('mouthPress', [('mouth-compression', 1.0)]),
    ('smile', [('mouth-corner-puller', 1.0)]),
    ('grimace', [('mouth-upward-retraction', 1.0)]),
    ('sneer', [('nose-left-elevation', 1.0), ('nose-right-elevation', 1.0)]),
    ('neckTense', [('neck-platysma', 1.0)]),
]
# Gaze keys: (name, axis, degrees, the lids' units that go with it).
GAZE = [
    ('lookLeft', 'Z', 30.0, []),
    ('lookRight', 'Z', -30.0, []),
    ('lookUp', 'X', -25.0, [('eye-left-opened-up', 0.6), ('eye-right-opened-up', 0.6)]),
    ('lookDown', 'X', 25.0, [('eye-left-closure', 0.3), ('eye-right-closure', 0.3)]),
]
MORPHS = [n for n, _ in EXPRESSIONS] + [n for n, *_ in GAZE]
PROXY_KINDS = ('lash', 'brow', 'hair', 'teeth', 'tongue')


def _co(o, key=None):
    n = len(o.data.vertices)
    a = np.empty(n * 3, dtype=np.float64)
    (key.data if key is not None else o.data.vertices).foreach_get('co', a)
    return a.reshape(n, 3)


def _unit_delta(body, unit, race, basis):
    d = np.zeros_like(basis)
    for r, w in race.items():
        if w <= 1e-4:
            continue
        sk = TargetService.load_target(body, os.path.join(UNITS, r, unit + '.target.gz'), weight=0.0, name='tmp')
        d += w * (_co(body, sk) - basis)
        body.shape_key_remove(sk)
    return d


def _add_keys(o, deltas):
    """Basis plus one key per morph (zero where the object doesn't move)."""
    if o.data.shape_keys is None:
        o.shape_key_add(name='Basis', from_mix=False)
    basis = _co(o)
    for name in MORPHS:
        sk = o.shape_key_add(name=name, from_mix=False)
        d = deltas.get(name)
        sk.data.foreach_set('co', (basis + (d if d is not None else 0)).ravel())
        sk.value = 0.0


def expression_keys(body, meshes, kinds, spec):
    """Shape keys for every morph on the body and its proxies; returns the body's deltas by unit for the masks."""
    race = spec['macro'].get('race', {'caucasian': 1.0})
    tot = sum(race.values()) or 1
    race = {k: v / tot for k, v in race.items()}
    basis = _co(body)
    cache = {}

    def unit(u):
        if u not in cache:
            cache[u] = _unit_delta(body, u, race, basis)
        return cache[u]

    deltas = {}
    for name, units in EXPRESSIONS:
        deltas[name] = sum(s * unit(u) for u, s in units)
    for name, _, _, lids in GAZE:
        deltas[name] = sum((s * unit(u) for u, s in lids), np.zeros_like(basis))
    # Units used only for the region masks.
    for u in ('mouth-pursing', 'nose-compression', 'nose-left-dilatation', 'nose-right-dilatation'):
        unit(u)
    # The proxies by their .mhclo fitting.
    moved = {}
    for o in meshes:
        kd = kinds[o.name]
        if kd not in PROXY_KINDS:
            continue
        path = ClothesService.find_clothes_absolute_path(o)
        mh = Mhclo()
        mh.load(path)
        nv = len(o.data.vertices)
        if len(mh.verts) != nv:
            print('FACE', o.name, 'mhclo has', len(mh.verts), 'vertices, mesh', nv, ': no keys')
            continue
        refs = np.array([mh.verts[i]['verts'] for i in range(nv)], dtype=np.int64)
        wts = np.array([mh.verts[i]['weights'] for i in range(nv)], dtype=np.float64)
        pd = {n: (d[refs] * wts[..., None]).sum(axis=1) for n, d in deltas.items()}
        _add_keys(o, pd)
        moved[o.name] = max(float(np.abs(v).max()) for v in pd.values())
    # The eyes turn about their own centres: the sphere fitted to each eyeball (least squares). The basemesh's eye
    # joints sit about 1 cm off them, and a turn about those swung the eyeball into the lids.
    for o in meshes:
        if kinds[o.name] != 'eye':
            continue
        co = _co(o)
        which = (co[:, 0] < 0).astype(int)
        centres = []
        for e in (0, 1):
            q = co[which == e]
            M = np.hstack([2 * q, np.ones((len(q), 1))])
            sol = np.linalg.lstsq(M, (q * q).sum(axis=1), rcond=None)[0]
            centres.append(sol[:3])
            print('FACE eye', e, 'radius', round(float(np.sqrt(sol[3] + sol[:3] @ sol[:3])), 4))
        ed = {}
        for name, axis, deg, _ in GAZE:
            R = np.array(Matrix.Rotation(math.radians(deg), 3, axis))
            d = np.zeros_like(co)
            for e in (0, 1):
                m = which == e
                c = centres[e]
                d[m] = (co[m] - c) @ R.T + c - co[m]
            ed[name] = d
        _add_keys(o, ed)
        print('FACE eyes', o.name, 'centres', [[round(x, 4) for x in c] for c in centres], 'split', int((which == 0).sum()), int((which == 1).sum()))
    _add_keys(body, deltas)
    print('FACE keys', len(MORPHS), 'body max move', {n: round(float(np.abs(d).max()), 4) for n, d in deltas.items()})
    print('FACE proxies moved', {k: round(v, 4) for k, v in moved.items()})
    return cache


def region_masks(body, units, head_z):
    """Per body vertex (lips, T-zone, eyelids, ears) in 0..1, from the expression units' moves (basemesh order)."""
    def mag(u):
        return np.linalg.norm(units[u], axis=1)

    def norm(a, lo, hi):
        m = a.max() or 1
        return np.clip((a / m - lo) / (hi - lo), 0, 1)
    lips = norm(mag('mouth-pursing'), 0.35, 0.7)
    lids = norm(mag('eye-left-closure') + mag('eye-right-closure'), 0.15, 0.45)
    tz = np.maximum(norm(mag('nose-compression') + mag('nose-left-dilatation') + mag('nose-right-dilatation'), 0.05, 0.3),
                    norm(mag('eyebrows-left-up') + mag('eyebrows-right-up'), 0.05, 0.35))
    co = _co(body)
    n = len(co)
    ears = np.zeros(n)
    head = co[:, 2] > head_z
    if head.any():
        cx = np.median(co[head, 0])
        lat = np.abs(co[:, 0] - cx)
        # Lateral of the skull: the ears stand out about 2 cm.
        band = head & (co[:, 2] < head_z + 0.16)
        mx = lat[band].max()
        ears = np.where(band, np.clip((lat - (mx - 0.026)) / 0.012, 0, 1), 0)
    return np.stack([lips, tz * (1 - lips), lids, ears], axis=1)


# ---------------------------------------------------------------------------------------------------------------
# Painting under the hair and brows: from each skin texel near them, rays straight out along the normal pick up the
# hair cards' coverage (1 - product of (1 - alpha) over every card crossed), so the scalp under the hair takes the
# roots' colour and the hairline grows out of the skin instead of a bald band between cards.

def _tri_bvh(o):
    me = o.data
    me.calc_loop_triangles()
    verts = [v.co.copy() for v in me.vertices]
    tris = [tuple(t.vertices) for t in me.loop_triangles]
    uvl = me.uv_layers.active.data
    tuv = np.array([[tuple(uvl[li].uv) for li in t.loops] for t in me.loop_triangles], dtype=np.float64)
    tco = np.array([[tuple(me.vertices[vi].co) for vi in t.vertices] for t in me.loop_triangles], dtype=np.float64)
    return BVHTree.FromPolygons(verts, tris), tuv, tco


def _bary(p, a, b, c):
    v0, v1, v2 = b - a, c - a, p - a
    d00, d01, d11 = v0 @ v0, v0 @ v1, v1 @ v1
    d20, d21 = v2 @ v0, v2 @ v1
    den = d00 * d11 - d01 * d01 or 1e-12
    v = (d11 * d20 - d01 * d21) / den
    w = (d00 * d21 - d01 * d20) / den
    return 1 - v - w, v, w


def coverage_map(body, proxy, img_px, res, reach, near):
    """Coverage (res x res, skin UV space) and the colour seen through it, from proxy cards within `reach` (m) along
    the skin's normal, for skin triangles with a vertex within `near` (m) of the proxy."""
    bvh, tuv, tco = _tri_bvh(proxy)
    H, W = img_px.shape[:2]
    pv = [v.co for v in proxy.data.vertices]
    kd = KDTree(len(pv))
    for i, v in enumerate(pv):
        kd.insert(v, i)
    kd.balance()
    me = body.data
    me.calc_loop_triangles()
    uvl = me.uv_layers.active.data
    cov = np.zeros((res, res), dtype=np.float32)
    col = np.zeros((res, res, 3), dtype=np.float32)
    nrm = [v.normal.copy() for v in me.vertices]
    rays = 0
    for t in me.loop_triangles:
        vs = [me.vertices[i].co for i in t.vertices]
        if min(kd.find(v)[2] for v in vs) > near:
            continue
        uv = np.array([tuple(uvl[li].uv) for li in t.loops]) * res
        x0, y0 = np.floor(uv.min(axis=0)).astype(int)
        x1, y1 = np.ceil(uv.max(axis=0)).astype(int)
        P = np.array([tuple(v) for v in vs])
        N = np.array([tuple(nrm[i]) for i in t.vertices])
        for y in range(max(y0, 0), min(y1 + 1, res)):
            for x in range(max(x0, 0), min(x1 + 1, res)):
                a, b, c = _bary(np.array([x + 0.5, y + 0.5]), uv[0], uv[1], uv[2])
                if a < -1e-3 or b < -1e-3 or c < -1e-3:
                    continue
                p = Vector(tuple(a * P[0] + b * P[1] + c * P[2]))
                n = Vector(tuple(a * N[0] + b * N[1] + c * N[2])).normalized()
                o = p + n * 0.0003
                left, trans, acc = reach, 1.0, np.zeros(3)
                for _ in range(6):
                    hit, _, fi, dist = bvh.ray_cast(o, n, left)
                    rays += 1
                    if hit is None:
                        break
                    ba, bb, bc = _bary(np.array(tuple(hit)), tco[fi][0], tco[fi][1], tco[fi][2])
                    huv = ba * tuv[fi][0] + bb * tuv[fi][1] + bc * tuv[fi][2]
                    px = img_px[min(H - 1, max(0, int(huv[1] * H))), min(W - 1, max(0, int(huv[0] * W)))]
                    al = float(px[3])
                    acc += trans * al * px[:3]
                    trans *= 1 - al
                    left -= dist + 0.0002
                    o = hit + n * 0.0002
                    if trans < 0.02 or left <= 0:
                        break
                k = 1 - trans
                if k > cov[y, x]:
                    cov[y, x] = k
                    col[y, x] = acc / max(k, 1e-6)
    return cov, col, rays


def blur(a, r):
    """Box blur, three passes (about Gaussian), radius r texels, edge clamped."""
    out = a.astype(np.float32)
    for _ in range(3):
        for ax in (0, 1):
            pad = [(0, 0)] * out.ndim
            pad[ax] = (r, r)
            p = np.pad(out, pad, mode='edge')
            c = np.cumsum(p, axis=ax, dtype=np.float64)
            c = np.concatenate([np.zeros_like(np.take(c, [0], axis=ax)), c], axis=ax)
            n = out.shape[ax]
            out = ((np.take(c, range(2 * r + 1, 2 * r + 1 + n), axis=ax) - np.take(c, range(0, n), axis=ax)) / (2 * r + 1)).astype(np.float32)
    return out


def resize(a, w, h):
    """(H, W, c) to (h, w, c): block means when it shrinks by whole factors, else bilinear."""
    H, W = a.shape[:2]
    if H % h == 0 and W % w == 0:
        return a.reshape(h, H // h, w, W // w, -1).mean(axis=(1, 3)).astype(np.float32)
    ys = np.clip((np.arange(h) + 0.5) * H / h - 0.5, 0, H - 1)
    xs = np.clip((np.arange(w) + 0.5) * W / w - 0.5, 0, W - 1)
    y0, x0 = np.floor(ys).astype(int), np.floor(xs).astype(int)
    y1, x1 = np.minimum(y0 + 1, H - 1), np.minimum(x0 + 1, W - 1)
    fy, fx = (ys - y0)[:, None, None], (xs - x0)[None, :, None]
    top = a[y0][:, x0] * (1 - fx) + a[y0][:, x1] * fx
    bot = a[y1][:, x0] * (1 - fx) + a[y1][:, x1] * fx
    return (top * (1 - fy) + bot * fy).astype(np.float32)


def set_keys(meshes, values):
    """Every object's morph keys to `values` (the rest 0)."""
    for o in meshes:
        keys = o.data.shape_keys
        if keys is None:
            continue
        for name in MORPHS:
            k = keys.key_blocks.get(name)
            if k is not None:
                k.value = values.get(name, 0.0)
    bpy.context.view_layer.update()


def upscale(a, size):
    """Bilinear resize of an (h, w[, c]) array to size x size."""
    h, w = a.shape[:2]
    ys = (np.arange(size) + 0.5) * h / size - 0.5
    xs = (np.arange(size) + 0.5) * w / size - 0.5
    y0 = np.clip(np.floor(ys).astype(int), 0, h - 1)
    x0 = np.clip(np.floor(xs).astype(int), 0, w - 1)
    y1 = np.clip(y0 + 1, 0, h - 1)
    x1 = np.clip(x0 + 1, 0, w - 1)
    fy = np.clip(ys - y0, 0, 1)[:, None]
    fx = np.clip(xs - x0, 0, 1)[None, :]
    if a.ndim == 3:
        fy, fx = fy[..., None], fx[..., None]
    top = a[y0][:, x0] * (1 - fx) + a[y0][:, x1] * fx
    bot = a[y1][:, x0] * (1 - fx) + a[y1][:, x1] * fx
    return top * (1 - fy) + bot * fy


# ---------------------------------------------------------------------------------------------------------------
# Ambient occlusion, baked with Cycles in the T-pose (the arms away from the body, as most of a match is).

def cycles_setup(samples=48, distance=0.1):
    scn = bpy.context.scene
    scn.render.engine = 'CYCLES'
    scn.cycles.samples = samples
    scn.render.bake.margin = 6
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        scn.cycles.device = 'GPU'
    except Exception as e:  # CPU is fine, only slower
        print('AO bake on the CPU:', e)
    scn.world = scn.world or bpy.data.worlds.new('w')
    scn.world.light_settings.distance = distance


def bake_ao_image(o, size, name):
    """AO baked into a new size x size image on the object's UVs; returns (h, w) float array."""
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=True)
    for slot in o.material_slots:
        mat = slot.material
        mat.use_nodes = True
        nd = mat.node_tree.nodes.new('ShaderNodeTexImage')
        nd.image = img
        mat.node_tree.nodes.active = nd
    for x in bpy.data.objects:
        x.select_set(False)
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.bake(type='AO', target='IMAGE_TEXTURES', use_clear=True)
    px = np.empty(size * size * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    for slot in o.material_slots:
        nt = slot.material.node_tree
        nt.nodes.remove(nt.nodes.active)
    bpy.data.images.remove(img)
    return px.reshape(size, size, 4)[:, :, 0].copy()


def bake_ao_vertices(o):
    """AO per vertex (the shoes and eyes have no UVs of their own in the atlas)."""
    me = o.data
    attr = me.color_attributes.new('bake_ao', 'FLOAT_COLOR', 'POINT')
    me.color_attributes.active_color = attr
    for x in bpy.data.objects:
        x.select_set(False)
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.bake(type='AO', target='VERTEX_COLORS', use_clear=True)
    a = np.empty(len(me.vertices) * 4, dtype=np.float32)
    attr.data.foreach_get('color', a)
    me.color_attributes.remove(attr)
    return a.reshape(-1, 4)[:, 0].copy()


def hair_depth_ao(hair, body):
    """Hair cards near the scalp are in the shadow of those above them: AO from each vertex's height over the skin."""
    dg = bpy.context.evaluated_depsgraph_get()
    tree = BVHTree.FromObject(body, dg, deform=False)
    out = np.ones(len(hair.data.vertices), dtype=np.float32)
    for i, v in enumerate(hair.data.vertices):
        hit = tree.find_nearest(v.co)
        d = hit[3] if hit[0] is not None else 0.05
        out[i] = 0.42 + 0.58 * min(1.0, max(0.0, d / 0.028)) ** 0.7
    return out


def shape_deltas(o, nv_basis_normals=True):
    """{morph: (positions (n, 3), normals (n, 3))} of an object's keys against its Basis; zeros where it has none."""
    n = len(o.data.vertices)
    keys = o.data.shape_keys
    out = {}
    if keys is None:
        return out
    basis = keys.reference_key
    b = np.empty(n * 3)
    basis.data.foreach_get('co', b)
    b = b.reshape(n, 3)
    bn = np.array(basis.normals_vertex_get()).reshape(n, 3)
    for name in MORPHS:
        k = keys.key_blocks.get(name)
        if k is None:
            continue
        c = np.empty(n * 3)
        k.data.foreach_get('co', c)
        dp = c.reshape(n, 3) - b
        dn = np.array(k.normals_vertex_get()).reshape(n, 3) - bn
        still = np.linalg.norm(dp, axis=1) < 1e-6
        dp[still] = 0
        dn[still] = 0
        out[name] = (dp, dn)
    return out


# ---------------------------------------------------------------------------------------------------------------
# The kit fitted closer (MakeHuman's casual suit is a loose tee and trousers; padel players wear fitted technical
# shirts and shorts): every suit vertex further than FIT_GAP from the skin keeps only part of the extra (folds stay,
# smaller), the shirt's hem hangs free below the hips, and the shorts' waistband is pulled in under the shirt (it
# poked through the shirt at the small of the back as the player bent). The moves are smoothed over the mesh so no
# crease appears where the fit changes.
FIT_GAP = 0.006


def highest_piece(me):
    """The vertices of the connected piece of the mesh that reaches highest."""
    par = list(range(len(me.vertices)))
    def find(a):
        while par[a] != a:
            par[a] = par[par[a]]
            a = par[a]
        return a
    for e in me.edges:
        par[find(e.vertices[0])] = find(e.vertices[1])
    top = find(max(range(len(me.vertices)), key=lambda i: me.vertices[i].co.z))
    return {i for i in range(len(me.vertices)) if find(i) == top}


def shirt_polygons(sm, women):
    """Per polygon of a suit, is it the shirt? The men's suit has one atlas with the shirt on its top half; a women's suit
    is separate pieces, whose atlases overlap in height."""
    if women:
        top = highest_piece(sm)
        return [p.vertices[0] in top for p in sm.polygons]
    uvl = sm.uv_layers.active.data
    return [sum(uvl[li].uv.y for li in p.loop_indices) / p.loop_total > 0.57 for p in sm.polygons]


def fit_suit(body, suit, hips_z, women=False, n_body=13380):
    me = body.data
    verts = [v.co.copy() for v in me.vertices]
    polys = [tuple(p.vertices) for p in me.polygons if max(p.vertices) < n_body]
    tree = BVHTree.FromPolygons(verts, polys)
    sm = suit.data
    n = len(sm.vertices)
    shirt = np.zeros(n, dtype=bool)
    for p, s in zip(sm.polygons, shirt_polygons(sm, women)):
        if s:
            for vi in p.vertices:
                shirt[vi] = True
    co = _co(suit)
    move = np.zeros_like(co)
    for i in range(n):
        q, nrm, _, _ = tree.find_nearest(Vector(co[i]))
        if q is None:
            continue
        d = Vector(co[i]) - q
        gap = d.dot(nrm)
        if gap <= FIT_GAP:
            continue
        z = co[i, 2]
        if shirt[i]:
            # Fitted over the chest, back and sides; over the waistband it keeps 14 mm clear of the skin so it stays
            # outside the shorts (fitted to 6-9 mm there); the last few cm above the hem hang a little freer.
            g0 = FIT_GAP + 0.008 * min(1.0, max(0.0, (hips_z + 0.14 - z) / 0.04))
            keep = 0.35 + 0.35 * min(1.0, max(0.0, (hips_z + 0.02 - z) / 0.05))
        else:
            # The shorts' legs a little closer; the waistband (under the shirt) right in.
            g0 = FIT_GAP
            keep = 0.6 if z < hips_z - 0.04 else 0.25
        if gap <= g0:
            continue
        want = g0 + (gap - g0) * keep
        move[i] = -np.array(nrm) * (gap - want)
    # Smoothed over the edges (three passes), so the fit changes gradually.
    nb = [[] for _ in range(n)]
    for e in sm.edges:
        a, b = e.vertices
        nb[a].append(b)
        nb[b].append(a)
    for _ in range(3):
        nxt = move.copy()
        for i in range(n):
            if nb[i]:
                nxt[i] = 0.5 * move[i] + 0.5 * move[nb[i]].mean(axis=0)
        move = nxt
    co += move
    sm.vertices.foreach_set('co', co.ravel())
    sm.update()
    d = np.linalg.norm(move, axis=1)
    print('FIT suit moved median', round(float(np.median(d)) * 1000, 1), 'mm, max', round(float(d.max()) * 1000, 1), 'mm;',
          int(shirt.sum()), 'shirt vertices')

def cut_shorts_under_shirt(suit, women=False, reach=0.03, band=0.02, sink=0.01, tuck=0.05):
    """
    The shorts' waistband out from under the shirt (REVIEW.md round 2 #12, round 3): the two layers sit a few mm
    apart, so a bend or a twist pushed the shorts through the shirt's back as a ragged black notch. As for the skin
    under the clothes (finish-player.py): shorts that see the shirt within `reach` straight out along their normal are
    removed, except a `band` next to the shorts that show, so the shirt's hem always has shorts under it. What stays
    under the shirt is pulled in towards the body, from nothing where the shorts show to `sink` a band's width up (the
    skin under it is removed later): kept where it was, a 2.5 cm band still came through the hem's back as the shirt
    pulled in over the seat.
    """
    from mathutils.bvhtree import BVHTree
    from mathutils.kdtree import KDTree
    sm = suit.data
    is_shirt = shirt_polygons(sm, women)
    verts = [v.co.copy() for v in sm.vertices]
    tree = BVHTree.FromPolygons(verts, [tuple(p.vertices) for p, s in zip(sm.polygons, is_shirt) if s])
    bm = bmesh.new()
    bm.from_mesh(sm)
    bm.normal_update()
    bm.faces.ensure_lookup_table()
    bm.verts.ensure_lookup_table()
    shirt_v = set()
    for f, s in zip(bm.faces, is_shirt):
        if s:
            for v in f.verts:
                shirt_v.add(v.index)
    covered = set()
    shorts = [v for v in bm.verts if v.index not in shirt_v]
    for v in shorts:
        if tree.ray_cast(v.co + v.normal * 0.0005, v.normal, reach)[0] is not None:
            covered.add(v.index)
    open_v = [v for v in shorts if v.index not in covered]
    kd = KDTree(max(1, len(open_v)))
    for i, v in enumerate(open_v):
        kd.insert(v.co, i)
    kd.balance()
    dist = {v.index: kd.find(v.co)[2] for v in shorts if v.index in covered}
    gone = {i for i, d in dist.items() if d > band}
    dead = [f for f, s in zip(bm.faces, is_shirt) if not s and all(v.index in gone for v in f.verts)]
    # Every covered vertex that stays (in the band, or on a face that reaches out from under the hem: the suit's
    # faces are 3-4 cm across, longer than the band) goes in.
    # The shorts that show but sit just under the hem go in too, less the further they are from the shirt (gone at
    # `tuck`): a ray from them along their normal passes under the hem's edge, so they count as showing, and they
    # came through the shirt's lowest few cm as the hips bent (the stepped dark notches in round 3's back views).
    ks = KDTree(max(1, len(shirt_v)))
    for i, vi in enumerate(shirt_v):
        ks.insert(bm.verts[vi].co, i)
    ks.balance()
    dead_set = set(dead)
    moves = []
    for v in shorts:
        if v.index in dist:
            if any(f not in dead_set for f in v.link_faces):
                moves.append((v, sink * min(1.0, dist[v.index] / band)))
        else:
            ds = ks.find(v.co)[2]
            if ds < tuck:
                u = 1.0 - ds / tuck
                moves.append((v, sink * u * u * (3 - 2 * u)))
    for v, d in moves:
        v.co -= v.normal * d
    sunk = len(moves)
    bmesh.ops.delete(bm, geom=dead, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(sm)
    bm.free()
    sm.update()
    print('SHORTS under the shirt out:', len(dead), 'faces;', len(covered), 'shorts vertices covered,', len(open_v), 'showing,', sunk, 'pulled in')
