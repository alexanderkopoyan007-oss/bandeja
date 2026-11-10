# A stroke measured on a clip's own page (MediaPipe pose in the browser pane, only numbers kept: docs/research/footage-pose.md)
# as the points retarget.py reads. The page hands the stroke over as a tool result in the session's record; this finds
# the last one and writes it to <out>:
#   BANDEJA_POSE_V1: mediapipe_body_3d_xyz.npy (frames x 33 x 3, mm; right-handed, x the picture's right, y up, z to
#     the camera; the hips' path already in it) and meta.json.
#   BANDEJA_POSE_V2: page.npz for one_camera.py: the body about the hips (mm), where the hips and feet were in the
#     picture, the body's size in the picture frame by frame, the free hand's direction, and when each of the racket's
#     hand-read keys falls in the stroke; and meta.json.
#   ~/bandeja-mocap/venv/bin/python -I tools/assets/mocap/from_page.py <session .jsonl> <out folder>
import json, sys, os
import numpy as np

src, out = sys.argv[1], sys.argv[2]
AB = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
LUT = {c: i for i, c in enumerate(AB)}
found = None
for line in open(src, errors='ignore'):
    if 'BANDEJA_POSE_V' not in line or '"tool_result"' not in line:
        continue
    try:
        d = json.loads(line)
    except ValueError:
        continue
    c = d.get('message', {}).get('content')
    for x in c if isinstance(c, list) else []:
        if x.get('type') != 'tool_result':
            continue
        for y in x.get('content') if isinstance(x.get('content'), list) else []:
            t = y.get('text', '') if isinstance(y, dict) else ''
            if '"marker"' in t and 'BANDEJA_POSE_V' in t and ('"enc"' in t or '"body"' in t):
                found = t[t.index('{'):t.rindex('}') + 1]
assert found, 'no stroke in the record'
m = json.loads(found)


def dec(s, n):
    """Two characters a value (0-4095)."""
    assert len(s) == n * 2, (len(s), n)
    return np.array([LUT[s[i]] * 64 + LUT[s[i + 1]] for i in range(0, len(s), 2)], float)


F, U = m['frames'], m['joints']
os.makedirs(out, exist_ok=True)
if m['marker'] == 'BANDEJA_POSE_V1':
    v = (dec(m.pop('enc'), F * len(U) * 3) - 2048).reshape(F, len(U), 3)
    body = np.full((F, 33, 3), np.nan)
    body[:, U] = v
    np.save(os.path.join(out, 'mediapipe_body_3d_xyz.npy'), body)
    hip = (body[:, 23] + body[:, 24]) / 2
    print('STROKE', m['clip_id'], F, 'frames at', m['fps'], 'fps, contact at', m['contact_s'], 's; hips travel',
          np.round((hip.max(0) - hip.min(0)) / 1000, 2), 'm')
else:
    IP = m['img_points']
    body = np.full((F, 33, 3), np.nan)
    body[:, U] = (dec(m.pop('body'), F * len(U) * 3) - 2048).reshape(F, len(U), 3)
    img = np.full((F, 33, 2), np.nan)  # x in picture widths, y in picture heights, from the top left
    img[:, IP] = (dec(m.pop('img'), F * len(IP) * 2) / 4000).reshape(F, len(IP), 2)
    scale = dec(m.pop('scale'), F) / 8000  # picture heights to the metre
    lh = (dec(m.pop('lh'), F * 6) - 2048).reshape(F, 2, 3) / 1000
    lh_ok = np.array([c == '1' for c in m.pop('lh_ok')])
    np.savez(os.path.join(out, 'page.npz'), body=body, img=img, scale=scale, lh=lh, lh_ok=lh_ok)
    print('STROKE', m['clip_id'], F, 'frames at', m['fps'], 'fps, slowed', m['k'], 'x, contact at', m['contact_s'],
          's; body size in the picture', np.round(scale[[0, F // 2, -1]], 3), 'heights/m; free hand seen in', int(lh_ok.sum()), 'frames')
json.dump(m, open(os.path.join(out, 'meta.json'), 'w'))
