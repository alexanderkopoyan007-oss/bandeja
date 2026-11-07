# The pilot's gate (docs/mocap-pilot.md, "What I check"), measured on one processed recording:
#   PY=~/bandeja-mocap/venv/bin/python
#   $PY -I tools/assets/mocap/gate.py <recording> [calibration_check.json]
#   $PY -I tools/assets/mocap/gate.py --selftest
# Reads what the steps left in the recording folder: FreeMoCap's 3D (output_data/, and its unfiltered points in
# raw_data/), racket.npz (racket.py), sync.json (sync.py), and the calibration's numbers (calibrate.py writes
# calibration_check.json beside its recording). A check whose input isn't there says so instead of passing.
import json
import os
import sys
import numpy as np

# MediaPipe body points
SEG = {'upper arm L': (11, 13), 'upper arm R': (12, 14), 'forearm L': (13, 15), 'forearm R': (14, 16),
       'thigh L': (23, 25), 'thigh R': (24, 26), 'shin L': (25, 27), 'shin R': (26, 28)}
JOINT = {'elbow L': (11, 13, 15), 'elbow R': (12, 14, 16), 'knee L': (23, 25, 27), 'knee R': (24, 26, 28)}
UNIT = 0.001  # m per calibration unit
LIMITS = {'calibration_px': 1.5, 'wobble': 0.03, 'jitter_deg': 3.0, 'contact_found': 0.9, 'racket_jitter_deg': 3.0,
          'contact_spread_s': 1 / 30}


def wobble(body):
    """Each limb's length over the recording: its standard deviation over its median (FreeMoCap's classroom sample,
    unfiltered: 5-13%)."""
    out = {}
    for name, (a, b) in SEG.items():
        L = np.linalg.norm(body[:, a] - body[:, b], axis=-1)
        L = L[np.isfinite(L)]
        mid = np.median(L) if len(L) > 10 else 0
        if mid > 0:
            out[name] = float(np.std(L) / mid)
    return out


def jitter(body, fps):
    """Each elbow's and knee's angle less its own running mean over 75 ms (9 frames at 120 fps; a limb's real turn in
    that time is nearly straight, so what's left is the frame-to-frame shake): deg, rms."""
    out = {}
    n = max(3, int(round(0.075 * fps)) | 1)
    k = np.ones(n) / n
    h = n // 2
    for name, (a, b, c) in JOINT.items():
        u, v = body[:, a] - body[:, b], body[:, c] - body[:, b]
        ang = np.degrees(np.arccos(np.clip((u * v).sum(-1) / (np.linalg.norm(u, axis=-1) * np.linalg.norm(v, axis=-1)), -1, 1)))
        ok = np.isfinite(ang)
        if ok.sum() > 30:
            x = np.interp(np.arange(len(ang)), np.nonzero(ok)[0], ang[ok])
            smooth = np.convolve(x, k, mode='same')
            r = (x - smooth)[h:-h][ok[h:-h]]
            out[name] = float(np.sqrt(np.mean(r ** 2)))
    return out


def racket_checks(R, S):
    """At each of the player's contacts (the pops sync.py traced to the racket or the hitting hand): were all three dots
    seen and the racket's shape held (within a frame of it), and how far the racket's fastest moment sits from the
    sound (its spread is the contact moment's uncertainty). The racket's face direction shake in slow frames."""
    fps = S['fps']
    pops = [p for p in S['pops'] if p.get('used') and p.get('source') in ('racket', 'hand')]
    F = len(R['rigid'])
    seen = np.isfinite(R['dots']).all(axis=(1, 2)) & R['rigid']
    c = R['centre'] * UNIT
    v = np.full(F, np.nan)
    v[1:-1] = np.linalg.norm(c[2:] - c[:-2], axis=-1) * fps / 2
    found, offs = 0, []
    for p in pops:
        f = int(round(p['t'] * fps))
        if 1 <= f < F - 1 and seen[f - 1:f + 2].any():
            found += 1
        w = np.arange(max(1, f - int(0.06 * fps)), min(F - 1, f + int(0.06 * fps) + 1))
        if len(w) and np.isfinite(v[w]).sum() > len(w) // 2:
            j = w[int(np.nanargmax(v[w]))]
            # between frames: the top of a parabola through the fastest frame and its neighbours
            a, b, c = v[j - 1], v[j], v[j + 1]
            den = a - 2 * b + c
            sub = 0.5 * (a - c) / den if np.isfinite(den) and den < 0 else 0.0
            offs.append((j + sub - p['t'] * fps) / fps)
    n = R['normal']
    slow = np.isfinite(v) & (v < 1.0) & np.isfinite(n).all(1)
    turn = []
    for f in np.nonzero(slow[1:] & slow[:-1])[0]:
        turn.append(np.degrees(np.arccos(np.clip(abs(float(n[f] @ n[f + 1])), -1, 1))))
    offs = np.array(offs)
    return {'contacts': len(pops), 'found': found, 'offsets': offs,
            'racket_jitter_deg': float(np.sqrt(np.mean(np.square(turn)))) if turn else None}


def report(rec, calib=None):
    rows = []

    def row(check, value, limit, ok, note=''):
        rows.append((check, value, limit, 'pass' if ok else ('FAIL' if ok is not None else 'not measured'), note))
    if calib and os.path.exists(calib):
        C = json.load(open(calib))
        row('Calibration: board corners reprojection error', '%.2f px' % C['px'], 'under %.1f px' % LIMITS['calibration_px'],
            C['px'] < LIMITS['calibration_px'], 'frames each phone read the board: %s' % C.get('views'))
    else:
        row('Calibration: board corners reprojection error', '-', 'under %.1f px' % LIMITS['calibration_px'], None, 'no calibration_check.json')
    out = os.path.join(rec, 'output_data', 'mediapipe_body_3d_xyz.npy')
    raw = os.path.join(rec, 'output_data', 'raw_data', 'mediapipe_3dData_numFrames_numTrackedPoints_spatialXYZ.npy')
    if os.path.exists(out):
        body = np.load(out)
        wb = wobble(body)
        worst = max(wb, key=wb.get)
        note = ''
        if os.path.exists(raw):
            wr = wobble(np.load(raw)[:, :33])
            note = 'unfiltered: worst %s %.1f%%' % (max(wr, key=wr.get), 100 * max(wr.values()))
        row('Body: limb lengths, worst limb\'s wobble', '%.1f%% (%s)' % (100 * wb[worst], worst), 'under 3%',
            wb[worst] < LIMITS['wobble'], note)
        sj = os.path.join(rec, 'sync.json')
        rp = os.path.join(rec, 'output_data', 'recording_parameters.json')
        fps = json.load(open(sj))['fps'] if os.path.exists(sj) else \
            json.load(open(rp))['post_processing_parameters_model']['framerate'] if os.path.exists(rp) else 30
        jt = jitter(body, fps)
        wj = max(jt, key=jt.get)
        row('Body: elbow and knee angles, worst shake', '%.1f deg (%s)' % (jt[wj], wj), 'under %.0f deg' % LIMITS['jitter_deg'],
            jt[wj] < LIMITS['jitter_deg'])
    else:
        row('Body', '-', '', None, 'no FreeMoCap output')
    rk, sj = os.path.join(rec, 'racket.npz'), os.path.join(rec, 'sync.json')
    if os.path.exists(rk) and os.path.exists(sj):
        S = json.load(open(sj))
        rc = racket_checks(np.load(rk), S)
        frac = rc['found'] / rc['contacts'] if rc['contacts'] else 0
        row('Racket: dots seen and shape held at the contacts', '%d of %d' % (rc['found'], rc['contacts']), '9 of 10',
            frac >= LIMITS['contact_found'] if rc['contacts'] else None)
        if rc['racket_jitter_deg'] is not None:
            row('Racket: face direction shake while slow', '%.1f deg' % rc['racket_jitter_deg'], 'under %.0f deg' % LIMITS['racket_jitter_deg'],
                rc['racket_jitter_deg'] < LIMITS['racket_jitter_deg'])
        o = rc['offsets']
        if len(o) >= 3:
            spread = float((np.percentile(o, 84) - np.percentile(o, 16)) / 2)
            row('Contact: the sound against the racket\'s fastest moment', 'spread %.1f ms (median offset %+.1f ms, %d contacts)'
                % (1000 * spread, 1000 * np.median(o), len(o)), 'spread under %.0f ms (1/30 s)' % (1000 * LIMITS['contact_spread_s']),
                spread < LIMITS['contact_spread_s'])
        else:
            row('Contact: the sound against the racket\'s fastest moment', '-', '', None, 'fewer than 3 contacts with the racket seen')
        st = S.get('refine')
        if st:
            rms = st.get('racket', {}).get('rms_ms')
            row('Sync: pops traced to the racket, rms after travel', '%s ms' % rms if rms is not None else '-', '(report)',
                True if rms is not None else None, 'pictures after sound (ms): %s' % {c['name']: round(1000 * c['av'], 2) for c in S['cams']})
    else:
        row('Racket and contact', '-', '', None, 'no racket.npz or sync.json')
    w = max(len(r[0]) for r in rows)
    print('GATE', rec)
    for check, value, limit, verdict, note in rows:
        print('  %-*s  %-12s %-34s %-14s %s' % (w, check, verdict, value, limit, note))
    return rows


def selftest():
    """Gate numbers on made-up recordings with known answers: a body whose forearm length shakes 2% (passes) and one at
    6% (fails), and a racket swung through 82 contacts whose sound sits 4 ms before its fastest moment, 6 ms either way."""
    import tempfile
    rng = np.random.default_rng(4)
    fps, F = 120, 2400
    t = np.arange(F) / fps
    for shake in (0.02, 0.06):
        body = np.zeros((F, 33, 3))
        body[:, 11] = [0, 1400, 0]
        body[:, 13] = body[:, 11] + np.stack([300 * np.ones(F), -50 * np.sin(t), np.zeros(F)], 1)
        fore = 260 * (1 + shake * rng.normal(0, 1, F))
        d = np.stack([np.cos(0.5 * np.sin(t)), np.sin(0.5 * np.sin(t)), np.zeros(F)], 1)
        body[:, 15] = body[:, 13] + d * fore[:, None]
        print('SELFTEST forearm shaking %.0f%%: wobble measured %.1f%%' % (100 * shake, 100 * wobble(body)['forearm L']))
    # the racket
    rec = tempfile.mkdtemp(prefix='gate-selftest-')
    F = 120 * 80
    t = np.arange(F) / fps
    contacts = np.arange(1.5, F / fps - 1, 0.95)
    c = np.zeros((F, 3))
    for tc in contacts:
        tp = tc + 0.004 + rng.normal(0, 0.006)  # the fastest moment: 25 m/s
        c[:, 0] += 1000 * 1.5 * (1 + np.tanh((t - tp) / 0.06))
    c[:, 2] = 3000
    normal = np.tile([0, 0, 1.0], (F, 1)) + rng.normal(0, 0.01, (F, 3))
    normal /= np.linalg.norm(normal, axis=1, keepdims=True)
    dots = np.repeat(c[:, None], 3, axis=1)
    rigid = np.ones(F, bool)
    rigid[rng.random(F) < 0.03] = False
    np.savez(os.path.join(rec, 'racket.npz'), dots=dots, centre=c, normal=normal, rigid=rigid)
    json.dump({'fps': fps, 'cams': [], 'pops': [{'t': float(x), 'used': True, 'source': 'racket'} for x in contacts]},
              open(os.path.join(rec, 'sync.json'), 'w'))
    rc = racket_checks(np.load(os.path.join(rec, 'racket.npz')), json.load(open(os.path.join(rec, 'sync.json'))))
    o = rc['offsets']
    print('SELFTEST racket: %d of %d contacts seen; the fastest moment after the sound by %.1f ms median (truth 4.0), spread'
          ' %.1f ms (truth 6.0); face shake %.1f deg (truth about %.1f)' % (rc['found'], rc['contacts'], 1000 * np.median(o),
                                                                          1000 * (np.percentile(o, 84) - np.percentile(o, 16)) / 2,
                                                                          rc['racket_jitter_deg'], np.degrees(0.01 * np.sqrt(2) * np.sqrt(2))))
    import shutil
    shutil.rmtree(rec, ignore_errors=True)


if __name__ == '__main__':
    if sys.argv[1] == '--selftest':
        selftest()
    else:
        report(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
