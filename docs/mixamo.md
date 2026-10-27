# Mixamo clips for M2 (animation)

Mixamo is free with an Adobe ID (mixamo.com). Adobe allows the animations inside a game but not redistributing the raw files, so they live in `assets-src/mixamo/` (gitignored) and only the processed, packed result is committed.

## Settings used for every download
- **Format:** FBX Binary (.fbx)
- **Frames per second:** 30
- **Keyframe reduction:** none
- **Skin:** *With Skin* for the character only; *Without Skin* for every animation
- **In Place:** ticked for every locomotion clip (the game moves the player itself)

## What is in `assets-src/mixamo/` (downloaded 27 Oct 2026)
Mixamo has no tennis or padel clips at all, so the strokes are not taken from it (see below). Everything else is the closest match on the site.

| File | Mixamo clip | What it's for |
|---|---|---|
| `ybot.fbx` | Y Bot (character, with skin) | Rig and stand-in body until the character creator (M5) |
| `idle-ready.fbx` | Goalkeeper Idle (without ball) | Ready position between shots: knees bent, weight forward |
| `run.fbx` | Running (with intention), In Place | Running forwards |
| `run-back.fbx` | Running Backward, In Place | Retreating to the glass |
| `strafe-left.fbx` | Jog Strafe Left (soccer), In Place | Side steps |
| `strafe-right.fbx` | Jog Strafe Right, In Place | Side steps |
| `jog.fbx` | Jog Forward, In Place | Short repositioning |
| `hop.fbx` | Jump (jumping in place) | Split step, cut down to the take-off and landing |
| `lunge.fbx` | Long Right Side Step (boxing) | Legs of a stretched shot; mirrored for the other side |
| `celebrate.fbx` | Fist Pump (pumping a fist) | Winning a point |
| `dejected.fbx` | Defeated (frustration after a loss) | Losing a point |

## Made in code instead
The strokes are authored procedurally on the Y Bot rig, with the user's OK, since nothing on Mixamo fits:
- forehand and backhand (drive, topspin, slice), the volley and the underarm serve
- bandeja, víbora and smash
- wall play (turning to take the ball off the glass)

They are keyframed in code against the rig's bones, time-warped so contact lands exactly on the sim's contact moment, and blended over the locomotion clips from the hips up.

To swap in better clips later (your own, or from a video-to-mocap tool), drop the FBX in with the same file name and rebuild.
