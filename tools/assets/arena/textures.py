# The arena's surface maps (public/assets/arena/<name>-{diff,nor,arm}.webp) from the CC0 sets downloaded to
# assets-src/textures/<source>/<set>/ (not in the repository; CREDITS.md lists each): colour, normal (OpenGL, +y up) and the
# packed occlusion / roughness / metalness, 1024 px, WebP.
#   ~/bandeja-mocap/venv/bin/python -I tools/assets/arena/textures.py
# The colour map is flattened to its own mean: a surface is tinted by the arena's own colour (data/arenas.json) and takes only
# the set's variation, so the map's large-scale tone must not tile visibly; `flat` is how much of the low frequencies go.
import os, sys
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..')
SRC = os.path.join(ROOT, 'assets-src', 'textures')
OUT = os.path.join(ROOT, 'public', 'assets', 'arena')
SETS = {
    # name: (folder, file stem, how much of the colour's low frequencies to remove)
    'concrete': ('polyhaven/concrete_floor_worn_001', 'concrete_floor_worn_001', 0.6),
    'corrugated': ('polyhaven/corrugated_iron_02', 'corrugated_iron_02', 0.5),
}
os.makedirs(OUT, exist_ok=True)
for name, (folder, stem, flat) in SETS.items():
    d = os.path.join(SRC, folder)
    diff = Image.open(os.path.join(d, stem + '_diff_1k.jpg')).convert('RGB')
    a = np.asarray(diff).astype(np.float32)
    low = np.asarray(diff.filter(ImageFilter.GaussianBlur(96))).astype(np.float32)
    mean = a.reshape(-1, 3).mean(0)
    a = np.clip(a - (low - mean) * flat, 0, 255)
    Image.fromarray(a.astype(np.uint8)).save(os.path.join(OUT, name + '-diff.webp'), quality=86, method=6)
    Image.open(os.path.join(d, stem + '_nor_gl_1k.jpg')).convert('RGB').save(os.path.join(OUT, name + '-nor.webp'), quality=90, method=6)
    Image.open(os.path.join(d, stem + '_arm_1k.jpg')).convert('RGB').save(os.path.join(OUT, name + '-arm.webp'), quality=84, method=6)
    lum = (a @ np.array([0.2126, 0.7152, 0.0722], np.float32)).mean() / 255
    print(name, 'mean colour', (mean / 255).round(3).tolist(), 'luminance', round(float(lum), 3),
          'sizes', [os.path.getsize(os.path.join(OUT, f'{name}-{k}.webp')) // 1024 for k in ('diff', 'nor', 'arm')], 'KB')
