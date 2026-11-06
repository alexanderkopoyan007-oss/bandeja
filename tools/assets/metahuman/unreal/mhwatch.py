# A file queue into this editor: every second, any ~/bandeja-people-src/mh-queue/*.py is run on the editor's thread,
# then <name>.done holds "OK" or the traceback. Lets scripts be sent from a terminal without remote execution
# (whose settings class Python can't reach here). Run once per editor session:  py .../mhwatch.py
import unreal, os, glob, time, traceback, builtins

Q = os.path.expanduser('~/bandeja-people-src/mh-queue')
os.makedirs(Q, exist_ok=True)
_last = [0.0]


def _tick(dt):
    now = time.time()
    if now - _last[0] < 1.0:
        return
    _last[0] = now
    for f in sorted(glob.glob(os.path.join(Q, '*.py'))):
        run = f + '.running'
        os.rename(f, run)
        try:
            exec(compile(open(run).read(), f, 'exec'), {'__name__': '__main__', '__file__': f})
            res = 'OK'
        except Exception:
            res = traceback.format_exc()
        open(f[:-3] + '.done', 'w').write(res)
        os.remove(run)


old = getattr(builtins, '_bandeja_watch', None)
if old is not None:
    unreal.unregister_slate_post_tick_callback(old)
builtins._bandeja_watch = unreal.register_slate_post_tick_callback(_tick)
unreal.log('bandeja: watching ' + Q)
