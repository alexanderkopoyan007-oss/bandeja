# Strokes from clips into the game: the plan (10 Nov 2026)

The owner, 10 Nov: do the vibora and the bandeja as the forehand was done, then put the strokes into the game behind a switch; show nothing
until they play in the game ("i just need to see the end"). Solo, no agents. Golden hashes ef6e47b6 / 90c06c87 and src/sim/ untouched.

## A. The clips (docs/research/footage-pose.md "One camera, made to hold"; tools/assets/mocap/page/README.md)
- [x] forehand `JtSP9EGtz1c` -> `public/assets/mocap-local/yt-forehand2.json` (gitignored), contact 1.781 s of 2.13.
- [ ] vibora `PihyQF3EnHk` (The Padel School, 1080p25; 28-34 s a real-speed one, 42-106 s the slow one with freezes).
- [ ] bandeja `DVQL4hUMnjw`.
- For each: frame differences + ball (which frames move, the slowing from the ball's fall), pose on the moving frames, the racket by eye
  (about 25 cut-outs), `from_page.py`, `one_camera.py`, `retarget.py`, then `keys.py <clip>` for the stroke in strokes.ts's terms.

## B. Into the game (behind a switch; nothing by default)
What the game has: strokes.ts `Family` = back / contact / finish keys (racket face centre about the stance, handle's line, face normal,
elbow pole, shoulder yaw, free hand) and avatar.ts drawing the swing through them, bent to the sim's contact. What a clip adds that keys
can't: the trunk's own timing (hips before shoulders), the head, the free arm's path, the knees and the step, the racket's real path.
1. `keys.py` numbers beside each family's keys: where the pro differs (first read, forehand: his demo swing is gentler than the game's:
   shoulders -45 degrees at the take-back against -60, +12 at +0.34 s against +54; contact low and close, 0.59 m up, 0.36 m out).
2. A clip stroke at run time (new file, e.g. `src/render/avatar/clipStroke.ts`): the clip sampled by time from contact, its trunk, head,
   free arm and standing legs laid over the body by the stroke's weight; the racket arm still solved to the game's key (the sim's contact
   wins: "animation bends to the sim"). Switch: `Avatar.strokeClips` from `?motion=3` (2 is the leg matcher), off by default.
3. Clips shipped as assets only once the owner has seen them: a compact binary beside player.bnz; until then `mocap-local/` (dev only).
4. Checks: animQa thresholds (racket to ball at contact, pops, planted feet), alloc x6, perf, the default path bit-identical.

## C. The end
One look for the owner: the strokes in a match (`/?motion=3`), and only then.
