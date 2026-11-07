# The phones' videos on one clock, from what they all heard, cut to the synchronized videos FreeMoCap takes (equal frame
# counts; frame j the same instant in every phone). docs/mocap-pilot.md has the session, docs/motion-plan.md the why.
#   PY=~/bandeja-mocap/venv/bin/python
#   $PY -I tools/assets/mocap/sync.py cut <recording folder> cam1.mov cam2.mov ...   by sound alone, before FreeMoCap
#   $PY -I tools/assets/mocap/sync.py refine <recording folder> <calibration.toml>    again, knowing where each sound was
#   $PY -I tools/assets/mocap/sync.py --selftest
# Out, in the recording folder: synchronized_videos/camN.mp4 (FreeMoCap's input); sync.json, each phone's clock and the
# pops on the videos' timeline (the contacts the strokes are timed to); sync.npz, per output frame each phone's source
# frame and how far that frame's moment sits from the output frame's (racket.py can interpolate the dots by it).
#
# Not FreeMoCap's own synchroniser (skelly_synchronize): it calls ffprobe, which the ffmpeg here (imageio-ffmpeg, 7 Nov)
# doesn't include, and it lines the phones up by sound alone. Sound covers 0.343 m a millisecond and the phones stand 2 to
# 10 m from the player, so one pop reaches them up to 25 ms apart (three frames at 120 fps), by an amount that changes as
# the player moves. And a phone's clock runs fast or slow by tens of parts per million (up to 30 ms over a ten-minute
# recording). So each phone's clock is a line against the first phone's (offset and rate), fitted twice:
#   cut: from the pops' arrival times alone, the sound's travel left in. Good to about 15 ms, enough for FreeMoCap's
#        calibration and body (they move slowly by comparison).
#   refine: from the arrivals minus each sound's travel to each phone. The sound's source comes from FreeMoCap's 3D (the
#        racket's face from racket.py, else past the hitting hand), and the phones' positions from the calibration.
#        Pops whose arrivals still disagree (the feeder's shots, bounces off the floor and the walls) are dropped.
# A phone's picture may also sit a little off its own sound (Android phones are known for tens of ms). racket.py measures
# each phone's against the first's from the racket's fastest frames (racket.npz picture_delay) and refine takes it up;
# --av sets them by hand. A delay every phone shares can't be measured that way, and the game doesn't need it (the motion
# plan's gate on the contact moment is 1/30 s).
# The loop: cut, FreeMoCap, racket.py, refine; if refine re-cut the videos, FreeMoCap and racket.py again (and refine
# once more, which should then leave the cut alone).
import json, os, re, subprocess, sys, threading
import numpy as np
from scipy.signal import butter, fftconvolve, sosfiltfilt

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from contacts import pops as find_pops, read_wav  # noqa: E402

SOUND = 343.0  # m/s at 20 C (2% either way between 10 and 30 C: a tenth of a millisecond over the phones' spread)
RATE = 48000
HOP = 0.001  # s: the coarse envelope's step
MATCH = 0.06  # s: a pop heard by another phone lies this close to where the coarse lag puts it
FIT_TOL = 0.0025  # s: a pop whose arrivals, less the sound's travel, disagree by more (rms) has the wrong source
RATE_SPAN = 60.0  # s: below this span of matched pops (or 6 of them) a phone's rate isn't fitted, only its offset
UNIT = 0.001  # metres per calibration unit (FreeMoCap's calibration is in the board's squares as typed in, in mm)
L_WRIST, R_WRIST, L_ELBOW, R_ELBOW = 15, 16, 13, 14  # MediaPipe body points
REACH = 0.45  # m: from the wrist to the racket face's middle, along the forearm
FF = None


def ffmpeg():
    global FF
    if FF is None:
        import imageio_ffmpeg
        FF = imageio_ffmpeg.get_ffmpeg_exe()
    return FF


def probe(path):
    """Size (as decoded, after the phone's rotation), nominal fps, sound or not, creation time."""
    s = subprocess.run([ffmpeg(), '-hide_banner', '-i', path], capture_output=True, text=True).stderr
    v = next(l for l in s.splitlines() if 'Video:' in l)
    m = re.search(r', (\d{2,5})x(\d{2,5})[ ,\[]', v + ' ')
    w, h = int(m[1]), int(m[2])
    rot = re.search(r'rotation of (-?[\d.]+) degrees', s)
    if rot and round(abs(float(rot[1]))) % 180 == 90:
        w, h = h, w
    fps = re.search(r'([\d.]+) fps', v)
    made = re.search(r'creation_time\s*:\s*(\S+)', s)
    return {'w': w, 'h': h, 'fps': float(fps[1]) if fps else None, 'sound': 'Audio:' in s, 'created': made[1] if made else None}


def frame_times(path):
    """Every video frame's time (s, the file's own timeline as ffmpeg decodes it), in showing order, without decoding."""
    out = subprocess.run([ffmpeg(), '-v', 'error', '-i', path, '-map', '0:v:0', '-c', 'copy', '-f', 'framecrc', '-'],
                         capture_output=True, text=True, check=True).stdout
    tb = re.search(r'#tb 0: (\d+)/(\d+)', out)
    pts = [int(l.split(',')[2]) for l in out.splitlines() if l and not l.startswith('#')]
    return np.sort(np.array(pts, float)) * int(tb[1]) / int(tb[2])


def extract_wav(path, out):
    """The sound, mono, on the same timeline as frame_times (silence put in if it starts after the picture)."""
    subprocess.run([ffmpeg(), '-v', 'error', '-y', '-i', path, '-map', '0:a:0', '-af', 'aresample=async=1:first_pts=0',
                    '-ac', '1', '-ar', str(RATE), '-c:a', 'pcm_s16le', out], check=True)


def envelope(x, rate):
    """The high band's loudness every millisecond, log-squashed (phones' gain controls differ) and centred."""
    hi = sosfiltfilt(butter(4, 2000.0, 'highpass', fs=rate, output='sos'), x)
    n = int(rate * HOP)
    m = len(hi) // n
    e = np.sqrt((hi[:m * n] ** 2).reshape(m, n).mean(1))
    e = np.log1p(e / (np.median(e) + 1e-12))
    return e - e.mean()


def coarse_lag(e_ref, e_k):
    """The shift (s) that lays e_k on e_ref (t_k = t_ref + lag), and how far the best match stands out."""
    c = fftconvolve(e_k, e_ref[::-1], mode='full')
    i = int(np.argmax(c))
    away = np.abs(np.arange(len(c)) - i) > int(0.2 / HOP)
    return (i - (len(e_ref) - 1)) * HOP, float(c[i] / max(c[away].max(), 1e-9))


def fit_line(x, y, fix_rate):
    """y = a x + b, trimmed of outliers (3 robust sigmas, at least a millisecond)."""
    keep = np.ones(len(x), bool)
    a, b = 1.0, 0.0
    for _ in range(6):
        if fix_rate:
            a, b = 1.0, float(np.mean(y[keep] - x[keep]))
        else:
            a, b = (float(v) for v in np.polyfit(x[keep], y[keep], 1))
        r = y - (a * x + b)
        s = max(1.4826 * np.median(np.abs(r[keep])), 0.001)
        new = np.abs(r) < 3 * s
        if new.sum() < 2 or (new == keep).all():
            break
        keep = new
    return a, b, keep


def sound_maps(sounds):
    """sounds: per phone (samples, rate). The phone with the most pops is the reference. Returns the reference, each
    phone's line (its clock = a * reference clock + b), and the pops: per reference pop, each phone's arrival (NaN where
    not heard) and strength."""
    env = [envelope(x, r) for x, r in sounds]
    found = [find_pops(x, r) for x, r in sounds]
    ref = int(np.argmax([len(f) for f in found]))
    t_ref = np.array([p['t'] for p in found[ref]])
    K, P = len(sounds), len(t_ref)
    arr = np.full((P, K), np.nan)
    arr[:, ref] = t_ref
    maps = [(1.0, 0.0)] * K
    report = []
    for k in range(K):
        if k == ref:
            report.append({'pops': len(found[k])})
            continue
        lag, clear = coarse_lag(env[ref], env[k])
        tk = np.array([p['t'] for p in found[k]])
        used = np.zeros(len(tk), bool)
        for i, t in enumerate(t_ref):
            if len(tk) == 0:
                break
            j = int(np.argmin(np.abs(tk - (t + lag))))
            if abs(tk[j] - (t + lag)) < MATCH and not used[j]:
                arr[i, k] = tk[j]
                used[j] = True
        ok = np.isfinite(arr[:, k])
        x, y = t_ref[ok], arr[ok, k]
        if len(x) == 0:
            maps[k] = (1.0, lag)
            report.append({'pops': len(found[k]), 'matched': 0, 'lag': lag, 'clear': clear})
            continue
        fix = len(x) < 6 or np.ptp(x) < RATE_SPAN
        a, b, keep = fit_line(x, y, fix)
        maps[k] = (a, b)
        res = y - (a * x + b)
        report.append({'pops': len(found[k]), 'matched': int(ok.sum()), 'lag': round(lag, 4), 'clear': round(clear, 2),
                       'ppm': round((a - 1) * 1e6, 1), 'spread_ms': round(1000 * float(np.std(res[keep])), 2)})
    strength = np.array([p['strength'] for p in found[ref]])
    return ref, maps, arr, strength, report


def plan_cut(pts, maps, av, fps):
    """Output frames at fps over the moments every phone filmed, on the reference's sound clock. Per phone: the source
    frame nearest each output frame's moment, and that frame's moment minus the output frame's (s)."""
    starts = [(p[0] - v - b) / a for p, (a, b), v in zip(pts, maps, av)]
    ends = [(p[-1] - v - b) / a for p, (a, b), v in zip(pts, maps, av)]
    T0 = max(starts)
    N = int(np.floor((min(ends) - T0) * fps + 1e-9)) + 1
    T = T0 + np.arange(N) / fps
    idx, lag = [], []
    for p, (a, b), v in zip(pts, maps, av):
        want = a * T + b + v
        i = np.clip(np.searchsorted(p, want), 1, len(p) - 1)
        i = i - ((want - p[i - 1]) < (p[i] - want)).astype(np.int64)
        idx.append(i.astype(np.int64))
        lag.append((p[i] - want) / a)
    return T0, N, np.array(idx), np.array(lag)


def write_cut(path, info, src, pts, out, fps):
    """Decode the phone's frames in order and write each as many times as the cut uses it. Every decoded frame's time is
    checked against frame_times', so a frame the decoder dropped or added can't shift the rest."""
    w, h = info['w'], info['h']
    size = w * h + 2 * ((w + 1) // 2) * ((h + 1) // 2)
    dec = subprocess.Popen([ffmpeg(), '-v', 'info', '-nostats', '-i', path, '-map', '0:v:0', '-vf', 'showinfo',
                            '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-'],
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    seen = []

    def listen():
        for line in dec.stderr:
            m = re.search(rb'pts_time:\s*(-?[\d.]+)', line)
            if m and b'Parsed_showinfo' in line:
                seen.append(float(m[1]))
    th = threading.Thread(target=listen, daemon=True)
    th.start()
    enc_args = [ffmpeg(), '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-s', f'{w}x{h}', '-r', str(fps),
                '-i', '-']
    codec = ['-c:v', 'h264_videotoolbox', '-b:v', '60M'] if w >= 640 else ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '8']
    enc = subprocess.Popen(enc_args + codec + ['-pix_fmt', 'yuv420p', out], stdin=subprocess.PIPE)
    uses = np.bincount(src, minlength=len(pts))
    last = int(src[-1])
    i = 0
    while i <= last:
        buf = dec.stdout.read(size)
        if len(buf) < size:
            break
        for _ in range(int(uses[i])):
            enc.stdin.write(buf)
        i += 1
    dec.stdout.close()
    dec.kill()
    dec.wait()
    th.join(timeout=5)
    enc.stdin.close()
    if enc.wait() != 0:
        raise RuntimeError(f'encoding {out} failed')
    if i <= last:
        raise RuntimeError(f'{path}: decoded {i} frames, the cut needs {last + 1}')
    got = np.array(seen[:i])
    if len(got) < i or np.max(np.abs(got - pts[:i])) > 1e-3:
        raise RuntimeError(f'{path}: decoded frames do not line up with the file\'s frame times')


def save(rec, S, Z):
    with open(os.path.join(rec, 'sync.json'), 'w') as f:
        json.dump(S, f, indent=1)
    np.savez_compressed(os.path.join(rec, 'sync.npz'), **Z)


def cut_videos(rec, S, Z, fps):
    os.makedirs(os.path.join(rec, 'synchronized_videos'), exist_ok=True)
    for k, cam in enumerate(S['cams']):
        out = os.path.join(rec, 'synchronized_videos', cam['name'] + '.mp4')
        write_cut(cam['video'], cam['info'], Z['src'][k], Z['pts'][k][:Z['n_pts'][k]], out, fps)


def timeline_pops(S, Z, maps, ref, T0, src_kind=None, e=None):
    """The pops on the synchronized videos' timeline: emission times if known, else the reference's arrivals."""
    arr = Z['arrivals']
    t = (arr[:, ref] if e is None else e) - T0
    out = []
    for i in range(len(t)):
        heard = {S['cams'][k]['name']: round(float((arr[i, k] - maps[k][1]) / maps[k][0] - T0), 5)
                 for k in range(arr.shape[1]) if np.isfinite(arr[i, k])}
        p = {'t': round(float(t[i]), 5), 'strength': float(Z['strength'][i]), 'heard': heard}
        if src_kind is not None:
            p['source'] = src_kind[i]
        out.append(p)
    return out


def cut(rec, videos, fps=None, av=None):
    os.makedirs(os.path.join(rec, 'audio'), exist_ok=True)
    infos = [probe(v) for v in videos]
    for v, inf in zip(videos, infos):
        if not inf['sound']:
            raise SystemExit(f'{v} has no sound to line it up by')
    fps = fps or round(min(i['fps'] for i in infos))
    names = [f'cam{k + 1}' for k in range(len(videos))]
    sounds = []
    for v, n in zip(videos, names):
        wav = os.path.join(rec, 'audio', n + '.wav')
        extract_wav(v, wav)
        sounds.append(read_wav(wav))
    ref, maps, arr, strength, report = sound_maps(sounds)
    pts = [frame_times(v) for v in videos]
    av = av or [0.0] * len(videos)
    T0, N, src, lag = plan_cut(pts, maps, av, fps)
    S = {'fps': fps, 'ref': ref, 'T0': T0, 'frames': N, 'stage': 'sound',
         'cams': [{'name': n, 'video': os.path.abspath(v), 'info': i, 'a': a, 'b': b, 'av': x, 'sound': r}
                  for n, v, i, (a, b), x, r in zip(names, videos, infos, maps, av, report)]}
    Z = {'src': src, 'lag': lag, 'pts': _pad(pts), 'n_pts': np.array([len(p) for p in pts]), 'arrivals': arr,
         'strength': strength}
    S['pops'] = timeline_pops(S, Z, maps, ref, T0)
    save(rec, S, Z)
    cut_videos(rec, S, Z, fps)
    print('SYNC', N, 'frames at', fps, 'fps;', len(S['pops']), 'pops; reference', names[ref])
    for n, r in zip(names, report):
        print(' ', n, r)


def _pad(pts):
    out = np.full((len(pts), max(len(p) for p in pts)), np.nan)
    for k, p in enumerate(pts):
        out[k, :len(p)] = p
    return out


# ---- refine: the sound's travel taken off --------------------------------------------------------------------------

def _at(track, f):
    """track (frames x 3) at fractional frame f, NaN outside or where unseen."""
    i = int(np.floor(f))
    if i < 0 or i + 1 >= len(track):
        return np.full(3, np.nan)
    u = f - i
    return track[i] * (1 - u) + track[i + 1] * u


def _speed(track, f, fps):
    a, b = _at(track, f - 2), _at(track, f + 2)
    return float(np.linalg.norm(b - a) * fps / 4)


def source_at(tau, fps, body, racket):
    """Where a pop at tau (s on the synchronized timeline) came from, and what: the racket's face if racket.py held it
    there, two hands together (a clap), else past the faster hand along its forearm; None if nothing was swinging."""
    f = tau * fps
    if racket is not None:
        c, rigid = racket
        i = int(np.floor(f))
        if 2 <= i < len(c) - 3 and rigid[i] and rigid[i + 1]:
            p = _at(c, f)
            if np.isfinite(p).all() and _speed(c, f, fps) > 5.0:
                return p, 'racket'
    if body is None:
        return None, 'other'
    L, R = _at(body[:, L_WRIST], f), _at(body[:, R_WRIST], f)
    if not (np.isfinite(L).all() and np.isfinite(R).all()):
        return None, 'other'
    if np.linalg.norm(L - R) < 0.25:
        return (L + R) / 2, 'clap'
    vL, vR = _speed(body[:, L_WRIST], f, fps), _speed(body[:, R_WRIST], f, fps)
    if max(vL, vR) < 2.0:
        return None, 'other'
    w, e = (L, _at(body[:, L_ELBOW], f)) if vL > vR else (R, _at(body[:, R_ELBOW], f))
    d = w - e
    n = np.linalg.norm(d)
    return (w + d / n * REACH if n > 0.05 else w), 'hand'


def refine_maps(arr, maps, ref, centres, where, rounds=4):
    """arr: pops x phones arrival times (each phone's own clock); maps: the first lines; centres: phones x 3 (m);
    where(e): the source of a pop emitted at reference time e -> (position or None, kind).
    Each pop's emission time e and the lines are fitted together: arrival_k = a_k (e + distance_k / SOUND) + b_k."""
    P, K = arr.shape
    a = np.array([m[0] for m in maps])
    b = np.array([m[1] for m in maps])
    heard = np.isfinite(arr)
    dist = np.zeros((P, K))
    known = np.zeros(P, bool)
    kinds = ['other'] * P
    keep = np.zeros(P, bool)
    for _ in range(rounds):
        # emission times from every phone that heard the pop, travel taken off
        e = np.nanmean((arr - b) / a - dist / SOUND, axis=1)
        for i in range(P):
            s, kinds[i] = where(e[i])
            known[i] = s is not None
            dist[i] = np.linalg.norm(centres - s, axis=1) if s is not None else 0
        use = known & (heard.sum(1) >= 3)
        keep = use.copy()
        for _ in range(8):
            e = np.nanmean((arr - b) / a - dist / SOUND, axis=1)
            res = arr - (a * (e[:, None] + dist / SOUND) + b)
            rms = np.sqrt(np.nanmean(np.where(heard, res, np.nan) ** 2, axis=1))
            keep = use & (rms < FIT_TOL)
            for k in range(K):
                if k == ref:
                    continue
                ok = keep & heard[:, k]
                if ok.sum() < 2:
                    continue
                x = e[ok] + dist[ok, k] / SOUND
                fix = ok.sum() < 6 or np.ptp(x) < RATE_SPAN
                a[k], b[k], _ = fit_line(x, arr[ok, k], fix)
    e = np.nanmean((arr - b) / a - dist / SOUND, axis=1)
    e[~keep] = np.nanmean(((arr - b) / a)[~keep], axis=1) if (~keep).any() else e[~keep]
    res = arr - (a * (e[:, None] + dist / SOUND) + b)
    stats = {}
    for kind in ('racket', 'hand', 'clap', 'other'):
        m = np.array([k == kind for k in kinds])
        stats[kind] = {'pops': int(m.sum()), 'used': int((m & keep).sum())}
        if (m & keep).any():
            stats[kind]['rms_ms'] = round(1000 * float(np.sqrt(np.nanmean(res[m & keep] ** 2))), 2)
    return list(zip(a.tolist(), b.tolist())), e, kinds, keep, stats


def refine(rec, toml):
    import cv2
    from aniposelib.cameras import CameraGroup
    S = json.load(open(os.path.join(rec, 'sync.json')))
    Z = dict(np.load(os.path.join(rec, 'sync.npz')))
    cg = CameraGroup.load(toml)
    by_name = {c.get_name(): c for c in cg.cameras}
    centres = []
    for cam in S['cams']:
        c = by_name[cam['name']]
        R = cv2.Rodrigues(np.asarray(c.get_rotation(), float))[0]
        centres.append(-R.T @ np.asarray(c.get_translation(), float) * UNIT)
    centres = np.array(centres)
    body_path = os.path.join(rec, 'output_data', 'mediapipe_body_3d_xyz.npy')
    body = np.load(body_path) * UNIT if os.path.exists(body_path) else None
    rk = os.path.join(rec, 'racket.npz')
    racket = None
    if os.path.exists(rk):
        R_ = np.load(rk)
        racket = (R_['centre'] * UNIT, R_['rigid'])
        # racket.py's picture delays (each phone's picture after its sound, beyond what this cut already allowed for),
        # taken up once per racket.npz
        stamp = os.path.getmtime(rk)
        if 'picture_delay' in R_ and S.get('racket_delays_from') != stamp:
            for name, d in zip(R_['cams'].tolist(), R_['picture_delay'].tolist()):
                cam = next(c for c in S['cams'] if c['name'] == name)
                cam['av'] = cam['av'] + d
            S['racket_delays_from'] = stamp
    fps, T0, ref = S['fps'], S['T0'], S['ref']
    maps0 = [(c['a'], c['b']) for c in S['cams']]
    maps, e, kinds, keep, stats = refine_maps(Z['arrivals'], maps0, ref, centres, lambda t: source_at(t - T0, fps, body, racket))
    pts = [Z['pts'][k][:Z['n_pts'][k]] for k in range(len(S['cams']))]
    av = [c['av'] for c in S['cams']]
    T0n, N, src, lag = plan_cut(pts, maps, av, fps)
    moved = []
    for k, cam in enumerate(S['cams']):
        span = np.array([T0, T0 + S['frames'] / fps])
        a0, b0 = maps0[k]
        a1, b1 = maps[k]
        moved.append(round(1000 * float(np.max(np.abs((a1 - a0) * span + (b1 - b0)))), 2))
        cam['a'], cam['b'] = a1, b1
        cam['moved_ms'] = moved[-1]
    changed = N != S['frames'] or any(not np.array_equal(src[k], Z['src'][k]) if len(src[k]) == len(Z['src'][k]) else True
                                      for k in range(len(src)))
    S.update({'stage': 'refined', 'T0': T0n, 'frames': N, 'refine': stats})
    Z.update({'src': src, 'lag': lag})
    S['pops'] = timeline_pops(S, Z, maps, ref, T0n, kinds, e)
    for p, k in zip(S['pops'], keep):
        p['used'] = bool(k)
    save(rec, S, Z)
    print('REFINE', stats, '| clocks moved ms', dict(zip([c['name'] for c in S['cams']], moved)),
          '| pictures after sound ms', {c['name']: round(1000 * c['av'], 2) for c in S['cams']})
    if changed:
        cut_videos(rec, S, Z, fps)
        print('  the cut changed: synchronized_videos rewritten; run FreeMoCap (and racket.py) on', rec, 'again')


# ---- self-tests ------------------------------------------------------------------------------------------------------

def _pop(x, k, rng, amp):
    n = int(0.004 * RATE)
    if 0 <= k and k + n < len(x):
        x[k:k + n] += amp * rng.normal(0, 1, n) * np.exp(-np.arange(n) / (0.0008 * RATE))


def selftest_sound():
    """A pilot-like session in numbers: four phones round half a court, each its own start, clock rate and gain, the
    player moving and hitting, bounces and the feeder's shots between, and echoes. The clocks found are checked against
    the truth: by sound alone, then refined with where the racket (or the hand) was."""
    rng = np.random.default_rng(7)
    cams = np.array([[0, 1.6, -0.3], [-4.8, 1.6, -0.2], [4.8, 1.6, -0.2], [-5.3, 1.6, 8.5]])
    K, D = len(cams), 240.0
    start = np.array([0.0, 1.7, -2.4, 0.9])  # each phone's recording start (true s)
    ppm = np.array([0.0, 31.0, -24.0, 12.0])
    gain = np.array([1.0, 0.6, 1.8, 0.8])
    clock = lambda k, t: (1 + ppm[k] * 1e-6) * (t - start[k])  # noqa: E731

    fps = 120
    tt = np.arange(-5, D + 5, 1 / fps)
    pc = np.stack([1.5 * np.sin(tt * 0.31), np.full_like(tt, 1.0), 3.5 + 1.2 * np.sin(tt * 0.17 + 1)], 1)  # the hips
    events = []  # (true time, position, kind)
    hits = np.arange(6.0, D - 6, 2.3) + rng.uniform(-0.3, 0.3, len(np.arange(6.0, D - 6, 2.3)))
    swing = []
    for t in hits:
        p = pc[int((t + 5) * fps)] + np.array([0.7 * rng.choice([-1, 1]), 0.1, 0.4])
        events.append((t, p, 'racket'))
        swing.append((t, p))
        events.append((t - 0.45, p + np.array([0, -1.0, 1.4]), 'bounce'))
        events.append((t - 1.3, np.array([rng.uniform(-3, 3), 1.0, 17.0]), 'feeder'))
    for t in (3.0, D - 3.0):
        events.append((t, pc[int((t + 5) * fps)] + np.array([0, 0.3, 0.3]), 'clap'))

    sounds = []
    for k in range(K):
        n = int((D - start[k] + 3) * RATE)
        x = rng.normal(0, 0.01, n)
        tk = np.arange(n) / RATE
        x += 0.15 * np.sin(2 * np.pi * 170 * tk) * (np.sin(2 * np.pi * 0.21 * tk) > 0.3)
        for t, p, _ in events:
            d = np.linalg.norm(cams[k] - p)
            arrive = clock(k, t + d / SOUND)
            amp = gain[k] * min(1.0, 3.0 / d)
            _pop(x, int(round(arrive * RATE)), rng, amp)
            _pop(x, int(round((arrive + rng.uniform(0.003, 0.012)) * RATE)), rng, 0.5 * amp)  # off the glass
        sounds.append((x, RATE))

    ref, maps, arr, strength, report = sound_maps(sounds)
    truth_line = [((1 + ppm[k] * 1e-6) / (1 + ppm[ref] * 1e-6), None) for k in range(K)]

    def err(ms):
        # each phone's clock reading for true moments across the take, predicted from the reference's clock
        T = np.linspace(5, D - 5, 50)
        worst = 0.0
        for k in range(K):
            pred = ms[k][0] * clock(ref, T) + ms[k][1]
            worst = max(worst, float(np.max(np.abs(pred - clock(k, T)))))
        return 1000 * worst
    print('SELFTEST sound alone: reference cam%d, worst clock error %.1f ms (the sound\'s travel left in)' % (ref + 1, err(maps)))

    # FreeMoCap's view of the player on the reference clock: hands and elbows, and the racket's face near each hit
    t_ref0 = -start[ref]  # true time at reference clock 0 (rates ~1: close enough to place the body)
    T0 = 0.0
    frames = int(D * fps)
    true_t = (np.arange(frames) / fps + T0) / (1 + ppm[ref] * 1e-6) - t_ref0
    hips = np.stack([np.interp(true_t, tt, pc[:, j]) for j in range(3)], 1)
    body = np.repeat(hips[:, None, :], 33, axis=1) + rng.normal(0, 0.02, (frames, 33, 3))
    body[:, L_WRIST] += [0.3, 0.1, 0.1]
    body[:, R_WRIST] += [-0.3, 0.1, 0.1]
    body[:, L_ELBOW] += [0.25, 0.3, 0.0]
    body[:, R_ELBOW] += [-0.25, 0.3, 0.0]
    centre = np.full((frames, 3), np.nan)
    rigid = np.zeros(frames, bool)
    for t, p in swing:
        j = np.arange(frames)
        near = np.abs(true_t - t) < 0.08
        v = np.array([0.0, 0.0, 20.0])
        centre[near] = p + v * (true_t[near] - t)[:, None] + rng.normal(0, 0.01, (near.sum(), 3))
        rigid |= near
        # the hitting hand swings through too (for the run without the racket)
        hand = 'R' if p[0] < hips[int(t * fps), 0] else 'L'
        wi, ei = (R_WRIST, R_ELBOW) if hand == 'R' else (L_WRIST, L_ELBOW)
        fore = np.array([0.0, 0.0, 1.0])
        body[near, wi] = p - fore * REACH + v[None] * 0.3 * (true_t[near] - t)[:, None] + rng.normal(0, 0.05, (near.sum(), 3))
        body[near, ei] = body[near, wi] - fore * 0.28
        del j
    for t, p, kind in events:
        if kind == 'clap':
            near = np.abs(true_t - t) < 0.05
            body[near, L_WRIST] = p + [0.05, 0, 0]
            body[near, R_WRIST] = p - [0.05, 0, 0]
    for label, rk in (('racket and hands', (centre, rigid)), ('hands only', None)):
        new, e, kinds, keep, stats = refine_maps(arr, maps, ref, cams, lambda t: source_at(t - T0, fps, body, rk))
        print('SELFTEST refined with %s: worst clock error %.2f ms;' % (label, err(new)), stats)


def selftest_video():
    """Three short phone-like recordings with different starts, sub-frame phases and clock rates, each frame's number in
    its picture, pops in the sound: cut, then every output frame's source read back from the pictures."""
    import tempfile
    rng = np.random.default_rng(3)
    tmp = tempfile.mkdtemp(prefix='sync-selftest-')
    fps, w, h = 120, 320, 240
    K = 3
    start = [0.0, 0.43, -0.71]  # true recording starts (s)
    phase = [0.0, 0.37, 0.81]  # first frame's delay, in frames
    ppm = [0.0, 45.0, -30.0]
    dur = 6.0
    claps = [1.2, 2.0, 2.9, 3.6, 4.4]
    videos = []
    for k in range(K):
        n = int(dur * fps)
        raw = os.path.join(tmp, f'v{k}.mp4')
        enc = subprocess.Popen([ffmpeg(), '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', f'{w}x{h}',
                                '-r', str(fps), '-i', '-', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '4',
                                '-pix_fmt', 'yuv420p', raw], stdin=subprocess.PIPE)
        for i in range(n):
            img = np.empty((h, w), np.uint8)
            for band in range(3):  # the frame's number in base 26, one band of grey per digit
                img[band * h // 3:(band + 1) * h // 3] = 16 + 8 * ((i // 26 ** band) % 26)
            enc.stdin.write(img.tobytes())
        enc.stdin.close()
        enc.wait()
        # the phone's sound: its own clock (rate), from its recording's start
        x = rng.normal(0, 0.005, int((dur + 0.5) * RATE))
        for c in claps:
            _pop(x, int(round((1 + ppm[k] * 1e-6) * (c - start[k]) * RATE)), rng, 0.8)
        wav = os.path.join(tmp, f'a{k}.wav')
        import wave
        with wave.open(wav, 'wb') as f:
            f.setnchannels(1)
            f.setsampwidth(2)
            f.setframerate(RATE)
            f.writeframes((np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes())
        # frames shown at (i + phase) / fps on the phone's clock: the frame rate is the phone's own, so its clock rate
        # is the frame times' rate too
        mov = os.path.join(tmp, f'cam{k + 1}.mov')
        subprocess.run([ffmpeg(), '-v', 'error', '-y', '-itsoffset', str(phase[k] / fps), '-i', raw, '-i', wav,
                        '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'pcm_s16le', mov], check=True)
        videos.append(mov)
    rec = os.path.join(tmp, 'rec')
    cut(rec, videos, fps)
    S = json.load(open(os.path.join(rec, 'sync.json')))
    Z = np.load(os.path.join(rec, 'sync.npz'))
    ref = S['ref']
    worst_t, worst_lag, bad = 0.0, 0.0, 0
    reads = []
    for k in range(K):
        cap = subprocess.run([ffmpeg(), '-v', 'error', '-i', os.path.join(rec, 'synchronized_videos', f'cam{k + 1}.mp4'),
                              '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], capture_output=True, check=True).stdout
        fr = np.frombuffer(cap, np.uint8).reshape(-1, h, w)
        reads.append(sum(26 ** band * np.round((fr[:, band * h // 3 + 4:(band + 1) * h // 3 - 4].mean((1, 2)) - 16) / 8).astype(int)
                         for band in range(3)))
    N = min(len(r) for r in reads)
    for j in range(N):
        # the true moment each phone's output frame j was filmed, less the moment the cut says it was: the same in all
        moments = []
        for k in range(K):
            i = reads[k][j]
            true = start[k] + ((i + phase[k]) / fps) / (1 + ppm[k] * 1e-6)
            moments.append(true - Z['lag'][k][j])
            if i != Z['src'][k][j]:
                bad += 1
        worst_t = max(worst_t, 1000 * (max(moments) - min(moments)))
        worst_lag = max(worst_lag, 1000 * float(np.max(np.abs(Z['lag'][:, j]))))
    print('SELFTEST video: %d frames x %d phones; frames not the planned source %d; output moments agree within %.2f ms;'
          ' largest offset from the frame %.2f ms (half a frame %.2f)' % (N, K, bad, worst_t, worst_lag, 500 / fps),
          '| reference cam%d' % (ref + 1))

    # refine, through the files: phones on a circle 4 m round the claps (every sound travels the same, so the clocks
    # mustn't move and the cut must stay), FreeMoCap's body with the hands together at each clap.
    from aniposelib.cameras import Camera, CameraGroup
    import cv2
    clap_at = np.array([0.5, 1.0, 3.0])
    group = []
    for k in range(K):
        ang = 2 * np.pi * k / K
        c = clap_at + 4.0 * np.array([np.sin(ang), 0, np.cos(ang)])
        R = cv2.Rodrigues(np.array([0.0, ang + np.pi, 0.0]))[0]  # looking at the claps
        group.append(Camera(matrix=[[300, 0, w / 2], [0, 300, h / 2], [0, 0, 1]], dist=np.zeros(5), size=(w, h),
                            rvec=cv2.Rodrigues(R)[0].ravel(), tvec=-R @ c / UNIT, name=f'cam{k + 1}'))
    toml = os.path.join(rec, 'calibration.toml')
    CameraGroup(group).dump(toml)
    Nf = S['frames']
    body = np.zeros((Nf, 33, 3)) + clap_at
    body[:, L_WRIST] += [0.3, 0, 0]
    body[:, R_WRIST] -= [0.3, 0, 0]
    for c in claps:
        f = ((1 + ppm[ref] * 1e-6) * (c - start[ref]) - S['T0']) * fps
        near = np.abs(np.arange(Nf) - f) < 6
        body[near, L_WRIST] = clap_at + [0.04, 0, 0]
        body[near, R_WRIST] = clap_at - [0.04, 0, 0]
    os.makedirs(os.path.join(rec, 'output_data'), exist_ok=True)
    np.save(os.path.join(rec, 'output_data', 'mediapipe_body_3d_xyz.npy'), body / UNIT)
    src0 = Z['src'].copy()
    refine(rec, toml)
    S2 = json.load(open(os.path.join(rec, 'sync.json')))
    Z2 = np.load(os.path.join(rec, 'sync.npz'))
    claps_used = sum(1 for p in S2['pops'] if p.get('source') == 'clap' and p['used'])
    print('SELFTEST refine through the files: claps used %d of %d; clocks moved %s ms; cut unchanged %s; pops now %.2f ms'
          ' earlier (4 m of sound)' % (claps_used, len(claps), [c['moved_ms'] for c in S2['cams']],
                                       bool(np.array_equal(src0, Z2['src'])), 1000 * (S['pops'][0]['t'] - S2['pops'][0]['t'])))
    import shutil
    shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    if sys.argv[1] == '--selftest':
        selftest_sound()
        selftest_video()
    elif sys.argv[1] == 'cut':
        args = [a for a in sys.argv[3:] if not a.startswith('--')]
        fps = next((int(a.split('=')[1]) for a in sys.argv if a.startswith('--fps=')), None)
        av = next(([float(v) for v in a.split('=')[1].split(',')] for a in sys.argv if a.startswith('--av=')), None)
        cut(sys.argv[2], args, fps, av)
    elif sys.argv[1] == 'refine':
        refine(sys.argv[2], sys.argv[3])
