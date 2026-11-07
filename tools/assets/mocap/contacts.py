# The ball's pops in a phone's sound: when the racket (or the floor, a wall) hit the ball (docs/mocap-pilot.md). A pop is
# a few milliseconds of broadband crack, far above talk and footsteps in its high band; its onset is the contact.
#   ~/bandeja-mocap/venv/bin/python -I tools/assets/mocap/contacts.py <sound.wav> [out.json]
#   ~/bandeja-mocap/venv/bin/python -I tools/assets/mocap/contacts.py --selftest
# Out: [{t (s), strength (over the band's median)}]. Which pops are the racket's is settled with the racket's path
# (racket.py): the racket's face meets the ball within a frame of a racket pop; a bounce or a wall has no racket near.
import json, sys, wave
import numpy as np
from scipy.signal import butter, sosfiltfilt

BAND = 2000.0  # Hz: above voices and shoe squeaks' bulk, below the pop's top
HOP = 0.0005  # s: the envelope's step
MIN_GAP = 0.25  # s: two contacts are never closer (a fast volley exchange is about 0.6 s)
OVER = 8.0  # a pop's envelope over the band's median


def read_wav(path):
    with wave.open(path) as w:
        n, ch, sw, rate = w.getnframes(), w.getnchannels(), w.getsampwidth(), w.getframerate()
        x = np.frombuffer(w.readframes(n), dtype={2: np.int16, 4: np.int32}[sw]).astype(np.float64)
    return x.reshape(-1, ch).mean(1) / float(2 ** (8 * sw - 1)), rate


def pops(x, rate):
    hi = sosfiltfilt(butter(4, BAND, 'highpass', fs=rate, output='sos'), x)
    hop = max(1, int(HOP * rate))
    env = np.sqrt(np.add.reduceat(hi ** 2, np.arange(0, len(hi), hop)) / hop)
    floor = np.median(env) + 1e-12
    found = []
    i = 0
    gap = int(MIN_GAP / HOP)
    while i < len(env):
        if env[i] > OVER * floor:
            j = i + int(np.argmax(env[i:i + int(0.01 / HOP)]))  # the peak within 10 ms
            # the onset: the first step from i that reaches half the peak, to the sample
            k = i
            while k < j and env[k] < 0.5 * env[j]:
                k += 1
            s0 = k * hop
            seg = np.abs(hi[s0:s0 + hop])
            on = s0 + (int(np.argmax(seg >= 0.5 * seg.max())) if len(seg) else 0)
            found.append({'t': round(on / rate, 5), 'strength': round(float(env[j] / floor), 1)})
            i = j + gap
        else:
            i += 1
    return found


def selftest():
    rate = 48000
    rng = np.random.default_rng(1)
    T = 12.0
    x = rng.normal(0, 0.01, int(T * rate))
    # talk-like low rumble and footstep thumps (below the band), and six pops (2 ms decaying cracks)
    t = np.arange(len(x)) / rate
    x += 0.2 * np.sin(2 * np.pi * 180 * t) * (np.sin(2 * np.pi * 0.3 * t) > 0)
    for s in (1.3, 3.1, 5.7, 8.2):
        k = int(s * rate)
        x[k:k + 2400] += 0.5 * np.sin(2 * np.pi * 70 * np.arange(2400) / rate) * np.exp(-np.arange(2400) / 600)
    truth = [0.8123, 2.4517, 4.0, 6.6031, 9.2502, 11.1009]
    for s in truth:
        k = int(round(s * rate))
        n = int(0.004 * rate)
        x[k:k + n] += rng.normal(0, 0.6, n) * np.exp(-np.arange(n) / (0.0008 * rate))
    got = pops(x, rate)
    times = [p['t'] for p in got]
    err = [min(abs(a - b) for b in times) for a in truth]
    print('SELFTEST pops found', len(got), 'of', len(truth), '| onset error ms max %.2f' % (1000 * max(err)), '| false', len(got) - len(truth))


if __name__ == '__main__':
    if sys.argv[1] == '--selftest':
        selftest()
    else:
        x, rate = read_wav(sys.argv[1])
        res = pops(x, rate)
        if len(sys.argv) > 2:
            json.dump(res, open(sys.argv[2], 'w'))
        print('CONTACTS', len(res), 'pops;', ' '.join(f"{p['t']:.3f}" for p in res[:20]))
