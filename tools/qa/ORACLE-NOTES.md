# Rule oracles: readings of the FIP text

`refereeOracle.ts` and `scoreOracle.ts` were written from `scratch/qa/fip-rules.txt` (FIP Rules of Padel,
application 01.01.2026) alone, without reading the game's rules code. These are the places where the text is
ambiguous, silent or contradicts itself, the reading the oracles use, and why. Tests: `tests/qa/oracle.test.ts`.

## Referee

### The serve (rules 6, 7)

1. **Which box is "right" (6.5).** 6.5 says the first serve goes into "the receiver's box located at his left
   side". Read literally from the receiver's point of view, that contradicts "served from the right ... diagonally"
   in the same clause and the right-side start of 1.tie-break.3. Reading: "his" is the server, who sees the
   diagonal box on their left. `ServeSide 'right'` (facts.ts) is the box diagonally opposite a server standing on
   the right of their half; every game starts there.
2. **Lines (7.1.c, court section).** Lines are 5 cm wide and the oracle takes each one as centred on its nominal
   position: the service line's centre 6.95 m from the net, the central line centred on x = 0. A bounce is in the
   box if the contact point is within half a line width past the box edge. The bounce point is the fact's (x, z);
   the ball's radius is not added (a ball touches the floor at the point under its centre).
3. **The preliminary bounce (6.2).** The server must bounce the ball before serving: a `toss` fact or a floor
   bounce before the strike counts. The last such bounce must be in the server's own area (behind the service line,
   between the central line's prolongation and the side wall). The ball at contact must not have crossed the
   service line or the central line: "crossed" means wholly past the line, so a ball on the line has not crossed.
   No bounce at all, a bounce outside the area, or contact past a line is a fault (7.1.a).
4. **Waist (6.4).** "At or below the waist": `y <= waist` is legal. The "one foot on the ground" half of 6.4 can
   only come in through `feetOk`.
5. **Rule label for rule-6 faults.** Every infringement of 6.1-6.4 is called `7.1.a` (the fault clause that cites
   rule 6); the sub-rule is in the code comments only.
6. **A serve that lands somewhere other than the floor (6.5 / 7.1.c).** A serve whose first contact after the
   strike (other than the net) is not a floor bounce in the box: glass, mesh, out of the court, an object, stuck,
   or a bounce on the server's own side, is called `7.1.c`. 7.1.c only names "bounces outside the box"; a wall
   first could equally be read as 6.5 via 7.1.a. Both are faults; only the label is a choice.
7. **7.1.d (ball hits the server or partner) is read as before the serve's bounce.** It covers their bodies and
   their rackets (a second strike by the serving pair while the serve is in the air). After a good bounce in the
   box the serve is treated as being in play: if it then comes back and touches the serving pair, 13.1.j (body)
   or 13.1.i/o (racket) apply and the point is lost, not a fault. 7.1.d itself has no time limit; 7.1.e/f show the
   text does allow faults after the bounce, so this is a judgement.
8. **7.1.e (fence).** Any mesh contact after the box bounce and before the receiver's return or the second bounce,
   also after the glass, and also the ball stuck in a mesh hole. The outside face of the court (`outerWall`) is not
   counted, and with out-of-court play a serve that is already outside can no longer be a 7.1.e fault.
9. **7.1.f "directly".** Read as: no contact between the bounce in the box and leaving through the door. A serve
   that bounces, touches the glass and then goes out through the door on a court without out-of-court play is
   instead a point to the server under 13.1.d (out after a good bounce). 7.1.f does not apply to courts with
   out-of-court play: there the serve stays in play outside (13.1.e).
10. **Who receives (8.1, 3.1).** The rules say the receiver receives, but no clause gives a penalty if their partner
    returns the serve. Reading: the receiving pair loses the point (rule label `8.1`), as in tennis doubles and in
    the spirit of 13.1.o ("the ball may only be played by one member of the team").
11. **8.5 includes the racket.** "Hits one of the receiving players or their rackets ... before it bounces": a
    volley of the serve by either receiving player is a point to the server, whether or not the serve was going in.

### Net serves and lets (rule 9)

12. **When a "net" serve is decided (9.1.a).** It is a let only if the ball lands in the box and does not touch the
    fence before the second bounce, so the oracle waits for the first thing that settles it: the second bounce, any
    player's touch (a racket counts as an "article carried", 9.1.b), going out over a wall or through a door on a
    court with out-of-court play, an object, or coming to rest on a wall top: all let. The mesh first: fault
    (7.1.e). A net serve that lands outside the box: fault (7.1.c).
13. **Net serve straight out through the door, no out-of-court play.** 9.1.a's only exception is the fence; 7.1.f
    has no exception for net serves. Reading: fault (7.1.f), by the same logic as the fence: a fault reason after
    the bounce is not cancelled by the net.
14. **9.1.b "net or posts (if these are within the game area)".** The posts are always treated as within it.
15. **Serve numbers (9.2.b/c, 13.1.q).** A let keeps the serve number (two serves after a first-serve let, one after
    a second-serve let). A double fault is called as a point to the receivers with rule `13.1.q`; faults and lets
    carry `winner: -1`.

### Ball in play, points lost (rules 12, 13)

16. **Touching the net during the serve (12.2 with 13.1.a).** "The ball will be in play from the moment in which a
    valid service takes place." A serve's validity is only known later (7.1.e/f can still make it a fault after the
    bounce). Reading: a net or opponents'-court touch made between the serve's strike and its return is held. If
    the serve becomes a fault or a let, it never counts. If the serve proves valid (it is returned, or any other
    rule decides the point), the touch came first and decides it: the toucher's pair loses (13.1.a). Touches before
    the serve's strike are ignored.
17. **13.1.f "before it has gone over the net".** Judged by where the ball is at contact (the strike's z), and only
    before the shot's good bounce: after it, 14.1.g lets the opponents play a ball that has come back over to the
    hitter's side (as long as they don't touch the net or that court, 13.1.a).
18. **Double hits (12.1, 13.1.i, 13.1.o).** Any second strike by the pair that hit last, with no touch by the other
    pair in between, before or after the bounce: the same player is `13.1.i`, the partner `13.1.o`. The 13.1.o note
    (one partner hits the other's racket) and 14.1.h (one continuous movement) produce a single strike fact and
    need no rule here.
19. **Body hits (13.1.j, 13.1.k, 14.1.a).** The hitting pair's body after their hit: they lose (j). The other pair's
    body, before or after the bounce: they lose (k; 14.1.a calls it a correct return).
20. **Whose court a contact is in (13.1.g/h/l).** Decided from the contact's z, not the wall's name (the names are
    used only to tell end walls from side walls). `object` and `stuck` facts carry no position, so they use the half
    the ball was last over (strike position and `cross` facts).
21. **Own walls and fence before the bounce.** Own glass is allowed (14.1.b). 13.1.l "touches the metallic fence,
    any part of the ground on their own side" is read with "on their own side" applying to the fence too (the
    opponents' fence is 13.1.g): own mesh before the bounce loses.
22. **Leaving the court before the bounce.** No clause says it in so many words. Reading: a ball that leaves the
    enclosure without bouncing in the opponents' court is lost by the hitter, as hitting "any element not related to
    the court": 13.1.g over the opponents' half, 13.1.h if it touched the net first, 13.1.l over the hitter's own.
23. **13.1.g against 14.1.f.** 13.1.g loses for hitting, before the bounce, "any element not related to or located on
    the ground of the opponents court"; 14.1.f calls "an object located on the ground of the opponents' court" (e.g.
    another ball) a correct return. Reading: `object` facts are things not on the court's ground (stands, lights,
    ceiling, another court; facts.ts). Before the good bounce they lose for the hitter (13.1.g/h/l by half); after
    it they are a correct return for the hitter (14.1.d). Objects on the ground (14.1.f, 10.1.d) have no fact.
24. **Corner nick (14.1.i).** A wall contact on the opponents' side before the bounce with the ball's centre at most
    6 cm above the floor (the ball's radius is 3.2-3.4 cm) is the "angle where the wall joins the ground" and counts
    as the bounce; a floor fact within 25 cm right after it is the same touch. Glass only: the mesh is the fence, not
    a wall, so a low touch of the opponents' mesh is still 13.1.g. The same is used for the serve's box against the
    side wall (glass: in; mesh: 7.1.e). The facts have no timestamps, hence the distance tolerance.

### Out of the court (13.1.d, 13.1.e, 14.1.j, rule 16)

25. **13.1.d (no out-of-court play).** A ball that leaves the court after a good bounce, over any wall or through a
    door, ends the point at once, lost by the pair that had to return it (14.1.d: a correct return). For a serve,
    7.1.f comes first (see 9).
26. **13.1.e, over the end wall.** "Players will lose a point if ... Authorized out-of-court play. When the ball, after
    bouncing correctly, goes out of court over the end wall." The text does not name the team. Reading: the pair
    that had to return it loses, at once. The ball bounced correctly, so the hitter's shot was good; the clause sits
    with 13.1.c/d, which are all points lost by the side that failed to return; 14.1.d calls bounce-then-out a
    correct return; and the alternative (the hitter loses for a correct shot) would contradict 14.1.d.
27. **13.1.e, over a side wall or through a door.** The ball stays in play (rule 16). The pair that had to return it
    loses "when the ball bounces for a second time" (the first bounce outside, its second overall) "or touches any
    element not related to the court" (an `object` fact). The outside faces of the court's own walls and mesh
    (`outerWall`) are related to the court, so touching them does not end the point.
28. **14.1.j, the return from outside.** "Valid if the points previous to this Rule are fulfilled": it must come back
    into the enclosure and then satisfy 14.1.a-i (bounce in the opponents' court, or be volleyed by them, or hit
    them), with 13.1.g/h/l as for any shot. Bouncing outside or touching an object before it comes back in loses for
    the striker (label `14.1.j`). The text does not say where it must come back in: the oracle accepts any way in
    (over either half's side wall or through any door), not only over the net inside the court.
29. **13.1.p and rule 16.** `outside` means outside the enclosure. With out-of-court play authorised, a strike from
    outside is legal whether or not the ball is outside at that moment.

### Points won (rule 15)

30. **15.1 only after the bounce.** Stuck in a mesh hole or on a wall top after bouncing in the opponents' court: the
    hitter wins. Stuck before that bounce: the ball hit the opponents' fence or wall (13.1.g) or its own (13.1.l), so
    the hitter loses. For a serve after its bounce: stuck in the mesh is 7.1.e (fence), on a wall top is 15.1.b to
    the server (a let if it touched the net).

### What the facts can't express

- 6.10-6.11 and 9.2.a (receiver not ready), 10 (lets: ball splits, something invades the court, 10.1.d), 11
  (interference), 13.1.b (the door post above 0.92 m is neutral: `playerTouch` has no door post), 13.1.m (racket
  thrown), 13.1.n (jumping the net shows only as a touch of the opponents' court), 13.1.r (safety cord, dropped
  racket), 14.1.f (object on the court's ground), 5.3 / 6.7 / 6.9 / 8.4 (corrections of mistakes), and the mixed
  matches' deciding-point receiver (1, Star Point 2 / Golden Point 3).
- facts.ts gaps worth knowing: `enter` has no position, so the half a ball re-enters is only known from the next
  `cross`/`floor`/`wall`; `outerWall` doesn't say glass or mesh (matters only for a strict reading of 7.1.e outside);
  `object` and `stuck` have no position; the strike's `half` field is not used (halves come from the `serve` fact).
- `resync(serveNo)` is a QA-harness hook (tools/qa/judge.ts), not a rule.

## Score

31. **Points are raw counts.** Advantage is 4-3, back to deuce 4-4, and so on (`ScoreState.points` "as counts").
32. **Star Point.** Deuce 1 at 3-3, advantage 1 at 4-3 (either pair), deuce 2 at 4-4, advantage 2 at 5-4 (either
    pair, including the one that lost advantage 1), deuce 3 at 5-5 and the Star Point decides it 6-5.
33. **Golden Point 2 says "the pair that wins the point wins the match".** Read as "the game" (an evident slip).
34. **Deciding point receiver.** The receiving pair chooses the side; they "cannot change positions", so the receiver
    is whoever stands there: right is the pair's first receiver for the set (8.2), left the partner. The server
    serves to that box. Default without a choice: right. The choice may be changed until the point is played.
35. **Which pair serves first in the next set.** 4.1 only sets the match's first server, and 6.8 lets each pair
    choose its own first server per set; which pair starts a new set is silent, except after a tie-break
    (1.tie-break.5). Reading: the order of service runs on across the set boundary (pairs alternate games, the
    tie-break counting as one game). That gives 1.tie-break.5 exactly, and the usual "6-4: same pair again, 6-3:
    the other pair".
36. **1.tie-break.5 "the player of the pair who did not begin serving".** Read as the pair; which of its players
    serves first is still the pair's choice under 6.8 (a `setStart` choice).
37. **Tie-break serving boxes (1.tie-break.3).** It says the next two points are served "from the left". With 6.5's
    alternation every point, the oracle reads it as the first of each pair of points from the left and the second
    from the right (right, left, right, left... from the tie-break's first point). Servers follow the set's order:
    A first, B first, A other, B other in doubles.
38. **Tie-break receivers.** 8.3: the receiving order "may not be altered during that set or tie-break", so each
    pair keeps its boxes: right is the first receiver, left the partner.
39. **Changes of ends (5.1, 5.2).** 5.1 counts games within each set, with the tie-break as a game (the 13th, or the
    9th in a mini set: odd, so ends change after a tie-break set). Nothing extra happens between sets: 5.1 alone
    already changes at the end of a set with an odd number of games and after the first game of the next set
    otherwise (2.5 confirms the change after each set's first game). 5.2: every 6 points in a tie-break, but not
    when the tie-break has just ended on that point (the end-of-set change applies instead, once). A match
    tie-break (to 7 or 10) also changes every 6 points; the rules do not distinguish it.
40. **Mini sets.** Four games with a margin of two: 4-3 plays on, 5-3 wins, 4-4 is a tie-break (to 7, like rule 1's)
    and the set is won 5-4.
41. **The final set.** "One set all" is generalised to both pairs being one set short (`setsToWin - 1` each), and
    only when `setsToWin >= 2`. `finalSet: 'advantage'` drops the tie-break in that set only (1.score.4).
    `tiebreak7` / `supertb10` replace it: `games` stay 0-0 during it and the history records it as a set won 1-0.
42. **The match tie-break is a new set for the order of play.** It "replaces the last set", so the order of service
    runs on into it as into any set, and each pair chooses again (6.8; 8.3 "may at the beginning of a new set"):
    `needs()` asks for `setStart` in doubles.
43. **Choices.** `setStart` is due in doubles before each set's first point until a set choice is given; the two
    fields may come in separate calls until that first point, and are ignored after it (6.8, 8.3). Defaults are slot
    0 for both. Singles never asks for `setStart`.
44. **After the match.** `over` and `winner` are set, `points` and `games` read 0-0, `history` holds every set, and
    `pointWon` is ignored.
