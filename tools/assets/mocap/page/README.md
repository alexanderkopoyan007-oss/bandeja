# A stroke off a clip's own page

What was run in the browser pane on a clip's page to measure one stroke (docs/research/footage-pose.md, "One camera, made to hold"). Nothing is
downloaded: only numbers leave the page, as a tool result that `from_page.py` reads back out of the session's record. The scripts are as they ran
for The Padel School's slow-motion forehand (`JtSP9EGtz1c`); the clip's own numbers in them (segments, key times, the slowing) are marked below.

Each file is one `javascript_tool` call, in this order:

0. Fetch the MediaPipe bundle and its wasm loader as text (`@mediapipe/tasks-vision@1.2.0` from jsdelivr: `vision_bundle.cjs`,
   `wasm/vision_wasm_internal.js`) into `window.__mpa`, `window.__mpb`; then, **in a call of its own with no await**, evaluate them
   (`module.exports` into `window.__mpv`, and `self.ModuleFactory`). The owner allowed this on 10 Nov 2026; ask again in a new session.
1. `1-load.js`: the pose model. The loader's `ModuleFactory` is used up by each model made: evaluate `window.__mpb` again before
   `1b-hand.js` (the hand model, for the free hand; a hand on a racket is not found).
2. `2-racket-cutout.js`: `__show(t)` puts a magnified cut-out round the racket wrist over the page, with rings every 10 cm at the body's scale
   and a degree scale: the racket is read off it by eye (`computer zoom` of the top-left 640 px) into the clip's `racket-keys.json`. Its
   `TS`/`MS` table (metres to the pixel through the clip) is this clip's. Remove the canvas (`#__ov`) before scanning. The pane's viewport must
   be given a size first (`resize_window`), or nothing paints.
3. `3-scan.js`: every frame of the stroke: the body (world and picture), the free hand's direction. Its yellow-pixel centroid for the ball is
   not used (other yellow things pull it): step 4 finds the ball.
4. `4-freezes-and-ball.js`: each frame's difference from the one before (a frozen frame: under 0.2; slow motion: 0.4 and up; a caption
   sliding in spikes inside a freeze) and the ball as the largest yellow blob. The ball's flight gives the slowing: its fall in video
   seconds against gravity (a pinhole fit, the ball's distance changing: `ball-JtSP9EGtz1c.py` here; here 7.2, a 180 fps camera at 25).
5. `5-stroke.js`: the moving frames only (`SEG`: this clip's), jitter out, to the stroke's own time (`K`), 60 a second, as
   `BANDEJA_POSE_V2`. `KT` is the racket keys' video times. Its result is the hand-over: `window.__export` as the call's value.

Then: `from_page.py <session .jsonl> <clip folder>`, `one_camera.py <clip folder> <clip folder>/v2`,
`FPS=60 CONTACT=<s> retarget.py <clip folder>/v2 public/assets/mocap-local/<name>.json <name>`.

## A clip that hides the racket arm, or changes speed (the víbora `PihyQF3EnHk`, 10 Nov 2026)

- **The speed is not one number.** A shadow swing has no ball to time (and this one's ball comes into the picture 8 frames before the
  hit). What settled it: the clip's own real-speed run of the stroke, tracked too; the wrist's travel per frame there against the slow
  part's (4.3-5.2); the racket's speed across the contact frame (0.21 m a frame: 25 m/s at 120 fps, 38 at 180); the ball's fall (9 m/s
  at 120). So 120 fps at 25 (4.8), not the forehand's 7.2; the first part plays at half that again (the raise of the free arm: 73 frames
  for the real run's 0.33 s); the second repeats frames (a frame whose difference from the one before is under 0.05 is the one before).
- **Freezes can hide cuts.** A one-frame jump in the frame difference inside a freeze is a cut to another frozen frame: here to the
  contact frame, four frames on (the hand's travel and the ball's fall both say four). `5b-stroke-parts.js` puts the cut frames back
  (`gap`) and gives each part its own time a frame. Parts that start and stop at once are the slow motion; ones that ramp up and down
  are captions and drawings moving over a frozen frame.
- **Behind the head the tracker loses the racket arm** (it put the wrist on the free arm, then hung it by the trunk). `2b-cutout-head.js`
  frames the head; the hand and elbow are read by eye and go into `racket-keys.json` as `arm`, which `one_camera.py` lays over the
  tracker's arm. A hidden hand is placed between where it was last and next seen, a racket's length from the head's centre (that is
  seen); a hidden elbow by the pose (out along the shoulder line as the trunk turns).
- Another clip in the same page without losing the trackers: `movie_player.loadVideoById(id)`.

## The bandeja (`DVQL4hUMnjw`, 10 Nov 2026)

- **An advert can play first** after `loadVideoById`: `movie_player.classList.contains('ad-showing')`, and `getDuration()` against the
  clip's known length, before any scan (a whole survey ran over a 234 s advert).
- Six slow parts between frozen frames with captions drawn over them: 47.84-49.52, 57.52-59.36, 67.36-71.36, 71.52-71.92, 79.92-80.96,
  88.96-92.0 (`5b-stroke-parts.js` with these as `SEGS`, each `dt: 1/120`, no `dedupe`, no `gap`; rows from the pass over 38.6-101.6).
  Each part's first frame is a new one (its difference from the frozen frame before is as large as the moving frames'), so nothing is
  dropped or repeated at the joins. 120 fps at 25 again: the ball falls 0.08-0.10 m a frame into the hit (10-12 m/s; 180 fps would
  make it 15-18, more than a lob can fall on a padel court).
- Seen from the net and a little to the side the tracker keeps the racket arm nearly all the way (`2b-cutout-head.js` at `half` 1.0,
  180 px to the metre: the head and the racket both in the cut-out). It dropped it for 20 frames behind the head (69.44-70.24: the
  wrist's height from the shoulder goes from +0.3 to -0.4 and back): the `arm` rows carry it across from the tracker's own arm
  either side.
- `#__ov` removed and made again leaves `__showH` drawing into the old canvas (black cut-outs): evaluate `2b-cutout-head.js` again.
  With the session open in no window the pane is hidden; cut-outs still paint and `computer zoom` still reads them.
- **Which face is seen.** A key may carry an eighth number: +1 the palm's side of the racket is towards the camera, -1 the back
  (`one_camera.py` passes it on as `face`, `retarget.py` keeps only such turns). Without it the fit turned the racket over about its
  handle in the three frames after the hit: a wrist laid back like a tray (55 degrees; the stroke's name) costs more in its books than
  the other face. `RK_DEBUG=1 retarget.py ...` prints every candidate turn of every key with the wrist it needs.


## The backhand (`5MH8RDf4qfg`, 10 Nov 2026)

- Slow parts between frozen frames again (42.40-43.20, 51.24-52.72, 60.76-61.56, 69.56-72.16, 80.20-81.12, 91.12-94.24; the last three
  are the stroke from the racket up by the head to the finish, and are what was converted). In the slow parts **a frame in three is the
  one before again** (difference under 0.1 against 0.7-1.0 for a moving frame): `dedupe` with the threshold at 0.2.
- **The speed from the ball against its own size.** The ball's rise to its top (70.8-72.16) by a yellow-pixel centroid in the page
  (r>165, g>185, b<140 on a 960-wide frame), frame by unique frame: 0.25 px a frame squared; the ball is 15.5 px across (31 at 1080p) =
  6.5 cm, so 238 px to the metre *at the ball* and 9.81 m/s2 makes a unique frame 1/96 s: a 100 fps camera (`dt: 1/100`). The body's
  own scale (162 px/m) would have said 63 fps: the camera is close and wide, and the ball and the contact are a third nearer it than the
  body is.
- For the same reason **the racket is drawn bigger than the body's scale in front of the body** and its head's width reads narrower
  than the face's turn (the camera looks well down on a racket at shin height): lengths count only where `near` is set, and the widths
  either side of the contact are set for a face near upright (the swing is a flat drive, low to high), not as measured.
- Return `window.__export` itself, not `JSON.stringify` of it: `from_page.py` looks for `"marker"` unescaped.
- The cut-outs are head-centred, so a hand's place in two cut-outs is not its travel (the head moves): speeds from the tracker's rows.
