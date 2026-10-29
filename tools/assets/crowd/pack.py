# Packs the spectators rendered by make-crowd.py into the game's crowd atlas (public/assets/crowd/), in Blender's
# Python (it has numpy; images are read and written through bpy):
#   blender -b --python tools/assets/crowd/pack.py -- <render-dir> <out-dir> <layout.json>
# Each frame was rendered twice at 2x, with a white shirt (A) and a black one (B). B is the person without the
# shirt's own light; A - B (over the white's albedo) is the light falling on the shirt, so a tint t gives
# B + t * light exactly (in linear light). base.webp holds B (sRGB) and the alpha, shirt.webp the shirt's light,
# sqrt(light / 2) in the red channel (light up to 2, finer in the darks). The layout (cells, views, poses, each
# person's seat height) goes to <layout.json> (data/crowd-atlas.json, which the game imports).
import sys, os, json
import numpy as np
import bpy

args = sys.argv[sys.argv.index('--') + 1:]
src, out, layout_path = args[0], args[1], args[2]
os.makedirs(out, exist_ok=True)
meta = json.load(open(os.path.join(src, 'meta.json')))
cw, ch = meta['cell']
views, poses, people = meta['views'], meta['poses'], meta['people']
n = len(people) * len(poses) * len(views)
cols = 2048 // cw
rows = -(-n // cols)
base = np.zeros((rows * ch, cols * cw, 4), np.float32)
light = np.zeros((rows * ch, cols * cw), np.float32)


def lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def load(path):
    im = bpy.data.images.load(path)
    im.colorspace_settings.name = 'Non-Color'
    w, h = im.size
    a = np.array(im.pixels[:], np.float32).reshape(h, w, 4)[::-1]
    bpy.data.images.remove(im)
    rgb = lin(a[..., :3])
    al = a[..., 3:4]
    return rgb, al


def down(img):
    """2x box filter (premultiplied colour in, premultiplied out)."""
    h, w = img.shape[:2]
    return img.reshape(h // 2, 2, w // 2, 2, -1).mean((1, 3))


def bleed(rgb, al, iters=6):
    """Spread colour into transparent pixels so filtering at the edges doesn't pull in black."""
    rgb = rgb.copy()
    have = al[..., 0] > 0.02
    for _ in range(iters):
        acc = np.zeros_like(rgb)
        cnt = np.zeros(have.shape, np.float32)
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            sh = np.roll(np.roll(have, dy, 0), dx, 1)
            acc += np.roll(np.roll(rgb, dy, 0), dx, 1) * sh[..., None]
            cnt += sh
        grow = (~have) & (cnt > 0)
        rgb[grow] = acc[grow] / cnt[grow][:, None]
        have = have | grow
    return rgb


cells = []
k = 0
for p in people:
    for pose in poses:
        for v in views:
            ra, aa = load(os.path.join(src, f"{p['name']}-{pose}-{v}-A.png"))
            rb, ab = load(os.path.join(src, f"{p['name']}-{pose}-{v}-B.png"))
            # Blender writes straight (unpremultiplied) colour; filter premultiplied.
            pa = down(np.concatenate([ra * aa, aa], 2))
            pb = down(np.concatenate([rb * ab, ab], 2))
            al = pa[..., 3:4]
            safe = np.maximum(al, 1e-4)
            a_rgb = pa[..., :3] / safe
            b_rgb = pb[..., :3] / safe
            lum = lambda c: 0.2126 * c[..., 0] + 0.7152 * c[..., 1] + 0.0722 * c[..., 2]
            li = np.clip(lum(a_rgb - b_rgb) / meta['shirt'], 0, 2)
            b_rgb = bleed(b_rgb, al)
            r, c = divmod(k, cols)
            y0, x0 = r * ch, c * cw
            base[y0:y0 + ch, x0:x0 + cw, :3] = b_rgb
            base[y0:y0 + ch, x0:x0 + cw, 3] = al[..., 0]
            light[y0:y0 + ch, x0:x0 + cw] = li
            k += 1

def save(name, rgba):
    h, w = rgba.shape[:2]
    im = bpy.data.images.new(name, w, h, alpha=True)
    im.colorspace_settings.name = 'Non-Color'
    im.pixels[:] = np.ascontiguousarray(rgba[::-1]).reshape(-1)
    im.file_format = 'WEBP'
    im.save(filepath=os.path.join(out, name), quality=90)
    bpy.data.images.remove(im)


save('base.webp', np.concatenate([srgb(base[..., :3]), base[..., 3:4]], 2))
l8 = np.sqrt(np.clip(light / 2, 0, 1))
save('shirt.webp', np.stack([l8, l8, l8, np.ones_like(l8)], 2))
layout = {
    'cell': [cw, ch], 'cols': cols, 'rows': rows, 'size': meta['size'], 'views': views, 'poses': poses,
    'elevation': meta['elevation'], 'people': [{'name': p['name'], 'seat': p['seat']} for p in people],
}
json.dump(layout, open(layout_path, 'w'), indent=1)
print('PACKED', n, 'frames', cols * cw, 'x', rows * ch, {f: os.path.getsize(os.path.join(out, f)) // 1024 for f in ('base.webp', 'shirt.webp')}, 'KB')
