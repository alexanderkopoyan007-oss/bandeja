# Realism programme

The owner (2026-10-27): "a pronounced emphasis on the physics and game realism… like real life, a 2K or FIFA level
amount of detail". This is the main body of work from here. Each item replaces a game shortcut with a model
measured against published data, and lands with tests that check the model against those numbers.

## Order of work
1. **Net as cloth.** Done 2026-10-27 (`src/sim/court/netCloth.ts`, CLAUDE.md M1 notes).
2. **Racket–ball impact physics.** Done 2026-10-27 (`src/sim/contact/racket.ts`, CLAUDE.md realism notes).
   - A racket model: mass, balance, moments of inertia, true COR against impact speed, face friction.
   - A forward impact (ball and swing → ball out, spin out) and its inverse (wanted ball → swing).
   - Errors made in the swing (path, face angle, speed, contact point, timing) and pushed through the physics.
   - Racket-speed caps instead of ball-speed caps, so a hard incoming ball comes back faster off the same swing,
     as a blocked smash does.
   - Checked: ACOR 0.50 at 17 m/s and 0.37–0.41 at 29 m/s; curvature along and across the face; grip above about
     55° and slide at 25°; smash median about 138 km/h against 133 for semi-pros.
3. **Ball flight.** Free-flight drag of a new ball, spin decay proportional to ω·v, ball wear over a match.
4. **Bounce.** Grip/slip with the floor (turf with sand infill), glass vs concrete walls, mesh, seams; spin through
   every bounce.
5. **Player physics.** Acceleration and braking on turf, split step, reaction time, fatigue over a match,
   collisions between partners, touching the net, and reach against the racket's length.
6. **Rules completeness.** Ball lodged in the mesh or on top of a wall, out-of-court play.
7. **Calibration** against match statistics: shot speeds, rally lengths, how points end.

## Data so far

### Ball flight
- **Drag.** Free-flight drag of new tennis balls is C_D = 0.507 ± 0.024 at 14–30 m/s and does not vary with spin
  or speed. That was 128 shots of Penn ATP balls, with spin −2400 to +2500 rpm. Wind-tunnel values run 15–20%
  higher (mostly above 0.6), and drag falls slightly as the ball wears. The game uses 0.55.
  ([Tennis Warehouse University, ball aerodynamics](https://twu.tennis-warehouse.com/learning_center/aerodynamics2.php))
- **Lift.** C_L = 0.1–0.3 at spin ratio S = rω/v = 0.14–0.53, close to linear in S (Cross & Lindsey 2013, on the
  same page). The game's fit, C_L = 1/(2 + 1/S), gives 0.11 at S = 0.14 and 0.26 at S = 0.53, inside that band.
- **Spin decay.** Spin decay is linear in initial spin × speed, with a constant that depends on the ball (James &
  Haake 2008, *The spin decay of sports balls in flight*, Engineering of Sport 7). The paper's tennis constant is
  not available here, so k in dω/dt = −k·ω·v is estimated from two figures:
  - golf balls lose about 4%/s at 60 m/s;
  - tennis balls decay over six times faster than golf balls, from the nap's skin friction (Haake group).
  With the inertia of each ball this gives k ≈ 5e-3 per metre. That loses about 8% of the spin over a 15 m flight
  at any speed. The game currently uses a 5 s exponential, a speed-blind 20%/s.

### Racket–ball impact
- **Apparent COR (ACOR) across the face.** Ball rebound ÷ approach speed off a free or hand-held padel racket at
  rest is an elliptic paraboloid, ea = B0 + B2·y + B3·x² + B5·y² (x across the face, y along it, in mm). The fits
  for 14 rackets at 16–30 m/s give:
  - B0 = 0.36–0.55;
  - B3 ≈ −4e-5 /mm², so ACOR falls fast towards the sides;
  - B5 ≈ −1e-5 /mm², so it falls slowly along the face.
  (Viollaz & Viollaz, *Apparent coefficient of restitution surface of a paddle racket*, ISBS 2008,
  [ojs.ub.uni-konstanz.de/cpa/article/view/1657](https://ojs.ub.uni-konstanz.de/cpa/article/view/1657))
- **Free-racket theory.** ea = (e − r)/(1 + r), with r = (m/M)(1 + M·b²/I_G), b the distance from the centre of
  mass, m the ball mass and M the racket mass. A twist term x²/I_polar is added the same way. With M = 0.36 kg,
  this fits the measured curvatures when I_G ≈ 0.0075 kg m² (B5) and I_polar ≈ 0.0018 kg m² (B3).
- **Speed and grip.** Going from 17 to 29 m/s cuts ACOR by 0.10 (25%), so the true COR e falls by about 0.0097 per
  m/s. The grip makes a 4% difference (hand-held vs free); a clamped handle adds 25%, which does not happen in play.
- **Racket types and impact points.** At the drive point, conventional rackets average 0.374 and hollow ones
  0.426. Typical impact points measured from the tip are 83 mm for the smash, 128 mm for the drive and 146 mm for
  the volley; the smash point is the lowest (0.29).
  (Viollaz et al., *Apparent COR of impacts in paddle rackets with different characteristics*,
  [ojs.ub.uni-konstanz.de/cpa/article/view/1656](https://ojs.ub.uni-konstanz.de/cpa/article/view/1656))
- **The ball.**
  - Drop test COR 0.728–0.76: the FIP 2.54 m drop bouncing 135–145 cm.
  - Stiffness 17.3 N/mm.
  - Clamped padel racket COR averages 0.66 (50 rackets).
  - Effective racket mass at the centre is about 290 g against a 58 g ball, so 83% of the racket's speed passes to
    the ball.
  ([TWU padel racket power](https://twu.tennis-warehouse.com/learning_center/padel/racketpower.php))
- **Face friction and spin.**
  - Padel faces have static COF 0.14–0.93 (sanded faces at the top).
  - A ball grips the face above an impact angle of about 37–62° from the face, depending on the COF, and slides
    below it. In the grip range every face gives the same spin, so roughness only matters for glancing,
    brushed shots.
  - Contact velocities in opposite directions always grip.
  - The padel ball is α = 0.55 (I = α m r²).
  ([TWU padel spin](https://twu.tennis-warehouse.com/learning_center/padel/padelspin.php),
  [comparison tool](https://twu.tennis-warehouse.com/learning_center/padel/padelspincomparison.php))

### Shot speeds
- **Smash speed (radar).** Semi-professionals average 133.1 km/h unopposed and 120.7 km/h with an opponent.
  Amateurs average 124.6 and 104.5 km/h. (Rivilla-García et al. 2019, *Kinesiology*,
  [hrcak.srce.hr/227742](https://hrcak.srce.hr/227742))
- **The game's AI.** Its smash median was 157 km/h with ball-speed caps; with the racket model it is about 138 km/h
  (12 seeds × 300 s of doubles, 2026-10-27).

### Walls
- **Glass vs concrete.** Glass gives faster, longer and more accelerated rebounds than concrete. Ball type matters
  more for speed and distance, and the wall for angle and acceleration; Dunlop balls bounce faster and longer
  than Head. (Gea García et al. 2021, *Int. J. Perf. Analysis in Sport*, doi 10.1080/24748668.2021.1875778)

### Turf
- **No independent padel data.** Nothing published measures rebound or friction against sand infill.
- **Cranfield (2010), on tennis-style sand-filled turf.** Adding infill hardens the surface, lowers the rebound
  and reduces rotational resistance, and deceleration stops rising above about 10 kg/m².
  ([Cranfield](https://dspace.lib.cranfield.ac.uk/handle/1826/6466))
- **The game stays calibrated to the FIP drop test** and keeps the turf's friction and grip as tuning values,
  labelled as such.
