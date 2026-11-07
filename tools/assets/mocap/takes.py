# One processed recording's strokes as takes, each labelled for the shot list's cells (docs/mocap-shotlist.md):
#   PY=~/bandeja-mocap/venv/bin/python
#   $PY -I tools/assets/mocap/takes.py <recording> [more recordings...]    writes <recording>/takes.json, prints coverage
#   $PY -I tools/assets/mocap/takes.py --selftest
# A take is the player's contact (a pop sync.py traced to the racket or the hitting hand) and the frames round it. Its
# labels, all measured: the hand (the racket's side of the hips, for the hitting hand: the wrist nearer the racket); the
# ball's height over the floor (the floor from the planted feet, floor.py) and how far out to the side and in front of the
# hips; the racket's speed; the family, from the pops sync.py placed on the court between the feeder's hit (the last pop
# past the net) and the contact: no bounce on the player's side is a volley; a bounce, a groundstroke (a lob if the racket
# went up through the ball, else a drive); a bounce then the glass, the same off the glass; met over 1.9 m, an overhead
# (a smash from 22 m/s, else a bandeja or víbora, which <recording>/labels.json can settle: {"take index": "family"}).
# The planted feet per frame go with each take (the game pins them). The court's axes: up from the floor, towards the net
# along phone 1's view (behind the back glass, middle: docs/mocap-pilot.md), the net NET_FROM_PHONE1 along it.
import json
import os
import re
import sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from floor import floor_up  # noqa: E402

UNIT = 0.001
NET_FROM_PHONE1 = 10.3  # m: phone 1 sits 0.3 m behind the back glass, the net 10 m from it
WALL_NEAR = 0.4  # m: a pop this close to a wall's plane is the glass
HALF_W = 5.0  # m: the side walls from the centre line
OVERHEAD = 1.9  # m: contact height above which a stroke is an overhead
SMASH = 22.0  # m/s: an overhead's racket this fast is a smash
LOB_UP = 0.5  # the racket's path at contact rising this steeply (sine) is a lob
BEFORE, AFTER = 1.0, 0.7  # s of take round the contact
L_WR, R_WR, L_EL, R_EL, L_HIP, R_HIP = 15, 16, 13, 14, 23, 24
# the shot list's bins (tools/shot-list.ts: keep in step)
HEIGHT = [(0.6, 'low'), (1.2, 'mid'), (2.0, 'high'), (99, 'overhead')]
OUT = [(0.5, 'close'), (0.9, 'arm out'), (99, 'reaching')]


def binned(v, bins):
    return next(lbl for t, lbl in bins if v < t)


def court_axes(up):
    """Up, towards the net (phone 1's view, camera space +z, laid on the floor) and across (to the right looking at it)."""
    fwd = np.array([0, 0, 1.0]) - up[2] * up
    fwd /= np.linalg.norm(fwd)
    return up, fwd, np.cross(fwd, up)


def label(rec, fps=None):
    S = json.load(open(os.path.join(rec, 'sync.json')))
    fps = fps or S['fps']
    body = np.load(os.path.join(rec, 'output_data', 'mediapipe_body_3d_xyz.npy'))
    up, note, floor_pt = floor_up(body, fps)
    if up is None:
        raise SystemExit(f'{rec}: no floor from the feet ({note})')
    body = body * UNIT
    floor_pt = floor_pt * UNIT
    up, fwd, right = court_axes(up)
    R = np.load(os.path.join(rec, 'racket.npz'))
    rc, rigid = R['centre'] * UNIT, R['rigid']
    F = len(body)
    seen = rigid & np.isfinite(rc).all(1)
    # the hitting hand: the wrist the racket stays nearer
    dl = np.nanmedian(np.linalg.norm(body[seen, L_WR] - rc[seen], axis=1)) if seen.any() else np.inf
    dr = np.nanmedian(np.linalg.norm(body[seen, R_WR] - rc[seen], axis=1)) if seen.any() else np.inf
    hand_w, hand_e, handed = (R_WR, R_EL, 1) if dr <= dl else (L_WR, L_EL, -1)
    # planted feet, per frame: heel and toe still (0.25 m/s) and on the floor (6 cm)
    planted = np.zeros((F, 2), bool)
    for side, (he, to) in enumerate(((29, 31), (30, 32))):
        ok = np.ones(F, bool)
        for k in (he, to):
            x = body[:, k]
            v = np.full(F, np.inf)
            v[2:-2] = np.linalg.norm(x[4:] - x[:-4], axis=1) / 4 * fps
            ok &= (v < 0.25) & (((x - floor_pt) @ up) < 0.06 + 0.04)  # (heel and toe points sit some 4 cm up)
        planted[:, side] = ok

    def at(track, f):
        i = int(np.floor(f))
        if i < 0 or i + 1 >= len(track):
            return np.full(3, np.nan)
        return track[i] + (track[i + 1] - track[i]) * (f - i)

    pops = S['pops']
    mine = [i for i, p in enumerate(pops) if p.get('used') and p.get('source') in ('racket', 'hand')]
    takes = []
    c1 = np.zeros(3)  # phone 1 is the calibration's origin
    for n, i in enumerate(mine):
        p = pops[i]
        f = p['t'] * fps
        hips = (at(body[:, L_HIP], f) + at(body[:, R_HIP], f)) / 2
        r = at(rc, f)
        racket_seen = 1 <= int(f) < F - 2 and seen[int(f)] and seen[int(f) + 1]
        if not racket_seen:
            w, e = at(body[:, hand_w], f), at(body[:, hand_e], f)
            r = w + (w - e) / max(np.linalg.norm(w - e), 1e-6) * 0.45
        rel = r - hips
        height = float((r - floor_pt) @ up)
        across, front = float(rel @ right), float(rel @ fwd)
        side = float(rel @ (body[int(f), R_HIP] - body[int(f), L_HIP]))
        hand = 'forehand' if side * handed >= 0 else 'backhand'
        v = (at(rc, f + 1) - at(rc, f - 1)) * fps / 2 if racket_seen else np.full(3, np.nan)
        speed = float(np.linalg.norm(v)) if np.isfinite(v).all() else None
        rising = float((v @ up) / np.linalg.norm(v)) if speed else 0.0
        # the pops between the feeder's hit (the last one past the net) and this contact
        between = [q for q in pops[:i] if q['t'] > p['t'] - 4.0 and 'at' in q]
        past_net = [k for k, q in enumerate(between) if (np.asarray(q['at']) - c1) @ fwd > NET_FROM_PHONE1]
        after = between[past_net[-1] + 1:] if past_net else between
        bounce = glass = False
        glass_kind = ''
        for q in after:
            a = np.asarray(q['at'])
            along, cross = float((a - c1) @ fwd), float((a - c1) @ right)
            if along < 0.3 + WALL_NEAR:
                glass, glass_kind = bounce, glass_kind or ' off the back glass'
            elif abs(cross) > HALF_W - WALL_NEAR:
                glass, glass_kind = bounce, glass_kind or ' off the side glass'
            else:
                bounce = True
        if height > OVERHEAD:
            family = 'smash' if speed and speed >= SMASH else 'bandeja or vibora'
        elif not bounce:
            family = 'volley'
        else:
            family = ('lob' if rising > LOB_UP else 'drive') + (glass_kind if glass else '')
        takes.append({'index': n, 't': p['t'], 'frames': [max(0, int(f - BEFORE * fps)), min(F, int(f + AFTER * fps) + 1)],
                      'contact_frame': round(f, 2), 'family': family, 'hand': hand, 'height': round(height, 3),
                      'out': round(abs(across), 3), 'front': round(front, 3), 'racket_speed': round(speed, 1) if speed else None,
                      'racket_seen': bool(racket_seen),
                      'planted': planted[max(0, int(f - BEFORE * fps)):min(F, int(f + AFTER * fps) + 1)].astype(int).tolist()})
    lab = os.path.join(rec, 'labels.json')
    if os.path.exists(lab):
        for k, fam in json.load(open(lab)).items():
            takes[int(k)]['family'] = fam
            takes[int(k)]['family_by'] = 'labels.json'
    for t in takes:
        t['cell'] = '|'.join([t['family'], t['hand'], binned(t['height'], HEIGHT), binned(t['out'], OUT)])
    json.dump({'fps': fps, 'handed': 'right' if handed > 0 else 'left', 'floor': note, 'takes': takes},
              open(os.path.join(rec, 'takes.json'), 'w'), indent=1)
    return takes


def shot_list(path):
    """The shot list's cells and planned takes, from docs/mocap-shotlist.md's table."""
    cells = []
    for line in open(path):
        m = re.match(r'\| ([a-z][^|]*?)(?: \([^)]*\))? \| (forehand|backhand) \| ([^|]+) \| ([^|]+) \| ([\d.]+)% \| [\d.]+% \| (\d+) \|', line)
        if m:
            cells.append(('|'.join([m[1], m[2], m[3].strip(), m[4].strip()]), float(m[5]), int(m[6])))
    return cells


def coverage(takes, path):
    got = {}
    for t in takes:
        got[t['cell']] = got.get(t['cell'], 0) + 1
    cells = shot_list(path)
    planned = {c for c, _, _ in cells}
    done = sum(1 for c, _, n in cells if got.get(c, 0) >= n)
    share = sum(s for c, s, n in cells if got.get(c, 0) >= n)
    print('COVERAGE %d takes; cells filled %d of %d (%.1f%% of in-game contacts); takes outside the list %d'
          % (len(takes), done, len(cells), share, sum(v for c, v in got.items() if c not in planned)))
    for c, s, n in cells[:25]:
        print('  %-55s %5.1f%%  %2d of %2d' % (c.replace('|', ', '), s, min(got.get(c, 0), n), n))


def selftest():
    """A made-up fed session in the calibration's space (phone 1 at the origin looking along the court): a right-hander
    meeting volleys, drives, lobs, a drive off the back glass and smashes from known places, the pops placed where they were
    made. Every take's family, hand and bins are checked against what was made."""
    import tempfile
    rng = np.random.default_rng(6)
    tmp = tempfile.mkdtemp(prefix='takes-selftest-')
    fps, F = 120, 120 * 60
    # the world: y up, z towards the net; phone 1 at (0, 1.6, -0.3) looking along z, tipped 6 degrees down
    tip = np.radians(6)
    Rw = np.array([[1, 0, 0], [0, np.cos(tip), np.sin(tip)], [0, -np.sin(tip), np.cos(tip)]]) @ np.diag([-1, -1, 1])
    C1 = np.array([0, 1.6, -0.3])
    to_cam = lambda X: (np.asarray(X) - C1) @ Rw.T  # noqa: E731
    body = np.zeros((F, 33, 3))
    t = np.arange(F) / fps
    hips = np.stack([1.0 + 0.6 * np.sin(t * 0.5), np.full(F, 0.95), 3.0 + 1.2 * np.sin(t * 0.3)], 1)
    for k in range(33):
        body[:, k] = hips
    body[:, L_HIP] += [0.12, 0, 0]  # facing the net (+z), the left hip is at +x
    body[:, R_HIP] += [-0.12, 0, 0]
    body[:, L_WR] += [0.3, 0.0, 0.1]
    body[:, R_WR] += [-0.35, 0.1, 0.2]
    body[:, L_EL] += [0.25, 0.25, 0]
    body[:, R_EL] += [-0.3, 0.3, 0]
    # feet: planted, stepping every 0.8 s across the area
    for i, (he, to) in enumerate(((29, 31), (30, 32))):
        stepped = hips[(np.floor(t / 0.8) * 0.8 * fps).astype(int)] + [0.15 - 0.3 * i, -0.91, 0]
        lift = (t % 0.8) < 0.25
        for k, dz in ((he, -0.1), (to, 0.15)):
            body[:, k] = np.where(lift[:, None], hips + [0.15 - 0.3 * i, -0.8, dz], stepped + [0, 0, dz])
    rc = np.full((F, 3), np.nan)
    rigid = np.zeros(F, bool)
    pops = []
    plan = [('volley', 'forehand', 1.0, -0.6), ('drive', 'backhand', 0.8, 0.7), ('lob', 'forehand', 0.7, -0.7),
            ('drive off the back glass', 'forehand', 1.0, -0.7), ('smash', 'forehand', 2.6, -0.3), ('volley', 'backhand', 0.4, 0.6),
            ('drive', 'forehand', 0.5, -0.95)]
    want = []
    for j, tc in enumerate(np.arange(3.0, 57, 2.4)):
        fam, hand, h, x = plan[j % len(plan)]
        f = int(round(tc * fps))
        p = hips[f] + [x, h - 0.95, 0.5]
        speed = 28.0 if fam == 'smash' else 18.0
        v = np.array([0, 0.75, 0.66]) if fam == 'lob' else np.array([0.3, 0.05, 0.95])
        v = v / np.linalg.norm(v) * speed
        near = np.abs(t - tc) < 0.08
        rc[near] = p + v * (t[near] - tc)[:, None]
        rigid |= near
        pops.append({'t': tc - 1.4, 'at': list(to_cam([0.5, 1.0, 17.0])), 'used': False, 'source': 'other'})  # the feeder
        if fam != 'volley' and fam != 'smash':
            pops.append({'t': tc - 0.5, 'at': list(to_cam(p + [0, -p[1], 1.2])), 'used': False, 'source': 'other'})  # bounce
        if 'back glass' in fam:
            pops.append({'t': tc - 0.25, 'at': list(to_cam([p[0], 1.0, 0.0])), 'used': False, 'source': 'other'})  # the glass
        pops.append({'t': float(tc), 'used': True, 'source': 'racket'})
        want.append((fam, hand, binned(h, HEIGHT), binned(abs(x), OUT)))
    pops.sort(key=lambda q: q['t'])
    os.makedirs(os.path.join(tmp, 'output_data'))
    np.save(os.path.join(tmp, 'output_data', 'mediapipe_body_3d_xyz.npy'), to_cam(body.reshape(-1, 3)).reshape(F, 33, 3) / UNIT)
    np.savez(os.path.join(tmp, 'racket.npz'), centre=to_cam(rc) / UNIT, rigid=rigid)
    json.dump({'fps': fps, 'pops': pops}, open(os.path.join(tmp, 'sync.json'), 'w'))
    takes = label(tmp)
    got = [(k['family'], k['hand'], *k['cell'].split('|')[2:]) for k in takes]
    wrong = [(w, g) for w, g in zip(want, got) if w != g]
    print('SELFTEST %d takes; labels right %d of %d%s' % (len(takes), len(want) - len(wrong), len(want),
                                                       '' if not wrong else '; wrong: %s' % wrong[:4]))
    import shutil
    shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    if sys.argv[1] == '--selftest':
        selftest()
    else:
        allt = []
        for rec in sys.argv[1:]:
            tk = label(rec)
            print('TAKES', rec, len(tk), 'takes')
            allt += tk
        coverage(allt, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'docs', 'mocap-shotlist.md'))
