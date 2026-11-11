# Strokes from clips into the game: the plan (10 Nov 2026)

The owner, 10 Nov: do the vibora and the bandeja as the forehand was done, then put the strokes into the game behind a switch; show nothing
until they play in the game ("i just need to see the end"). Solo, no agents. Golden hashes ef6e47b6 / 90c06c87 and src/sim/ untouched.

## A. The clips (docs/research/footage-pose.md "One camera, made to hold"; tools/assets/mocap/page/README.md)
- [x] forehand `JtSP9EGtz1c` -> `public/assets/mocap-local/yt-forehand2.json` (gitignored), contact 1.781 s of 2.13.
- [x] vibora `PihyQF3EnHk` (The Padel School, 1080p25) -> `yt-vibora.json`, contact 1.008 s of 1.84; a 120 fps camera at 25 (4.8), not
  the forehand's 7.2; the racket arm by eye behind the head.
- [x] bandeja `DVQL4hUMnjw` (the same channel) -> `yt-bandeja.json`, contact 1.9 s of 2.53; 120 fps at 25 again, six slow parts between
  frozen frames; the tracker's racket arm carried across 20 frames it dropped; contact at head height, 0.79 m out to the side.
- [x] backhand `5MH8RDf4qfg` (the same channel) -> `yt-backhand.json`, contact 0.63 s of 1.17; a 100 fps camera with a frame in three
  repeated; a flat drive met low (0.42 m) and in front, the racket up by the head 0.16 s before; `tracks/backhand.json` (lead 0.3,
  follow 0.45) draws BACKHAND behind `?motion=3` (the owner, 10 Nov: "fix the rest of the shots", then the look pass).
- [x] forehand volley `p6SwYJQ5AYY` -> `yt-volley-fh.json` (contact 0.87 s of 1.37, 1.09 m up, the face open 28 degrees; a long chop
  down across after it) and backhand volley `jRkQB25IGPw` -> `yt-volley-bh.json` (contact 1.1 s of 1.42, 0.79 m up); tracks lead 0.3,
  follow 0.3: VOLLEY_FH and VOLLEY_BH behind `?motion=3`. A track-drawn volley follows through as the clip does (the coded one stops
  short by the ball: `wrist` goes with the other shaping).
- [ ] smash, serve: **no usable clip yet** (11 Nov). Tried `EVErNSuvpmE` (EverythingPadel, flat smash), `5l0vMSN2Mek` and `m996plIjcz0`
  (The Padel School): talk-throughs with swings at real speed (8 blurred frames a swing at 25 fps) and match footage from far off, no
  slow-motion breakdown; the serve search turned up only `gvxuqyt_hn0` (tips, the same format). Both stay the coded keys (the smash is
  the chest-frame throw, the serve the toss-timed one) until a slow-motion clip of each is found or the owner names one.
- For each: frame differences + ball (which frames move, the slowing from the ball's fall), pose on the moving frames, the racket by eye
  (about 25 cut-outs), `from_page.py`, `one_camera.py`, `retarget.py`, then `keys.py <clip>` for the stroke in strokes.ts's terms.

## B. Into the game (behind a switch; nothing by default)
What the game has: strokes.ts `Family` = back / contact / finish keys (racket face centre about the stance, handle's line, face normal,
elbow pole, shoulder yaw, free hand) and avatar.ts drawing the swing through them, bent to the sim's contact. What a clip adds that keys
can't: the trunk's own timing (hips before shoulders), the head, the free arm's path, the knees and the step, the racket's real path.
1. `keys.py` numbers beside each family's keys: where the pro differs (first read, forehand: his demo swing is gentler than the game's:
   shoulders -45 degrees at the take-back against -60, +12 at +0.34 s against +54; contact low and close, 0.59 m up, 0.36 m out).
2. Done (10 Nov): `src/render/avatar/clipStroke.ts`. Not the clip laid over the body, but its **track**: `TRACK=<out.json> LEAD= FOLLOW=
   keys.py <clip>` writes, 60 a second from `lead` before the ball to `follow` after, the racket (face centre and turn), the elbow, the
   racket shoulder, the shoulders' turn, the free hand and the trunk's tilt and bow, about the stance. `?motion=3` loads
   `assets/mocap-local/tracks/{forehand,vibora,bandeja}.json` and those families (and their left-handed mirrors) are drawn by the track
   in place of the three keys and the curve between them. The sim's contact wins: the arm-and-racket shape is turned about the racket
   shoulder and stretched (`Avatar.trackKey`), fully at the ball and eased either side, so the racket's centre is at the sim's contact.
   Everything after the key is the avatar's own as before (the IK, the hips' reach, the feet, the body's turn, the head on the ball).
   The clip's legs and steps are not used: the game's feet go where the sim's player goes.
3. Still to do if the owner takes it: the tracks as shipped assets beside player.bnz (they are 9 KB each as JSON), and the other
   strokes (the serve, and the lob / slice / drop / chiquita / off-the-glass variants are still the coded keys; the backhand and both
   volleys were added 11 Nov, the smash the same day: DECISIONS.md "The smash from a clip").
4. Checked: `tests/render/clipStroke.test.ts` (tracks made from the coded keys still meet the ball, either hand); the suite (the default
   path untouched: no track, no branch taken); `TRACKS=public/assets/mocap-local/tracks node tools/anim-check.ts m3 100 6` against the
   same without: racket to ball p50 0.6-0.9 cm either way, pops 10.8-18.2 a minute against 11.0-17.6 (threshold 30), no knee spins;
   the racket in the body 0.02-0.13% of frames against 0-0.09% (deepest 10.7 cm against 6.9): the clips' follow-throughs wrap closer
   across the trunk than the coded ones. Not done: alloc and perf with the switch on.

## C. The end
One look for the owner: the strokes in a match (`/?motion=3`), and only then. Sent 10 Nov: one film (forehand, bandeja, vibora; each at
full speed then half), and the address to play it.
