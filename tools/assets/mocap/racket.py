# The racket from its three tape dots (docs/mocap-pilot.md: pink at the top of the head, orange at the widest point on
# the left, green on the right), in every phone's video, triangulated with the session's calibration.
#   ~/bandeja-mocap/venv/bin/python -I tools/assets/mocap/racket.py <calibration.toml> <out.npz> cam1.mp4 cam2.mp4 ...
#   ~/bandeja-mocap/venv/bin/python -I tools/assets/mocap/racket.py --selftest <calibration.toml>
# The videos must be the synchronized ones (same frame count, FreeMoCap's synchronized_videos), in the toml's camera
# order. With sync.py's sync.npz in the recording folder, each phone's dots are first moved to the output frame's own
# moment: a phone's frame can sit up to half a frame (4 ms at 120 fps) off it, and at contact the racket's face covers
# 10 cm in that time. The three dots move together, so the shape check doesn't see it; the racket just lands centimetres
# off (selftest at 25 m/s, phones 2.2 ms apart: 21 mm off as cut, 1.3 mm retimed). Out: per frame the three dots (x y z, NaN where fewer than two phones saw one), the face centre, the face's
# normal and the shaft's direction, and each dot's reprojection error; the racket's own shape (the three dots' spacing)
# held to within RIGID_TOL is what tells a good frame (the pilot's gate: 9 of 10 contact frames, 1 cm).
import os
import sys
import numpy as np
import cv2
from aniposelib.cameras import CameraGroup

# HSV ranges (OpenCV: H 0-179) for fluorescent tape in daylight; the pilot's footage will tune them.
COLOURS = {'pink': ((150, 90, 120), (175, 255, 255)), 'orange': ((5, 120, 150), (20, 255, 255)), 'green': ((40, 90, 120), (80, 255, 255))}
ORDER = ('pink', 'orange', 'green')
MIN_AREA = 6  # pixels: a 2 cm dot at 8 m on a 1080p phone is about 5 px across
RIGID_TOL = 0.01
# Metres per calibration unit: FreeMoCap's calibration is in the board's square size as typed in, in mm.
UNIT = 0.001


def find_dots(frame_bgr):
    """Each colour's largest blob centre in a frame (px), NaN where none."""
    hsv = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2HSV)
    out = np.full((len(ORDER), 2), np.nan)
    for i, c in enumerate(ORDER):
        lo, hi = COLOURS[c]
        m = cv2.inRange(hsv, np.array(lo), np.array(hi))
        n, _, stats, cent = cv2.connectedComponentsWithStats(m)
        if n > 1:
            j = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
            if stats[j, cv2.CC_STAT_AREA] >= MIN_AREA:
                out[i] = cent[j]
    return out


def solve(cg, pts2d):
    """pts2d: cams x frames x 3 x 2 -> dots frames x 3 x 3 (calibration units), error frames x 3 (px)."""
    C, F = pts2d.shape[:2]
    flat = pts2d.reshape(C, F * 3, 2)
    p3 = cg.triangulate(flat, progress=False)
    err = cg.reprojection_error(p3, flat, mean=True)
    seen = (~np.isnan(flat[..., 0])).sum(0)
    p3[seen < 2] = np.nan
    return p3.reshape(F, 3, 3), np.asarray(err).reshape(F, 3)


def pose(dots):
    """Face centre (between the side dots, a third of the way to the tip), the face's normal, the shaft's direction."""
    tip, left, right = dots[:, 0], dots[:, 1], dots[:, 2]
    side_mid = (left + right) / 2
    centre = side_mid + (tip - side_mid) / 3
    shaft = tip - side_mid
    shaft /= np.linalg.norm(shaft, axis=-1, keepdims=True)
    normal = np.cross(left - tip, right - tip)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    return centre, normal, shaft


def spacing(dots):
    return np.stack([np.linalg.norm(dots[:, 0] - dots[:, 1], axis=-1), np.linalg.norm(dots[:, 0] - dots[:, 2], axis=-1),
                     np.linalg.norm(dots[:, 1] - dots[:, 2], axis=-1)], axis=-1)


def retime(track, lag, src, fps):
    """One phone's dots (frames x 3 x 2) as seen at each output frame's moment plus lag (s, sync.py), moved to the output
    frames' own moments along the phone's own frames (a source frame the cut repeated counted once): a Catmull-Rom curve
    through the four frames round the moment (a swing's arc turns 10-20 degrees a frame; a straight line between two
    frames cuts the corner by up to a centimetre), a straight line where an outer one didn't see the dot, NaN where an
    inner one didn't."""
    F = len(track)
    first = np.ones(F, bool)
    first[1:] = src[1:F] != src[:F - 1]
    j = np.nonzero(first)[0]
    m = np.arange(F) / fps + lag[:F]
    T = np.arange(F) / fps
    k = np.clip(np.searchsorted(m[j], T), 1, len(j) - 1)
    a, b = j[k - 1], j[k]
    a0, b1 = j[np.maximum(k - 2, 0)], j[np.minimum(k + 1, len(j) - 1)]
    u = ((T - m[a]) / (m[b] - m[a]))[:, None, None]
    p0, p1, p2, p3 = track[a0], track[a], track[b], track[b1]
    line = p1 * (1 - u) + p2 * u
    cubic = 0.5 * (2 * p1 + (p2 - p0) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u ** 2 + (3 * p1 - p0 - 3 * p2 + p3) * u ** 3)
    return np.where(np.isfinite(cubic), cubic, line)


AV_SEARCH = 0.03  # s either way, in 2 ms steps, then a millisecond either way of the best in 0.1 ms steps
AV_FRAMES = 300  # the fastest frames used (the search triangulates them 52 times a phone a round)


def picture_delays(cg, raw, lag, src, fps, ref=0, rounds=4):
    """How much later than its own sound each phone's picture runs, against the reference phone's (s): the delay that,
    taken off the moments sync.py found by sound, makes the racket's fastest frames triangulate best. At 25 m/s a
    millisecond between phones puts the dots 2.5 cm apart, several pixels at court distances, so this finds it to a
    fraction of a millisecond. A delay shared by every phone can't be seen this way (and the game's contact timing,
    1/30 s, doesn't need it). raw: phones x frames x 3 x 2 as found in the synchronized videos; lag, src: sync.npz's."""
    C, F = raw.shape[:2]
    every = np.isfinite(raw).all(axis=(0, 2, 3))
    step = np.linalg.norm(np.diff(raw, axis=1), axis=-1).max(-1)  # phones x frames-1, px a frame
    speed = np.concatenate([np.nanmin(step, axis=0), [np.nan]])
    cand = np.nonzero(every & np.isfinite(speed) & (np.arange(F) > 1) & (np.arange(F) < F - 2))[0]
    delay = np.zeros(C)
    if len(cand) < 8:
        return delay, 0
    fast = cand[np.argsort(-speed[cand])[:AV_FRAMES]]

    def cost(tracks):
        sub = np.array([t[fast] for t in tracks]).reshape(C, -1, 2)
        p3 = cg.triangulate(sub, progress=False)
        e = np.sort(cg.reprojection_error(p3, sub, mean=True)[np.isfinite(p3).all(1)])
        return float(np.mean(e[:max(1, int(0.9 * len(e)))] ** 2))  # squared, the worst tenth left out (a stray blob)
    for _ in range(rounds):
        for k in range(C):
            if k == ref:
                continue
            tracks = [retime(raw[c], lag[c] - delay[c], src[c], fps) for c in range(C)]
            best = 0.0
            for grid in (np.arange(-AV_SEARCH, AV_SEARCH + 1e-12, 0.002), best + np.arange(-0.001, 0.001 + 1e-12, 0.0001)):
                if len(grid) < 25:
                    grid = best + np.arange(-0.001, 0.001 + 1e-12, 0.0001)
                costs = []
                for d in grid:
                    tracks[k] = retime(raw[k], lag[k] - d, src[k], fps)
                    costs.append(cost(tracks))
                best = float(grid[int(np.nanargmin(costs))])
            delay[k] = best
    return delay, len(fast)


def selftest(toml):
    """Dots on a racket swinging through the calibrated space, drawn into blank frames for each camera and found again."""
    cg = CameraGroup.load(toml)
    unit = 1 / UNIT
    F = 40
    t = np.linspace(0, 1, F)
    # a racket's dots (m): tip 0.22 m above the face's middle, sides 0.13 m either way, swung round a point 2.5 m out
    local = np.array([[0, 0.22, 0], [-0.13, 0.05, 0], [0.13, 0.05, 0]])
    pivot = np.array([0.0, 0.0, 2.5])
    truth = np.zeros((F, 3, 3))
    for f in range(F):
        a = -1.2 + 2.4 * t[f]
        R = cv2.Rodrigues(np.array([0.3, a, 0.2]))[0]
        truth[f] = (local @ R.T + pivot) * unit  # (in the first camera's space)
    proj = cg.project(truth.reshape(-1, 3)).reshape(len(cg.cameras), F, 3, 2)
    found = np.full_like(proj, np.nan)
    bgr = {'pink': (180, 105, 255), 'orange': (0, 140, 255), 'green': (60, 220, 60)}
    for ci, cam in enumerate(cg.cameras):
        w, h = cam.get_size()
        for f in range(F):
            img = np.full((h, w, 3), 90, np.uint8)
            for di, c in enumerate(ORDER):
                x, y = proj[ci, f, di]
                if 0 <= x < w and 0 <= y < h:
                    cv2.circle(img, (int(round(x)), int(round(y))), 4, bgr[c], -1)
            found[ci, f] = find_dots(img)
    dots, err = solve(cg, found)
    good = np.isfinite(dots).all(axis=(1, 2))
    d = np.linalg.norm(dots[good] - truth[good], axis=-1) / unit
    sp = spacing(dots[good]) / unit
    print('SELFTEST frames with all dots', int(good.sum()), 'of', F, '| position error mm median %.1f max %.1f' % (1000 * np.median(d), 1000 * d.max()),
          '| spacing sd mm %.2f' % (1000 * sp.std(0).max()), '| reprojection px median %.2f' % np.nanmedian(err))

    # A racket's face at about 23 m/s (swung round in a circle so it stays in every phone's view), filmed at 120 fps by
    # phones whose frames sit off the output frames by up to half a frame (as sync.py's cut leaves them) and whose
    # pictures run a few ms off their own sound: as cut, retimed by sync.npz, then with the delays picture_delays() finds.
    fps, F = 120, 90
    C = len(cg.cameras)
    rng = np.random.default_rng(5)
    lag = rng.uniform(-0.5, 0.5, (C, 1)) / fps + rng.normal(0, 0.0002, (C, F))
    lag[0] = 0
    late = np.array([0.0, 0.0052, -0.0031])[:C]  # each picture after its sound (s)
    src = np.tile(np.arange(F), (C, 1))
    arm = local + np.array([0, 0.45, 0])

    def racket_at(t):
        R = cv2.Rodrigues(np.array([0.3, 0.2, 45.0 * t]))[0]
        return (arm @ R.T + pivot) * unit
    seen = np.zeros((C, F, 3, 2))
    for ci in range(C):
        cam = cg.cameras[ci]
        w, h = cam.get_size()
        Rc = cv2.Rodrigues(np.asarray(cam.get_rotation(), float))[0]
        K_ = cam.get_camera_matrix()
        for f in range(F):
            X = racket_at(f / fps + lag[ci, f] - late[ci])
            p = cam.project(X).reshape(3, 2) + rng.normal(0, 0.3, (3, 2))
            # a phone sees only what lies within its view's angle (the lens model folds points from outside back in)
            Xc = X @ Rc.T + np.asarray(cam.get_translation(), float)
            inside = (Xc[:, 2] > 0) & (np.abs(Xc[:, 0] / Xc[:, 2]) < w / 2 / K_[0, 0]) & (np.abs(Xc[:, 1] / Xc[:, 2]) < h / 2 / K_[1, 1])
            seen[ci, f] = np.where(inside[:, None], p, np.nan)
    truth = np.array([racket_at(f / fps) for f in range(F)])
    found, n_fast = picture_delays(cg, seen, lag, src, fps)
    runs = (('as cut', seen, None), ('retimed', None, np.zeros(C)), ('retimed, picture delays found', None, found))
    for label, pts, d in runs:
        if pts is None:
            pts = np.array([retime(seen[ci], lag[ci] - d[ci], src[ci], fps) for ci in range(C)])
        dots, _ = solve(cg, pts)
        ok = np.isfinite(dots).all(axis=(1, 2))
        ok[[0, -1]] = False
        dd = np.linalg.norm(dots[ok] - truth[ok], axis=-1) / unit
        print('SELFTEST 23 m/s, phones up to %.1f ms apart and pictures %s ms off their sound, %s: racket off by mm median %.1f max %.1f (%d frames)'
              % (1000 * np.ptp(lag[:, 0]), (1000 * late).round(1).tolist(), label, 1000 * np.median(dd), 1000 * dd.max(), int(ok.sum())))
    print('SELFTEST picture delays found', (1000 * found).round(2).tolist(), 'ms from', n_fast, 'fast frames; truth', (1000 * late).round(2).tolist())


def main():
    if sys.argv[1] == '--selftest':
        return selftest(sys.argv[2])
    toml, out, videos = sys.argv[1], sys.argv[2], sys.argv[3:]
    cg = CameraGroup.load(toml)
    caps = [cv2.VideoCapture(v) for v in videos]
    frames = min(int(c.get(cv2.CAP_PROP_FRAME_COUNT)) for c in caps)
    pts = np.full((len(caps), frames, 3, 2), np.nan)
    for f in range(frames):
        for ci, c in enumerate(caps):
            ok, img = c.read()
            if ok:
                pts[ci, f] = find_dots(img)
    rec = os.path.dirname(os.path.dirname(os.path.abspath(videos[0])))
    sync_npz = os.path.join(rec, 'sync.npz')
    cams = [os.path.splitext(os.path.basename(v))[0] for v in videos]
    delay = np.zeros(len(videos))
    if os.path.exists(sync_npz):
        import json
        Z = np.load(sync_npz)
        S = json.load(open(os.path.join(rec, 'sync.json')))
        names = [c['name'] for c in S['cams']]
        ks = [names.index(c) for c in cams]
        lag, src, fps = Z['lag'][ks], Z['src'][ks], S['fps']
        delay, n_fast = picture_delays(cg, pts, lag, src, fps)
        pts = np.array([retime(pts[ci], lag[ci] - delay[ci], src[ci], fps) for ci in range(len(videos))])
        print('RACKET dots moved to the output frames\' moments (sync.npz); pictures after the first phone\'s by',
              dict(zip(cams, (1000 * delay).round(2).tolist())), 'ms, from', n_fast, 'fast frames',
              '(sync.py refine takes these up)' if np.abs(delay).max() > 0.0005 else '')
    dots, err = solve(cg, pts)
    centre, normal, shaft = pose(dots)
    sp = spacing(dots)
    shape = np.nanmedian(sp, axis=0)
    rigid = np.all(np.abs(sp - shape) <= RIGID_TOL / UNIT, axis=-1)
    np.savez_compressed(out, dots=dots, err=err, centre=centre, normal=normal, shaft=shaft, rigid=rigid, shape=shape,
                        cams=np.array(cams), picture_delay=delay)
    print('RACKET', frames, 'frames; all three dots in', int(np.isfinite(dots).all(axis=(1, 2)).sum()), '; rigid within 1 cm in', int(rigid.sum()))


main()
