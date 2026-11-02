# What padel sounds like, in numbers

Round 11, 31 Oct 2026, after the owner said "the sounds are wrong". Nobody, person or agent, has listened to any of
this. Everything below was measured from renders; nothing says a sound is right, only how far a number is from a
published one. The numbers the code tests against are in `data/audio-reference.json`.

Run it: `node tools/audio-dump.ts <outDir>` (every voice, to WAV, with the table), `--ref` (against the curves below),
`--mix <secs> [--arena a] [--floor n] [--solo]` (a simulated AI match through a model of the engine's chain).

## 1. Sources and what each one really gives

Read first, because most of the reports turned out to hold less than their titles promise.

| Source | What it gives | Weight |
|---|---|---|
| [Wadman et al. 2021, Chalmers bachelor's thesis](https://odr.chalmers.se/handle/20.500.12380/302423) | The only source found with one sound of each kind measured apart, in a real cage: LAFmax, waveforms, spectra, the cage's T20. | Best there is, and still students with a meter, single events, unknown ball speeds. Figures read by hand. |
| [Piana, Tonetti, Garcia, Milesi 2025, Riv. It. di Acustica 49(2)](https://journals.francoangeli.it/index.php/ria/article/view/21012) | ISO 3744 sound power of a whole game, third octaves 20 Hz-10 kHz, with and without shouting; direct sound of a hit from ambisonics. | Good. Four amateurs, one outdoor court, 12 mm tempered glass, turf. |
| [Higgins, MW Acoustic Consultants 2025](https://maywalters.com/wp-content/uploads/2025/08/Summary-Paper-A-Noise-Assessment-for-Padel.pdf), via [The Padel Paper](https://thepadelpaper.com/padel-noise-martin-higgins-research/) | Events per 5 minutes, side against end, words for the sounds. | The summary has no levels by source. The paper itself was not found. |
| [Clarke Saunders white paper 2023](https://clarkesaunders.com/images/CSA%20white%20paper%20PADEL%20NOISE.pdf) | Hit rates, "thunk" against "bop", the claim that wall hits matter less than strikes. | Words and rates, no levels. |
| [Geltinger, DataKustik, Noise News Int. 2026](https://noisenewsinternational.net/racket-sports-and-environmental-noise-assessing-and-predicting-impulsive-noise-from-tennis-padel-and-pickleball/), [DataKustik page](https://www.datakustik.com/lp/padel-laerm.html) | Emission values for padel, tennis, pickleball. | Single numbers. |
| [Dutch Handreiking Padel en Geluid](https://www.knltb.nl/media/ewkh5i05/handreiking-padel-en-geluid-v4.pdf), [Geldrop report](https://www.geldrop-mierlo.nl/_flysystem/media/onderzoek-geluidsbelasting-realiseren-padelbanen-bij-tv-de-mast-te-geldrop-definitief-incl-bijlagen-de-mast.pdf), [Sain](https://www.sainadvies.nl/nieuws/geluid-van-padel/) | Sound power and peak source levels. | No octave spectra were readable in any of them. |
| [Abu Dhabi case study 2026, Sound & Vibration 60(5)](https://ojs.acad-pub.com/index.php/SV/article/view/4407) | LAeq, LAmax, octave bands in a figure, at 10 m. | One 15-minute recording. The paper says so itself. |
| [TWU pickleball study](https://twu.tennis-warehouse.com/learning_center/pickleball/pickleballnoise.php), [Crystal Instruments](https://www.crystalinstruments.com/blog/2024/1/5/pickleball-paddle-noise-characterization-with-coco-80x-and-post-analyzer-dec-2023) | A solid paddle's spectrum and duration. | Another sport, a useful neighbour: a stiff faced paddle on a ball, no strings. |
| [Harvard squeak study 2026, Physics Today summary](https://physicstoday.aip.org/quick-study/a-peek-into-the-physics-of-squeaky-sneakers) | How a sole squeaks. | Rubber on smooth plates, not sand. |

Not found, though searched for in English, Swedish, Dutch, German, Spanish and Italian: octave or third-octave spectra of
one racket hit, glass hit or fence hit in any neighbour-noise report; any study of a ball on sand-filled turf; any modal
analysis of a padel racket; any measurement of chain-link or welded-mesh rattle; any applause-to-hit ratio.

## 2. What real padel measures

### Levels (LAFmax, Wadman et al. Fig. 4.2.3)

| Sound | dBA | At |
|---|---|---|
| Ball hit into the glass on your own side | 95.4 | 2 m |
| Padel racket hit, in the cage | 92.5 | 2 m |
| Padel racket hit, on an open tennis court | 92.5 | 2 m |
| Loudest moment of play, in the cage | 88.9 | net end |
| Ball into the mesh | 87.6 | 1.5 m (85.1 at 2 m by inverse square) |
| Tennis racket hit | 80.9 | 2 m |
| Mesh hit from outside | 67.1 | 16 m |
| Loudest moment of play | 63.8 | 31 m |

So at equal distance: glass +2.9 dB, mesh -7.4 dB, tennis racket -11.6 dB against a padel racket. LAeq in the cage 69.4
dBA at the net end, tennis 58.2. Geltinger: LWAFmax 100 dB(A) a strike for padel, 102.5 pickleball, 95 tennis. Geldrop
assumes peaks up to 103 dB(A) from padel and 100-105 from shouts. Whole-court power 89-91 dB(A) (Handreiking, Piana: 89.2
without shouting, 91.1 with: voices are about 2.4 dB under the impacts, in those four players). At 10 m in Abu Dhabi, LAeq
64.2, LAmax 71.3.

Clarke Saunders disagree with the glass figure in practice: the ball reaches the glass mostly after the floor, so
slowly, and "ball-wall impact sound is much less significant than ball strikes". Both can hold: the 95.4 is a ball
struck directly at the glass. The sim's glass hits run at a median of 6.8 m/s, so the level law gives the same result.

### The racket (Wadman et al. Fig. 4.3.2, at 2 m in the cage)

Power per Hz against its own top, smoothed: flat from 125 Hz up to a top at about 700 Hz, -7 dB at 1 kHz, -10 at 1.4 kHz,
-13 at 1.7 kHz, -20 at 2 kHz, -17 at 2.5 kHz, -19 at 3.2 kHz, -25 at 4 kHz, -32 at 5 kHz, -43 at 8 kHz. Below about
125 Hz the curves meet the background, so they aren't used. Padel and tennis racket hits don't differ much, tennis
having somewhat more high end.

- Direct sound: about 30 ms (Piana). Pickleball: contact about 2 ms, "the ear integrates" up to about 30 ms, 80% of the
  power under 750 Hz, nothing significant above 2 kHz (TWU). Narrow-band noise at 200-500 Hz under a top near 1 kHz
  (Crystal Instruments). Peak 1/3 octave at 1250 Hz for one paddle ([INCE 2023, excerpt only](https://ince.publisher.ingentaconnect.com/contentone/ince/incecp/2023/00000266/00000002/art00004?crawler=true&mimetype=application/pdf)).
  Spectral peak of a real padel hit: about 700 Hz. Spectral centroid: not published.
- Whole game, A-weighted (Piana Fig. 6): rising to a plateau at 800-1600 Hz, 4 dB down at 2-3 kHz, 9 at 4 kHz, 13 at
  5 kHz. Fig. 7, with shouting, adds 125-400 Hz but keeps the same top.
- Words: "bop" for padel against "thunk" for tennis (Clarke Saunders); "sharp, high-frequency crack" (Higgins);
  "broadband, dry" (Piana); carbon drier, fibreglass softer (Piana). The words disagree, so the spectrum decides.
- Harder and more pressurised is sharper (Piana). Holes in the face dissipate energy (Piana): no number.

### Glass (ibid.)

Power per Hz against its own top: flat 125-250 Hz, -4 at 400, -8 at 500, -13 at 700 (a dip where the racket peaks), -10
at 1-1.4 kHz, -16 at 2 kHz, -27 at 3 kHz, -31 at 4 kHz, -32 at 6 kHz, -44 at 8 kHz. Higgins: "lower-frequency 'thump'".
Waveform (Fig. 4.3.1): about 20 dB down in about 0.2-0.4 s, with a slow low wobble out to a second. A small pre-impulse is
the racket's hit. A panel in a steel frame: no separate measurement of frame rattle found.

### Mesh (ibid.)

- Unlike anything else on court it builds, for about 50 ms, then falls slowly: about -6 dB at 0.25 s, -10 at 0.5, -20
  at 0.85, -26 at 1.35 s after its top (read off Fig. 4.3.1). "Gallerträff" holds the most energy over time.
- Power per Hz against its own top: -5 at 500 Hz, 0 at 800-1000, -7 at 1.4 kHz, -13 at 1.7, -5 at 2.5, -8 at 3.2, -11 at
  4, -15 at 5, -16 at 6, -13 at 7.5, -18 at 10, -28 at 16 kHz. Clearly more high end than any other impulse.
- In their informal listening test it was the most disturbing sound, as a neighbour they interviewed also said.
- Chain link: no measurement found. [Fence recordings exist](#6-real-recordings-to-ask-the-owner-about).

### The cage (Wadman et al. Fig. 4.2.5, outdoors)

T20: 0.53 s at 63 Hz, 0.80 at 125, 1.0 at 250, 1.25 at 500, 1.24 at 1 kHz, 0.61 at 2 kHz, 0.68 at 4 kHz, 0.47 at 8 kHz.
Fig. 4.3.1: a hit in the cage leaves a tail about 9.5 dB under its peak at 60 ms, 14 at 100 ms, 17.5 at 200 ms, 23.5 at
300 ms, 33 at 500 ms; the same hit on an open tennis court leaves none. Piana's sound map shows the reflections off the
short walls, floor and side structures. Higgins: "semi reverberant"; the side is about 12 dB over the glass end.

### Rates

Elite: a hit every 1.0 s (SD 0.4) in a rally (Wadman), one every 2.8 s overall (Clarke Saunders). Club: one every 2.0 s
(Clarke Saunders), every 4 s, 88 impacts in 5 minutes of all kinds (Higgins).

### Floor, feet, net, audible or not

- Ball on sand-filled turf: "dampened" and softer (Piana); no measurement. Resin "does not absorb vibrations
  effectively" and is louder (Piana). A hard court: about 1 kHz for a cycle or two, then a decaying 250 Hz, against a
  racket hit that stays at 1 kHz (line-calling patent: US 9551572 in the code's earlier note; a search excerpt this
  round gave the same words for [US 5908361](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/5908361), a
  scan that could not be read, so the number is unsettled).
- Shoes on sand: no measurement. The squeak needs a sole's wrinkle pulses repeating on a smooth, clean surface (Harvard);
  sand between sole and fibres is the opposite condition, and padel soles are herringbone or omni for sand. Reasoned, not
  measured: no squeak on sand-filled turf.
- What is audible on court: every survey names racket, glass, mesh and voices. Piana lists footfalls among people's
  sounds, no one measures them. Swing noise appears in none of them.
- From the broadcast camera, about 20 m from the near baseline: a hit at 92.5 dBA at 2 m is about 72.5 dBA by
  distance alone.

## 3. Before and after

Ours are renders on turf; LAFmax is dB re full scale, compared only as differences. Fit: rms dB from the real curve over
its frequencies after the best level. Mix figures: a 60 s AI match through the chain, on the left ear.

### One sound at a time (dry render, top strength, stadium bank, turf)

| Sound | Measure | Real | Before | After | Reading |
|---|---|---|---|---|---|
| Racket | spectral peak | about 700 Hz | 1037 Hz | 699 Hz | in reach |
| | fit to the curve, p .95 / .6 | 0 is identical | 6.0 / 5.6 dB rms | 3.2 / 3.2 dB rms | closer, not equal: 500 Hz 4 under, 2.5-3.2 kHz 5-7 under, 2 kHz 4 over |
| | the 400-700 Hz band | flat with the top | 13 dB hole | filled, a notch left at 500 Hz | closer |
| | centroid | not published | 919 Hz | 618 Hz | no real number |
| | attack | contact about 2 ms (pickleball) | 1.0 ms | 0.8 ms | no padel number |
| | direct sound | about 30 ms | 22 ms to -40 | 24 ms to -40 | in reach, different definitions |
| | 16 kHz band under the top | not read; 8 kHz is -43 per Hz | -31 dB, flat click | -50 dB | click gone |
| Glass | fit to the curve | 0 | 6.0 dB rms | 4.2 dB rms | closer: 2 kHz 9 under, 125 Hz 5 over |
| | where the energy sits | flat 125-250 Hz | peak 91 Hz, centroid 146 | peak 167 Hz, centroid 331 | moved up off what a laptop can't play |
| | the dip at 700 Hz | -13 dB | filled | -11 dB | in reach |
| | fall of 20 dB | about 0.2-0.4 s in a cage | 0.20 s dry | 0.07 s dry, 0.28 s club, 0.35 s stadium | in reach through the room |
| | LAFmax against racket, top bins | +2.9 dB | +0.2 | -0.2 | 3 dB under on the voices; at the camera +3.4 in the stadium mix, -2.3 in the club mix, that 5.7 dB difference not traced |
| Mesh | fit to the curve | 0 | 8.0 dB rms | 3.4 dB rms | closer |
| | build | about 50 ms, read off | 2 ms | 75-101 ms, 10-90% | slower than real |
| | fall of 20 dB | about 0.85 s | 0.09 s | 0.83 s | in reach |
| | LAFmax against racket | -7.4 dB | -1.9 | -6.4 | in reach |
| Ball on floor | A-centroid | no measurement; "dampened" (Piana) | 1133 Hz | 409 Hz | the click is gone, the target is reasoned |
| | spectral peak | hard court: 250 Hz after a cycle of 1 kHz | 187 Hz | 240 Hz | a hard-court number on turf |
| Step | A-centroid | no measurement | 4520 Hz | 2327 Hz | reasoned |
| Scuff | LAFmax against top bounce | no measurement | +2 dB | -14 dB | reasoned: no survey names it |
| Whoosh | LAFmax against top racket; A-centroid | no survey names it | -7 dB; 2749 Hz | -19 dB; 1036 Hz | reasoned |
| Net | spectral peak | no measurement | 57 Hz | 244 Hz | reasoned |

### Through the chain, at the camera (60 s, seed 4242, AI match on turf)

| Measure | Real | Stadium before | Stadium after | Club before | Club after |
|---|---|---|---|---|---|
| Whole LAeq / LAFmax, dBFS | gap 19.5 dB (Wadman), 7.1 (Abu Dhabi) | -27.4 / -12.8 | -35.9 / -22.4 | -38.6 / -26.3 | -38.8 / -26.5 |
| Peak dBFS | | -0.1 | -5.4 | -2.0 | -2.0 |
| Racket LAFmax | reference | -29.3 | -30.4 | -26.5 | -26.8 |
| Glass LAFmax | | -29.2 | -27.0 | -28.9 | -29.1 |
| Mesh LAFmax | | -33.3 | -37.0 | -31.3 | -35.7 |
| Bounce LAFmax | | -41.4 | -42.0 | -41.2 | -41.6 |
| Scuff LAFmax | | -36.7 | -52.2 | -36.8 | -50.9 |
| Whoosh LAFmax | | -41.7 | -53.0 | -42.7 | -53.6 |
| Step LAFmax | | -49.5 | -51.3 | -49.1 | -50.5 |
| Applause LAFmax | no ratio published | -12.8 | -22.5 | -40.5 | -50.5 |
| Bird LAFmax | | | | -30.9 | -43.9 |

Applause over the top racket hit in the stadium: 16.5 dB before, 8 dB after. That is my estimate of what it should be,
not a measurement. The whole stadium mix is about 8.5 dB quieter than it was because the crowd was what set its level:
the hits themselves moved by about 1 dB. `lift` was left alone, so the owner's overall volume at the stadium has dropped.

Hit's tail through the club-day room, in dB under the hit:

| After the hit | +60 ms | +100 ms | +200 ms | +300 ms | +500 ms |
|---|---|---|---|---|---|
| Real (Wadman Fig. 4.3.1) | -9.5 | -14 | -17.5 | -23.5 | -33 |
| Before | -29.7 | -39.6 | -57.8 | -74.6 | -173 |
| After | -16.0 | -17.0 | -23.6 | -26.4 | -38.2 |

The room was too small, not too big. It is still 3-7 dB under the reading.

Whole match against Piana Fig. 6, A-weighted third octaves in dB, each against its own top, club-day:

| Hz | 160 | 250 | 400 | 630 | 1k | 1.6k | 2k | 2.5k | 3.2k | 4k | 5k | 8k | 10k |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Piana | -13 | -7 | -6 | -3 | 0 | -1 | -4 | -4 | -4 | -9 | -13 | -15 | -22 |
| Before | -14 | -14 | -10 | -5 | 0 | -9 | -11 | -10 | -5 | -8 | -15 | -22 | -29 |
| After | -13 | -9 | -3 | 0 | -3 | -8 | -12 | -11 | -12 | -16 | -21 | -29 | -38 |

The low half is now within about 4 dB. Above 1.6 kHz the after is 7-14 dB under Piana, and in places further off than the
before. The before's closer high end came from birds, sand hiss and whooshes, the wrong sources, so I did not put it back
and stopped tuning there: Wadman's single hit and Piana's whole game disagree with each other by several dB up there, and
the mesh, the brightest thing on court, sounds once a minute in the sim. The stadium's match against Piana above 1.6 kHz
looks better (-1 to -7 dB) only because applause fills it.

## 4. The trigger audit

A 60 s stadium match (seed 4242), every play logged, through `Soundscape` into the offline engine.

| Plays per second | |
|---|---|
| Step | 7.78 (from stand-in soles, not real avatars) |
| Scuff | 0.60 |
| Bounce | 0.48 |
| Whoosh | 0.47 |
| Racket | 0.47, one every 2.1 s (real club: one every 2.0 s, Clarke Saunders) |
| Glass | 0.22 |
| Grunt | 0.07 |
| Applause | 0.05 |
| Mesh, net | 1 each in the minute |

At the club, racket and bounce read 0.98/s because neighbouring courts play behind; their own court's is the same.

- Right sound per event: `E_WALL` picks glass or mesh by the surface, a seam under 4 cm adds metal; `E_NET` picks net,
  cord or post; `E_FLOOR` plays above an impact speed of .3. Read in the code and confirmed from the log.
- Silent events: `E_BODY` and `E_ROOF` had no sound. Fixed (`body`, and a `metal` render for the roof). `E_CALL`, `E_EXIT`, `E_SPLIT` are still
  silent.
- Mesh on mesh: one mesh hit in the minute, so overlap couldn't be audited.
- Repeats: the same render within 4 s, 3 of 71 impacts (stadium), 24 of 141 (club, the neighbours). Not a cause.
- Strengths: racket power median .28, max .52 of the 0..1 scale, so a match rarely reaches the top bins everything above is
  fitted to. All 28 AI contacts in the minute were clean, none off-centre or framed. Glass median 6.8 m/s, max 15. Floor
  median 4.6 m/s.
- The limiter idles at the camera (0.0-0.1 dB): it isn't what's flattening anything. That was my first guess and it was wrong.
- Things that don't belong: a string ping: none, tested (no spectral line over 5% of the power). Squeak on turf: none, the
  chirp is `FL_HARD` only. Stadium roar at a club: none (crowds under 50 don't cheer or gasp). Too-big reverb: the opposite,
  see section 3. What was wrong was levels: birds as loud as the racket, scuffs louder than bounces, whooshes 12 dB under
  the hit at the camera, because `lift` (12 dB) landed on top of levels set before it existed and the mix tests left it out.
- The default arena is the stadium (`src/app/settings.ts`), so a first game hears a hall of 4,600, which no club player knows.
  Not changed: out of the allowed files, and the owner's call.

## 5. What changed

Biggest first, by the numbers above.

1. `dsp.contactPulse`: its cosine jumped at both ends, a click flat to 16 kHz under every impact. Now one sine cycle.
2. Racket: the 1 kHz ringing top became modes at 430-1450 Hz with an onset through the half-sine's own null, a low body, an
   `edge` set at 1.85-3.5 kHz under the null at 1.9 kHz, and a shorter, lower noise crack.
3. Glass: panel modes 70-2600 Hz under a measured weight (`glassWeight`), a felt slap, a frame thud at 92/151 Hz.
4. Mesh: a click train with a falling rate through `dsp.resonate`, mode groups 420 Hz-15 kHz, 1.7 s long, a build and a slow
   fall.
5. Rooms: club RT60 0.3 s became the measured cage's 0.9/1.25/0.6 s with its crossovers, wet -1 dB, and the crowd and
   beds no longer sent through it at the full level (`crowdSend`, `bedSend`).
6. Floor, feet, scuff, whoosh, net: clicks and high hiss out; levels set under what the surveys name.
7. Crowd and birds cut to the estimates in section 3.
8. New: `body` for a ball on a player, `E_ROOF` sounds, `E_BODY` sounds.

Tooling: `tools/audio-dump.ts`, `src/audio/measure.ts`, `src/audio/offline.ts`, `data/audio-reference.json`,
`tests/audio/reference.test.ts`, `tests/audio/chain.test.ts`. `chain.test.ts` runs a match through the whole chain, `lift` included.

## 6. Real recordings to ask the owner about

Downloads need his yes. Nothing here was downloaded or listened to. Every one is marked Creative Commons 0 on its
Freesound page. Freesound needs an account to download. Bytes are the page's file size.

| # | Name, author | URL | Length | Bytes | Format | Note from the page |
|---|---|---|---|---|---|---|
| 1 | "Padel", Refrain | https://freesound.org/people/Refrain/sounds/345759/ | 4:04.158 | 67.1 MB | 48k/24 stereo | practice in a closed, resonant space, talking and shouting |
| 2 | padel bo / padel training, MAPASONORALCOVER | https://freesound.org/people/MAPASONORALCOVER/sounds/790875/ | 0:50 | 8.4 MB | 44.1k/16 stereo | |
| 3 | Padel, Luisa_Sanchez | https://freesound.org/people/Luisa_Sanchez/sounds/813413/ | 0:04.899 | 1.2 MB | 44.1k/24 stereo | |
| 4 | padel 2 edit, Luisa_Sanchez | https://freesound.org/people/Luisa_Sanchez/sounds/816833/ | 0:04.899 | 675.9 KB | mono | |
| 5 | Tennis Ball Hits Metal Fence, jamesdrake89 | https://freesound.org/people/jamesdrake89/sounds/662260/ | 0:24.981 | 3.5 MB | 48k/24 mono | |
| 6 | Tennis Ball Hits Metal Fence Hard, jamesdrake89 | https://freesound.org/people/jamesdrake89/sounds/662261/ | 0:20.821 | 2.9 MB | 48k/24 mono | some traffic and wind under |
| 7 | Tennis Metal Fence Impacts, jamesdrake89 | https://freesound.org/people/jamesdrake89/sounds/662262/ | 0:19.506 | 2.7 MB | 48k/24 mono | |
| 8 | Tennis Whooshes Swishes, jamesdrake89 | https://freesound.org/people/jamesdrake89/sounds/662267/ | 0:17.743 | 2.5 MB | 48k/24 mono | |
| 9 | Tennis Forehand 2, jamesdrake89 | https://freesound.org/people/jamesdrake89/sounds/662263/ | 0:03.810 | 555.3 KB | 48k/24 mono | |
| 10 | Chain Link Fence - Impacts, MWsfx | https://freesound.org/people/MWsfx/sounds/575388/ | 0:34.923 | 5.9 MB | 44.1k/16 stereo | |
| 11 | Chain fence hit_sequence-01.R, Hupguy | https://freesound.org/people/Hupguy/sounds/138250/ | 1:01.098 | 8.0 MB | 44.1k/24 mono | |
| 12 | TennisBallBounce, drivr3joe | https://freesound.org/people/drivr3joe/sounds/533410/ | 0:07.483 | 1.9 MB | 44.1k/24 stereo | surface not stated |
| 13 | hit - glass - window 01, Anthousai | https://freesound.org/people/Anthousai/sounds/406261/ | 0:01.649 | 928.1 KB | 96k/24 stereo | a wooden spoon on a window, not a ball on a panel |

Listed under Freesound's CC0 filter, pages not opened: Starvolt Fence Rattle 189219, 189220, 189223, 189224; alec_mackay
463639; Razzberry6 790559. CC0 searches for "ball glass thud", "squash ball wall" and "artificial turf footsteps" returned
nothing. No tested CC0 recording of a ball on tempered glass or on sand-filled turf was found. Number 1 is the single most
useful one, for checking the whole picture; 5-7 and 10 would let the mesh be measured, which nobody has published.

## 7. Gaps

- Nobody has listened: not to the before, not to the after, not to section 8. Every line above is a number.
- The real curves are single events of unknown speed read by hand off a thesis's figures. Nothing under 125 Hz is used.
- Racket mode frequencies are fitted to a spectrum: no modal analysis of a padel racket exists. A real hit's centroid isn't
  published. The fit still misses by 4-7 dB at 500 Hz and 2-3.2 kHz.
- Whole match above 1.6 kHz is 7-14 dB under Piana (club), and those two sources disagree with each other up there.
- Glass LAFmax is 3 dB under its reading on the voices; glass 2 kHz is 9 dB under the curve, 125 Hz 5 over.
- Glass frame rattle, post tone (430/620 Hz) and level, and the net: unmeasured anywhere, all reasoned.
- Ball on sand-filled turf: no measurement anywhere, level and balance reasoned.
- Feet, scuff, whoosh levels reasoned. No squeak on sand reasoned from a study of smooth surfaces. Step rate from stand-in
  soles, not real avatars.
- Mesh time to top 75-101 ms against about 50 ms. Mesh sounds once a minute in the sim; the real rate is unknown and the sim
  is out of scope, so the mix's high end can't be judged. The speed of Wadman's mesh hit is unknown.
- All 28 AI racket contacts in the minute were clean and at power .52 or less, so off-centre, frame and top-strength voices
  are fitted but barely heard in the audit.
- The applause-to-hit ratio is my estimate. Stadium and hall RT60 and wets are estimates. The club tail is still 3-7 dB under
  the reading. The hall's still 1-8 dB under it.
- `src/audio/offline.ts` is a model of `engine.ts`. The limiter is modelled. Section 8 reads the real engine's output.
- LAFmax minus LAeq: ours 12-14 dB against 19.5 (Wadman) and 7.1 (Abu Dhabi). Ours is in between; those two don't agree.
- Voices are still formant synthesis, and there are no calls or shouts though `E_CALL` exists and Piana puts shouts at +1.9 dB
  on the whole game. A spoken "mine" built this way would sound like a machine; real recordings are the honest way to it. `E_EXIT`, `E_SPLIT` are silent too.
- Laptop speakers weren't measured. Close cameras weren't audited: every mix figure is from the broadcast camera.
- The stadium mix is 8.5 dB quieter overall, hits about the same, peak -5.4 dBFS. `lift` wasn't raised: the owner's call.
- The default arena stays the stadium.
- `DECISIONS.md`, `FEEL.md` and `OPEN_QUESTIONS.md` weren't updated (outside the files allowed), so their Phase 6 notes are
  stale against this page.
- `dsp.spectrum` still uses a Hann window from the first sample, which weighs an attack at nothing. The game doesn't use it;
  four band-share checks in `tests/audio/voices.test.ts` still do. The centroid helper moved to `measure.ts`.
- Patent number for the hard-court bounce is unsettled (section 2).

## 8. Grunts, and what really comes out (2 Nov)

The owner asked for grunts like two named tennis players. Their recordings aren't used, for the reasons in `DECISIONS.md`:
two voices are generated in the same broad manners, and no name is attached to either.

**Grunts were more than an octave too low.** [Raine, Pisanski & Reby 2017, Animal Behaviour 130](https://sussex.figshare.com/articles/journal_contribution/Tennis_grunts_communicate_acoustic_cues_to_sex_and_contest_outcome/23445572)
measured 367 grunts from 50 professional tennis matches and serve grunts from 60 players. Ours used the speaking voice raised
by effort.

| Measure | Real | Before | After |
|---|---|---|---|
| Men, serve grunts of 60 players | 297 Hz | 135-200 Hz | see below |
| Women, same | 574 Hz | 230-330 Hz | |
| Men's 14 frequent grunters: serve / forehand / backhand | 325 / 312 / 298 Hz | 135-200 Hz | voices 285-330 Hz, serve x1.042, backhand x0.954 |
| Women's frequent grunters: serve / forehand | 650 / 616 Hz | 230-330 Hz | voices 555-660 Hz |
| Against speaking pitch | three times | about 1.4 times | about three times |
| Overlap between the sexes | very little | men 135-200, women 230-330 | men 260-350, women 520-700 |

Speaking pitch, age, height and weight predicted none of it, so a grunt's pitch is its own number here. Still from that paper
and not modelled: about 15 Hz higher late in a match, about one semitone higher in a match being lost. Of top-30 players 90%
of men and 76% of women grunted at all, and half of men and 63% of women often enough to study.

Reasoned, not measured: both shapes and both lengths (long 0.3-0.55 s climbing to about 60% of its length, clipped 0.11-0.2 s
falling), the strain (every other glottal cycle stronger, so a subharmonic), how often they come (a usual drive about every
other time, a volley about one in five) and the level (a top grunt 1.5-3 dB under a top racket hit for men, as loud for women,
on a level meter). The mouth doesn't know: the face still opens only on smashes and serves.

**The engine has now been heard by a meter.** A Chrome launched by a tool reads its context as `running` while the clock stands
still after two quanta (a bare oscillator did the same, headless or not), so every earlier "audio on" run rendered nothing.
`--disable-audio-output` runs the clock on a timer; `tools/perf.mjs` now passes it. An AudioWorklet after the clip took 60 s of
what would go to the speakers.

That found one fault nothing had: a third of all footsteps came from standing players, a foot set down as the stance settled,
11.3 steps a second against the offline model's 7.5. Under 0.15 m/s they are now silent.

Racket and glass moved against Wadman's curves too: rms miss 3.2 to 2.1 dB and 4.4 to 2.9 dB. The worst bands: racket 2.5 kHz
-8 to -3, glass 2 kHz -9 to -7, 125 Hz +5 to +3.

Read from that output, 60 s of AI play, same seed:

| Measure | Stadium before | Stadium after | Club before | Club after |
|---|---|---|---|---|
| Peak (dBFS) | -1.7 | -2.1 | -1.5 | -0.5 |
| Moments over the limiter's -2 dBFS | | 0 | 3 | 7 |
| LAeq | -38.4 | -38.2 | -39.5 | -37.5 |
| Between hits, LAeq | -51.5 | -51.5 | -52.8 | -51.1 |
| Racket alone, median LAFmax | -34.3 | -35.3 | -33.4 | -32.4 |
| Footsteps a second | 11.3 | 7.5 | 11.5 | 7.5 |
| Grunts in the minute | 4 | 10 | 3 | 12 |

The grunts' own pitch in that output: mostly 330-375 Hz for men, with a few reading at 200-240 where the racket's tail or a
sub-octave beat the voice. The stadium's "before" column is the build before this section's racket and glass changes, with the
new grunts' pitch not yet in; the rest are 1d275f7 against e318742. The limiter works a little more at the club, on hits at the
near baseline closest to the camera: under 1.5 dB, for milliseconds, and nothing reaches full scale.

