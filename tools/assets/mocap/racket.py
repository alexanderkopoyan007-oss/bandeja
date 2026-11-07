# The racket from its three tape dots (docs/mocap-pilot.md: pink at the top of the head, orange at the widest point on
# the left, green on the right), in every phone's video, triangulated with the session's calibration.
#   ~/bandeja-mocap/venv/bin/python -I tools/assets/mocap/racket.py <calibration.toml> <out.npz> cam1.mp4 cam2.mp4 ...
#   ~/bandeja-mocap/venv/bin/python -I tools/assets/mocap/racket.py --selftest <calibration.toml>
# The videos must be the synchronized ones (same frame count, FreeMoCap's synchronized_videos), in the toml's camera
# order. Out: per frame the three dots (x y z, NaN where fewer than two phones saw one), the face centre, the face's
# normal and the shaft's direction, and each dot's reprojection error; the racket's own shape (the three dots' spacing)
# held to within RIGID_TOL is what tells a good frame (the pilot's gate: 9 of 10 contact frames, 1 cm).
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
    dots, err = solve(cg, pts)
    centre, normal, shaft = pose(dots)
    sp = spacing(dots)
    shape = np.nanmedian(sp, axis=0)
    rigid = np.all(np.abs(sp - shape) <= RIGID_TOL / UNIT, axis=-1)
    np.savez_compressed(out, dots=dots, err=err, centre=centre, normal=normal, shaft=shaft, rigid=rigid, shape=shape)
    print('RACKET', frames, 'frames; all three dots in', int(np.isfinite(dots).all(axis=(1, 2)).sum()), '; rigid within 1 cm in', int(rigid.sum()))


main()
