# A stroke measured on a clip's own page (MediaPipe pose in the browser pane, only numbers kept: docs/research/footage-pose.md)
# as the points retarget.py reads. The page hands the stroke over as a tool result in the session's record; this finds
# the last one (marker BANDEJA_POSE_V1) and writes <out>/mediapipe_body_3d_xyz.npy (frames x 33 x 3, mm; right-handed,
# x the picture's right, y up, z to the camera) and <out>/meta.json.
#   ~/bandeja-mocap/venv/bin/python -I tools/assets/mocap/from_page.py <session .jsonl> <out folder>
import json, sys, os
import numpy as np

src, out = sys.argv[1], sys.argv[2]
AB = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
found = None
for line in open(src, errors='ignore'):
    if 'BANDEJA_POSE_V1' not in line or '"tool_result"' not in line:
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
            if '"enc"' in t and 'BANDEJA_POSE_V1' in t:
                found = t[t.index('{'):t.rindex('}') + 1]
assert found, 'no stroke in the record'
m = json.loads(found)
F, U = m['frames'], m['joints']
enc = m.pop('enc')
assert len(enc) == F * len(U) * 3 * 2, (len(enc), F, len(U))
v = np.array([AB.index(enc[i]) * 64 + AB.index(enc[i + 1]) - 2048 for i in range(0, len(enc), 2)], float).reshape(F, len(U), 3)
body = np.full((F, 33, 3), np.nan)
body[:, U] = v
os.makedirs(out, exist_ok=True)
np.save(os.path.join(out, 'mediapipe_body_3d_xyz.npy'), body)
json.dump(m, open(os.path.join(out, 'meta.json'), 'w'))
hip = (body[:, 23] + body[:, 24]) / 2
print('STROKE', m['clip_id'], F, 'frames at', m['fps'], 'fps, contact at', m['contact_s'], 's; hips travel',
      np.round((hip.max(0) - hip.min(0)) / 1000, 2), 'm; right wrist height above the floor at contact',
      round(float(body[int(round(m['contact_s'] * m['fps'])), 16, 1] - np.nanmin(body[:, 27:33, 1])) / 1000, 2), 'm')
