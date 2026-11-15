# Out of sync: what causes it, what the game does about it

Every player keeps a copy (a "replica") of every other village and replays that player's signed command log into it. The owner broadcasts a hash of their state every tick;
a copy that disagrees used to show "out of sync ⚠" and stay that way. This note records the investigation and what changed.

## Method

* Read the whole path: `Room` (`web/src/net/p2p.ts`), the handlers in `connect()` (`web/src/main.ts`), `applyCmd`/`stepTo` (`commands.ts`), `Village.advanceTo`, `World::state_hash`.
* Core determinism by experiment: `crates/game-core/tests/replay_sync.rs` records busy sessions (buildings, batches, soldiers marching through woods and felling trees, links, drawbridges, gates, raids,
  about 500 commands over 2500 ticks, 60–285 trees felled) in one world, then replays the log in other worlds with different habits: silent, "drawn" every tick (every query the renderer makes: `det_flat`,
  `det_path`, `road_paths_flat`, `net_route`, `walk_route`…), drawn now and then, queried only at the end, built far from the origin. State hashes are compared **tick by tick**, and the paths the replica ends
  with are compared with the owner's. All of it agrees.
* Message ordering by experiment: `web/tests/desync.test.mjs` drives a copy with the real core and the real judging code, feeding the messages in the orders the network can produce.

## Not causes (checked)

* **Hash containers.** The only `HashMap`/`HashSet` in the core (`road_cache`, `used` in `rebuild_roads`, `at_cell` in `march.rs`) are looked up or inserted into (the one `retain` does not depend on order). No wall-clock time or
  randomness reaches the simulation (`Math.random`/`Date.now`/`performance.now` in `main.ts` only drive visuals, ids and the "while you were away" catch-up, which steps the world deterministically).
* **Caches.** `net_cache`/`ov_cache` stamps cover buildings, levels, craters, links, felled trees, bridges and the road count; the replay test above (with a replica whose caches are empty, or filled at other moments)
  gives equal hashes and equal paths. `route_stamp` (the per-route `road_cache`) does **not** include `felled`, `bridges` or `links`; no divergence could be provoked, so it is recorded here as a latent risk.
  It was not widened: felled trees change all the time and the cache is what keeps building big villages cheap.
* **f32.** Every client runs the same wasm build; there is no native/wasm mix.
* **Step cadence.** One tick is one `step()`; how many are run per frame (`acc`, the hidden-tab worker clock) changes nothing in the world, only when commands are issued, and that is the tick the world has.

## Causes found

1. **A hash could overtake the command before it.** Commands go through an async queue (signature checks); `hash` was handled at once. Owner: command at tick 20, hash of tick 21. Copy: hash first, runs on to
   tick 21, then applies the command at tick 21, a tick late, for good (the test `the cause: …` shows the two worlds differ). Also made every command sent right before a hash look like a desync.
   *Fix:* hashes go through the same per-peer queue; and the copy never runs past a command it does not have yet (see "How a copy judges a hash").
2. **False mismatches inside a tick.** `stepLocal` commits (`checkArrivals`, `pollTrade`) *before* it broadcasts the hash, but the command is signed and sent later: the hash holds an effect the copy cannot have yet.
   *Fix:* the hash carries the number of commands the owner has issued; the copy waits until it has them.
3. **Lost commands were invisible.** A history that is older than a command whose live copy was dropped (the live command arrives before the hello and is ignored) leaves a gap nobody noticed; later commands
   apply on top of it. *Fix:* command count in the hash (`lost` after 5 s) and an automatic re-fetch of the history.
4. **A player who moved to another site** (`moveToSite`, two players on one spot) only re-sent a hello: copies replaced the village with an *empty* world at the new site and never got a history. *Fix:* the copy
   is rebuilt from the history it has and the history is requested again.
5. **Our own army fighting in an away village** (`attackAway`, `stepAwayFights`) changes the copy locally, so it can no longer match the owner. *Fix:* the copy is marked "under your attack" and not judged;
   it is rebuilt from their history when they come back. Likewise when the loot ledger corrected a claim on purpose.
6. **Testing tools** (`cheat`, `flatten`, `demo`) change the owner's village but peers refuse to replay them: always a desync for the others. *Fix:* announced in the hash (`tools`), shown as "testing tools in use".
7. **Silent non-comparison.** `onHash` returned early whenever the hash was more than 2 ticks ahead of the copy's last message, so after a lost or rate-limited hash the sync label simply froze. Replaced by the
   rules below.
8. **Silent wrong-tick application.** `advanceTo` stopped after 4000 steps and `stepTo` after 20000 and then applied the command anyway, at the wrong tick. *Fix:* `advanceTo` reports whether it arrived (limit
   8000; a command that is further ahead is not applied but triggers a re-sync); `stepTo` only guards against nonsense (2 000 000).
9. **Builds with different rules.** Marching, felling, links and paths changed recently: an old log replays differently on a new build, and nothing said so. *Fix:* see "Versions".

## How a copy judges a hash (`web/src/net/sync.ts`)

The owner sends `{ tick, hash, c, p, tools }`: the tick, the state hash, how many commands of their history others replay, the hashes of the sections of the state, and whether testing tools were used.

* `c` above what the copy has applied → *wait* (the copy is **not** advanced); after 5 s → *lost* → re-sync.
* Copy ahead of the hash's tick, or an old build's hash (no `c`/`p`) → *stale*, nothing is judged. A copy that cannot get to the tick (big jumps are rationed, capped at 8000 steps) → *behind*.
* Equal count and tick → compare. Equal → *match*. Different → *mismatch* with a `Diagnosis`: the tick, the sections that differ, the last tick and command count that matched, and the ops of the commands applied since
  (the first divergence is among them).

Sections (`state_hash_part_names()`): `core` (clock, random stream, people), `stock`, `buildings`, `deposits`, `links`, `army`, `soldiers`, `diplomacy` (relations, treaties, caravans and the journeys on the road with their departure and arrival ticks), `land` (felled trees, bridges, levels, craters), `battle` (every soldier's position, hit points, army, sogginess; and for bosses their maximum hit points, kind, name, phase and the horn and slam clocks; the boss of the fight and the lair it is in).
`World::state_hash()` is the fold of these; it now also covers the random stream and the full felled/bridge/level lists.

## What the game does

* Mismatch or lost commands → toast "Re-syncing with <name>…", `want` message asks the owner for their history again (the owner only ever answers, at most once every 5 s; your own village is never changed
  by anybody else's hash).
* The history arrives → the copy is rebuilt, the next comparison decides: "Back in sync with <name>." or, if the freshly rebuilt copy still differs, "Could not sync with <name>: their history plays out differently
  here, so they are probably on another version of the game or using testing tools." (No retry: replaying their own log did not help.)
* Rate limits: at least 6 s between requests, at most 4 in 10 minutes, then it gives up quietly and tries again after 5 minutes.
* Counters per player (desyncs, re-syncs, last diagnosis with tick, sections and commands) in the performance panel (F3, "Multiplayer sync") and in the console: `flandersSync()` and a `console.warn`
  at every new desync.

## Versions

`hello` carries `v` (`SYNC_PROTOCOL`, bumped when the hash message or hello changes) and `rules`: `rules_fingerprint(seed)`, the hash of a small scripted game (buildings, soldiers marching through woods, a raid)
played by this build's core. Any change that makes a log play out differently changes it, with nobody having to remember to bump a number. Players whose `v` or `rules` differ are shown "different game version",
are not judged, and get one calm toast. Saved villages record both; a village saved by another build logs a warning when loaded (the history is replayed with the rules of the build that loads it).
Both fields are checked in `validate.ts` (`sanitizeBuild`, `sanitizeHash`); the room id did not change, so builds still meet (and say so).

## Waterwheel placement

No new state. The waterwheel's snap to the bank (`waterwheel_snap`) is computed on the clicking client only and the *result* travels in the `place` command (x, y, rot), like the drawbridge's; `place` itself refuses
a wheel that does not hang over water for that turn (`wheel_in_water`, -16) and levels the pad no higher than `WHEEL_PAD_MAX`, so every copy replaying the log checks and builds the same thing. Changing
`WHEEL_REACH` or the pad cap changes the rules fingerprint, as it should.

## Left as it is

* The `return` ledger correction (a deliberate difference when an attacker's claim does not match the battle the copies saw).
* Villages that used testing tools stay un-replayable for others by design.
* `route_stamp` (latent, see above).
