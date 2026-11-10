# One fixed camera's stroke (from_page.py's page.npz) as retarget.py's input, with what one camera can still be made to
# give (docs/research/footage-pose.md, "One camera, made to hold"):
#   - where the body was: across and up from where the hips were in the picture, and its distance from its size in the
#     picture (a pinhole camera: FOV= its vertical field of view in degrees, a guess: 35; only the travel towards the camera
#     scales with it);
#   - which feet stood: a foot that doesn't move in a fixed camera's picture is on the floor, whatever its guessed depth;
#   - the floor: the plane through where those feet stood (UP=x,y,z in the camera's frame overrides it);
#   - the racket: keys read by eye off the clip's frames (racket-keys.json), handed on with the camera's line of sight;
#   - the free hand's direction.
#   ~/bandeja-mocap/venv/bin/python -I tools/assets/mocap/one_camera.py <clip folder> [out folder]
# Out (FreeMoCap's layout, in the floor's frame: y up from the floor, x the picture's right, mm):
#   mediapipe_body_3d_xyz.npy, mediapipe_left_hand_3d_xyz.npy (or right: the free hand's wrist, knuckles' line and
#   direction only), plants.json, floor.json, racket_keys.json.
import json, os, sys
import numpy as np

src = sys.argv[1]
out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(src, 'output_data')
FOV = float(os.environ.get('FOV', 35))
meta = json.load(open(os.path.join(src, 'meta.json')))
d = np.load(os.path.join(src, 'page.npz'))
body, img, scale, lh, lh_ok = d['body'] / 1000, d['img'], d['scale'], d['lh'], d['lh_ok']
F, fps, A = len(body), meta['fps'], meta.get('aspect', 16 / 9)
RACKET = meta.get('racket_hand', 'Right')
FREE = 'Left' if RACKET == 'Right' else 'Right'
SIDES = {'Left': {'heel': 29, 'toe': 31, 'ankle': 27}, 'Right': {'heel': 30, 'toe': 32, 'ankle': 28}}


def unit(v):
    return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-9)


def smooth(x, n):
    """A running mean over n frames each side, the ends held."""
    if n <= 0:
        return x
    k = np.ones(2 * n + 1) / (2 * n + 1)
    pad = np.concatenate([np.repeat(x[:1], n, 0), x, np.repeat(x[-1:], n, 0)])
    return np.stack([np.convolve(pad[:, c], k, 'valid') for c in range(x.shape[1])], -1) if x.ndim > 1 else np.convolve(pad, k, 'valid')


# ---- the camera's frame: x the picture's right, y its up, z towards the camera; metres ----
f = 0.5 / np.tan(np.radians(FOV) / 2)  # the focal length in picture heights
scale = smooth(scale, 3)
body = body - ((body[:, 23] + body[:, 24]) / 2)[:, None]

# ---- the racket arm where the tracker lost it: placed by eye ----
# Behind the head (an overhead's take-back seen from the net) the tracker puts the racket arm on the free one or hangs it
# by the trunk. racket-keys.json may carry `arm`: at key times, the shoulder as the tracker marked it, the elbow and the
# hand on the handle as read off the cut-out (its pixels, y down, px to the metre), and how far each is nearer the camera
# than the shoulder (m; from the limb's length and the pose, by judgement). Between `arm_from` and the first key the
# tracker's arm eases over to it; after the last it eases back by `arm_to` (video times, both among the keys).
kp = os.path.join(src, 'racket-keys.json')
rk = json.load(open(kp)) if os.path.exists(kp) else None
if rk and rk.get('arm') and meta.get('key_t'):
    from scipy.interpolate import PchipInterpolator
    t_of = dict(zip([round(t, 3) for t in meta['key_t']], meta['key_out']))
    sh, el, wr, fingers = ((12, 14, 16, (18, 20, 22)) if RACKET == 'Right' else (11, 13, 15, (17, 19, 21)))
    ts, es, ws = [], [], []
    for t, sx, sy, ex, ey, bx, by, ppm, ez, hz in rk['arm']:
        e = np.array([(ex - sx) / ppm, -(ey - sy) / ppm, ez])
        h = np.array([(bx - sx) / ppm, -(by - sy) / ppm, hz])
        ts.append(t_of[round(t, 3)])
        es.append(e)
        ws.append(h - 0.07 * unit(h - e))  # the wrist, short of the middle of the grip
    tt = np.arange(F) / fps
    tc = np.clip(tt, ts[0], ts[-1])
    E, Wn = PchipInterpolator(ts, np.array(es))(tc), PchipInterpolator(ts, np.array(ws))(tc)
    t0, t1 = t_of[round(rk['arm_from'], 3)], t_of[round(rk['arm_to'], 3)]
    ease = lambda x: np.clip(x, 0, 1) ** 2 * (3 - 2 * np.clip(x, 0, 1))
    wgt = (ease((tt - t0) / max(ts[0] - t0, 1e-6)) * ease((t1 - tt) / max(t1 - ts[-1], 1e-6)))[:, None]
    move = (body[:, sh] + Wn - body[:, wr]) * wgt
    body[:, el] += (body[:, sh] + E - body[:, el]) * wgt
    for j in (wr,) + fingers:
        body[:, j] += move
    print('ONE_CAMERA racket arm by eye: %d keys, %.2f to %.2f s (eased from %.2f, to %.2f)' % (len(ts), ts[0], ts[-1], t0, t1))

# ---- limbs their own length ----
# One camera's guess makes a limb that points at the camera or away too short (here: a thigh 0.33 m beside its fellow's
# 0.43, an upper arm 0.20 on the way back): what it sees across the picture is right, the depth is pulled in. Each
# upper arm, forearm, thigh and shin is given its length back (the 85th percentile of both sides' through the clip),
# all of it in depth, on the side the guess already had it; what hangs off it moves with it. A limb the guess had
# almost square to the camera (under 6 cm of depth) is eased in, not flipped.
CHAINS = {'Left': ((11, 13, 15, (17, 19, 21)), (23, 25, 27, (29, 31))), 'Right': ((12, 14, 16, (18, 20, 22)), (24, 26, 28, (30, 32)))}
fixed = []
for part in (0, 1):
    for seg in (0, 1):
        ref = np.percentile(np.concatenate([np.linalg.norm(body[:, CHAINS[s][part][seg + 1]] - body[:, CHAINS[s][part][seg]], axis=-1) for s in CHAINS]), 85)
        for s in CHAINS:
            ch = CHAINS[s][part]
            a, b_ = ch[seg], ch[seg + 1]
            v = body[:, b_] - body[:, a]
            dz = smooth(v[:, 2], 8)
            want = np.sqrt(np.maximum(ref * ref - v[:, 0] ** 2 - v[:, 1] ** 2, dz * dz))
            add = smooth((want - np.abs(dz)) * np.sign(dz) * np.clip(np.abs(dz) / 0.06, 0, 1), 3)
            for j in (b_,) + ((ch[2],) if seg == 0 else ()) + ch[3]:
                body[:, j, 2] += add
            fixed.append(np.abs(add).max())
print('ONE_CAMERA limbs given their length back: up to %.0f mm of depth' % (1000 * max(fixed)))

hip = (img[:, 23] + img[:, 24]) / 2
u, v = (hip[:, 0] - 0.5) * A, -(hip[:, 1] - 0.5)
root = np.stack([u / scale, v / scale, -f / scale], -1)
pts = body + root[:, None]
# the line of sight to the body, frame by frame (the picture's own axes turned onto it)
zv = unit(np.stack([-u, -v, np.full(F, f)], -1))
xv = unit(np.array([1.0, 0, 0]) - zv[:, :1] * zv)
yv = np.cross(zv, xv)

# ---- which feet stood: still in the picture ----
V_ON, V_OFF, MIN_FRAMES = 0.16, 0.3, 4
ip = img * np.array([A, 1.0])


def still(j):
    p = smooth(ip[:, j], 1)
    sp = np.zeros(F)
    sp[1:-1] = np.linalg.norm(p[2:] - p[:-2], axis=-1) / 2 * fps
    sp[0], sp[-1] = sp[1], sp[-2]
    return sp / scale  # metres a second at the body's distance


def runs(on_speed, off_speed):
    """Spans where the speed went under V_ON and stayed under V_OFF."""
    spans, a = [], None
    for t in range(F):
        if a is None and on_speed[t] < V_ON:
            a = t
        elif a is not None and off_speed[t] > V_OFF:
            spans.append([a, t - 1])
            a = None
    if a is not None:
        spans.append([a, F - 1])
    return [s for s in spans if s[1] - s[0] + 1 >= MIN_FRAMES]


plants, report = {}, []
for side, ix in SIDES.items():
    toe, heel = still(ix['toe']), still(ix['heel'])
    spans = []
    for a, b in runs(toe, toe):
        flat = float(np.mean(heel[a:b + 1] < V_OFF))
        spans.append({'a': int(a), 'b': int(b), 'flat': bool(flat > 0.7)})
    plants[side] = spans
    report.append('%s %s' % (side, ' '.join('%d-%d%s' % (s['a'], s['b'], '' if s['flat'] else '(toe)') for s in spans)))
print('ONE_CAMERA feet standing (frames):', '; '.join(report))

# ---- the floor: the plane through where they stood ----
on = []
for side, ix in SIDES.items():
    for s in plants[side]:
        on.append(np.median(pts[s['a']:s['b'] + 1, ix['toe']], axis=0))
        if s['flat']:
            on.append(np.median(pts[s['a']:s['b'] + 1, ix['heel']], axis=0))
on = np.array(on)
up_note = ''
if os.environ.get('UP'):
    up = unit(np.array([float(x) for x in os.environ['UP'].split(',')]))
    up_note = 'given'
else:
    up = None
    if len(on) >= 4:
        c = on - on.mean(0)
        sv = np.linalg.svd(c, compute_uv=True)
        n = sv[2][2] * (1 if sv[2][2][1] > 0 else -1)
        spread = sv[1]
        # the standing places must cover some floor both ways, and the plane must be near the picture's own level
        if spread[1] > 0.08 and np.degrees(np.arccos(np.clip(n[1], -1, 1))) < 25:
            up, up_note = n, 'from %d standing places, %.0f mm off the plane' % (len(on), 1000 * np.sqrt(np.mean((c @ n) ** 2)))
    if up is None:
        up = unit(np.array([0, np.cos(np.radians(10)), np.sin(np.radians(10))]))
        up_note = 'assumed (the camera 10 degrees down): too few standing places'
roll = np.degrees(np.arctan2(up[0], up[1]))
if not os.environ.get('UP'):
    # (a camera on a tripod is level side to side: the few standing places' sideways tilt, 3-5 degrees either way
    # between two readings of the same clip, is their own error)
    up = unit(up * [0, 1, 1])
pitch = np.degrees(np.arctan2(up[2], up[1]))
# and the same from the picture alone: a foot on the floor sits (camera height x the body's size) under the horizon
if len(on) >= 2:
    rows_v, rows_s = [], []
    for side, ix in SIDES.items():
        for s in plants[side]:
            rows_v.append(np.median(img[s['a']:s['b'] + 1, ix['toe'], 1]) - 0.5)
            rows_s.append(np.median(scale[s['a']:s['b'] + 1]))
    if np.ptp(rows_s) > 0.01:
        h_cam, v_h = np.polyfit(rows_s, rows_v, 1)
        print('ONE_CAMERA from the picture alone: the camera %.2f m up, the horizon %.2f picture heights above the middle (%.1f degrees down at FOV %g)'
              % (h_cam, -v_h, np.degrees(np.arctan(-v_h / f)), FOV))
print('ONE_CAMERA up %s: the camera looks %.1f degrees down (%s; the fit\'s sideways tilt of %.1f left out)' % (np.round(up, 3), pitch, up_note, roll))
ex = unit(np.array([1.0, 0, 0]) - up[0] * up)
ez = np.cross(ex, up)
R = np.stack([ex, up, ez])  # rows: the camera's frame -> the floor's
floor0 = float(np.median(on @ up)) if len(on) else float(np.nanmin(pts[:, [29, 30, 31, 32]] @ up))
o = root[0]
w = (pts - o) @ R.T
w[..., 1] = pts @ up - floor0
os.makedirs(out, exist_ok=True)
np.save(os.path.join(out, 'mediapipe_body_3d_xyz.npy'), w * 1000)
json.dump(plants, open(os.path.join(out, 'plants.json'), 'w'))
# (head_tilt_deg: retarget.py's lift of the head from the line ears to nose; 13 with real 3D points, 16 less here)
# (forward: the way to the camera along the floor. These clips are filmed from the net's side, and a stroke's forward is
# the net, whichever way the player happens to stand as the clip starts: here 40 degrees round already.)
json.dump({'up': [0, 1, 0], 'y': 0, 'forward': [0, 0, 1], 'note': up_note, 'camera_pitch_deg': round(float(pitch), 2), 'fov_deg': FOV,
           'head_tilt_deg': float(os.environ.get('HEAD_TILT', -3))}, open(os.path.join(out, 'floor.json'), 'w'))
hipw = (w[:, 23] + w[:, 24]) / 2
print('ONE_CAMERA hips travel: %.2f m across, %.2f m towards the camera, height %.2f to %.2f m'
      % (np.ptp(hipw[:, 0]), hipw[-1, 2] - hipw[0, 2], hipw[:, 1].min(), hipw[:, 1].max()))

# ---- the free hand: its wrist, direction and knuckles' line as three points of a hand ----
hand = np.full((F, 21, 3), np.nan)
dv, av = unit(lh[:, 0]) @ R.T, unit(lh[:, 1]) @ R.T
wr = w[:, 15 if FREE == 'Left' else 16]
ok = lh_ok
hand[ok, 0] = wr[ok]
hand[ok, 9] = wr[ok] + dv[ok] * 0.09
hand[ok, 5] = wr[ok] + dv[ok] * 0.085 + av[ok] * 0.03
hand[ok, 17] = wr[ok] + dv[ok] * 0.085 - av[ok] * 0.03
np.save(os.path.join(out, 'mediapipe_%s_hand_3d_xyz.npy' % FREE.lower()), hand * 1000)

# ---- the racket's keys, with the line of sight at each ----
if rk and meta.get('key_t'):
    t_out = dict(zip([round(t, 3) for t in meta['key_t']], meta['key_out']))
    keys = []
    for t, bx, by, cx, cy, wd, near, *more in rk['keys']:
        if round(t, 3) not in t_out:
            continue
        to = t_out[round(t, 3)]
        fr = min(F - 1, max(0, int(round(to * fps))))
        dx, dy = cx - bx, cy - by
        # (how much shorter than life the racket looks is read to 15% at best, which is 35 degrees of lean: it counts
        # only where the key says the tip is plainly nearer or further; else the racket lies in the picture)
        short = float(min(1.0, np.hypot(dx, dy) / rk['px_per_m'] / rk['grip_to_centre_m'])) if near else 1.0
        keys.append({'t': to, 'video_t': t, 'theta': float(np.arctan2(dy, dx)),
                     'c': short, 'near': near, 'w': wd, 'face': more[0] if more else 0,
                     'x': (xv[fr] @ R.T).tolist(), 'y': (yv[fr] @ R.T).tolist(), 'z': (zv[fr] @ R.T).tolist()})
    json.dump({'hand': RACKET, 'keys': keys}, open(os.path.join(out, 'racket_keys.json'), 'w'))
    print('ONE_CAMERA racket keys:', len(keys), 'from', round(keys[0]['t'], 2), 'to', round(keys[-1]['t'], 2), 's')
