# Serve and stroke motion: what pros do, as far as anyone has measured it

Research for the Phase 3 animation brief (2026-10-27): the owner wants "the serve also needs to be a better
motion, more like the pros". This file is about **how the body and racket move**. Outcomes, ball speeds, tactics
and split-step timing are in `shots-movement-feel.md`; numbers already there are only repeated when a key pose
needs them. No player names or likenesses appear here or should appear in the game.

**Evidence labels.** **[P]** padel, peer-reviewed measurement. **[Pn]** padel, peer-reviewed technical
description with no measurement. **[T]** measured in another racket sport (tennis, soft tennis), used as an
analogue. **[R]** rulebook. **[C]** coaching, governing-body or retailer description (weak). **[D]** derived
here from physics or body geometry; nobody measured it.

**Conventions used in every table below.**
- Right-handed player; mirror S for left-handers.
- Player frame at each key: origin = the floor point under the mid-hip at that key. **F** = horizontal aim
  direction (for the serve, the diagonal to the target, 10–27° off the court's long axis, see §1.2), **S** =
  horizontal, 90° to F, towards the racket hand, **U** = height above the floor. In `strokes.ts` model terms:
  F = model forward, S = whichever model-x sign the racket hand has. Racket positions are of the **face centre**.
- Lengths for a 1.80 m player; scale every length by stature / 1.80.
- **Turn** of the hip line or shoulder line, in the horizontal plane: 0° = square (chest to the target),
  90° = side-on with the free-hand shoulder towards the target (for a forehand the chest faces +S), above 90° =
  coiled past side-on. Tennis papers that put side-on at 180° convert as ours = theirs − 90°.
- **Face angle** = elevation of the face normal above horizontal (+ open, − closed). **Path angle** = elevation
  of the face-centre velocity at contact (+ rising).
- **t** = ms relative to racket–ball contact (negative = before).

---

## 1. The serve (priority)

### 1.1 Rules that shape the motion [R]

FIP *Rules of Padel*, review of application 01.01.2026, Rule 6 ([PDF](https://www.padelfip.com/wp-content/uploads/2025/12/FIP_Rules-of-Padel.pdf)), read in full this session:
1. At the start the server stands with **one foot behind the service line**, between the centre-line
   extension and the side wall, "and must remain there until the ball has been served".
2. The ball is **bounced on the ground inside the server's own box**; it may not cross the service line before
   it is struck.
3. The feet may not touch the service line or the imaginary centre line.
4. At contact the ball is **at or below waist level** and **at least one foot is on the ground**.

The 2026 text needs only one foot behind the line (the old rule needed both feet behind it; Padel Addict's
[2026 rules summary](https://www.padeladdict.com/nuevas-normas-padel-2026-reglamento-fip/), [C]).
**Animation constraints:** never airborne at contact; the planted foot stays behind the line until after
contact; the step-through lands after contact; the contact point is no higher than the waist. The rulebook gives
no number for "waist". [D] Textbook body proportions (Drillis–Contini, as reproduced in Winter's *Biomechanics
and Motor Control of Human Movement*) put elbow height at 0.630 H and the greater trochanter at 0.530 H, so the
waist (navel) is about 0.58–0.63 H, or 1.05–1.13 m at 1.80 m. Better: read it off the rig (the Spine bone's
height in the stance) and keep contact a few cm under it.

### 1.2 What has actually been measured on the padel serve

| Quantity | Value | Source | Method / sample | Turns into |
|---|---|---|---|---|
| Contact ahead of the body's centre of gravity, along the court | **0.52 ± 0.28 m** highly trained; 0.69 ± 0.25 m novice [P] | Sánchez-Alcaraz, Martínez-Gallego, Llana et al. 2021, IJERPH 18(2):435 ([PMC7828082](https://pmc.ncbi.nlm.nih.gov/articles/PMC7828082/)) | 2 overhead IP cameras at 25 fps, SAGIT tracking, 48 recreational men (24 first-regional, 24 third-regional), 14,478 shots. Header says m, text says cm; values only make sense as m. Height and sideways distance not measured | Contact F ≈ +0.50 m from the pelvis point |
| Ball speed by category | U14 55.9 ± 6.7, U16 58.6 ± 7.0, U18 62.2 ± 5.3, open amateur **70.0 ± 6.6**; printed as m/s but only possible as **km/h** [P] | Sánchez-Pay, Escudero-Tena, Martínez Nieto, Muñoz & Sánchez-Alcaraz 2023, Padel Sci J 1(2):157–172 ([doi](https://doi.org/10.17398/2952-2218.1.157)) | Ball Coach PR1000-BC pocket radar from behind the server, 45 amateur men × 24 serves. The same group's 2025 smash study uses the same radar family and reports km/h, range 40–210 ([PMC12031073](https://pmc.ncbi.nlm.nih.gov/articles/PMC12031073/)) | 60–70 km/h for good club players; pro speed unpublished |
| Server's run after the serve, high-level national (beginners) | time serve → return contact **1.22 ± 0.20 s** (1.42); distance covered **2.71 ± 0.58 m** (1.82); peak speed **2.93 ± 0.43 m/s** (1.85); server **5.08 ± 0.58 m** from the net at the return (6.47). Australian formation: peak 3.21 m/s, 2.97 m; conventional: 2.69 m/s, 2.48 m [P] | Ramón-Llin, Guzmán, Martínez-Gallego, Vučković, Muñoz & Sánchez-Alcaraz 2021, PLoS ONE 16(10):e0250225 ([PMC8550361](https://pmc.ncbi.nlm.nih.gov/articles/PMC8550361/), Tables 2–3) | 2 cameras at 25 fps, SAGIT, 2,148 points, 18 matches, 72 men | Follow-through + run-in timing; split-step at about +1.2 s |
| Where the server stands | [D] from the row above: CoG at contact ≈ 5.08 m + about 2.5 m of forward travel ≈ 7.5–7.6 m from the net, i.e. **0.55–0.65 m behind the service line** (6.95 m); with contact 0.5 m ahead, the ball is struck 0.05–0.15 m behind the line | derived | — | Pelvis start position |
| Grip | Continental is the recommended and usual grip; some professionals use a slight eastern backhand, or an "Australian" (slight eastern forehand) [Pn] | Sánchez-Alcaraz, Conde, Genevois & Muñoz 2022, Trances 14(2):92–110 ([PDF](https://diegomun.es/wp-content/uploads/2022/03/Analisis-tecnico-tactico-del-saque-en-padel-profesional-Revision-Narrativa.pdf)) | narrative review (Murcia, Rafa Nadal Academy, Lyon 1, Extremadura) | Continental hand pose; face opens by rolling the forearm, not by changing grip |
| Serve direction | Over 60% of pro serves go to the side glass; about 70% from the left court [Pn, citing Sánchez-Alcaraz et al. 2020] | Trances 2022 (above); full numbers in `shots-movement-feel.md` §6 | WPT match analysis | Aim yaw: glass 10–27° cross, T about 10° |
| Contact height, bounce height, where in the bounce, racket path and face, joint angles, phase durations, pro speed | **not measured anywhere I could find** | — | — | §1.4–1.6 fill these from physics and analogues |

### 1.3 The technique, stage by stage [Pn]

The only padel source that describes the serve's mechanics is the Trances review above (full text read this
session; earlier research could not reach it). It splits the stroke into 3 phases and 7 stages. Paraphrased:

| Stage | From → to | What happens | Key pose to author |
|---|---|---|---|
| 1 Start | first movement | Feet about shoulder-width apart; weight on the rear leg or shared; ball in the free hand resting on or near the racket face; eyes on the receiver. Four stances: **side-on** (front foot = free-hand side, turned in about 45° to the service line; rear foot parallel to the line; shoulder line pointing at the net), **semi-open** (feet line 30–45° to the service line), **open** (feet line about parallel to the service line, trunk turned), **closed**. Stance is "style more than fundamental"; the side served to can change it | Address |
| 2 Release | → ball leaves the hand | Three options: **push the ball down into the turf** (the one most professionals use, and the recommended one: it gives a higher contact), **drop it** (lower contact), **toss it up** (similar to pushing). Released to the racket side, bounces **near the front foot**, behind the line. The backswing starts with the release or just before it | Release |
| 3 Backswing | release → legs loaded | Elbow bends, trunk and hips turn, racket goes **back and up** by shoulder abduction and external rotation. End height varies by player: **above the head for some, lower for others**. At the end the racket head is above the grip. The free arm balances and helps the turn. Ends at the racket's highest point = most elbow flexion and trunk turn | Top of backswing |
| 4 Forward swing | top → contact | Trunk and hips rotate forward while the racket accelerates **downwards**; the free arm braces ("se bloquea"); eyes on the ball | Mid-swing |
| 5 Contact | contact | Face **slightly open** (bottom edge ahead of the top edge), ball **at most waist height**, face slides under the ball for **backspin** | Contact |
| 6 Deceleration | contact → racket stops | Racket slows while the player already moves forward | Finish |
| 7 Finish and run | → first running step | Trunk slightly flexed forward; run to the net | Step-through |

Five footwork patterns at contact (same source):
- **Pivot** (default): weight on the rear leg at the release, front foot pointing at the net; when the ball
  bounces the hitting-side leg pushes back against the floor; at contact the rear leg is still behind the CoG
  (some players have it ahead); after the swing the rear leg comes through, pivoting on the front foot.
- **Front-leg hop**: weight on the front leg at contact, rear leg in the air; hop forward and land on the same
  foot nearer the net; the rear leg kicks back and out, sole towards the side wall.
- **Running**: toss to the side and bring the rear leg forward; at contact the free-side leg is in the air
  and the hitting-side leg on the floor; the front foot lands after contact.
- **Transfer from an open stance**: weight on the hitting-side leg, push, rise slightly; at contact that leg
  is down and the free leg swinging forward; land on the free leg pointing at the target.
- **Carioca**: the rear leg crosses behind the front leg at contact; the free-side leg keeps going.

### 1.4 The bounce: where contact height comes from [D]

The FIP ball must rebound 135–145 cm from 2.54 m on a hard surface, so e = 0.73–0.76. Sand-filled turf may
be a little lower; use the game's own turf model. No spin or drag below (they barely matter over a 1 m drop).

| Release height | Push down | t to bounce | Apex height (e 0.74 / 0.68) | Release → apex |
|---|---|---|---|---|
| 1.0 m | none (drop) | 452 ms | **0.55 / 0.46 m** | 786 ms |
| 1.0 m | 2 m/s | 292 ms | 0.66 / 0.56 m | 658 ms |
| 1.0 m | 3 m/s | 240 ms | **0.80 / 0.67 m** | 643 ms |
| 1.0 m | 4 m/s | 201 ms | **0.99 / 0.84 m** | 651 ms |
| 0.9 m | 3 m/s | 221 ms | 0.74 / 0.63 m | 610 ms |

What this means for the motion:
- A plain drop from waist height peaks around knee height (0.45–0.55 m). That is the low, crouched beginner
  serve, and it is why pros push the ball into the turf: a push of 3–4 m/s puts the apex at 0.8–1.0 m, just
  under the waist (matches §1.3 stage 2).
- With any real push, **release → apex is about 0.60–0.66 s**, so the serve's rhythm is fixed by physics: the
  release key sits about 620 ms before contact and the bounce about 400 ms before it.
- Within ±80 ms of the apex the ball's height changes by 3 cm or less (±100 ms: 5 cm), so contact "at the top
  of the bounce" is forgiving: the game can put contact 0–60 ms before the apex and keep the same height.
- The ball rises almost vertically if pushed straight down, so the bounce spot ≈ the contact spot in plan view.

### 1.5 Face and path by serve type [T → D]

Nothing measures a padel serve's face or path. The closest measurement is a backhand slice/drive study in soft
tennis (Matsue & Maeda, 九州体育・スポーツ学研究 40(2), early release 2025,
[PDF](https://webpages.ihs.kyushu-u.ac.jp/ktsm/journals/souki_koukai-V40N2-2.pdf); 13 university men, Motion
Analysis Mac3D with 8 cameras at 500 Hz, markers on the racket):

| Shot (soft tennis) | Path at contact | Face relative to path | Face angle (derived = sum) | Racket speed order |
|---|---|---|---|---|
| Defensive slice | −9.5 ± 2.8° | 35.4° open | ≈ +26° | slowest |
| Aggressive slice | −14.9 ± 3.4° | 42.1° open | ≈ +27° | middle |
| Topspin drive | +10.5 ± 3.6° | −2.0° | ≈ +8.5° | fastest |

Their coaching translation: defensive slice face up 20–30°, swing shoulder → chest; aggressive slice face up
25–35°, shoulder → navel; drive face up about 10°, chest → shoulder. Mapped onto the serve [D]:
slice ("cortado", the default) face +25°, path −10° (−15° for a biting one); flat ("plano") face +5–10°,
path 0 to −5°; topspin/kick ("liftado") face +5–10°, path +10°, which means the racket has to drop below the
ball first. Racket face speed: no measurement; let the game's inverse racket solver pick it (for scale, a
70 km/h ball off a near-still ball at the measured padel ACOR of about 0.5 needs about 13 m/s of normal face
speed, more with spin) [D].

### 1.6 Body turn and timing: the best analogue [T]

No padel serve joint angles or phase times exist. The best-measured analogue is the tennis forehand
(Landlinger, Lindinger, Stöggl, Wagner & Müller 2010, JSSM 9:643–651,
[PMC3761808](https://pmc.ncbi.nlm.nih.gov/articles/PMC3761808/); Vicon 8 cameras at 400 Hz, 6 ATP + 7 national
youth players, 12 strokes each). Converted to our turn convention:

| Event | Elite | Youth |
|---|---|---|
| Max hip turn 82.6° (just short of side-on) | −243 ms | −236 |
| Max shoulder turn **105.8°** (16° past side-on) | −231 ms | −214 |
| Max hip–shoulder separation 27° (33° youth) | −168 ms | −148 |
| Max racket lag | −146 ms | −133 |
| Peak pelvis angular velocity 540°/s | −75 ms | −93 |
| Peak trunk angular velocity 745°/s | −57 ms | −75 |
| Peak shoulder internal-rotation velocity 794°/s | +24 ms | +24 |
| Forward swing, first forward racket movement → end of forward travel | 324 ms | 326 |

The serve hits the ball at roughly half that forehand's speed (70 vs about 120+ km/h), so keep the order
(hips → shoulders → racket, coil peaking 230–250 ms before contact, pelvis leading the trunk by about 20 ms)
and give the serve a slightly longer, lower-amplitude swing (§4.1).

### 1.7 How it differs from a tennis underhand serve

- Rules: the tennis server releases the ball and must hit it before it touches the ground, with no height limit
  (ITF Rules of Tennis, Rule 16; not re-read this session) [R]. The padel ball must bounce first, be at or below
  the waist and be hit with a foot on the ground. So the padel serve is **a low forehand slice off a self-fed
  bounce**, a groundstroke, not the tennis underarm pendulum flick (which is a surprise short serve).
- Power: the padel serve rotates in the horizontal plane (hips, then shoulders) with a downward racket path; the
  tennis overarm serve uses trunk tilt and a vertical chain (48° trunk tilt above horizontal and 101° arm
  abduction at impact, Fleisig et al. 2003, §2.6). Speeds: padel 56–70 km/h (amateurs) against 183 km/h for
  Olympic men's tennis serves (50.8 m/s, Fleisig et al. 2003).
- Purpose: placement and getting to the net, not aces. Pros put about 90% of first serves in and almost never
  win the point outright (`shots-movement-feel.md` §6).

### 1.8 Second and tactical serves

Measured: first serves in 88–93%, about 2% of second serves are faults (`shots-movement-feel.md` §6). How the
**motion** of a second serve differs: not measured anywhere. Coaching sources [C] describe the same motion with
less pace and more slice and margin, aimed at the glass. Trances' practical advice [Pn]: vary spin, speed, height,
direction and depth, and serve from different spots along the line (nearer the side wall or the centre).
For the game: one motion, with variants made from racket speed, face/path angles, aim yaw and where the server
stands (§4.1).

---

## 2. Other strokes

### 2.1 Contact point along the court, all strokes [P]

Sánchez-Alcaraz et al. 2021 (§1.2 method; distance from the CoG, + = towards the net):

| Stroke | Highly trained | Novice | Use |
|---|---|---|---|
| Serve | 0.52 ± 0.28 m | 0.69 ± 0.25 | contact F |
| Groundstroke (drive) | 0.64 ± 0.32 | 0.57 ± 0.34 | contact F |
| Volley | 0.38 ± 0.26 | 0.51 ± 0.26 | contact F |
| Tray (bandeja) | **−0.01 ± 0.34** | 0.24 ± 0.31 | contact level with the body, not in front |
| Smash | 0.45 ± 0.44 | 0.60 ± 0.30 | contact F |
| Back wall (salida de pared) | **0.43 ± 0.41** | 0.11 ± 0.35 | pros move forward with the rebound |
| Lob | 0.65 ± 0.32 | 0.59 ± 0.38 | contact F |
| Lateral wall | 0.73 ± 0.38 | 0.61 ± 0.37 | contact F |
| Double wall | 0.49 ± 0.43 | 0.26 ± 0.44 | contact F |

Trained players hit serves, volleys, trays and smashes further back and wall shots further forward. The
paper's mean differences don't all equal the difference of the means (serve: −0.11 printed vs −0.17); the
means are used here.

### 2.2 Footfall-timed phases for overheads and the back-wall exit [P]

Espino, Skiadopoulos, Gianikellis & Luis del Campo 2015, RAMD 8(4):186 (congress abstract,
[doi](https://doi.org/10.1016/j.ramd.2015.08.006); full abstract read this session from the Elsevier PDF).
Two S-VHS cameras at 50 Hz (±20 ms), Kinescan-IBV 3D photogrammetry, 25 markers, **5 elite players** (2 men,
3 women), 2 good trials each. Feet: AI/DI = left foot down/off, AD/DD = right foot down/off, so the sequences
read for right-handers (handedness not stated). Strokes: back-wall exit (SP), bandeja (B), smash por tres (R).

| Phase | Sub-phases | SP | B | R |
|---|---|---|---|---|
| Preparation (FP) | 1AI→1DD, 1DD→AD, AD→DI, DI→2AI | **531 ms** | **516 ms** | **540 ms** |
| Hitting (FG) | 2AI→2DD, [2DD→2DI smash only], →IMP | **369 ms** | **264 ms** | **386 ms** |
| Finish (FT) | IMP→end | — | — | — |

Step sequences in the preparation: **1DD+AD+DI+2AI** (right off, right down, left off, left down) in 80% of
SP, 56% of B, 67% of R; **1DD+DI+AD+2AI** in 44% of B and 33% of R; 1DD+AD and DI+2AI in 10% of SP each.

What it means for the animation:
- **The front (free-side) foot plants 264 ms (bandeja), 369 ms (back-wall exit) and 386 ms (por tres)
  before contact**, and the racket-side foot leaves the floor before contact in all three. In the por tres the
  front foot leaves too (2DI): contact is in the air.
- First foot to contact: 780 ms (B), 900 ms (SP), 926 ms (R).
- [D] The second sequence has the left foot leave before the right lands: a moment with both feet off, i.e. a
  **skip / chassé**. That is the side-on shuffle with a flight phase, seen in 44% of bandejas and 33% of por tres
  smashes; back-wall exits never used it (plain alternating steps).
- Caution: FG starts at a footfall, not at the racket's forward swing, so 264 ms is "front foot down → contact",
  not the bandeja's swing time (`shots-movement-feel.md` §2 reads it as a forward swing; it isn't one).

### 2.3 Drive (forehand and backhand groundstrokes)

- [P] Contact 0.64 m in front of the CoG (trained). No padel racket speed, joint angle or swing time exists.
- [T] Forehand: Landlinger 2010 timings in §1.6 (coil −230 to −245 ms, separation −168, pelvis peak −75,
  trunk peak −57; tennis racket 31–33 m/s). Padel drives are slower and more compact, so use the same order of
  events with less amplitude [D].
- [T] Backhand: Genevois, Reid, Rogowski, Crespo & Boyer 2015, *Performance factors related to the different
  tennis backhand groundstrokes: a review*, JSSM 14(1):194–202 ([full text](https://jssm.org/jssm-14-194.xml-Fulltext)):
  elbow at impact about 170° (backspin one-hander) and 164° (topspin one-hander); elbow extension gives about
  25% of racket speed in the slice; hip–shoulder separation at contact +9.2 ± 7.2° (one-hander) vs
  −6.4 ± 4.3° (two-hander); a suggested front-foot angle of about 45° to the baseline (Ellenbecker 2006, cited
there, coaching); swing time 0.5 ± 0.1 s (one-hander) and
  0.4 ± 0.1 s (two-hander) as printed in the review (its text says the reverse; check the original).

### 2.4 Volley

- [P] Contact 0.38 m in front of the CoG (trained), 0.51 m (novice).
- [T] Chao, Huang, Chao, Chen & Liu 2008, *Kinematic analysis of tennis volley*, ISBS 26 (Seoul) pp. 533–536
  ([PDF](https://ojs.ub.uni-konstanz.de/cpa/article/view/1922/1790)): 15 skilled men 3 m from the net, ball
  machine at 21.3 m/s hidden behind a screen, two 250 Hz cameras, Kwon3D, 21 landmarks.

| Lateral ball position | Split-step (toe-off → down) | Ipsilateral side step | Forward swing | Stroke (first racket movement → contact) | Contact height | Elbow at contact | Shoulder at contact |
|---|---|---|---|---|---|---|---|
| 2 m forehand side | 314 ms | 150 | 135 | 526 | 1.10 m | 152° | 101° |
| 1 m forehand side | 363 | 156 | 131 | 527 | 1.07 | 143° | 72° |
| At the body | 330 | 120 | **121** | **466** | 1.17 | 132° | 52° |
| 1 m backhand side | 320 | 145 | 131 | 534 | 1.22 | 146° | 83° |
| 2 m backhand side | 332 | 271 | **165** | **624** | 1.23 | 161° | 97° |

Peak wrist speed in the forward swing 4.3–5.1 m/s; wrist angle about 157–164° at contact whatever the
position (the grip is set, the arm reaches). Their split-step phase (toe-off to toe-down, 0.31–0.36 s) is far
longer than on court (about 0.14 s, Mecheri 2019): the lab players hopped to the machine's audible cue, so use
the on-court figure for the hop. An **ipsilateral side step** (open step with the foot nearer the
ball, before the other foot crosses) came in 86% of backhand and 67% of forehand volleys; balls at the body were
taken on the forehand 55% of the time.

### 2.5 Bandeja and víbora

- [P] Bandeja contact level with the CoG along the court (−0.01 ± 0.34 m, trained) while novices hit it 0.24 m
  in front: the trained player is often still retreating, so the ball is above or slightly behind the body.
- [P] Footwork and timing: §2.2 (prep 516 ms; front foot down −264 ms; 44% chassé).
- [P] Frequency: men's WPT points contain a bandeja in 44–48% and a topspin bandeja / víbora in 20–23%
  (Martín-Miguel et al. 2024, Sports 12(8):218, [PMC11359520](https://pmc.ncbi.nlm.nih.gov/articles/PMC11359520/)).
- [C] LTA Padel ([glossary](https://www.ltapadel.org.uk/play/padel-glossary-what-do-bandeja-vibora-and-chiquita-mean/)):
  the bandeja is a sliced defensive overhead with the racket face held open at head height, like a waiter's
  tray, hit deep so it stays low off the glass; the víbora is hit at about head or shoulder height with
  sidespin, an attacking shot that kicks low and sideways. Retail guides add that the víbora is a shorter, faster,
  more lateral swing.
- [T] Overhead chain timing (Fleisig, Nicholls, Elliott & Escamilla 2003, Sports Biomech 2(1):51–64; 200 Hz,
  20 Olympic singles players): upper-torso peak rotation speed 58 ms (men) / 75 ms (women) before contact.
- No joint angles, heights or racket speeds have been measured for either stroke.

### 2.6 Smash, por tres and por cuatro

- [P] Ball speed (radar): semi-professionals 133.1 ± 8.2 km/h unopposed, 120.7 ± 9.8 opposed; amateurs 124.6 /
  104.5 (Rivilla-García, Muñoz Moreno, Lorenzo, van den Tillaar & Navandar 2019, Kinesiology 51(2),
  [doi](https://doi.org/10.26582/k.51.2.6); 14 + 30 players). High-performance juniors 12–16 y: boys 112.2 ±
  13.4 (best 127.5), girls 103.6 ± 5.2, 8 smashes from 2 m off the net (Sánchez-Alcaraz et al. 2025, Sports
  13(4):104, [PMC12031073](https://pmc.ncbi.nlm.nih.gov/articles/PMC12031073/)).
- [P] Contact 0.45 ± 0.44 m in front (trained); por tres timing and jump in §2.2.
- [P] Por tres appears in 7–8% of men's WPT points, flat smash 30–33% (Martín-Miguel et al. 2024).
- [T] Tennis serve as the arm-chain analogue (Fleisig 2003): at the cocked position maximum shoulder external
  rotation 172° and elbow flexion 104°; at impact the arm is abducted 101° and the trunk tilted 48° above
  horizontal; peak angular velocities pelvis 440°/s, upper torso 870°/s, elbow extension 1,510°/s, wrist
  flexion 1,950°/s, shoulder internal rotation 2,420°/s (men) / 1,370°/s (women).
- Por cuatro (out through the side door): nothing measured.
- Lead not read: Rosselló Coll, Ruiz Malagón, Moreno Vecino & Delgado García 2023, *Análisis de la cinemática y
  la variabilidad motora en remates de pádel* (book chapter, Dykinson, pp. 16–43,
  [repository](https://repositorio.comillas.edu/items/ccc58a1e-d046-4258-8765-a66e23aa4eff)): flat smashes by
  level and intensity; the 14.6 MB book PDF was too large to fetch.

### 2.7 Back-wall exit (salida de pared)

- [P] Pros meet it 0.43 m in front of the CoG, novices 0.11 m: after the ball comes off the glass the pro moves
  forward with it and hits in front; the novice lets it come to the body.
- [P] Prep 531 ms, front foot down 369 ms before contact, plain alternating steps 80% (§2.2).
- [P] Back-wall forehands appear in 42–45% and backhands in 34–36% of men's points (Martín-Miguel 2024).
- [P] Granda Vera, Barbero Álvarez & Cortijo Cantos 2019, RIMCAFD 19(73) (abstract only;
  [repository](https://digibug.ugr.es/handle/10481/61947)): 5 expert players hitting off the back wall to three
  directions; hand height and left-heel position at the start and end of the swing predicted direction best
  (r = .896 and .777). A usable "tell" for the AI, not a pose.

### 2.8 Ready position and split-step

- [P] Elite padel men make 7.7 split-steps per 5 min of play (Priego et al. 2013, JHSE 8(4):925–931,
  [doi](https://doi.org/10.4100/jhse.2013.84.04); 100 Hz video, 20 pros, 10 matches).
- [T] Take-off +9 ± 36 ms and landing +152 ± 25 ms after the opponent's contact (Mecheri et al. 2019, J Sports
  Sci, [accepted MS](https://pure.port.ac.uk/ws/files/13666713/Mecheri_et_al._Accepted.pdf); two 100 Hz cameras,
  22 world-class tennis players). More in `shots-movement-feel.md` §4.
- Ready-position knee angle, stance width, racket height: nothing measured; coaching says low, feet apart,
  knees bent, racket up in front [C].

---

## 3. Footwork

| Pattern | Data | Use |
|---|---|---|
| What pros' feet do over a match | Per 5 min: lateral displacements 16.1, forward 13.3, split-steps 7.7, pivots on the right / left foot 1.07 / 1.36; forward runs about 43% of displacements (tennis about 20%) [P] Priego 2013 | Mostly short side steps and forward runs |
| Last steps into an overhead or back-wall shot | Two alternating steps, then the front foot plants 264–386 ms before contact; 33–44% of overheads use a skip with a flight phase [P] Espino 2015, [D] interpretation | Retreat for a lob side-on with a chassé, plant, swing |
| Volley at the net | Open step with the ball-side foot (86% backhand, 67% forehand volleys; 120–270 ms), then the other foot crosses on wide balls; at the body, almost no step [T] Chao 2008 | Short shuffle / open step; crossover only for the 2 m-wide ball |
| Crossover vs shuffle | Crossover covers more ground and is the usual lateral pattern at pro level; shuffles when the ball is a step or two away [C] [tennisplayer.net](https://www.tennisplayer.net/category/footwork/pat_dougherty/lateral_and_forward_movement/lateral_and_forward_movement.html/). Retailer padel guides warn against crossovers near the wall [C] | Shuffle under about 1.5 m, crossover beyond [D] |
| Backing up for a lob | No padel measurement of turn-and-run vs shuffle. The game's movement model already runs back side-on at 4.3 m/s (`data/tuning.json`) | Turn side-on early, chassé the last 1–2 steps (Espino) |
| Server's run-in | 2.7 m in 1.22 s, peak 2.9 m/s (high level) [P] Ramón-Llin 2021 | §4.1 K7–K8 |

---

## 4. What the game should use

### 4.1 Serve key poses: default first serve (slice), right-hander, 1.80 m

Pelvis-floor point at contact about 0.65 m behind the service line (it drifts about 0.10 m forward from K0 to
K5 as the weight transfers), front toe about 0.35 m behind the line, ball struck about 0.15 m behind it; aim F
along the diagonal. Positions are face-centre (F, S, U) in metres from the floor point under the mid-hip at
that key. Tags say where each number comes from; everything not tagged [P]/[Pn]/[T] is [D]. Geometry check
[D]: shoulder to face centre is about 0.80 m with the elbow at 150° and the racket at about 135° to the forearm
(upper arm 0.186 H, forearm 0.146 H, hand-to-face-centre about 0.24 m on a 45.5 cm racket), which is what puts
the contact 0.55 m out to the side when it is 0.50 m forward and 0.90 m high.

| Key | t (ms) | Feet and legs | Hip / shoulder turn, trunk | Racket face centre (F, S, U) and orientation | Elbow, free hand |
|---|---|---|---|---|---|
| K0 Address | ≤ −900 (hold; optional 1–2 ritual bounces, not studied) | Side-on: front foot at (+0.30, −0.05), toes turned in about 45° towards the net; rear foot at (−0.25, +0.05), parallel to the line [Pn]; about 0.55 m apart (about shoulder width [Pn]); knees 15–20°; weight on the rear leg [Pn] | Hips 80°, shoulders 85°; trunk upright | (+0.10, +0.35, 0.95), face up, ball resting on or next to it [Pn] | Elbow 100°; free hand holding the ball at (+0.15, +0.35, 1.00) |
| K1 Release | −620 | Unchanged; weight back | Coil begins; trunk tips 10° forward so the free hand can reach | Racket starts back and up [Pn] | Free hand at about (+0.50, +0.45, 0.95) pushes the ball down at 3–3.5 m/s, slightly forward and out so it lands on the bounce spot [Pn: push into the turf; D: speed, direction] |
| K2 Bounce | −400 | Bounce spot = the contact spot in plan view: about 0.30 m ahead of the front ankle and 0.55 m out to the racket side ("near the front foot" [Pn]). Rear knee loads to about 40° and starts pushing [Pn] | Hips 85°, shoulders 100° | (−0.40, +0.40, 1.35), rising | Elbow 95°; free hand stays out at (+0.30, +0.30, 1.00), pointing at the ball |
| K3 Top of backswing | −300 (range −400 to −250) | Front knee 35°, rear knee 40–45°: the body lowers for the low contact | Hips 85°, shoulders **105°** (coil about 20° [T: 106° at −231 ms in the tennis forehand]); trunk leans 10–15° forward | **(−0.55, +0.35, 1.50)**; head above the grip, face about vertical [Pn]. Players vary: "high" style U 1.70 (above the head), "compact" U 1.25 [Pn] | Elbow 90°, upper arm abducted 70–80° with external rotation [Pn]; elbow pole back and down; free arm across the front at chest height for balance [Pn] |
| K4 Mid forward swing | −120 | Rear leg drives; weight moving onto the front foot | Hips 65°, shoulders 85° (hips lead by about 20 ms [T]) | (−0.25, +0.55, 1.10), dropping on a high-to-low path [Pn]; face opening | Elbow 125°; free arm braces [Pn] |
| K5 **Contact** | 0 | Front foot planted and behind the line [R]; rear foot on its toes, heel up (pivot) [Pn]; front knee 30–40° | Hips 50°, shoulders 45°; trunk leans 15–25° forward | **(+0.50 [P], +0.55, 0.90)**: ball near its apex [D §1.4], at or under the waist [R]. Shaft pointing out to +S and slightly back, head 0–15° below the hand; **face +25° open, path −10°** [T→D]; face normal along F | Elbow 150° [T: 132–170°]; wrist set; free hand folds in to the chest |
| K6 End of deceleration | +180 | Rear foot leaves the floor and swings through, pivoting on the front foot [Pn] | Hips 25°, shoulders 15° | Slice: (+0.75, +0.15, 1.25), face still open, low forward finish towards the target [Pn, T] | Elbow 140°; trunk slightly flexed [Pn] |
| K7 Step-through | +300 to +400 | Rear foot lands 0.5–0.7 m ahead of the front foot (it may cross the line now) | Square to the net | Racket comes up to the ready position at chest height | — |
| K8 Run-in and split-step | +400 → +1220 | Accelerate to about 2.9 m/s; 2.7 m covered by the return [P]; split-step take-off at the receiver's contact (about +1220 ms ± 200), landing about 150 ms later [T] | — | Ready position | — |

Timing logic: K1 and K2 are tied to the ball (release → apex about 620 ms, bounce about 400 ms before contact:
§1.4), K3–K5 to the swing, K6–K8 to the run. If the sim's serve uses a different push, keep K1 = contact −
(release → apex) and K2 = contact − (bounce → apex).

**Variants** (all [D] unless tagged):

| | Slice (default) | Flat | Kick / topspin | Second serve | Low drop (beginner look) |
|---|---|---|---|---|---|
| Ball push | 3–3.5 m/s | 3.5–4 m/s | 3 m/s | 3 m/s | none (drop) |
| Contact U | 0.85–0.95 m | 0.95–1.00 m (just under the waist) | 0.80–0.90 m | 0.85–0.95 m | 0.45–0.55 m [D §1.4]; knees bent 60°+ |
| Face / path | +25° / −10° [T] | +8° / −3° | +8° / +10° [T]; racket drops to U ≈ 0.65 at −100 ms, then brushes up | +28° / −12° | +20° / −5° |
| Top of backswing U | 1.50 | 1.60 | 1.25 (loop below) | 1.40 | 1.20 |
| Shoulders at contact | 45° | 30° (more rotation) | 40° | 50° | 60° |
| Finish | low, forward (+0.75, +0.15, 1.25) | across, high (+0.40, −0.25, 1.55) | up and across (+0.35, −0.20, 1.70) | low, forward | short |
| Racket speed scale | 1.0 | 1.1–1.2 | 1.0 | 0.85 | 0.7 |
| Aim | glass (about 63% of pro serves [P]) | T / body | glass | glass | anywhere |
| Footwork | pivot | running or front-leg hop | pivot | pivot | pivot, flat-footed |

### 4.2 Other strokes: anchor timings and contact positions

| Stroke | Measured anchors | Contact (F, S, U) | Orientation and body | Main gap |
|---|---|---|---|---|
| Bandeja | Prep 516 ms; front foot down **−264 ms**; racket-side foot leaves before contact; chassé in 44% [P] | **(0.0 [P], +0.35, 1.85–2.05)** at head height or a little above, arm not fully straight [C, D] | Side-on (shoulders about 90°) at the plant, 50–60° at contact [D]; face open about 25°, slice [C]; free arm up towards the ball; upper torso peaks about −60 ms [T] | Heights, angles, racket speed |
| Víbora | Same footwork [P, as bandeja] | (−0.1 to 0.0, +0.50, 1.55–1.85): shoulder to head height [C], further out to the racket side [D] | Face less open (+10–15°), path down 20–30° and across the body towards the free side, so the face cuts the side of the ball (sidespin + backspin) [C, D]; more trunk turn and forearm pronation [C] | Everything kinematic |
| Smash (flat, por tres) | Prep 540 ms; front foot down **−386 ms**; both feet off before contact (jump) [P]; ball 121–133 km/h [P] | (**+0.45 [P]**, +0.25, 2.30–2.50) at full reach in the air [D] | Tennis-serve chain [T]: cocked shoulder external rotation about 170°, elbow about 105°; at contact arm abducted about 100°, trunk tilted about 48° above horizontal; upper torso peaks −58 ms | Padel joint data; por cuatro |
| Back-wall exit | Prep 531 ms (2 alternating steps, 80%); front foot down **−369 ms** [P] | (**+0.43 [P]**, +0.60, 0.70–1.00) [D] | Side-on as the ball passes to the glass, then move forward with the rebound and hit in front [P]; drive timing as below [T] | Height, how far from the glass |
| Volley | Split-step lands about +150 ms after the opponent's contact [T]; open step with the ball-side foot 120–270 ms [T]; forward swing **120–165 ms**, stroke 466–624 ms [T] | (**+0.38 [P]**, +0.45 to +0.70 by width, 1.07–1.23 at 3 m from the net [T]) | Elbow 132° (at the body) to 160° (wide) [T]; wrist set at 157–164° [T]; continental grip, compact backswing [C] | Padel volley speeds and angles |
| Drive | Coil max −230 to −245 ms; separation max −168; racket lag −146; pelvis peak −75; trunk peak −57 [T] | (**+0.64 [P]**, +0.65, 0.6–1.0) [D] | Shoulders 106° at max coil, about 0–30° at contact [T, D]; one-hander backhand elbow about 165–170° at contact [T] | All padel kinematics |

### 4.3 Footwork rules

- Mostly short side steps and forward runs; backward runs are rare (Priego 2013).
- Into an overhead: turn side-on early, retreat with alternating steps or a chassé (flight phase in about 40% of
  them), plant the front foot 264 ms (bandeja) or 386 ms (smash) before contact, lift the rear foot during the
  swing; for the por tres push off the front foot so contact is airborne.
- Back-wall exit: two alternating steps, plant the front foot about 370 ms before contact, and move forward with
  the rebound so contact is about 0.4 m in front.
- Net volleys: open step with the ball-side foot; cross the other foot only for balls 2 m wide; at the body,
  almost no step and the forehand slightly more often.
- Serve: pivot by default (rear leg pushes at the bounce, comes through after contact); never airborne at
  contact, planted foot behind the line until the ball has gone.

---

## 5. Gaps (nothing measured that I could find)

- **Padel serve**: contact height, bounce height, where in the bounce it is struck, stance distances and
  angles, backswing height, racket path and face, joint angles, phase durations, pro serve speed, and how a
  second serve's motion differs. Everything in §4.1 that isn't tagged comes from rules, physics, the Trances
  description and tennis or soft-tennis analogues.
- Padel joint kinematics for every stroke. The one 3D shoulder study (de Sire et al. 2024, J Sports Med Phys
  Fitness 64(4):383–391, optoelectronic + EMG, professionals vs amateurs) reports only group differences in its
  abstract (more glenohumeral rotation and scapular tilt with experience; men volley with more external
  rotation); its full text was not reachable.
- Padel racket speeds for any stroke, and padel ball speeds for drives, volleys, bandejas and víboras.
- Contact heights for any padel stroke (Sánchez-Alcaraz 2021 measured only the along-court distance).
- How padel players retreat for a lob (turn-and-run vs shuffle), measured; ready-position angles.
- Bandeja vs víbora differences beyond coaching descriptions.
- Not opened: the Rosselló Coll 2023 smash-kinematics chapter (PDF too large); Granda Vera 2019 full text
  (the repository's bot check blocks it, so abstract only); the ITF Rules of Tennis PDF (the 2025 link
  returned 404; the Rule 16 wording above is from memory).

## 6. Sources

- FIP, *Rules of Padel*, review of application 01.01.2026 ([PDF](https://www.padelfip.com/wp-content/uploads/2025/12/FIP_Rules-of-Padel.pdf)).
- Padel Addict, *Nuevas normas de pádel 2026* ([link](https://www.padeladdict.com/nuevas-normas-padel-2026-reglamento-fip/)) [C].
- Sánchez-Alcaraz BJ, Conde R, Genevois C, Muñoz D (2022). Análisis técnico-táctico del saque en pádel profesional. Revisión narrativa. *Trances* 14(2):92–110 ([PDF](https://diegomun.es/wp-content/uploads/2022/03/Analisis-tecnico-tactico-del-saque-en-padel-profesional-Revision-Narrativa.pdf)).
- Sánchez-Alcaraz BJ, Martínez-Gallego R, Llana S, et al. (2021). Ball impact position in recreational male padel players. *IJERPH* 18(2):435 ([PMC7828082](https://pmc.ncbi.nlm.nih.gov/articles/PMC7828082/)).
- Sánchez-Pay A, Escudero-Tena A, Martínez Nieto FJ, Muñoz D, Sánchez-Alcaraz BJ (2023). Análisis de la velocidad y la precisión en el saque en jugadores de pádel amateur. *Padel Sci J* 1(2):157–172 ([doi](https://doi.org/10.17398/2952-2218.1.157)).
- Ramón-Llin J, Guzmán J, Martínez-Gallego R, Vučković G, Muñoz D, Sánchez-Alcaraz BJ (2021). Comparison of service tactic formation on players' movements and point outcome between national and beginner level padel. *PLoS ONE* 16(10):e0250225 ([PMC8550361](https://pmc.ncbi.nlm.nih.gov/articles/PMC8550361/)).
- Espino C, Skiadopoulos A, Gianikellis K, Luis del Campo V (2015). Análisis espacio-temporal de los golpes de pádel: salida de pared, bandeja y remate por tres. *Rev Andal Med Deporte* 8(4):186 ([doi](https://doi.org/10.1016/j.ramd.2015.08.006)).
- Priego Quesada JI, Olaso Melis J, Llana Belloch S, et al. (2013). Padel: a quantitative study of the shots and movements in the high-performance. *J Hum Sport Exerc* 8(4):925–931 ([doi](https://doi.org/10.4100/jhse.2013.84.04)).
- Rivilla-García J, Muñoz Moreno A, Lorenzo J, van den Tillaar R, Navandar A (2019). Influence of the opposition on overhead smash velocity in padel players. *Kinesiology* 51(2) ([doi](https://doi.org/10.26582/k.51.2.6)).
- Sánchez-Alcaraz BJ, et al. (2025). Physical parameters in young competitive padel players: strength, power, agility, and smash velocity. *Sports* 13(4):104 ([PMC12031073](https://pmc.ncbi.nlm.nih.gov/articles/PMC12031073/)).
- Martín-Miguel I, et al. (2024). Game dynamics in professional padel: shots per point, point pace and technical actions. *Sports* 12(8):218 ([PMC11359520](https://pmc.ncbi.nlm.nih.gov/articles/PMC11359520/)).
- Granda Vera J, Barbero Álvarez JC, Cortijo Cantos A (2019). Determinación de preíndices en pádel mediante análisis cinemático. *RIMCAFD* 19(73) ([repository](https://digibug.ugr.es/handle/10481/61947)).
- de Sire A, Demeco A, Frizziero A, et al. (2024). Risk of injury and kinematic assessment of the shoulder biomechanics during strokes in padel players. *J Sports Med Phys Fitness* 64(4):383–391 (doi 10.23736/S0022-4707.23.15418-1).
- Landlinger J, Lindinger S, Stöggl T, Wagner H, Müller E (2010). Key factors and timing patterns in the tennis forehand of different skill levels. *JSSM* 9:643–651 ([PMC3761808](https://pmc.ncbi.nlm.nih.gov/articles/PMC3761808/)).
- Fleisig G, Nicholls R, Elliott B, Escamilla R (2003). Kinematics used by world class tennis players to produce high-velocity serves. *Sports Biomech* 2(1):51–64 ([doi](https://doi.org/10.1080/14763140308522807)).
- Chao HW, Huang CF, Chao HH, Chen YD, Liu GC (2008). Kinematic analysis of tennis volley. ISBS 26, Seoul ([PDF](https://ojs.ub.uni-konstanz.de/cpa/article/view/1922/1790)).
- Genevois C, Reid M, Rogowski I, Crespo M, Boyer E (2015). Performance factors related to the different tennis backhand groundstrokes: a review. *JSSM* 14(1):194–202 ([full text](https://jssm.org/jssm-14-194.xml-Fulltext)).
- Matsue T, Maeda A (2025, early release). Kinematic features of racket motion in aggressive backhand slice shots in soft tennis. 九州体育・スポーツ学研究 40(2) ([PDF](https://webpages.ihs.kyushu-u.ac.jp/ktsm/journals/souki_koukai-V40N2-2.pdf)).
- Mecheri S, Laffaye G, Triolet C, et al. (2019). Relationship between split-step timing and leg stiffness in world-class tennis players when returning fast serves. *J Sports Sci* ([accepted MS](https://pure.port.ac.uk/ws/files/13666713/Mecheri_et_al._Accepted.pdf)).
- LTA Padel, *Padel glossary: bandeja, víbora, chiquita* ([link](https://www.ltapadel.org.uk/play/padel-glossary-what-do-bandeja-vibora-and-chiquita-mean/)) [C].
- Dougherty P, *Lateral and forward movement*, tennisplayer.net ([link](https://www.tennisplayer.net/category/footwork/pat_dougherty/lateral_and_forward_movement/lateral_and_forward_movement.html/)) [C].
- Rosselló Coll JF, Ruiz Malagón EJ, Moreno Vecino B, Delgado García GA (2023). Análisis de la cinemática y la variabilidad motora en remates de pádel. In *Viaje didáctico por el cuerpo y la mente*, Dykinson, pp. 16–43 ([repository](https://repositorio.comillas.edu/items/ccc58a1e-d046-4258-8765-a66e23aa4eff)) (not read).
