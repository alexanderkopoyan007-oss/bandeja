# Where a Meshy person's shirt, shorts, eyes and mouth are: Meshy paints one fused surface, so the bake knows skin from cloth (opaque.webp's
# alpha, decimate-bake.py) but not one piece of cloth from another.
#   blender -b --python tools/assets/meshy/kit-mask.py -- <work>/low
# writes normal-kit.webp (normal.webp with the mask in its alpha, a plane WebP keeps apart from the colour, so the mask can't leak
# into the normals), kit.json (each garment's middle brightness, which the shader divides by to keep the folds Meshy painted) and
# face.json (the left eye and the mouth, game axes on the body's middle: rig.py lays p1's face over them).
# Alpha: 0.25 nothing (never 0: see decimate-bake.py), 0.62 shirt, 1 shorts. Skin, hair, socks and shoes keep their own colours.
import json, os, sys

import bpy
import numpy as np

args = sys.argv[sys.argv.index('--') + 1:]
LOW = args[0]
TEX = 2048
SHIRT, SHORTS = 0.62, 1.0
# Bands of a T-posed body as fractions of the height. Above `TOP` the head, below `BOTTOM` the shins; all cloth over the hem band is the
# shirt's and all under it the shorts', and inside the band each texel goes by its colour. Past `REACH` from the axis the sleeves
# have ended: nothing out there is shirt.
TOP, HEM_HIGH, HEM_LOW, BOTTOM, REACH = 0.87, 0.585, 0.44, 0.33, 0.42
# How far the mask runs past the islands' edges (texels): mips reach further than the colour's 14, and a seam would show untinted.
BLEED = 32


def read(name, space):
    im = bpy.data.images.load(os.path.join(LOW, name))
    im.colorspace_settings.name = space
    im.alpha_mode = 'STRAIGHT'
    px = np.empty(TEX * TEX * 4, dtype=np.float32)
    im.pixels.foreach_get(px)
    return px.reshape(TEX, TEX, 4)


d = np.load(os.path.join(LOW, 'low.npz'))
co, tri, uv = d['co'], d['tri'], d['uv']
H = float(co[:, 2].max())
cx = float(np.median(co[:, 0]))
# Each texel's place on the body, from the triangles (height, and distance out from the axis).
z = np.full((TEX, TEX), -1.0, dtype=np.float32)
x = np.zeros((TEX, TEX), dtype=np.float32)
fwd = np.zeros((TEX, TEX), dtype=np.float32)
for t, u in zip(tri, uv):
    p = u * TEX - 0.5
    y0, y1 = int(max(p[:, 1].min() - 1, 0)), int(min(p[:, 1].max() + 2, TEX))
    x0, x1 = int(max(p[:, 0].min() - 1, 0)), int(min(p[:, 0].max() + 2, TEX))
    if y1 <= y0 or x1 <= x0:
        continue
    gy, gx = np.mgrid[y0:y1, x0:x1]
    e0, e1 = p[1] - p[0], p[2] - p[0]
    det = e0[0] * e1[1] - e0[1] * e1[0]
    if abs(det) < 1e-9:
        continue
    a = ((gx - p[0, 0]) * e1[1] - (gy - p[0, 1]) * e1[0]) / det
    b = (e0[0] * (gy - p[0, 1]) - e0[1] * (gx - p[0, 0])) / det
    m = (a >= -0.3 / max(np.abs(e0).max(), 1)) & (b >= -0.3 / max(np.abs(e1).max(), 1)) & (a + b <= 1 + 0.3 / max(np.abs(e1 - e0).max(), 1))
    if not m.any():
        continue
    c = co[t]
    z[y0:y1, x0:x1][m] = (c[0, 2] + a[m] * (c[1, 2] - c[0, 2]) + b[m] * (c[2, 2] - c[0, 2]))
    x[y0:y1, x0:x1][m] = c[0, 0] + a[m] * (c[1, 0] - c[0, 0]) + b[m] * (c[2, 0] - c[0, 0]) - cx
    fwd[y0:y1, x0:x1][m] = -(c[0, 1] + a[m] * (c[1, 1] - c[0, 1]) + b[m] * (c[2, 1] - c[0, 1]))
placed = z >= 0
print('KIT placed', round(float(placed.mean()), 3))

opaque = read('opaque.webp', 'sRGB')
srgb = np.clip(opaque[:, :, :3], 0, 1)
rgb = np.where(srgb <= 0.04045, srgb / 12.92, ((srgb + 0.055) / 1.055) ** 2.4)
lum = rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
hue = rgb / np.maximum(rgb.sum(2, keepdims=True), 1e-4)
skin = np.clip((opaque[:, :, 3] - 0.25) / 0.75, 0, 1)
cloth = placed & (skin < 0.5)
h = z / H
out = np.abs(x) / H


def middle(m):
    return np.median(hue[m], 0), float(np.median(lum[m]))


def far(c, l):
    """How unlike a garment's middle a texel is: mostly by hue, so that a fold, darker, stays in its garment."""
    return 4 * np.abs(hue - c).sum(2) + 0.35 * np.abs(np.log(np.maximum(lum, 1e-3) / max(l, 1e-3)))


chest = cloth & (h > 0.62) & (h < 0.74) & (out < 0.14)
c0, l0 = middle(chest)
d0 = far(c0, l0)
# The shorts: what's under the chest and not the shirt's colour (a woman's are cut well above a man's, so no one band finds them).
hips = cloth & (h > 0.38) & (h < 0.56) & (out < 0.2) & (d0 > 0.8)
if hips.sum() < 2000:
    hips = cloth & (h > 0.42) & (h < 0.5) & (out < 0.2)
c1, l1 = middle(hips)
print('KIT chest', c0.round(3), round(l0, 3), 'texels', int(chest.sum()), '| hips', c1.round(3), round(l1, 3), 'texels', int(hips.sum()))
d1 = far(c1, l1)
band = cloth & (h <= HEM_HIGH) & (h >= HEM_LOW)
shirt = cloth & (h > HEM_HIGH) & (h < TOP) & (out < REACH) & (d0 < 0.9)
shorts = cloth & (h < HEM_LOW) & (h > BOTTOM) & (d1 < 0.9)
shirt |= band & (d0 < d1)
shorts |= band & (d1 <= d0)


def spread(v, n, only):
    """`n` passes of the four neighbours' mean, on the texels of `only`."""
    v = v.astype(np.float32)
    for _ in range(n):
        s = (np.roll(v, 1, 0) + np.roll(v, -1, 0) + np.roll(v, 1, 1) + np.roll(v, -1, 1)) * 0.25
        v[only] = s[only]
    return v


# A hem is a line round the body: a fold's few texels of the wrong colour go with their neighbours.
k = spread(shirt, 16, band) > spread(shorts, 16, band)
shirt = (shirt & ~band) | (band & k)
shorts = (shorts & ~band) | (band & ~k)
rims = ~placed
wa = spread(shirt, BLEED, rims)
wb = spread(shorts, BLEED, rims)
# (the leftover at a rim is what the bleed has reached)
wa = np.where(placed, shirt.astype(np.float32) * (1 - skin), np.minimum(wa * 4, 1))
wb = np.where(placed, shorts.astype(np.float32) * (1 - skin), np.minimum(wb * 4, 1))
near_b = wb > wa
alpha = 0.25 + np.where(near_b, (SHORTS - 0.25) * wb, (SHIRT - 0.25) * wa)
print('KIT shirt share', round(float(shirt.mean()), 3), 'shorts', round(float(shorts.mean()), 3))

# ---------- the face ----------
tip = float(fwd[placed & (h > 0.88) & (h < 0.95) & (np.abs(x) < 0.03)].max())
front = placed & (fwd > tip - 0.06) & (np.abs(x) < 0.08) & (h > 0.84)
skin_lum = float(np.median(lum[front & (skin > 0.8)]))
# The whites of the eyes: the only pale, colourless thing on a face.
pale = 1 - rgb.min(2) / np.maximum(rgb.max(2), 1e-4)
whites = front & (pale < 0.3) & (lum > 0.25 * skin_lum) & (h > 0.9) & (h < 0.965) & (np.abs(x) > 0.012) & (np.abs(x) < 0.055)
# (the middle of their span, not of the texels: more white shows outside the iris than in)
across = np.percentile(np.abs(x[whites]), [4, 96])
print('KIT whites', int(whites.sum()), 'texels, across', across.round(4))
eye = [float(across.mean()), float(np.median(z[whites])), float(np.median(fwd[whites]))]
# The mouth: the darkest line across the lips, down the face's middle (the chin's shadow is darker, so only where a mouth can be).
middle_ = front & (np.abs(x) < 0.012) & (z > eye[1] - 0.056 * H) & (z < eye[1] - 0.03 * H)
bins = np.round(z[middle_] * 500).astype(np.int64)
dark = {b: float(lum[middle_][bins == b].mean()) for b in np.unique(bins) if (bins == b).sum() > 8}
mouth_z = min(dark, key=dark.get) / 500
mouth_fwd = float(np.median(fwd[middle_][np.abs(z[middle_] - mouth_z) < 0.003]))
# What a closed eye shows: the lid's skin, a little over the eye.
lid = front & (np.abs(np.abs(x) - eye[0]) < 0.012) & (z > eye[1] + 0.009) & (z < eye[1] + 0.015) & (skin > 0.6)
lid_rgb = [round(float(c), 4) for c in np.median(rgb[lid], 0)]
json.dump({'eye': eye, 'mouth': [mouth_z, mouth_fwd], 'lid': lid_rgb}, open(os.path.join(LOW, 'face.json'), 'w'))
print('KIT face: eye', np.round(eye, 4), 'mouth', round(mouth_z, 4), round(mouth_fwd, 4), 'nose tip', round(tip, 4), 'height', round(H, 3))

normal = read('normal.webp', 'Non-Color')
normal[:, :, 3] = alpha
im = bpy.data.images.new('normal-kit', TEX, TEX, alpha=True)
im.colorspace_settings.name = 'Non-Color'
im.alpha_mode = 'STRAIGHT'
im.pixels.foreach_set(normal.reshape(-1))
path = os.path.join(LOW, 'normal-kit.webp')
im.filepath_raw = path
im.file_format = 'WEBP'
im.save(filepath=path, quality=90)
json.dump({'shirtLum': round(float(np.median(lum[shirt])), 4), 'shortsLum': round(float(np.median(lum[shorts])), 4)}, open(os.path.join(LOW, 'kit.json'), 'w'))
print('KIT brightness', open(os.path.join(LOW, 'kit.json')).read())
