# Pilot capture: one hour on court with 4 phones

*For the motion plan (`docs/motion-plan.md`), route A. This first session only tests whether phones are good enough, especially for the racket and wrist. It doesn't need to be perfect.*

## Bring
- **4 phones** with the free **Blackmagic Camera** app (iPhone or Android). Its manual shutter and its "stabilisation off" setting matter.
- **4 tripods**, or anything that holds a phone still at chest height. Phone clamps on light stands are fine.
- **The board**: the file `charuco_board_5x3_1m.pdf` (sent with this guide), printed at a print shop **at 100%, 1000 × 773 mm, on stiff foam board**. Keep it flat; a bent board ruins calibration. Afterwards, measure one black square's side in mm and write it down.
- **Fluorescent tape** in 3 colours (pink, orange, green). Wrap 2 cm strips round the racket's rim so they show from both faces:
  - pink at the very top of the head
  - orange at the widest point on the left of the head
  - green at the widest point on the right of the head
- A racket, a bucket of balls, **one player** (the one we capture) and **one feeder**.
- **Daylight or a bright indoor court.** Floodlights at night force slow shutters, and the racket smears.

## The phones
Settings, the same on all four:
- landscape, 1080p
- **120 fps** (60 if a phone can't)
- the main 1× lens, never the ultra-wide
- **stabilisation OFF** (it warps the picture)
- **shutter 1/1000** or faster
- focus and exposure locked on the player's spot
- record sound

Where they go. Work in one half of the court, with the player in the back half on their usual side:

| Phone | Where | Height | Points at |
|---|---|---|---|
| 1 | Outside, behind the back glass, middle, **lens pressed flat on the glass** (no reflections that way) | 1.6 m | The player from behind |
| 2 | Outside, back corner on the player's side, lens on the side glass | 1.6 m | The hitting area, about 45° |
| 3 | Outside, the other back corner, lens on the glass | 1.6 m | The hitting area, about 45° |
| 4 | Outside the side mesh, near the net on the player's side, **lens inside one of the mesh's square gaps** | 1.6 m | Back at the player, from the front side |

Every phone must see the whole area where the player moves: from the back glass to about 2 m in front of the service line, side to side. Being outside the court keeps them safe from balls.

## Session plan (about 1 hour)
1. **Calibration (10 min).**
   - Start all 4 recordings. One loud **clap** where every phone can hear it; the claps and the balls' pops are what line the videos up.
   - **Close-ups:** hold the board about 1 m in front of each phone in turn for 5 s, tilting it a little each way, so it fills a good part of that phone's picture. (This is what gets each phone's lens right; without it the farthest phone's comes out several % wrong.)
   - Walk the board slowly round the whole hitting area for about 90 s: turn it, tilt it, high and low, and turn its printed face towards each phone in turn, so every phone sees it often and from different angles. Go right up to the far end of the area too, near phone 4.
   - Clap again.
   - (No need to lay the board on the floor: from 1.6 m up and several metres away the phones can't read it lying flat. The floor comes from where the player's feet stand.)
2. **Footwork, no ball (5 min).** Without stopping the phones:
   - ready bounce, 10 s
   - 5 split steps
   - side shuffle across and back, 3 times each way
   - crossover run to the side, 3 times
   - sprint 4 m forward and stop, 3 times
   - backpedal to the glass, 3 times
   - turn and run back to the glass, 3 times
3. **Strokes, fed balls (25 min).** The feeder feeds from the other side, one ball at a time with a short pause between, varying height a little:
   - 10 forehand drives
   - 10 backhand drives
   - 6 forehand volleys
   - 6 backhand volleys (step up into range)
   - 8 bandejas
   - 5 lobs
   - 5 forehands and 5 backhands off the back glass
   - 5 smashes

   Say the shot name out loud before each block (the phones hear it).
4. **Play (5 min).** A few points of normal rallying.
5. **Clap and stop.** Stop the phones every 10 minutes or so to keep files a sensible size. Clap at the start of each new recording.

## After
- Copy every video, unedited, to the Mac by AirDrop, into `~/bandeja-mocap/sessions/pilot/` with one folder per phone: `cam1`, `cam2`, `cam3`, `cam4`.
- Tell me the board's square size in mm.
- The videos show people's faces, so they stay on the Mac: never in the repo, the game, or online. Delete them after processing if the player wants.

## Consent (the player and the feeder, in writing; a text message is fine)
> I agree that my movement recorded on [date] may be used to animate characters in the game BANDEJA. My face and appearance won't be used, and the videos stay private.

## What I check, and the gate
I check each item once the videos are on the Mac.

| Check | Pass |
|---|---|
| Calibration reprojection error | under about 1.5 px |
| Limb lengths after fitting our skeleton | wobble under 3% (FreeMoCap's own classroom sample, raw: 6-14%) |
| Racket dots | found in at least 9 of 10 contact frames, racket shape held within 1 cm |
| Contact moment from the ball's sound against the racket's path | within one frame |

If the body passes but the racket doesn't, phones still do all the footwork, and the strokes get a studio day (route B).

## Processing (on the Mac, `PY=~/bandeja-mocap/venv/bin/python`, each with `-I`; every tool has a `--selftest`)
All of it in one go, resumable (a step whose output exists is skipped): `tools/assets/mocap/process.py ~/bandeja-mocap/sessions/pilot <square mm>`. It matches each phone's files into recordings by their creation times, calibrates on the first, then for every recording runs the steps below and prints its gate (`gate.py`). Run end to end on FreeMoCap's own sample (with claps added as its sound) on 7 Nov.

The steps, for each recording (the phones' files that were recorded together):
1. `tools/assets/mocap/sync.py cut <rec> cam1.mov cam2.mov cam3.mov cam4.mov`: the phones on one clock by the claps' and balls' sound, cut to FreeMoCap's synchronized videos (ffmpeg from imageio-ffmpeg).
2. On the calibration recording only, `tools/assets/mocap/calibrate.py <rec> <square mm>`: each phone's lens from its own views first, then where the phones stand. Gate: corners' reprojection error.
3. `tools/assets/mocap/run_headless.py <rec> <calibration.toml>`: FreeMoCap's bodies.
4. `tools/assets/mocap/racket.py <toml> <rec>/racket.npz <rec>/synchronized_videos/cam*.mp4`: the racket, each phone's dots moved to the frame's own moment, and each phone's picture delay against its sound. Gate: dots and shape at contact.
5. `tools/assets/mocap/sync.py refine <rec> <toml>`: the clocks again, each pop's travel to each phone taken off (its source the racket's face, else the hitting hand), with the picture delays. If it re-cuts the videos, 3-5 once more.
   - It also places every pop on the court from its arrivals alone (self-test: bounces 2.3 cm, racket hits 1.7 cm across the court; heights weak, the phones all stand at one height): the feeder's hit, the bounce, the glass.
6. `tools/assets/mocap/retarget.py <rec>/output_data <out.json>` (with `FPS=120`): onto the game's skeleton, up from the floor the feet stood on.
7. `tools/assets/mocap/gate.py <rec> <calibration rec>/calibration_check.json`: the table above, measured. Limb wobble is each limb's length's standard deviation over its median; the contact check is the spread of the racket's fastest moment around the sound.
8. `tools/assets/mocap/takes.py <rec>...`: each of the player's contacts as a take, labelled by measurement (hand, height, reach, racket speed; family from the placed pops between the feeder's hit and the contact: no bounce a volley, a bounce a groundstroke, then the glass; over 1.9 m an overhead), and how much of the [shot list](mocap-shotlist.md) the takes fill, which says what's left to film. A bandeja or víbora (and anything mislabelled) is settled in `<rec>/labels.json`.

Self-tests (7 Nov 2026, synthetic): clocks to 0.07 ms after refine (5.3 ms by sound alone); frames exact through a video round trip; the racket at 23 m/s within 1 mm once retimed with picture delays (30 mm as cut); the calibration with four phones round half a court: lenses within 0.4%, 0.5 m sticks anywhere in the hitting area 2.1% at the 95th percentile (7.0% without the lens step); the floor from footsteps within 0.05 degrees.
