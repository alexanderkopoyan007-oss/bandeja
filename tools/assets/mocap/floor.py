# The court's floor from where the player's feet stood (FreeMoCap's 3D, mm): used by retarget.py (up) and takes.py.
import numpy as np

HEELS_TOES = (29, 30, 31, 32)  # MediaPipe: left heel, right heel, left toe, right toe


def floor_up(body, fps):
    """Returns (up, note, a point on the floor), up None if not found. Up as the floor's normal, the floor from where the feet stood: every heel and toe point held still (under 0.25 m/s
    for five frames) is on the court, and a plane through them (RANSAC, 3 cm) over a metre or more of court gives up to
    a fraction of a degree. The calibration doesn't give it: its space is the first phone's (calibrate.py). None if the
    feet didn't stand on enough of the court (then up from the trunk, as before the pilot: a padel ready stance leans
    the trunk 10-20 degrees, so that's the fallback only)."""
    F = len(body)
    pts = []
    for k in (HEELS_TOES):
        x = body[:, k]
        v = np.linalg.norm(x[4:] - x[:-4], axis=-1) / 4 * fps / 1000  # m/s over four frames (mm in)
        still = np.zeros(F, bool)
        still[2:-2] = v < 0.25
        pts.append(x[still & np.isfinite(x).all(1)])
    pts = np.concatenate(pts)
    if len(pts) < 50:
        return None, 'too few planted feet (%d points)' % len(pts), None
    rng = np.random.default_rng(0)
    best, n_best = None, 0
    for _ in range(400):
        a, b, c = pts[rng.choice(len(pts), 3, replace=False)]
        n = np.cross(b - a, c - a)
        if np.linalg.norm(n) < 1e-6:
            continue
        n = n / np.linalg.norm(n)
        inl = np.abs((pts - a) @ n) < 30.0
        if inl.sum() > n_best:
            best, n_best = inl, inl.sum()
    q = pts[best]
    c = q.mean(0)
    _, sv, vt = np.linalg.svd(q - c, full_matrices=False)
    n = vt[2]
    hip = np.nanmean((body[:, 23] + body[:, 24]) / 2, axis=0)
    if np.dot(hip - c, n) < 0:
        n = -n
    spread = sv[:2] / np.sqrt(len(q)) * 2  # about the planted points' extent (two standard deviations), mm
    if spread.min() < 800:
        return None, 'the feet stood on too little of the court (%.0f x %.0f mm)' % tuple(spread), None
    return n, '%d planted points over %.1f x %.1f m' % (len(q), spread[0] / 1000, spread[1] / 1000), c

