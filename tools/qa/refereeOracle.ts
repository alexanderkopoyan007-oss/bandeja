// Referee oracle (Phase 7 QA). Judges one serve attempt at a time from the plain facts of tools/qa/facts.ts, using
// only the FIP Rules of Padel (application 01.01.2026, scratch/qa/fip-rules.txt). It was written without reading
// the game's own referee, so a disagreement between the two is a finding, never an agreement by construction.
// Every reading of an ambiguous or silent rule is listed in tools/qa/ORACLE-NOTES.md.
//
// How an attempt is judged:
//   beforeStrike  'serve' fact .. the serve's strike or whiff (rule 6: feet, the bounce, the waist; 7.1.a/b)
//   serveFlight   the strike .. the serve's first landing (7.1.c/d, 8.5, 9.1.a/b)
//   live          the serve after a good bounce in the box, then every rally shot (7.1.e/f, 8.1, 12-16)
// A shot is "good" once it has bounced correctly in the court of the team that must return it (14.1.b/e/i).
// Before that, almost any other contact loses the point for the team that hit it; after it, the ball stays in
// play (12.3) until the receiving team returns it, or it bounces a second time, or something ends the point.

import type { Call, CourtFacts, Fact, Half, MatchFacts, ServeSide, Wall } from './facts.ts';

/** A wall contact with the ball's centre this low is in the angle where the wall joins the ground (14.1.i). */
const CORNER_Y = 0.06;
/** A floor contact this close (m) to such a corner contact is the same touch, not a further bounce. */
const SAME_TOUCH = 0.25;

type Phase = 'idle' | 'beforeStrike' | 'serveFlight' | 'live' | 'decided';

type Decision =
  | { kind: 'point'; winner: number; rule: string }
  | { kind: 'fault'; rule: string }
  | { kind: 'let'; rule: string };

type ServeFact = Extract<Fact, { k: 'serve' }>;

const fault = (rule: string): Decision => ({ kind: 'fault', rule });
const replay = (rule: string): Decision => ({ kind: 'let', rule });
const halfAt = (z: number, fallback: Half): Half => (z > 0 ? 1 : z < 0 ? -1 : fallback);
const isEndWall = (w: Wall): boolean => w === 'backNear' || w === 'backFar';

export class RefereeOracle {
  private readonly court: CourtFacts;
  private serveNumber = 1;
  private phase: Phase = 'idle';

  // The attempt in progress (from its 'serve' fact).
  private server = 0;
  private receiver = 1;
  private serveTeam = 0;
  private teamHalf: [Half, Half] = [1, -1];
  private side: ServeSide = 'right';
  /** 6.2: the server bounced the ball before serving (a 'toss', or a floor bounce before the strike). */
  private tossed = false;
  /** 6.2: the last such bounce was inside the server's own area. */
  private tossBounceOk = true;

  // The shot being judged.
  private hitTeam = 0;
  private lastStriker = 0;
  /** The shot has bounced correctly in the court of the team that must return it. */
  private good = false;
  /** The shot touched the net or a post since it was struck, before its good bounce (13.1.h, 14.1.e). */
  private netSinceStrike = false;
  /** The ball is outside the enclosure. */
  private outside = false;
  /** The half the ball is over, from the strike position and 'cross' facts. */
  private ballHalf: Half = 1;
  /** A corner contact that counted as the good bounce; a floor fact right after it at the same spot is that touch. */
  private corner: { x: number; z: number } | null = null;

  // Serve only: the shot is the serve until the receiver returns it.
  private isServe = false;
  /** 9.1: the serve touched the net or a post on its way. */
  private serveNet = false;
  /** Contacts since the serve's bounce in the box (7.1.f: out through the door "directly"). */
  private contactsSinceBounce = 0;
  /** 12.2: a player touched the net or the opponents' court while the serve was not yet proved valid. */
  private pendingTouch = -1;

  constructor(m: MatchFacts) {
    this.court = m.court;
  }

  /** 1 or 2: the serve number of the attempt in progress, or of the next one. */
  get serveNo(): number {
    return this.serveNumber;
  }

  /**
   * Not a rule: lets the QA harness put the serve number back in step with the game's after a disagreement, so
   * one wrong call doesn't shift every later comparison. Applies to the next attempt.
   */
  resync(serveNo: number): void {
    this.serveNumber = serveNo === 2 ? 2 : 1;
  }

  feed(f: Fact): Call | null {
    if (f.k === 'serve') {
      this.begin(f);
      return null;
    }
    let d: Decision | null = null;
    if (this.phase === 'beforeStrike') d = this.beforeStrike(f);
    else if (this.phase === 'serveFlight') d = this.serveFlight(f);
    else if (this.phase === 'live') d = this.live(f);
    if (!d) return null;
    this.phase = 'decided';
    return this.settle(d);
  }

  // ---------------------------------------------------------------------------------------------------------------

  private begin(f: ServeFact): void {
    this.phase = 'beforeStrike';
    this.server = f.server;
    this.receiver = f.receiver;
    this.serveTeam = f.server % 2;
    this.teamHalf[this.serveTeam] = f.half;
    this.teamHalf[1 - this.serveTeam] = f.half === 1 ? -1 : 1;
    this.side = f.side;
    this.tossed = false;
    this.tossBounceOk = true;
    this.isServe = false;
    this.serveNet = false;
    this.pendingTouch = -1;
    this.contactsSinceBounce = 0;
    this.corner = null;
    this.outside = false;
  }

  /** Turns a decision into the call, and keeps the serve number (13.1.q, 9.2.b/c). */
  private settle(d: Decision): Call {
    if (d.kind === 'let') {
      // 9.2.b: a let on the first serve replays the whole point (two serves); 9.2.c: on the second, only that one.
      return { result: 'let', winner: -1, rule: d.rule };
    }
    if (d.kind === 'fault') {
      if (this.serveNumber === 1) {
        this.serveNumber = 2; // rule 6: "If the first service is not valid the server is allowed a second service"
        return { result: 'fault', winner: -1, rule: d.rule };
      }
      this.serveNumber = 1;
      return { result: 'point', winner: 1 - this.serveTeam, rule: '13.1.q' }; // two consecutive faults
    }
    this.serveNumber = 1;
    return { result: 'point', winner: d.winner, rule: d.rule };
  }

  /** `team` loses the point. */
  private lose(team: number, rule: string): Decision {
    // 12.2: the ball is in play from the moment a valid serve takes place. A touch of the net or the opponents'
    // court made while the serve was still in the air is held until the serve proves valid (not a fault or a
    // let); once it does, that touch came first and decides the point (13.1.a).
    if (this.isServe && this.pendingTouch >= 0) {
      return { kind: 'point', winner: 1 - (this.pendingTouch % 2), rule: '13.1.a' };
    }
    return { kind: 'point', winner: 1 - team, rule };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Geometry. The server stands on the right of their half (side 'right') or the left, as they face the net.
  // Seen from the z > 0 end, right is +x, so a server in half h standing on their right is at x sign h.

  private serverXSign(): number {
    const h = this.teamHalf[this.serveTeam];
    return this.side === 'right' ? h : -h;
  }

  /** 6.5 / 7.1.c: the box diagonally opposite the server; the lines (5 cm, centred on their marks) are good. */
  private inTargetBox(x: number, z: number): boolean {
    const h = this.teamHalf[this.serveTeam];
    const w = this.court.lineWidth / 2;
    const into = -z * h; // distance into the receivers' half
    const across = -x * this.serverXSign(); // distance into the target box from the central service line
    return into > 0 && into <= this.court.serviceLineFromNet + w && across >= -w;
  }

  /**
   * 6.1-6.2: the server's own area, behind the service line, between the (prolonged) central line and the side
   * wall. The ball has not "crossed" a line while it still touches it.
   */
  private inServerArea(x: number, z: number): boolean {
    const h = this.teamHalf[this.serveTeam];
    const w = this.court.lineWidth / 2;
    const back = z * h; // distance from the net into the server's half
    const across = x * this.serverXSign();
    return back >= this.court.serviceLineFromNet - w && across >= -w;
  }

  // ---------------------------------------------------------------------------------------------------------------

  private beforeStrike(f: Fact): Decision | null {
    switch (f.k) {
      case 'toss':
        if (f.player === this.server) this.tossed = true;
        return null;
      case 'floor':
        // The serve's preliminary bounce (6.2): it must be within the box the server serves from.
        this.tossed = true;
        this.tossBounceOk = this.inServerArea(f.x, f.z);
        return null;
      case 'whiff':
        // 6.6: an intentional attempt to hit the ball is a serve; missing it is a fault (7.1.b).
        return f.player === this.server ? fault('7.1.b') : null;
      case 'strike':
        if (f.player !== this.server) return null;
        // 7.1.a: the server infringes rule 6, points 1 to 6.
        if (!f.feetOk) return fault('7.1.a'); // 6.1 stance, 6.3 lines, 6.4 a foot on the ground
        if (!this.tossed || !this.tossBounceOk) return fault('7.1.a'); // 6.2 must bounce it, in their own box
        if (!this.inServerArea(f.x, f.z)) return fault('7.1.a'); // 6.2 ball over the service or centre line
        if (f.y > f.waist) return fault('7.1.a'); // 6.4 at or below the waist
        this.startServe();
        return null;
      default:
        return null;
    }
  }

  private startServe(): void {
    this.phase = 'serveFlight';
    this.isServe = true;
    this.serveNet = false;
    this.hitTeam = this.serveTeam;
    this.lastStriker = this.server;
    this.good = false;
    this.netSinceStrike = false;
    this.outside = false;
    this.ballHalf = this.teamHalf[this.serveTeam];
    this.corner = null;
    this.contactsSinceBounce = 0;
    this.pendingTouch = -1;
  }

  /** The serve is struck and has not landed yet. */
  private serveFlight(f: Fact): Decision | null {
    const servers = this.serveTeam;
    const receivers = 1 - servers;
    switch (f.k) {
      case 'net':
        this.serveNet = true; // 9.1.a: judged when it lands
        return null;
      case 'cross':
        this.ballHalf = f.to;
        return null;
      case 'floor':
        if (this.inTargetBox(f.x, f.z)) {
          this.serveBounced();
          return null;
        }
        return fault('7.1.c'); // also a net serve that lands outside the box (9.1.a needs it in the box)
      case 'wall':
        // A serve bouncing in the angle of its box and the wall bounced in the box (14.1.i read for the serve);
        // at the mesh that same touch is the fence before the second bounce (7.1.e).
        if (f.y <= CORNER_Y && this.inTargetBox(f.x, f.z)) {
          if (f.surface === 'mesh') return fault('7.1.e');
          this.serveBounced();
          this.corner = { x: f.x, z: f.z };
          return null;
        }
        // 6.5: it must pass over the net and bounce in the box; any wall first means it did not land there.
        return fault('7.1.c');
      case 'exit':
      case 'object':
      case 'stuck':
        return fault('7.1.c'); // it will not have bounced in the box
      case 'body':
        if (this.serveNet) return replay('9.1.b'); // after the net it hit a player: "net", repeat
        if (f.player % 2 === servers) return fault('7.1.d'); // the server or partner
        return this.lose(receivers, '8.5'); // a receiving player before the bounce: point to the server
      case 'strike':
        // A racket is "an article carried" (9.1.b) / "object carried" (7.1.d) / "their rackets" (8.5).
        if (this.serveNet) return replay('9.1.b');
        if (f.player % 2 === servers) return fault('7.1.d');
        return this.lose(receivers, '8.5'); // the receivers volleyed the serve (8.1: wait for the bounce)
      case 'playerTouch':
        if (this.pendingTouch < 0) this.pendingTouch = f.player;
        return null;
      default:
        return null;
    }
  }

  private serveBounced(): void {
    this.phase = 'live';
    this.good = true;
    this.contactsSinceBounce = 0;
  }

  /** The serve after its bounce in the box, and every shot of the rally after it. */
  private live(f: Fact): Decision | null {
    const ht = this.hitTeam;
    const rt = 1 - ht; // the team that must return the ball
    const rtHalf = this.teamHalf[rt];
    const oocOk = this.court.outOfCourtPlay;
    const serveNet = this.isServe && this.serveNet;

    const corner = this.corner;
    this.corner = null;
    if (corner && f.k === 'floor' && Math.hypot(f.x - corner.x, f.z - corner.z) < SAME_TOUCH) return null;

    switch (f.k) {
      case 'floor': {
        this.outside = false;
        if (!this.good) {
          // 14.1.b/e: it must bounce in the opponents' court; 13.1.l: on its own side it loses.
          if (halfAt(f.z, this.ballHalf) === rtHalf) {
            this.good = true;
            return null;
          }
          return this.lose(ht, '13.1.l');
        }
        // The second bounce. A net serve that landed in the box without touching the fence is "net" (9.1.a).
        if (serveNet) return replay('9.1.a');
        return this.lose(rt, '13.1.c');
      }

      case 'wall': {
        if (!this.good) {
          if (halfAt(f.z, this.ballHalf) === rtHalf) {
            // 14.1.i: the angle where the wall joins the ground counts as a bounce in the court. The mesh is the
            // fence, not a wall, so a low touch of the opponents' mesh is still 13.1.g.
            if (f.y <= CORNER_Y && f.surface === 'glass') {
              this.good = true;
              this.corner = { x: f.x, z: f.z };
              return null;
            }
            // 13.1.g: their walls or fence before the bounce; 13.1.h: the same after touching the net.
            return this.lose(ht, this.netSinceStrike ? '13.1.h' : '13.1.g');
          }
          // Own side: the walls are allowed (14.1.b), the metallic fence is not (13.1.l).
          if (f.surface === 'mesh') return this.lose(ht, '13.1.l');
          return null;
        }
        // 7.1.e: a serve that touches the metallic fence before the second bounce is a fault, net or no net
        // (9.1.a only makes it "net" if it does not touch the fence).
        if (this.isServe && f.surface === 'mesh') return fault('7.1.e');
        this.contactsSinceBounce++;
        return null; // 12.3, 14.1.c: any part of the court after the bounce keeps the ball in play
      }

      case 'net':
        if (!this.good) this.netSinceStrike = true; // 14.1.e
        else this.contactsSinceBounce++; // 12.4: the net and posts are parts of the court
        return null;

      case 'cross':
        this.ballHalf = f.to;
        return null;

      case 'strike': {
        const t = f.player % 2;
        if (serveNet) return replay('9.1.a'); // a net serve that landed in the box: replayed whoever touches it
        if (t === ht) {
          // 12.1: the pairs hit alternately. 13.1.i: the same player twice; 13.1.o: both partners.
          return this.lose(t, f.player === this.lastStriker ? '13.1.i' : '13.1.o');
        }
        // 13.1.f: volleying before the ball has come over the net into the striker's half (only before the
        // good bounce: after it, 14.1.g lets them play it over the other side too).
        if (!this.good && halfAt(f.z, this.ballHalf) !== rtHalf) return this.lose(t, '13.1.f');
        if (f.outside && !oocOk) return this.lose(t, '13.1.p');
        // 8.1 / 3.1: the serve is returned by the receiver; their partner playing it loses the point.
        if (this.isServe && f.player !== this.receiver) return this.lose(t, '8.1');
        // A correct return (14.1.a-j). The serve was valid, so a touch held during it now decides (12.2, 13.1.a).
        if (this.isServe && this.pendingTouch >= 0) return this.lose(this.pendingTouch % 2, '13.1.a');
        this.startShot(f.player, f.z);
        return null;
      }

      case 'body':
        if (serveNet) return replay('9.1.b');
        if (f.player % 2 === ht) return this.lose(ht, '13.1.j'); // the hitter or partner
        return this.lose(rt, '13.1.k'); // an opponent's body: a correct return (14.1.a)

      case 'exit': {
        this.outside = true;
        this.ballHalf = halfAt(f.z, this.ballHalf);
        if (!this.good) {
          // Out without bouncing in the opponents' court: over their walls (13.1.g/h) or over its own (13.1.l).
          if (this.ballHalf === rtHalf) return this.lose(ht, this.netSinceStrike ? '13.1.h' : '13.1.g');
          return this.lose(ht, '13.1.l');
        }
        if (this.isServe) {
          // 7.1.f: bounced in the box and straight out through the door, with no out-of-court play.
          if (f.door && !oocOk && this.contactsSinceBounce === 0) return fault('7.1.f');
          if (serveNet) return replay('9.1.a'); // landed in the box, never touched the fence
        }
        // 13.1.d: no out-of-court play: out after a good bounce, over any wall or through a door, ends the point.
        // The team that had to return it loses (14.1.d: a correct return).
        if (!oocOk) return this.lose(rt, '13.1.d');
        // 13.1.e with out-of-court play: over the END wall after bouncing correctly, the point is decided at
        // once, against the team that had to return it (it is listed as their point lost, like 13.1.d, and
        // 14.1.d calls a ball that bounces and goes out a correct return).
        if (isEndWall(f.wall) && !f.door) return this.lose(rt, '13.1.e');
        // Over a side wall or out through a door it stays in play (rule 16): they may go out and return it.
        return null;
      }

      case 'enter':
        this.outside = false;
        return null;

      case 'floorOutside':
        if (!this.good) return this.lose(ht, '14.1.j'); // a return from outside that never came back in
        if (serveNet) return replay('9.1.a');
        return this.lose(rt, '13.1.e'); // the second bounce, outside (13.1.e)

      case 'outerWall':
        // The outside of the court's own walls is not "an element not related to the court" (13.1.e).
        return null;

      case 'object':
        if (!this.good) {
          if (this.outside) return this.lose(ht, '14.1.j');
          // 13.1.g/h: an element not related to the court over the opponents' half; 13.1.l over its own.
          if (this.ballHalf === rtHalf) return this.lose(ht, this.netSinceStrike ? '13.1.h' : '13.1.g');
          return this.lose(ht, '13.1.l');
        }
        if (serveNet) return replay('9.1.a');
        if (this.outside) return this.lose(rt, '13.1.e'); // outside: it touched an element not related to the court
        return this.lose(rt, '14.1.d'); // bounced, then the ceiling or lights: a correct return

      case 'stuck':
        if (!this.good) {
          if (this.ballHalf === rtHalf) return this.lose(ht, this.netSinceStrike ? '13.1.h' : '13.1.g');
          return this.lose(ht, '13.1.l');
        }
        if (this.isServe && f.where === 'meshHole') return fault('7.1.e'); // it touched the fence
        if (serveNet) return replay('9.1.a');
        return this.lose(rt, f.where === 'meshHole' ? '15.1.a' : '15.1.b');

      case 'playerTouch':
        if (this.isServe) {
          if (this.pendingTouch < 0) this.pendingTouch = f.player;
          return null;
        }
        return this.lose(f.player % 2, '13.1.a');

      default:
        return null; // toss, whiff (no rule outside the serve)
    }
  }

  /** A correct return by `player`: a new shot, still to bounce in the other court. */
  private startShot(player: number, z: number): void {
    this.isServe = false;
    this.serveNet = false;
    this.pendingTouch = -1;
    this.hitTeam = player % 2;
    this.lastStriker = player;
    this.good = false;
    this.netSinceStrike = false;
    this.corner = null;
    this.ballHalf = halfAt(z, this.teamHalf[this.hitTeam]);
  }
}
