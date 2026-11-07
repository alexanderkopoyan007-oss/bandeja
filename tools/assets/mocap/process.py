# Every step from the phones' files to the game's clips (docs/mocap-pilot.md, "Processing"), in order, resumable:
#   PY=~/bandeja-mocap/venv/bin/python
#   $PY -I tools/assets/mocap/process.py <session> <black square side, mm> [--only=N] [--toml=<a calibration already made>]
#   $PY -I tools/assets/mocap/process.py --selftest
# <session>/cam1 ... camN hold each phone's files as copied off the phone (any names). A recording is the phones' files
# that ran at the same time, matched by their creation times (phones keep network time to a second or so, and the
# recordings run for minutes); the first one holds the board and calibrates every recording. Out, for recording NN:
# <session>/rec/NN/ (FreeMoCap's folder layout: synchronized_videos, output_data; sync.json/npz, racket.npz),
# public/assets/mocap-local/<session>-NN.json (the clip, gitignored) and the gate printed. A step whose output exists
# is skipped; delete it to run the step again.
import datetime
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import sync  # noqa: E402

PY = sys.executable
VIDEO = ('.mov', '.mp4', '.m4v')


def when(info, fallback):
    """A file's recording span on its phone's clock (s since the epoch); the file's order when it has no time."""
    if info['created']:
        t0 = datetime.datetime.fromisoformat(info['created'].replace('Z', '+00:00')).timestamp()
        return t0, t0 + (info['duration'] or 0)
    return fallback * 1e6, fallback * 1e6 + 1


def recordings(session):
    """The phones' files grouped into recordings: each of the first phone's files with, from every other phone, the file
    whose span overlaps it most (none if no file overlaps by half the shorter span)."""
    cams = sorted(d for d in os.listdir(session) if d.startswith('cam') and os.path.isdir(os.path.join(session, d)))
    files = {}
    for c in cams:
        fs = sorted(os.path.join(session, c, f) for f in os.listdir(os.path.join(session, c)) if f.lower().endswith(VIDEO))
        files[c] = [(f, when(sync.probe(f), i)) for i, f in enumerate(fs)]
    out = []
    for f0, (a0, b0) in files[cams[0]]:
        group = [(cams[0], f0)]
        for c in cams[1:]:
            best, over = None, 0.0
            for f, (a, b) in files[c]:
                o = min(b, b0) - max(a, a0)
                if o > over:
                    best, over = f, o
            if best is None or over < 0.5 * min(b0 - a0, max(1e-9, (lambda s: s[1] - s[0])(dict(files[c])[best]))):
                print('  no file from', c, 'runs with', os.path.basename(f0), '- left out')
                continue
            group.append((c, best))
        out.append(group)
    return out, cams


def run(args, env=None):
    print('>', ' '.join(os.path.basename(a) if os.path.isabs(a) else a for a in args))
    r = subprocess.run(args, env={**os.environ, **(env or {})})
    if r.returncode != 0:
        raise SystemExit(f'step failed ({r.returncode}): {" ".join(args)}')


def bodies_and_racket(rec, toml):
    """FreeMoCap, then racket.py, each skipped if its output is there."""
    if not os.path.exists(os.path.join(rec, 'output_data', 'mediapipe_body_3d_xyz.npy')):
        run([PY, '-I', os.path.join(HERE, 'run_headless.py'), rec, toml])
    if not os.path.exists(os.path.join(rec, 'racket.npz')):
        vids = sorted(os.path.join(rec, 'synchronized_videos', v) for v in os.listdir(os.path.join(rec, 'synchronized_videos')))
        run([PY, '-I', os.path.join(HERE, 'racket.py'), toml, os.path.join(rec, 'racket.npz')] + vids)


def process(session, square, only=None, given_toml=None):
    session = os.path.abspath(session)
    groups, cams = recordings(session)
    print('PROCESS', len(groups), 'recordings:', [[f'{c}/{os.path.basename(f)}' for c, f in g] for g in groups])
    toml = None
    for n, group in enumerate(groups, 1):
        rec = os.path.join(session, 'rec', '%02d' % n)
        if only is not None and n != only and n != 1:
            continue
        print('== recording', n, rec)
        if not os.path.exists(os.path.join(rec, 'sync.json')):
            sync.cut(rec, [f for _, f in group], names=[c for c, _ in group])
        if given_toml:
            toml = given_toml
        elif n == 1:
            if len(group) < len(cams):
                raise SystemExit('the first recording (the board) must have every phone: it has ' + ', '.join(c for c, _ in group))
            check = os.path.join(rec, 'calibration_check.json')
            if not os.path.exists(check):
                run([PY, '-I', os.path.join(HERE, 'calibrate.py'), rec, str(square)])
            toml = json.load(open(check))['toml']
            if only is not None and only != 1:
                continue
        use = toml
        if len(group) < len(cams):
            # a phone missed this recording: the calibration of the phones it has, in their order
            from aniposelib.cameras import CameraGroup
            use = os.path.join(rec, 'calibration_subset.toml')
            if not os.path.exists(use):
                CameraGroup.load(toml).subset_cameras_names([c for c, _ in group]).dump(use)
        rec_toml = use
        bodies_and_racket(rec, rec_toml)
        S = json.load(open(os.path.join(rec, 'sync.json')))
        if S['stage'] != 'refined':
            # the second pass; if it moved any frame, the bodies and the racket again, and once more
            for _ in range(2):
                if not sync.refine(rec, rec_toml):
                    break
                for stale in (os.path.join(rec, 'output_data', 'mediapipe_body_3d_xyz.npy'), os.path.join(rec, 'racket.npz')):
                    os.remove(stale)
                bodies_and_racket(rec, rec_toml)
        clip = os.path.join(HERE, '..', '..', '..', 'public', 'assets', 'mocap-local', '%s-%02d.json' % (os.path.basename(session), n))
        if not os.path.exists(clip):
            run([PY, '-I', os.path.join(HERE, 'retarget.py'), os.path.join(rec, 'output_data'), clip], env={'FPS': str(S['fps'])})
        run([PY, '-I', os.path.join(HERE, 'gate.py'), rec, os.path.join(session, 'rec', '01', 'calibration_check.json')])
        print('== recording', n, 'done: clip', os.path.normpath(clip))


def selftest():
    """Matching recordings across phones by their files' creation times: three phones, three recordings each, started a
    second or two apart, one phone's middle recording missing and its files named in another order."""
    import shutil
    import tempfile
    tmp = tempfile.mkdtemp(prefix='process-selftest-')
    starts = [0, 700, 1500]  # s
    plan = {'cam1': [(0, 'IMG_0001.MOV'), (1, 'IMG_0002.MOV'), (2, 'IMG_0003.MOV')],
            'cam2': [(0, 'C0103.mp4'), (2, 'C0101.mp4')],  # the middle one missing, names out of order
            'cam3': [(0, 'a.mov'), (1, 'b.mov'), (2, 'c.mov')]}
    skew = {'cam1': 0.0, 'cam2': 1.4, 'cam3': -0.8}
    base = datetime.datetime(2026, 11, 14, 10, 0, 0, tzinfo=datetime.timezone.utc)
    for cam, items in plan.items():
        os.makedirs(os.path.join(tmp, cam))
        for k, name in items:
            t = base + datetime.timedelta(seconds=starts[k] + skew[cam])
            subprocess.run([sync.ffmpeg(), '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=64x48:r=10:d=3', '-f', 'lavfi',
                            '-i', 'sine=d=3', '-shortest', '-metadata', 'creation_time=' + t.strftime('%Y-%m-%dT%H:%M:%S.000000Z'),
                            os.path.join(tmp, cam, name)], check=True)
    got, _ = recordings(tmp)
    names = [[os.path.relpath(f, tmp) for _, f in g] for g in got]
    want = [['cam1/IMG_0001.MOV', 'cam2/C0103.mp4', 'cam3/a.mov'], ['cam1/IMG_0002.MOV', 'cam3/b.mov'],
            ['cam1/IMG_0003.MOV', 'cam2/C0101.mp4', 'cam3/c.mov']]
    print('SELFTEST recordings matched across phones:', 'right' if names == want else 'WRONG', names)
    shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    if sys.argv[1] == '--selftest':
        selftest()
    else:
        only = next((int(a.split('=')[1]) for a in sys.argv if a.startswith('--only=')), None)
        given = next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--toml=')), None)
        process(sys.argv[1], float(sys.argv[2]), only, given)
