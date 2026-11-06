# A file queue into this editor: every second, the oldest ~/bandeja-people-src/mh-queue/*.py is run on the editor's thread,
# then <name>.done holds "OK" or the traceback. Lets scripts be sent from a terminal without remote execution
# (whose settings class Python can't reach here). Run once per editor session:  py .../mhwatch.py
import unreal, os, glob, time, traceback, builtins

Q = os.path.expanduser('~/bandeja-people-src/mh-queue')
os.makedirs(Q, exist_ok=True)
_last = [0.0]
# One job at a time. A long job (a build, the DCC export) ticks Slate itself, and that tick called this one again: the next
# job started inside it, and a second character's DCC export inside the first's crashed the editor (6 Nov, a null TNotNull
# in GetFaceAndBodySkeletalMeshes).
_busy = [False]


def _tick(dt):
    now = time.time()
    if _busy[0] or now - _last[0] < 1.0:
        return
    _last[0] = now
    jobs = sorted(glob.glob(os.path.join(Q, '*.py')))
    if not jobs:
        return
    f = jobs[0]
    run = f + '.running'
    os.rename(f, run)
    _busy[0] = True
    try:
        exec(compile(open(run).read(), f, 'exec'), {'__name__': '__main__', '__file__': f})
        res = 'OK'
    except Exception:
        res = traceback.format_exc()
    finally:
        _busy[0] = False
    open(f[:-3] + '.done', 'w').write(res)
    os.remove(run)


old = getattr(builtins, '_bandeja_watch', None)
if old is not None:
    unreal.unregister_slate_post_tick_callback(old)
builtins._bandeja_watch = unreal.register_slate_post_tick_callback(_tick)
unreal.log('bandeja: watching ' + Q)
