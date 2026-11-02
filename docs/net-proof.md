# Can BANDEJA be played online?

A feasibility check on branch `net-proof`, 2 November 2026, on the game at `b6e9bd9`. Nothing here is shipped.

## Verdict: works, with named changes

Rollback netcode works on this game. Two copies of the real game stayed on one match at every link tested, nothing crashed, and rewinding is cheap. The sim needed one fix (below). The work left is mostly around the sim: a connection layer, and making sound, banners and cues cope with a past that can change.

- **Recommended input delay:** 25 ms (3 ticks) on a good connection, 50 ms (6 ticks) at 80 ms one way, 75 ms (9 ticks) at most. As a rule: 60% of the one-way latency, kept between 3 and 9 ticks.
- **Playable range:** comfortable to about 80 ms one way. 150 ms stays in sync, but the ball jumps nearly 3 m and points are sometimes called and taken back.
- **The two costs a player would notice:** the ball hops forward when the other player hits it, and input delay moves the timing window off the ring. Both have small fixes (section 3).
- **Not proven:** nothing has run across two real networks, on Windows or x86, or in Firefox. Nobody has played it by hand (section 6).

## 1. Cross-browser determinism: passes on what was tested

12 full matches, each run from the same seed and scripted inputs, with `MatchSim.hash()` compared every 120 ticks. The set covers 1, 2 and 4 humans, a pair, singles, women, left-handers, all-AI, and one windy, hot, 900 m match on a hard panoramic court.

| Engine | Matches identical to Node 24 | Ticks | Samples | Hits | Points |
|---|---|---|---|---|---|
| Chrome 156 (headless) | 12 of 12 | 2,265,505 (5.2 hours of play) | 18,896 | 6,808 | 1,421 |
| Safari 27 | 12 of 12 | same | same | same | same |
| Firefox | not run: not installed | | | | |

- **First divergence:** none, in any engine, on the final code.
- **One real bug, found by the rewind check:** the first `NetCloth` built in a climate settled the net in its constructor and left `quiet` and `h` non-default. They sat in the hash until the ball first touched the net. Fixed in `src/sim/court/netCloth.ts`. **This fix is only on this branch and has to reach the main line.**
- **History:** the same matches run in reverse order, and each in a fresh process, are 12 of 12 identical.
- **In the sim itself:** no inexact `Math` calls, clock reads or `Math.random`.

All of this ran on one Mac (arm64). The older `tools/det-probe.ts` runs agreed across macOS arm64, Linux arm64 and Linux x64, but those are short runs, not full matches.

## 2. Rewind safety: passes, over the GC budget

Each of the 12 matches ran twice: straight through, and on guessed inputs with rewinds to a snapshot followed by true inputs.

| Measure | Result |
|---|---|
| Rewinds on wrong guesses | 78,820 |
| Rewinds across points, faults and match end | 1,714 |
| Presses missed by the guess and replayed | about 12,158 |
| Full-object comparisons, every field | 3,160 |
| Hash differences after the `NetCloth` fix | 0 |
| Field differences after the `NetCloth` fix | 0 |

**State that doesn't survive:** none after that fix. Only `world`, `cfg`, `tuning`, `spec`, `def`, `court`, `surfaces` and `TIMING` were left out of the comparison, because they never change in a match.

**Cost:** `copyFrom` takes 0.17 ms, a 12-tick rewind about 0.3 ms, and a tick 0.012 ms on average (p99 0.3, max 5.6). A snapshot sim builds in 8-35 ms, so the ring is built before play starts.

**GC over 100,000 ticks (about 14 minutes):**

| Snapshots | Scavenges | Longest | Mark-compacts | Longest | Total pause |
|---|---|---|---|---|---|
| None | 11 | under 1 ms | 0 | | 1 ms |
| Every 4 ticks (recommended) | 573 | 0.6 ms | 25 | 4.1 ms | 84 ms |
| Every tick (120 a second) | 1,013 | 0.5 ms | 76 | 1.4 ms | 165 ms |

So 120 copies a second does break the rally GC budget of 10 per 100,000 ticks, by about 100 times, and it breaks "no GC in a rally". It costs 2% of a core, and no single pause gets near a frame. The likely cause is `copyState`'s `Object.keys`, `Map` and boxed doubles, but this wasn't profiled. Generated per-class copiers should fix it.

## 3. Render under rewind: nothing breaks hard, four things show

**Harness:** the built game in two windows of one Chrome, packets over `BroadcastChannel`, held at the far end to fake the link: 2% loss, jitter of ±15% of the latency. Each window runs one human seat on scripted hands that release within ±45 ms of contact, with two AI players. Each window predicts the other and rewinds on a late input. Replays were off, and both windows shared one start clock. 120 s per setting.

| One way | Delay | Hashes agree | Rewinds/s | Depth p50/p95/max (ticks) | Replay p99/max (ms) | Step + rewind per frame p99/max (ms) | Ball hop max (m) | Hops over 0.5 m in 2 min | Body hop max (m) |
|---|---|---|---|---|---|---|---|---|---|
| 0 ms | 3t | 243/243 | 0.1-0.8 | 4/5/6 | 0.8/1.1 | 0.9/4.9 | 0.19 | 0 | 0.00 |
| 40 ms | 3t | 243/243 | 2.8-3.1 | 5/7/9 | 2.4/3.1 | 1.1/4.7 | 0.99 | 4-6 | 0.01 |
| 80 ms | 6t | 244/244 | 3.0-3.1 | 6/8/10 | 2.9/4.6 | 1.1/5.6 | 1.39 | 4-9 | 0.03 |
| 150 ms | 9t | 243/243 | 3.1-3.2 | 10/13/15 | 4.0/5.4 | 1.2/5.6 | 2.36 | 1-2 | 0.09 |

Across all four settings: no stalls, no frames that had to skip time, no page errors or console errors, and the score never went backwards. Frame times were the same at every setting, including 0 ms (p50 16.7 ms, p99 about 33.5 ms, 4-6% over 20 ms). That comes from two windows sharing one GPU, not from rollback, whose own cost is the step + rewind column.

**Longer runs in Node:** 600 s, same client, timed hands. Hashes agreed 1196 of 1196 at every setting, with no stalls.

| | 40 ms, 3t | 80 ms, 6t | 150 ms, 9t |
|---|---|---|---|
| 2 people: ball hop max | 0.73 m | 1.44 m | 2.93 m |
| 2 people: hops over 0.5 / 1 m a minute | 0.4 / 0 | 2.8 / 0.8 | 2.3 / 1.5 |
| 2 people: a remote hit seen late, p95 | 25 ms | 50 ms | 75 ms |
| 2 people: points shown then undone | 0 | 0 | 1 |
| 4 people: rewinds a second | 9.0 | 9.0 | 8.8 |
| 4 people: ball hop max | 0.82 m | 1.24 m | 2.56 m |
| 4 people: hops over 0.5 / 1 m a minute | 2.5 / 0 | 4.1 / 0.8 | 5.6 / 3.9 |
| 4 people: points shown then undone | 2 | 3 | 6 |

### What shows, by part

**Ball: shows in most rallies.** You learn of the other player's hit late, so the ball is already on its way and jumps forward by its speed × (latency − delay). The fix is to ease the correction in the ball's view. By arithmetic, an 80 ms ease at 60 Hz shows 19% of a 1.4 m hop on its first frame, 0.27 m, while a 30 m/s ball already moves 0.5 m a frame. Not built or measured.

**Timing cues: the biggest change to how it feels.** The ring closes on the sim's clock, but a release lands the delay later. Measured with hands that release on the cue, about 700 hits per row, about ±4 points:

| Release within | Delay | Cue moved? | Perfect | Good or better |
|---|---|---|---|---|
| ±45 ms | none | | 64% | 78% |
| ±45 ms | 3t (25 ms) | no / yes | 57 / 63% | 74 / 80% |
| ±45 ms | 6t (50 ms) | no / yes | 22 / 40% | 67 / 76% |
| ±45 ms | 9t (75 ms) | no / yes | 10 / 38% | 55 / 79% |
| ±80 ms | none | | 48% | 71% |
| ±80 ms | 3t (25 ms) | no / yes | 51 / 49% | 71 / 72% |
| ±80 ms | 6t (50 ms) | no / yes | 19 / 27% | 62 / 75% |
| ±80 ms | 9t (75 ms) | no / yes | 16 / 28% | 57 / 73% |

Moving the cue earlier by the delay restores Good or better. It doesn't restore Perfect above 3 ticks, and I haven't established why. The likely reason is that the planned contact still moves in the last 50 ms, after the release is committed. Also, the plan and ring for an incoming ball only appear once the late hit arrives, so a player loses 25-75 ms of warning.

**Sound: rare errors, only at high latency.** Sound reads events as they happen and can't take one back. In two windows at 150 ms, one wrong rally in 2 minutes gave one window one hit and a swing that never happened, and it never played a floor bounce, a wall hit or two whiffs. At 40 and 80 ms there was one missed event in each run, and neither was a hit, bounce or point. Over 600 s at 150 ms: 1 ghost hit and 1 missed hit with two people, 6 and 7 with four.

**HUD: the numbers correct themselves, the banners don't.** The score is read from the sim every frame, so it is always right. Banners, the announcer, stats and the crowd read events, so a point shown then undone stays shown. The table above counts those. In the two windows at 150 ms, one window never showed one point's event at all, though its score ended right.

**Avatars: fine at the recommended delays.** Real avatar code, driven by a rollback client, 6 seeds × 60 s:

| One way | Delay | Pops per player-minute |
|---|---|---|
| 0 ms | 3t | 17.4 |
| 40 ms | 3t | 17.5 |
| 80 ms | 3t | 18.1 |
| 80 ms | 6t | 15.3 |
| 150 ms | 6t | **28.5** |
| 150 ms | 9t | 19.1 |

Too little delay shows at once: 344 of the pops at 150 ms on 6 ticks were in the ready pose. At the recommended delays bodies hop 1-9 cm at most on a rewind (11 cm with four people at 150 ms). A remote player's swing starts late by latency − delay, the same as the ball.

**Timing and the loop:** no problem on one clock. It would break on a real one in the ways listed below.

### What must change

Line counts are estimates.

| Change | Where | Size |
|---|---|---|
| Rooms, WebRTC channel, clock sync, build-version check, dropped-player rule | new `src/net/`, one small Worker | Large: 500-800 lines |
| A confirmed-events feed, so banners, announcer, stats and crowd wait for all seats' inputs and sound can react at once | new file, plus about 5 lines at each of the 10 event cursors | Medium: about 200 lines |
| Ease ball and body corrections | ball and player views | Small: about 60 lines |
| Move the ring and timing bar earlier by the delay | `render/views.ts`, `ui/hud.ts` | Small: about 10 lines |
| Real keys into the client, and carry `aimAbs`, `aimTX`, `aimTZ`, which mouse aim needs and the proof client drops | `tools/net/rollback.ts` moved to `src/net/`, `game.ts` | Small: about 30 lines |
| `assist`, `timingScale` and `autoTiming` are one value per match: agree on them, or make them per seat | `src/sim/match.ts` | Small to medium |
| Replays record one human and pause the match: record every seat and draw them without stopping the sim, or switch them off online | `game/replay.ts`, `game.ts` | Small: about 30 lines |
| Pause, a lost tab and a lost pad can't stop a shared match: a hidden tab stalls the other player after 0.4 s | `game.ts`, `app/` | Medium: about 100 lines |
| `MAX_TICKS_PER_FRAME` throws time away after a hitch: online it must catch up | `game.ts` | Small: about 10 lines |
| Swap hashes in the packets to catch a desync | client | Small: about 30 lines |
| Per-class snapshot copiers, for the GC budget | `sim/core/copyState.ts` | Medium: about 100 lines |
| The `NetCloth` fix to the main line | `src/sim/court/netCloth.ts` | Done here |

## 4. Input delay

Use the rule at the top: 60% of the one-way latency, 3 to 9 ticks, with the cue moved by the same amount.

- **Why not less:** 150 ms on 6 ticks took pops from 17 to 28.5, and hops grow with the gap between latency and delay.
- **Why not more:** Perfect falls fast above 3 ticks, even with the cue moved. Players under about 50 ms one way should sit at 3 ticks, where it holds at 63%.
- **Both players must use the same delay:** it's part of the match's settings, so agree on it at connection, from the measured latency.
- **Snapshot every 4 ticks, go back 48 ticks at most, repeat past frames in each packet.** No setting came near 48 ticks.

## 5. Free hosting

The game stays on GitHub Pages. It needs three things beside it. All checked against each provider's documentation on 2 November 2026.

| Need | Recommended | Free allowance |
|---|---|---|
| Finding each other (signalling) | Cloudflare Worker with a Durable Object per room | [Workers: 100,000 requests a day](https://developers.cloudflare.com/workers/platform/limits/). [Durable Objects: 100,000 requests and 13,000 GB-s a day, SQLite storage only; past a limit operations fail; resets 00:00 UTC](https://developers.cloudflare.com/durable-objects/platform/pricing/). [No duration billed while hibernating](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) |
| Learning your public address (STUN) | `stun.cloudflare.com` | [Free and unlimited](https://developers.cloudflare.com/realtime/turn/faq/) |
| Relay when no direct path exists (TURN) | Cloudflare Realtime TURN | [First 1,000 GB a month free, shared with the SFU, then $0.05/GB](https://developers.cloudflare.com/realtime/sfu/pricing/). [Billed on data from Cloudflare to the client; credentials last 48 hours at most](https://developers.cloudflare.com/realtime/turn/faq/) |

Packets go over a WebRTC data channel set to [`ordered: false, maxRetransmits: 0`](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/createDataChannel), so a lost packet is dropped rather than resent. The proof's packets already repeat past frames for that reason.

- **Traffic, by arithmetic, not measured:** 60 packets a second at about 120 bytes is about 7 kB/s each way, so a fully relayed 20-minute match for two is about 17 MB. 1,000 GB is about 58,000 such matches. Published figures for how many sessions need a relay are secondary estimates, such as [up to 17.7%](https://openvidu.io/blog/2026/06/09/turn-key-considerations/).
- **Before relying on it:** Cloudflare's pricing page doesn't say whether TURN needs a card or a paid plan, and past 1,000 GB it charges. Check that when the account is set up.
- **Backup relay:** [Metered Open Relay gives 20 GB a month with a sign-up](https://www.metered.ca/tools/openrelay/). It states no uptime promise.
- **Workable but not needed:** [Firebase Realtime Database's Spark plan caps at 100 simultaneous connections](https://firebase.google.com/docs/database/usage/limits?hl=en).
- **Not recommended, relaying game packets through the Durable Object:** [incoming WebSocket messages count 20:1](https://developers.cloudflare.com/durable-objects/platform/pricing/), so 60 a second each way for 20 minutes is 7,200 requests, about 13 matches a day, and WebSockets resend in order, so one lost packet holds up the rest.
- **Not relied on, PeerJS's free cloud server:** [its docs](https://peerjs.com/docs/) state no limits or uptime.

## 6. What couldn't be tested

- **Two real networks.** Everything here is a fake link on one machine. It has no burst loss, latency spikes, Wi-Fi drops, NAT or a real relay, and loss was an even 2%.
- **WebRTC itself.** `BroadcastChannel` carried the packets.
- **Clock sync.** Both windows shared one clock, so drift and a bad latency estimate are untested. So are hitches on one side, as none happened.
- **Firefox.** Not installed. x86 and Windows have no full-match run either. Hashes on those are the biggest open risk: one last-bit difference ends a match.
- **People.** The hands are scripted. Nobody has played this, felt 50 ms of delay or judged the hop by eye. The percentages say what timing does; they don't say whether it is fun.
- **Looks and sound by ear.** Everything here is counters, plus one still of each window confirming each draws its own end with the same score. Nobody watched a hop or listened to a ghost hit.
- **Four people in a browser.** Four-seat figures are Node only.
- **Safari under rewind.** Safari ran the hash check, not the two-window harness. GC was measured in Node, not in a browser.
- **Whole matches online.** Two windows ran for 120 s per setting and Node for 600 s.

## 7. Run it again

```bash
bash tools/one-chrome.sh node tools/net/hash-run.mjs node chrome safari
node tools/net/history.ts
node tools/net/rewind.ts
node tools/net/alloc-rewind.mjs
node tools/net/link-sim.ts 600
node tools/net/anim-rewind.ts
node tools/net/grades.ts 3000
npx vite build --outDir /tmp/dist-net && bash tools/one-chrome.sh node tools/net/tabs-run.mjs /tmp/dist-net 120
```

`tests/net/rewind.test.ts` holds the two promises in the suite: a rewind changes nothing, and two clients agree over 80 ms with 2% loss. All 716 tests pass on this branch. `game.ts` and `main.ts` have a few added lines for the harness; they aren't meant to ship as they are.
