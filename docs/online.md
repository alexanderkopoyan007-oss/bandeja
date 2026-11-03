# Online play

Doubles over the internet for 2 to 4 people, with the AI in any empty seat. There's no game server: each browser runs the whole sim and swaps inputs with the others. No accounts, names or chat. The feasibility proof is in `docs/net-proof.md`; why each choice was made is in `DECISIONS.md` under "Online play (2026-11-02)".

## The two ways in

Both are on the menu under Online.

- **Find a match** puts you in the public queue. Everyone gets the same fixed match: doubles, one set to 4 games, golden point, level club AI in empty seats, default assists. It's built from the seed on each machine, so nobody's setup or settings shape it. You need someone else looking at the same time, and the search gives up after 10 minutes.
- **Create a match** makes a room with a five-letter code and a link to send. **Join with a code** takes the code. The links are `?room=CODE`. The host picks the setup as for an offline match and starts it.

`?online=new` and `?online=find` go straight to those screens.

## How a match works

The code is in `src/net/`.

- **`room.ts`** is a WebSocket to the room server. It finds the others and passes on start, go and seat messages.
- **`links.ts`** opens WebRTC data channels between every pair of players, unreliable and unordered. If a channel has been quiet for 1.5 s, packets go through the room server instead. A quiet channel is still pinged, which is how it comes back.
- **`session.ts`** is the lobby: seats, the host, the start message, ready, go. Only the host may send seats, start or go. A client accepts go once.
- **`rollback.ts`** is the rollback client from the proof. Each player sends their inputs a few ticks ahead (`delayFor`: 60% of the one-way time, 3 to 9 ticks). A tick with someone's input missing is guessed from their last hands, and when the real input arrives the sim rewinds and replays. It keeps a snapshot every 4 ticks and goes back up to 48 ticks (0.4 s).
- **`netMatch.ts`** ties it to the game: sending, receiving, comparing state hashes, keeping clocks together, and handing seats on.
- **`feed.ts`** gives the sounds and the HUD events that can't be unsaid. A rewind can take back a bounce, so a point call waits until the tick is confirmed.

If everyone can't be heard for 0.4 s the match holds and its clock stops. After 500 ms the HUD says "Waiting for the other players". Afterwards the clocks even out by a quarter of the gap each second, so nobody races.

State hashes are compared about twice a second. If two machines disagree the match ends with a message. It hasn't happened in any test on the final code.

## Players who go

Someone leaving doesn't end the match. The AI takes their seat on the same tick on every machine.

1. The room says they left, or they've been silent for 6 s (going from 5 s).
2. For 1 s everyone passes on the last 64 frames they hold for that seat, because they may each have heard different amounts.
3. The lowest remaining player names the tick and sends the frames. Everyone rewinds if they need to, and `sim.giveToAi` runs at that tick, in replays too.

If the host leaves, the room makes the lowest remaining player the host.

**The serve clock** is for someone who stays connected but has walked away. A person's serve needs a press, so they'd stop the match for everyone. `MatchConfig.serveClock` (20 s in public matches, 60 s with friends) gives the server's seat to the AI, and the HUD tells them why. It's in the sim, so it happens on the same tick everywhere. Offline it's off.

## The queue

`worker/room.js`, class `Queue`, one Durable Object for the world. Its only state is the open sockets.

- Players group by build version, then by distance from Cloudflare's rough location: within 2,500 km at first, 6,000 km after 10 s, 10,000 km after 20 s, anywhere after 35 s.
- Four go at once. Two or three wait 8 s for more.
- The figures are judgement. There's no real queue to measure yet.

## What a stranger can and can't do

Everything from another player is treated as hostile, because the host of a public match is a stranger.

- **Throw someone out:** no. Word that a seat has gone counts only once a client has seen the same itself, and word about your own seat is ignored. If the others really have given up on you they go silent in turn, and you play on with the AI in their seats.
- **Change the match:** no. A public match comes from the seed. A friend's start is checked (seats, delay, seed) before it's used.
- **Crash or freeze a page with a bad packet:** no. Packets are size-checked before decoding (256 frames at most, 240 ticks ahead at most, no gaps) and a bad one is dropped.
- **Speak for someone else:** no. A player can only send inputs for their own seat, apart from the passing-on in a handover.
- **Cheat in a rally:** partly. Inputs are the player's own, so a modified client can't move the ball or the score without splitting the hashes, which ends the match. It could still play with a bot's timing. Nothing detects that.
- **See your IP address:** yes. That's what a direct connection is, and the Find a match description says so. TURN with forced relay would hide it (see below).

The reviewer's 12 faults that led to these rules are listed in `DECISIONS.md`.

## The server and its limits

The Worker `bandeja-rooms` runs at `bandeja-rooms.alexander-kopoyan007-721.workers.dev` on Cloudflare's free plan, with one Durable Object per room and one for the queue. `worker/wrangler.toml` holds the bindings. It accepts connections only from the Pages site and localhost. Deploy from `worker/` with `CI=1 npx --yes wrangler@4.156.2 deploy`.

The free plan allows 100,000 requests a day on Workers and on Durable Objects, and 13,000 GB-seconds a day. Past a limit, new rooms fail until 00:00 UTC. Matches already connected directly carry on, because inputs don't go through the server, but handing on a seat does, so a player leaving could then end one.

- **Direct matches cost almost nothing.** A room sleeps once the match is running, and an open socket costs nothing while it sleeps.
- **Relayed matches are the expensive ones.** By the arithmetic, four players relayed all the time would use the day's requests in 73 to 90 minutes. This is the case when a pair of players' networks refuse a direct path. Cloudflare's free STUN server is used, and there's no TURN.
- **Each address may hold 4 places in the queue, and the queue holds 500.** The search stops at 10 minutes, and a client beats every 2 s only while someone else is waiting.

**TURN is optional.** It would connect players whose networks refuse direct paths without using the room server, and could hide IP addresses. It needs a key made in the Cloudflare dashboard under Realtime, TURN. The first 1,000 GB a month is free, then $0.05/GB.

## Tested

All on one Mac, with bots playing, in separate browser windows. Lag and loss are faked in the links for the local runs. The final-build rows ran against the deployed server, which is real for the room and the queue but still loopback between the players.

| Run | Result |
|---|---|
| 2 players, 80 ms, 2% loss, direct | round trip 220-226 ms, delay 9 ticks, 86 hashes agree, rewinds 12-14, deepest 13 ticks, longest replay 5.8 ms, no stalls |
| Same, forced through the server | round trip 239-246 ms, delay 8 |
| 4 players, 40 ms | round trip about 145 ms, delay 6, rewinds 46-65, deepest 15 |
| 3 players, 150 ms | round trip 341-365 ms, delay 9, deepest 24, longest replay 7.2 ms |
| Whole public match to the result, 2 and 3 players (local server) | every player has the same score, then all re-queue and the second match stays in sync |
| Final build, 2 players, menus and a typed code | window minimised 12 s: sim keeps going, no stalls. Either player cut for 3 s: note shown, recovers, hashes agree. Forged seat message: ignored. Cut for good: both sides play on with the AI |
| Final build, 4 players, 40 ms, queue, host quits | round trip 129-149 ms, delay 6, deepest 16. New host, AI takes the seat, hashes agree, ticks 1644 to 3364 in 15 s |
| Final build, 2 players, queue, host quits | the one left plays on, ticks 1648 to 3376 |
| Final build, 3 players, 80 ms, relayed, last player quits | round trip 246-265 ms, delay 8, deepest 19, longest replay 6.3 ms, hashes agree, ticks 1640 to 3361 |

Round-trip times read 40 to 60 ms above twice the fake lag.

Offline play was compared with the build before it, five 20 s runs of each, alternated, while other sessions loaded the machine. Medians were 14.0 v 12.4 ms on the laptop stand-in and 5.9 v 5.3 ms at High, with the ranges overlapping (9.3-14.8 v 10.0-14.8), and both held 120 Hz paced at the median. The offline frame only gains a few checks for an online match, so this reads as noise, but it hasn't been measured on a quiet machine. The memory check fails its 10-collection budget by one on the avatars run, 11 on both builds.

## Not tested

- **Two real networks.** Everything ran on one Mac. NAT traversal, real jitter and how often a direct path fails are unmeasured.
- **Firefox, Windows, x86.** The proof shows Chrome and Safari on arm64 match to the bit. A difference elsewhere would end the match with a message.
- **Anyone's hands.** Bots played every run. The moved timing cue, ball hops and the AI taking a seat haven't been judged by eye.
- **A real queue of strangers.** The grouping figures are guesses, and a queue only works if two people look at about the same time.

## Running the tests

`tests/net/` covers packets, the event feed, rewinds, dropped seats and the serve clock. `tools/net/online-e2e.mjs` plays real matches in real browser windows, through the one-Chrome lock:

```bash
npx vite build --outDir /tmp/dist-live --emptyOutDir
START_S=100 SECS=15 FIND=1 QUIT=host LINKS='[[4,40,0.02,0]]' REMOTE=1 bash tools/one-chrome.sh node tools/net/online-e2e.mjs /tmp/dist-live
```

`LINKS` is a list of `[players, lag ms, loss, relay]`. Other options: `WHOLE` (to the result and on to another match), `MENUS` (through the menus with a typed code), `FIND` (the public queue), `QUIT=host|last`, `HIDE` (minimise a window), `DROP` (cut connections), `REMOTE=1` (the deployed server, not a local wrangler), `BASE=<url>` (a deployed site, not a local build).
