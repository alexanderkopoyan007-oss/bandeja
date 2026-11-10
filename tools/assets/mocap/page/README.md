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
