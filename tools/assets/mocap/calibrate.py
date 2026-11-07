# The phones' calibration from one synchronized recording (docs/mocap-pilot.md: the board held close to each phone, then
# walked round the hitting area), with FreeMoCap's calibrator and no GUI:
#   PY=~/bandeja-mocap/venv/bin/python
#   $PY -I tools/assets/mocap/calibrate.py <recording> <black square side, mm>
#   $PY -I tools/assets/mocap/calibrate.py --selftest
# Writes the calibration toml into the recording folder (FreeMoCap also keeps copies in ~/freemocap_data) and prints its
# path and the pilot gate's number: the board corners' reprojection error (pass under about 1.5 px).
#
# Its space is the first phone's (FreeMoCap's "pin camera 0"), not the floor's: the floor comes from the player's planted
# feet (retarget.py). FreeMoCap can set the floor from the board lying flat, but only from the recording's first second,
# and a board flat on the court is unreadable from phones 1.6 m up and 5-7 m away (its squares 8 px tall at 1080p; the
# self-test drew it so: no phone read it).
# The close-ups: a phone that only ever sees the board 7-9 m off gets its lens wrong (self-test without them: focal 14%
# long, the phone 1.2 m out); 5 s of the board close to each phone first gives every lens a close look.
import os
import sys
import numpy as np
import cv2


LENS_CLOSE, LENS_SPREAD = 60, 40  # a phone's lens from its 60 largest views of the board and 40 others


def lens_first(cg):
    """FreeMoCap's calibration fits every phone's lens (one focal length, one radial term, the centre fixed) and pose
    together, from the frames two or more phones saw at once: a phone that saw the board only from afar got its lens wrong
    by 4-11% (self-test), and its place with it. Instead: each phone's lens first, from its own views of the board alone
    (the close-ups weighing most; focal, centre and two radial terms, OpenCV's calibrateCamera), then the bundle
    adjustment fits only where the phones stand and point. Replaces the group's calibrate_videos (same inputs and
    returns)."""
    import types

    def calibrate_videos(videos, board, init_intrinsics=True, init_extrinsics=True, verbose=True, **kw):
        rng = np.random.default_rng(0)
        all_rows = cg.get_rows_videos(videos, board, verbose=verbose)
        cg.set_camera_sizes_videos(videos)
        for rows, cam in zip(all_rows, cg.cameras):
            objp, imgp = board.get_all_calibration_points(rows)
            ok = [i for i, o in enumerate(objp) if len(o) >= 8]
            area = np.array([cv2.contourArea(cv2.convexHull(imgp[i].reshape(-1, 1, 2))) for i in ok])
            order = np.argsort(-area)
            pick = list(order[:LENS_CLOSE])
            if len(order) > LENS_CLOSE:
                pick += list(rng.choice(order[LENS_CLOSE:], min(LENS_SPREAD, len(order) - LENS_CLOSE), replace=False))
            o = [objp[ok[i]] for i in pick]
            im = [imgp[ok[i]].reshape(-1, 1, 2) for i in pick]
            size = tuple(int(v) for v in cam.get_size())
            K0 = cv2.initCameraMatrix2D(o, im, size)
            flags = cv2.CALIB_USE_INTRINSIC_GUESS | cv2.CALIB_ZERO_TANGENT_DIST | cv2.CALIB_FIX_K3 | cv2.CALIB_FIX_ASPECT_RATIO
            rms, K, dist, _, _ = cv2.calibrateCamera(o, im, size, K0, None, flags=flags)
            cam.set_camera_matrix(K)
            cam.set_distortions(dist.ravel()[:5])
            print('LENS', cam.get_name(), 'from %d views: focal %.0f px, centre (%.0f, %.0f), k1 %.3f k2 %.3f, rms %.2f px'
                  % (len(pick), K[0, 0], K[0, 2], K[1, 2], dist.ravel()[0], dist.ravel()[1], rms))
        # the bundle adjustment sees each phone as its six pose numbers only (it sizes itself by get_params)
        for cam in cg.cameras:
            cam.get_params = types.MethodType(lambda self: np.concatenate([self.get_rotation(), self.get_translation()]), cam)
            cam.set_params = types.MethodType(lambda self, p: (self.set_rotation(p[:3]), self.set_translation(p[3:6])), cam)
        try:
            return cg.calibrate_rows(all_rows, board, init_intrinsics=False, init_extrinsics=init_extrinsics, verbose=verbose)
        finally:
            for cam in cg.cameras:
                del cam.get_params, cam.set_params

    cg.calibrate_videos = calibrate_videos


def calibrate(rec, square):
    from pathlib import Path
    from freemocap.core_processes.capture_volume_calibration.anipose_camera_calibration import anipose_camera_calibrator as cal
    from freemocap.core_processes.capture_volume_calibration.charuco_stuff.charuco_board_definition import charuco_5x3

    calibrator = cal.AniposeCameraCalibrator(charuco_5x3(), charuco_square_size=square,
                                             calibration_videos_folder_path=Path(rec) / 'synchronized_videos')
    lens_first(calibrator._anipose_camera_group_object)
    toml, _ = calibrator.calibrate_camera_capture_volume(pin_camera_0_to_origin=True, use_charuco_as_groundplane=False)
    cg = calibrator._anipose_camera_group_object
    d2 = np.asarray(cg.charuco_2d_data, float)  # cams x frames x corners x 2
    flat2 = d2.reshape(d2.shape[0], -1, 2)
    p3 = cg.triangulate(flat2, progress=False)
    err = cg.reprojection_error(p3, flat2, mean=True)
    seen = (np.isfinite(flat2[..., 0]).sum(0) >= 2) & np.isfinite(err)
    px = float(np.median(err[seen]))
    views = (np.isfinite(d2[..., 0]).sum(2) >= 4).sum(1)  # frames each phone read the board in
    print('CALIBRATED', toml, '| corners reprojection error px median %.2f (gate: under about 1.5)' % px,
          '| frames each phone read the board in', views.tolist())
    return str(toml), px, d2


# ---- self-test: the board drawn into four phones' views -------------------------------------------------------------

def look_at(c, target):
    z = target - c
    z /= np.linalg.norm(z)
    x = np.cross(z, [0, 1, 0])  # world y up; the image's x to the right, y down
    x /= np.linalg.norm(x)
    y = np.cross(z, x)
    return np.stack([x, y, z])  # rows: camera axes in world (world -> camera rotation)


def selftest():
    import json
    import subprocess
    import tempfile
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from sync import ffmpeg
    rng = np.random.default_rng(11)
    W, H, fps = 1280, 720, 120
    f_px = W / 2 / np.tan(np.radians(35))  # a phone's main lens: about 70 degrees across
    K = np.array([[f_px, 0, W / 2], [0, f_px, H / 2], [0, 0, 1]])
    sq = 0.18  # m, a 5 x 3 board 0.9 m wide
    aim = np.array([0.0, 1.0, 3.0])
    phones = np.array([[0, 1.6, -0.3], [-4.6, 1.6, -0.2], [4.6, 1.6, -0.2], [-5.3, 1.6, 8.5]])
    rots = [look_at(c, aim) for c in phones]
    S = 100  # board image px a square
    m = S // 2
    board = cv2.aruco.CharucoBoard((5, 3), 1.0, 0.8, cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_250))
    img = board.generateImage((5 * S + 2 * m, 3 * S + 2 * m), marginSize=m)
    A = np.array([[sq / S, 0, -m * sq / S], [0, sq / S, -m * sq / S], [0, 0, 1]])  # board px -> board plane m

    poses = []  # per frame: origin, x axis, y axis (the printed face is seen looking along x cross y)
    # close to each phone in turn, 1.2 m off, tilting
    for C, R in zip(phones, rots):
        for i in range(60):
            a = 2 * np.pi * i / 60
            Rt = cv2.Rodrigues(0.4 * np.sin(a) * R[0] + 0.4 * np.cos(a) * R[1])[0]
            x, y = Rt @ R[0], Rt @ R[1]
            poses.append((C + 1.2 * R[2] - 0.45 * x - 0.27 * y, x, y))
    close = len(poses)
    walk = 600
    for i in range(walk):
        u = i / walk
        yaw = 2 * np.pi * u * 1.5
        pitch = 0.5 * np.sin(2 * np.pi * u * 2.3)
        R = cv2.Rodrigues(np.array([0, yaw, 0]))[0] @ cv2.Rodrigues(np.array([pitch, 0, 0]))[0]
        x, y = R @ [1.0, 0, 0], R @ [0, -1.0, 0]
        # round the hitting area as the guide has it: back glass to 2 m past the service line (6.95 m), side to side
        c = np.array([2.2 * np.sin(2 * np.pi * u), 1.2 + 0.3 * np.sin(2 * np.pi * u * 3), 4.9 + 3.3 * np.cos(2 * np.pi * u)])
        poses.append((c - 0.45 * x - 0.27 * y, x, y))
    # flat on the court at the T, printed side up (looking down at it, x cross y points down)
    floor0 = len(poses)
    for _ in range(150):
        poses.append((np.array([-0.45, 0.0, 6.68]), np.array([1.0, 0, 0]), np.array([0, 0, 1.0])))

    tmp = tempfile.mkdtemp(prefix='calib-selftest-')
    vids = os.path.join(tmp, 'synchronized_videos')
    os.makedirs(vids)
    seen = np.zeros(len(phones), int)
    for k, (C, R) in enumerate(zip(phones, rots)):
        enc = subprocess.Popen([ffmpeg(), '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', f'{W}x{H}',
                                '-r', str(fps), '-i', '-', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12',
                                '-pix_fmt', 'yuv420p', os.path.join(vids, f'cam{k + 1}.mp4')], stdin=subprocess.PIPE)
        for O, x, y in poses:
            frame = np.full((H, W), 105, np.uint8)
            facing = np.dot(O - C, np.cross(x, y)) > 0
            corners = [O + a * 5 * sq * x + b * 3 * sq * y for a in (-0.1, 1.1) for b in (-0.1, 1.1)]
            depth = min((R @ (p - C))[2] for p in corners)
            if facing and depth > 0.3:
                M = K @ np.column_stack([R @ x, R @ y, R @ (O - C)]) @ A
                warped = cv2.warpPerspective(img, M, (W, H), flags=cv2.INTER_LINEAR, borderValue=0)
                mask = cv2.warpPerspective(np.full(img.shape, 255, np.uint8), M, (W, H), borderValue=0) > 128
                frame[mask] = warped[mask]
                seen[k] += 1
            noise = rng.normal(0, 2, frame.shape)
            enc.stdin.write(np.clip(frame + noise, 0, 255).astype(np.uint8).tobytes())
        enc.stdin.close()
        enc.wait()
    print('SELFTEST board drawn: %d frames; seen face-on by each phone in %s' % (len(poses), seen.tolist()))
    toml, px, d2 = calibrate(tmp, sq * 1000)
    from aniposelib.cameras import CameraGroup
    cg = CameraGroup.load(toml)
    cen = np.array([-cv2.Rodrigues(np.asarray(c.get_rotation(), float))[0].T @ np.asarray(c.get_translation(), float)
                    for c in cg.cameras]) / 1000
    order = [int(c.get_name()[-1]) - 1 for c in cg.cameras]
    truth = phones[order]
    d_true = np.linalg.norm(truth[:, None] - truth[None], axis=-1)
    d_got = np.linalg.norm(cen[:, None] - cen[None], axis=-1)
    iu = np.triu_indices(len(truth), 1)
    focal = [round(float(c.get_camera_matrix()[0, 0]) / f_px, 3) for c in cg.cameras]
    floor_read = (np.isfinite(d2[:, floor0:, :, 0]).sum(2) >= 4).sum(1)
    print('SELFTEST calibration: corners reprojection px %.2f; distances between phones off by mm max %.0f (of %.1f m);'
          ' focal found over true %s; the board flat at the T read in %s of %d frames by each phone'
          % (px, 1000 * np.abs(d_got - d_true)[iu].max(), d_true[iu].max(), focal, floor_read.tolist(), len(poses) - floor0))
    # what the bodies feel: 0.5 m sticks anywhere in the hitting area, filmed by the true phones, triangulated with the
    # calibration found
    a_pts = np.column_stack([rng.uniform(-3, 3, 300), rng.uniform(0.1, 2.2, 300), rng.uniform(0.5, 9, 300)])
    d = rng.normal(0, 1, (300, 3))
    b_pts = a_pts + 0.5 * d / np.linalg.norm(d, axis=1, keepdims=True)
    ends = np.concatenate([a_pts, b_pts])
    uv = []
    for k in order:
        c = (ends - phones[k]) @ rots[k].T
        q = c @ K.T
        px = q[:, :2] / q[:, 2:]
        inside = (c[:, 2] > 0.3) & (px[:, 0] >= 0) & (px[:, 0] < W) & (px[:, 1] >= 0) & (px[:, 1] < H)
        uv.append(np.where(inside[:, None], px, np.nan))  # a phone sees only what's in its picture
    p3 = cg.triangulate(np.array(uv), progress=False) / 1000
    got = np.linalg.norm(p3[:300] - p3[300:], axis=1)
    off = 1000 * np.abs(got - 0.5)
    print('SELFTEST 0.5 m sticks in the hitting area: length off by mm median %.1f, 95th %.1f (%.1f%%)'
          % (np.nanmedian(off), np.nanpercentile(off, 95), np.nanpercentile(off, 95) / 5))
    del close
    import shutil
    shutil.rmtree(tmp, ignore_errors=True)
    os.remove(toml)  # FreeMoCap's own copy (it also overwrote its 'last successful calibration', which nothing here reads)
    del json


if __name__ == '__main__':
    if sys.argv[1] == '--selftest':
        selftest()
    else:
        calibrate(sys.argv[1], float(sys.argv[2]))
