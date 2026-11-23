# Multiplayer delivery: no dropped commands, a connection that mends itself

Transport is unchanged (Trystero: Nostr relays to find each other, WebRTC data channels for traffic; see `TRANSPORTS.md`). What changed is everything above it. Before, a command was sent once to whoever was
connected at that moment: nothing confirmed it, nothing resent it, and a lost one was only noticed seconds later through the hash, which then cost a full history download and a full rebuild of the copy.

## Files

| File | What it is | Runs under plain node |
|---|---|---|
| `web/src/net/wire.ts` | message types, the signing key (`Identity`), `Hello` | yes |
| `web/src/net/validate.ts` | field-by-field checks of everything that arrives, `Sequence`, rate buckets | yes |
| `web/src/net/link.ts` | the delivery rules: `Inbox` (ordering), `Retx` (resending), `LinkMonitor`, `Backoff`, `Strikes` | yes |
| `web/src/net/room.ts` | `RoomCore`: introductions, histories, heartbeats, reconnecting, over a `Transport` | yes |
| `web/src/net/p2p.ts` | the Trystero `Transport` and `Room` (what the game uses) | no (imports trystero) |
| `web/src/update.ts` | "everybody plays the latest version" | yes |
| `web/tests/link.test.mjs`, `net.test.mjs`, `netsim.mjs`, `update.test.mjs` | unit tests, a simulated network with virtual time, chaos runs | |

## How a command is delivered

Every player has one history: their own signed commands, numbered `n = 0, 1, 2, …` inside an epoch. Everybody else keeps a copy.

* **In order, no gaps.** The receiver (`Inbox`) applies a command only when it is exactly the next number. One that is ahead of a gap is *held* (not applied, not dropped) and the missing range is asked for at once
  (`want {t:2, e, from}`). When the gap is filled, everything held behind it is released in order. Repeats and old commands are dropped quietly. Testing-tool commands (`cheat`, `flatten`, `demo`) are never applied
  by others but still count for the numbering, so they cannot look like a gap.
* **Acks.** Every 2 s each side sends a heartbeat `hb {ts, e, n}` carrying how far it has got with the *other* player's history. The sender keeps its history as the outbox (`myLog`); if the ack stops moving it sends
  what is missing again from the ack (`more`, pieces of at most 300 commands, each saying which number came before it so that a number that was never used is not mistaken for a gap). The wait doubles while nothing moves
  (1.5 s up to 12 s), so a peer that went away is not flooded. A lost command, a lost request and a lost answer all heal the same way.
* **Whole history only when needed:** the receiver knows nothing of the sender yet, it is in another epoch, or it is more than 1500 commands behind (one replay in a worker is cheaper than that many single commands).
  The state-hash check stays as the last resort for a copy that is complete but wrong.
* **Before the introduction.** A command that arrives before the sender's hello has been checked used to be thrown away (the hello waits for a signature check, the command does not). Now up to 400 messages wait and are
  looked at, in order, right after the introduction. A hello that was lost is repeated every 3 s until the other side answers with a heartbeat.
* **Memory by key.** What we know of a player (`Inbox`) is kept by their public key for ten minutes, not by their connection. A connection that drops and returns, even under a new peer id, costs the few commands
  missed in between, not their whole history and not a rebuild of their village on our side.

## A connection that mends itself

* **Liveness.** Any message proves the link is alive. After 6 s of silence a link is *weak*, after 12 s *lost*. The round trip comes from the heartbeat (`hbr` echo). The network status line and the village list show
  the ping and "connection unstable".
* **Reopening the room.** When no connection is working, the room is left and joined again: 3 s after every connection went quiet (growing to 1 minute), or every 20 s growing to 2 minutes when nobody has come at all.
  Not while the device is offline (the status says so), not while the page is hidden (its timers are unreliable). The page becoming visible, or the network coming back, sends heartbeats at once.
* **Short breaks are not news.** "X has left the world" is shown only if they are still gone after 8 s; a returning player is greeted only if they had been announced as gone. A leave from an old connection never
  marks someone away who is already back on a new one.
* **Strikes fade.** A peer that sends bad data is shut out for 5 minutes (not for the session); the score fades by 1 per 10 s, so a hiccup is forgiven. A bad signature counts triple, a malformed message once, an
  over-rate message a fifth.
* **Resyncs** after a hash mismatch are paced with a doubling pause (6 s … 2 min) and never given up for good.

## Everybody plays the latest version

* The build writes `version.json` (`{id, time}`) next to the game; it is never cached (`public/_headers`). A running page asks for it every 5 minutes, when it is shown again and 20 s after start. A deployed
  build that is different and newer makes the page save, say so, and reload itself 4 s later (`updateNow` in `main.ts`).
* The hello carries `b`, the time the sender's build was made. If another player's build is newer (higher `SYNC_PROTOCOL`, or the same protocol with different rules and a later `b`: `isNewerBuild`), the page updates
  itself the same way. A player on an older build is told that they have been asked to update; they get the same message from us and reload.
* A reload that did not bring anything new (a host cache) is not repeated for the same version for ten minutes (`mayReload`), so nobody gets stuck in a loop. Development builds have no id and never update.
* `SYNC_PROTOCOL` is **4**: the hello gained `b`, and the room speaks `hb`, `hbr`, `more` and an incremental `want`. Players on build 3 or lower see "different version" and are asked to reload.

## Testing

`npm test` runs `link.test.mjs` (the rules), `net.test.mjs` (the room on a simulated network: 30% loss with repeats and delays, reordering, hello overtaken by commands, drops and silent partitions, a link that returns
under a new id, tools in the history, restarts, garbage, ban and forgiveness, offline, rejoining, and a chaos run over six seeds) and `update.test.mjs`. The network simulation (`tests/netsim.mjs`) has virtual time: an hour
of play runs in a second.

Not tested here: real WebRTC and Nostr relays (the sandbox cannot reach them) and real browsers going to sleep. The `Transport` boundary is what a test double replaces; the Trystero adapter is about 25 lines.
