# Mixamo downloads for M2 (animation)

Mixamo is free with an Adobe ID (mixamo.com). Adobe allows the animations inside a game but not redistributing the raw files, so they go in `assets-src/mixamo/` (gitignored) and only the processed, packed result is committed.

## Settings for every download
- **Format:** FBX Binary (.fbx)
- **Frames per second:** 30
- **Keyframe reduction:** none
- **Skin:** *With Skin* for the character only; *Without Skin* for every animation
- **In Place:** ticked for every locomotion clip (the game moves the player itself)

## The list
Search each term and take the closest match. If two look similar, download both and I'll pick.

| # | Search | File name to save as | What it's for |
|---|---|---|---|
| 1 | **Y Bot** (Characters tab) | `ybot.fbx` | Rig and stand-in body until the character creator (M5) |
| 2 | tennis idle / ready idle | `idle-ready.fbx` | Ready position between shots |
| 3 | tennis forehand | `forehand.fbx` | Drive, topspin, slice (blended) |
| 4 | tennis backhand | `backhand.fbx` | Backhand side of the same |
| 5 | tennis serve | `serve.fbx` | Arm action; padel's underarm serve is adapted from it |
| 6 | tennis smash, overhead, or baseball pitch | `overhead.fbx` | Bandeja and smash |
| 7 | running (In Place) | `run.fbx` | Running forwards |
| 8 | running backward (In Place) | `run-back.fbx` | Retreating to the glass |
| 9 | left strafe, right strafe (In Place) | `strafe-left.fbx`, `strafe-right.fbx` | Side steps |
| 10 | jog forward (In Place) | `jog.fbx` | Short repositioning |
| 11 | jump (short hop) | `hop.fbx` | Split step |
| 12 | lunge, or stretching / reaching | `lunge.fbx` | Stretched shots |
| 13 | victory / fist pump | `celebrate.fbx` | Winning a point |
| 14 | disappointed / defeated | `dejected.fbx` | Losing a point |

About an hour in total. Padel-specific motion (víbora, wall play, the underarm serve) is not on Mixamo; it is built procedurally on top of these clips.
