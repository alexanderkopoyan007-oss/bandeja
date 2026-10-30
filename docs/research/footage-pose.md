# Strokes measured on video

Pose read in the browser from public clips (MediaPipe pose landmarker, heavy model, 1.2.0), a frame at a time, on the clip's own
page. Nothing but these numbers was kept: no frame, no landmark file, no clip. Measures: hips and stance in leg lengths, elbow as
flexion (0 straight), wrist height in trunk lengths above (+) or below (-) the shoulders.

Limits. Slowed clips dilate time, so times below are scaled by estimate. A coach's demonstration has a higher, closer ball than a
match. Depth from one camera is poor, so stance width reads narrow and is only compared within a clip.

| Stroke | Measure | Video | Game | Clip |
|---|---|---|---|---|
| Bandeja | Racket elbow at contact | 54-65 | 50 | [1](https://www.youtube.com/watch?v=ze0PoGPd22k) (7 strokes, 25 fps) |
| Bandeja | Free hand | -0.4 at -1.2 s, 0.5 at -0.3, -0.5 at +0.1 | 0.82 at -0.2, 0.2 at contact | 1 |
| Bandeja | Hips, stance | 0.87-0.92, 0.5-0.9 | 0.88, 0.9 | 1, 3 |
| Bandeja | Elbow after contact | 31-62, free arm stays long (6-31) | | 1 |
| Víbora | Elbow, wrist at contact | 53, 0.6 | 92, 0.11 (n 3) | [3](https://www.youtube.com/watch?v=WoKcwSZB57E) |
| Trophy | Elbows, hands | 30-43, rising together | | 3 |
| Smash | Knees before the jump | 93 / 67 at about -0.65 s | none: open | [2](https://www.youtube.com/watch?v=lAEme2jpwf8) |
| Smash | Racket elbow | 139 to 53 at contact | 102 to 36 | 2 |
| Smash | Legs at contact | 27 / 23 | 71 / 2 (airborne) | 2 |
| Forehand volley | Wrist in front of the racket shoulder | 0.39 m (0.35-0.48) | 0.41 | [4](https://www.youtube.com/watch?v=xgknoDRg-Gc) (13 volleys, 6 fps) |
| Forehand volley | Wrist below the shoulder | 0.27 m (0.13-0.38) | 0.35-0.43 | 4 |
| Forehand volley | Elbow | 63 (53-79) | 34-41 | 4 |
| Forehand volley | Shoulders on the hips | 25 (20-37) | 18 | 4 |
| Forehand volley | Chest turned from the net | 11-55 by the camera | 40 | 4 |
| Forehand volley | Free hand | elbow 78, 0.24 m in front | elbow 74, 0.10 | 4 |
| Forehand volley | Hips, knees | 0.82-0.85, 40-45 / 30 | 0.83, 62 / 40 | 4 |
| Backhand volley | Wrist in front of the racket shoulder | 0.42 m | 0.42 | [5](https://www.youtube.com/watch?v=jRkQB25IGPw) (held poses of a coach's breakdown) |
| Backhand volley | Wrist below the shoulder | 0.37 m | 0.35 | 5 |
| Backhand volley | Chest turned from the net | 60 | 60 | 5 |
| Backhand volley | Elbow | 54 | 37 | 5 |
| Backhand volley | Free hand at contact | 0.27 in front, 0.23 below, elbow 62 | 0.23, 0.26, elbow 100 | 5 |
| Backhand volley | Take-back | wrist at shoulder height, across the chest, elbow 59-68, both hands up | keyed the same | 5 |
| Serve | Wrist against the hip at contact | 0.12-0.3 m below (3 serves, 25 fps) | at the hip (was 0.10 above) | [6](https://www.youtube.com/watch?v=-e0uxZZOePQ), [7](https://www.youtube.com/watch?v=gvxuqyt_hn0) |
| Serve | Trunk forward at contact | 33-41 | 27 (was 19) | 6, 7 |
| Serve | Racket elbow at contact | 13-21 | 30 | 6, 7 |
| Serve | Chest, backswing to finish | -35 to +60 by the camera | | 6 |
| Serve | Free arm through the swing | nearly straight, 10-28 | 18 | 6, 7 |

Not done: groundstrokes (a [breakdown clip](https://www.youtube.com/watch?v=JtSP9EGtz1c) was scanned, too mixed in its cuts to give
clean contacts at 5 fps).

The serve's clips also moved the sim. A ball let go at the waist bounces to about 0.6-0.7 m and pros strike it near there, with the
wrist below the hip. The game's push of 3.2 m/s bounced it to 0.87 m. At 2.0 m/s it is struck at 0.70 m, and the trunk follows
without any new key, since the bend comes from the contact's height.
