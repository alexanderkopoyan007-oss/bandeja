# Step 2 of the golden club's sky (tools/assets/golden/build-sky.sh): the CC0 sky's sun taken out and measured, the rest
# turned so the sun stands where the arena wants it, written as an sRGB WebP and a few numbers for data/arenas.json.
#   ~/bandeja-mocap/venv/bin/python -I sky.py <sky2k.npy> <out.webp> <sun azimuth deg> <sun irradiance wanted>
# Equirectangular as three's `equirectUV` reads it: column -> azimuth atan2(z, x) from -180 to 180 deg left to right, row 0
# at the zenith. The sun is the pixels over SUN_T (well above any cloud); its light is the sum of their radiance x solid
# angle (the irradiance it gives a surface facing it), its direction their light-weighted mean. In its place the disc is
# filled from the ring round it, so the sky keeps its glow and the arena's directional light (with its shadows) is the sun.
# `scale`: the radiance one unit of the WebP stands for, in the game's light units (the arena's key = the sun's irradiance
# times the same factor, so sky and sun keep the ratio the photograph measured).
import sys, json, numpy as np
from PIL import Image
src, out, az_want, e_want = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4])
a = np.load(src).astype(np.float64)
H, W, _ = a.shape
L = a @ np.array([0.2126, 0.7152, 0.0722])
el = (0.5 - (np.arange(H) + 0.5) / H) * np.pi
az = ((np.arange(W) + 0.5) / W - 0.5) * 2 * np.pi
dO = (np.pi / H) * (2 * np.pi / W) * np.cos(el)[:, None]
SUN_T = 200.0
# The disc and the camera's flare round it (radiance over ~50, 400x the sky's median, out to about a degree) are the sun.
FILL_DEG = 1.0
sun = L > SUN_T
w = (L * dO) * sun
E_rgb = (a * (dO * sun)[..., None]).reshape(-1, 3).sum(0)
cx, cy, cz = (np.cos(el)[:, None] * np.cos(az)[None, :]), np.sin(el)[:, None] * np.ones((1, W)), np.cos(el)[:, None] * np.sin(az)[None, :]
d = np.array([(w * cx).sum(), (w * cy).sum(), (w * cz).sum()]); d /= np.linalg.norm(d)
sun_el = np.degrees(np.arcsin(d[1])); sun_az = np.degrees(np.arctan2(d[2], d[0]))
# the disc's angular radius, then fill disc + 1.5x with the ring just outside it (its mean, per row: keeps the gradient)
ys, xs = np.nonzero(sun)
cosang = cx * d[0] + cy * d[1] + cz * d[2]
ang = np.degrees(np.arccos(np.clip(cosang, -1, 1)))
r_disc = ang[sun].max()
fill = ang < FILL_DEG
ring = (ang >= FILL_DEG) & (ang < FILL_DEG + 0.3)
ring_mean = a[ring].mean(0)
a[fill] = ring_mean
# sky irradiance on the ground (upper half), after the sun is out
Lr = a @ np.array([0.2126, 0.7152, 0.0722])
E_sky = (Lr * dO * np.clip(np.sin(el), 0, None)[:, None]).sum()
E_sun = float(E_rgb @ np.array([0.2126, 0.7152, 0.0722]))
k = e_want / E_sun
# turn: the sun's column to the azimuth wanted
shift = int(round((az_want - sun_az) / 360 * W))
a = np.roll(a, shift, axis=1)
# Encoded v = x / (1 + x), x = radiance / UNIT (the game decodes x = v / (1 - v)): the deep blue keeps its steps small and the
# glow round the sun (to 30 x UNIT, v 0.968) still fits in 8 bits. Lossless: a lossy step near v = 1 is a doubling.
UNIT = 0.5
x = np.clip(a / UNIT, 0, 30)
v = x / (1 + x)
Image.fromarray((v * 255 + 0.5).astype(np.uint8)).save(out, lossless=True, quality=100, method=6)
scale_tex = UNIT
sd = [float(np.cos(np.radians(sun_el)) * np.cos(np.radians(az_want))), float(np.sin(np.radians(sun_el))), float(np.cos(np.radians(sun_el)) * np.sin(np.radians(az_want)))]
col = E_rgb / E_rgb.max()
print(json.dumps({
    'sunElevationDeg': round(float(sun_el), 2), 'sunDiscDeg': round(float(r_disc), 2), 'sunDir': [round(x, 4) for x in sd],
    'sunColour': '#%02x%02x%02x' % tuple(int(round(255 * (c ** (1 / 2.2)))) for c in col),
    'keyIntensity': round(e_want, 3), 'skyScale': round(scale_tex * k, 4),
    'measured': {'E_sun': round(E_sun, 2), 'E_sky_horizontal': round(float(E_sky), 3), 'sun_on_ground_over_sky': round(E_sun * float(np.sin(np.radians(sun_el))) / float(E_sky), 2)},
    'bytes': __import__('os').path.getsize(out)}, indent=1))
