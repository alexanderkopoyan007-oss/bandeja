# Step 2 of the impostors (after impostor.py): the atlases to WebP for public/assets/arena/golden/. The island trees stand on a
# pale patch of their own ground, which the cards must not show: in each view's lowest 6 %, pale grey pixels lose their alpha.
#   ~/bandeja-mocap/venv/bin/python -I atlas.py <npy dir> <out dir> <name>...
import sys, os, numpy as np
from PIL import Image
src, out, names = sys.argv[1], sys.argv[2], sys.argv[3:]
for name in names:
    al = np.load(os.path.join(src, f'{name}-albedo.npy'))
    no = np.load(os.path.join(src, f'{name}-normal.npy'))
    H = al.shape[0] // 2
    rgb = al[..., :3].astype(np.float32) / 255
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722])
    sat = rgb.max(-1) - rgb.min(-1)
    rows = np.arange(al.shape[0]) % H
    low = (rows >= H * 0.94)[:, None]
    ground = low & (lum > 0.45) & (sat < 0.12)
    al[ground, 3] = 0
    no[..., 3] = al[..., 3]
    Image.fromarray(al, 'RGBA').save(os.path.join(out, f'{name}-albedo.webp'), quality=88, method=6, exact=False)
    # the normal atlas keeps its alpha too (unused by the game, but it keeps WebP from smearing the bled edges)
    Image.fromarray(no[..., :3], 'RGB').save(os.path.join(out, f'{name}-normal.webp'), quality=90, method=6)
    print(name, 'ground px cut', int(ground.sum()), 'KB', [os.path.getsize(os.path.join(out, f'{name}-{k}.webp')) // 1024 for k in ('albedo', 'normal')])
