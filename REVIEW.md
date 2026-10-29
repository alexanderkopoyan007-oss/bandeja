# BANDEJA expert review (Phase 9)

Two reviewers, one list: a professional padel player (does it play like padel?) and a games critic who has played
Top Spin 2K25 (does it look, sound and feel like a top-tier sports game?). Ranked by impact on someone playing it.

- **Critical**: breaks the game or the sport's identity. **High**: an expert notices it within a minute or a match
  and it is clearly short of real padel or a top-tier sports game. **Medium**: noticeable, but the game is right in
  kind. **Low**: polish.
- Evidence: AI doubles at level 1 measured the way match-analysis studies measure pros (`node tools/match-stats.ts
  --points 2000 --level 1`, `docs/review/match-stats-l1.txt`), a probe of where each kind of shot bounces and how the
  next one is taken (16 matches), captures of every arena from the broadcast camera and close-ups (`?cam=body|face`),
  a human match played by the keyboard bot (`tools/bot-play.mjs`), and the QA army's findings from Phase 7.
- Pro figures: WPT 2020 quarter-finals to finals, 20 matches, 35,145 hits (Courel-Ibáñez/Sánchez-Alcaraz et al.,
  *Sports* 2024, PMC11359520): men 10-11 shots a point, 13.5-14.8 s, 0.80 shots/s; each stroke as the share of
  points it appears in (bandeja 44-48%, flat smash 30-33%, back-wall forehand 42-45%, backhand 34-36%, contrapared
  11-13%, bajada 14-17%). WPT 2014 men's shot mix (8,581 actions) and the per-stroke and ending figures already in
  `tools/match-stats.ts`.

Features the roadmap leaves to later milestones (replays and broadcast cameras M7, career and tournaments M6,
character creator M5, commentary, online play) are listed at the end and not ranked: this brief is the realism of
what is there.

## Round 1

| # | Rank | Reviewer | Finding | Evidence | Status |
|---|---|---|---|---|---|
| 1 | High | Critic | **The stadium crowd is made of blocks.** 4,640 people, each a six-sided cylinder, a box for thighs, a 20-face ball for a head and a cap: no arms, no legs, no faces. Next to the MakeHuman players it is the most dated thing on screen, and from the TV camera it fills the top third of the frame. | `rv-tv-b` (broadcast), `rv-face-*` (behind every close-up) | |
| 2 | High | Pro | **No bajada.** A lob that comes off the back glass high is smashed back down by pros (in 14-17% of men's points). The AI never plays an overhead off the glass (it plans overheads only from inside 6.5 m, before the bounce), so every high ball off the glass is let drop and played as a groundstroke. A human holding O gets an overhead plan off the glass, untested and with no hint. | `simpleAi.ts plan()` (`abs(p.pos.z) < 6.5 && lobComing`), `chooseShot` (`depth < 7`) | |
| 3 | High | Pro | **Too much is played off the back glass.** 27.4% of all shots are back-wall shots against 12.8% for WPT men in 2014; all wall shots 32.4% against 19.0% (2014) and 24.5% (an earlier pro-tour zone study). Groundstrokes before the glass 17.8% against 23.1%. A pro sees back players let nearly every deep ball through to the glass. The planner adds 0.6 to any contact before the glass within 1.7 m of the back and takes 0.1 off any after it: written for the owner's "can't hit it off the wall", it applies to the AI too. | match-stats L1; removing the bias for everyone: back-wall 22.4%, groundstrokes 22.0%, all walls 27.2% | |
| 4 | High | Pro | **Smashes where pros play the bandeja.** The smash is 49% of the AI's overheads (5.4% of shots against a bandeja's 3.8% and víbora's 1.8%); pros smash 26-36% of overheads and play the bandeja in 44-48% of points against the flat smash's 30-33%, to keep the net. The smash's winner rate is half the pros' (23% against 45%) because it is tried from too far. Left open by the physics audit (OPEN_QUESTIONS, "The x3 smash and overhead choice"). | match-stats L1 per-stroke table; `chooseOverhead` (95% smash inside the kill depth at level 1) | |
| 5 | Medium | Pro | **Rallies a little slow.** 15.4 s a point at 0.73 shots/s against 13.5-14.8 s at 0.80 for WPT men (shots a point 11.2, in their 10-11). Half the points last over 11 s. Mostly items 2-4: balls let through to the glass travel twice as far. | match-stats L1 | re-measure after 2-4 |
| 6 | Medium | Pro | **Errors go into the net, rarely off the side.** 70% of errors in the net against 51%; 4.6% off the side glass or out of the side against 17%. The swing's yaw error is small next to its pitch error, and the AI's targets keep 1.2 m off the side glass. | match-stats L1 errors line | |
| 7 | Medium | Critic | **A grey band at the waist.** When a player bends forward the shirt rides up and shows the shorts' waistband, which the suit's ambient-occlusion map darkens to grey (it was under the shirt in MakeHuman's model). Visible from the TV camera on a player leaning into a low ball. | `rv-body-b` | |
| 8 | Medium | Pro | **Too few serve faults.** First-serve faults 6.2% against about 10%, double faults 0.8% of second serves against about 2%. | match-stats L1 | |
| 9 | Medium | Pro | **No play outside the court.** A ball that leaves over the side glass or by a door after a good bounce can be chased and played back from outside on courts that allow it (FIP 14.2); pros do it a few times a match after a smash por tres or por cuatro. The game calls the point at the second bounce. | CLAUDE.md (stretch goal) | not in this brief |
| 10 | Medium | Critic | **Faces are MakeHuman's.** Plausible at TV distance, plain in close-up: no expressions, no blinking, one look each for the four. | `rv-face-*` | limited by the CC0 source (OPEN_QUESTIONS) |
| 11 | Medium | Critic | **Low-poly trees** round the club arenas (clumps of spheres). | `rv-pano-clubday`, `rv-clubnight-tv` | |
| 12 | Low | Critic | **Bare stadium surround**: plain red floor and grey hall walls behind the stands; one TV camera and an umpire's chair as dressing. | `rv-tv-b` | |
| 13 | Low | Pro | **Lobs** 16.9% of shots against about 20% for elite men (2013); in kind right (lobs in most points). | match-stats L1 | |

### Not ranked: later milestones
A critic would mark these down in a commercial release; the roadmap has them after this brief. Instant replays of
the last point from other angles (M7: the sim is deterministic, so a point is its seed and inputs), commentary (M7
audio), a character creator and rackets to choose (M5), career, tournaments and an academy (M6), online play (stretch).
