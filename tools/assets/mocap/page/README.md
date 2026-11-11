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

## The volleys (`p6SwYJQ5AYY` forehand, `jRkQB25IGPw` backhand, 11 Nov 2026)

- These two are cut into fifteen and more "moving" parts, most of them **drawing over a frozen frame** (lines, circles, captions fading
  in: frame differences of 0.25-1.1 with nobody moving). The parts where the *body* moves are found from the pass's own rows: the
  racket wrist's travel across a run of rows (hundreds of pixels against 0-10 for a drawn-over freeze). Forehand volley: 58.12-60.28,
  68.28-68.92, 78.96-79.60, 87.64-89.56; backhand volley: 62.56-65.20, 73.20-74.64, 84.56-85.20, 93.20-94.44. No frame repeated
  (a 100 fps camera at 25, 4x); contact the frozen frame with the ball on the strings (79.60, 85.20).
- **Frames cut after the frozen contact frame**: the wrist's step across the freeze is 45 px against 11-14 either side (forehand
  volley: three frames, put back by re-timing page.npz, the same as `{gap: 3}` in SEGS) and 30 against 15-20 (backhand: `{gap: 1}`).
- `window.__sheet(times, half, job, cols, up)` (made in the page, not kept as a file: it is twenty lines): body-centred tiles of
  several frames on one canvas, one `computer zoom` of [0,0,750,500] for all of them (24 tiles of 125 px to find what a part is; six of
  250 px, 131.6 px to the metre at half 0.95, to read the racket). A third of the pictures the single cut-outs took.
- `window.__mkExport(job, SEGS, contact, clip, KT, k)`: `5b-stroke-parts.js` as a function (dedupe threshold 0.2).
- **Keys either side of a frozen frame are 0.01 s apart**: two readings 15 degrees apart there are 1500 degrees a second to the
  spline, and the racket swung round a loop before them. One of each such pair is kept.


## The smash (`yRiT052FmVw`, 11 Nov 2026)

- **A hand-held camera behind the player, close: the feet are out of the picture.** One unbroken slow-motion take (no freezes, no
  captions). The speed from the jump itself: the hips' rise and fall is 76 frames for a rise of 0.11 m, which gravity makes 0.30 s:
  a 240 fps camera at 30 (`dt: 1/240`, 8 x). The net's tape stays on one row (586-598 of 1080) and level: the camera is square to
  the net and looks about 2 degrees down, so `UP=0,0.9994,0.035 FORWARD=0,0,-1`, and `HELD=0.93` (one_camera.py: the hips held over
  one spot at that height, no foot said to stand: the legs are the tracker's guess, and the game draws its own legs and jump).
- **The scan re-detects each frame in a square cut round the body** (704 px of the 1080: the body fills the frame and a raised arm
  left the model's own crop), frames 450-795, every one tracked; the stroke is 566-790, the ball on the strings at 658.
- **A seek can be answered by the seek before it**: wait 0.7 s after `seeked` before drawing a still for the eye (a sheet drawn at
  0.15 s showed other frames and read as a camera tilting 10 degrees). `movie_player.pauseVideo()` as well as the video's own pause,
  autoplay-next off (`.ytp-autonav-toggle-button`), and the scan checks `getVideoData().video_id` each frame: the page went on to
  another clip in the middle of one.
- **The tracker's world points squash a raised arm seen from behind** (an upper arm of 0.12-0.20 m from the drop to the
  follow-through; the length fix then pushed the elbow at the camera): `arm` rows for 622-692 from the picture (the tracker's own
  picture marks, by eye where it put the wrist on the elbow), depths from the limbs' lengths. The racket's lag settles the side:
  at 650 the racket hangs from the raised hand, edge on, along the forearm in the picture; a wrist lays back 90 degrees at most, so
  forearm and racket both lean at the camera (the forearm 26 degrees). Away from it the fit's wrist cost was 23.7.
- Cut-outs for the racket: two 512-px tiles a call centred on the racket shoulder (`__two(frames, half, up, dx)`, read with
  `computer zoom` of [0,0,800,400]), 267-364 px to the metre. 646 and 666 are blurs: no key. 706-766: the black racket hangs
  against black shorts: placed between 706 and 790.
- **A kick smash is not the game's smash.** He hits it side-on (the shoulders 85 degrees from the net at the ball), leaning back,
  the ball over his head; the game's smash is met 0.6 m out in front. As the clip has it the racket shoulder was 1.06 m from the
  game's ball (reach 0.87). `TURN=back,ball,finish,bow keys.py` turns the player to another heading: the shoulders' turn re-based
  (the clip's own change kept either side of the ball), the bow taken to nothing at the ball, and **the racket, the elbow, the
  racket shoulder and the free hand turned about the stance with it**, so the arm stays where he has it on his chest. The first
  go (owner, 11 Nov: "look at where that arm goes, not realistic at all") turned the shoulders alone: through the drop the upper
  arm stood 80-100 degrees behind the chest's plane. The ball's turn is -0.4 (the chest 23 degrees short of square): the racket
  goes through the ball 27 degrees across the net's line (45 at 0.05, 10 at -0.8; his own is 45 the other way).
  `TURN=-1.6,-0.4,0.3,0 TRACK=public/assets/mocap-local/tracks/smash.json LEAD=0.32 FOLLOW=0.45 keys.py public/assets/mocap-local/yt-smash.json 0`.
  Check a track's arm in the chest's own frame before wiring it: `ROM=1 node tools/out/yt/vib-dbg.ts <seed> <player> <t>` (scratch)
  prints the upper arm's elevation and its angle off the chest's plane, the hand and the racket from the shoulder; the clip's own
  come from keys.py's bones the same way.

