# Step 1 of the golden club's sky (tools/assets/golden/build-sky.sh): Blender reads the CC0 Radiance HDR (it parses .hdr
# natively) and writes its linear pixels, halved, as a float32 .npy for sky.py.
#   blender -b --factory-startup --python sky_read.py -- <in.hdr> <out.npy>
import sys, bpy, numpy as np
src, out = sys.argv[sys.argv.index('--') + 1:][:2]
img = bpy.data.images.load(src)
w, h = img.size
a = np.empty(w * h * 4, np.float32)
img.pixels.foreach_get(a)
a = a.reshape(h, w, 4)[::-1, :, :3]  # Blender's rows run bottom-up
a = a.reshape(h // 2, 2, w // 2, 2, 3).mean((1, 3))  # 4k -> 2k box
np.save(out, a.astype(np.float32))
print('sky_read', w, h, '->', a.shape, 'max', float(a.max()))
