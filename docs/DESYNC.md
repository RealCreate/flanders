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
* **Caches.** `net_base` (the path network without roads), `net_cache` (the same with the roads marked on it) and `ov_cache` have stamps that cover buildings, levels, craters, links, the state of gates and drawbridges, the terrain version, and (`net_cache`, `ov_cache`) `road_sig`, a fingerprint of the roads. The roads are derived state: `rebuild_roads` routes them over `net_base` (never over the marked network, so they do not depend on their own earlier value), and `link_village` rebuilds them because the links are part of the network. `route_stamp` (the per-route `road_cache`) is the network's own stamp plus the two buildings: the route depends on nothing else (felled trees and soldiers' bridges are not part of the network). A replica whose caches are empty or filled at other moments gets the same roads: `replay_sync` compares `road_paths_flat` after every habit. The only `HashMap`s used for roads (`road_cache`, the `memo` of `RoadCtx`) are looked up and inserted into, never iterated.
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

## Armies and water: lent drawbridges and soldiers who do not wade

A new rule set, all of it a pure function of the world's state, run once per tick by every copy in the same place (`World::step`: after `march_step` and `defence_step`; the fight's own movement in `battle_substep`).
No new command exists: the player's `bridge` command (`drawbridge_set`) is the only input, and it is already in `PEER_OPS` and checked in `validate.ts`.

* **Lent drawbridges** (`crates/game-core/src/lend.rs`). A drawbridge's `status` is part of the hash (buildings section; it was not before): 4 lowered, 5 drawn up by hand, 6 lowered for an army (was up),
  7 lowered for an army during a battle (was lowered; every drawbridge counts as drawn up in a battle). `progress` of a drawbridge (otherwise unused, and hashed) is its timer: for a lent one the seconds nobody
  has needed it, for one drawn up by hand the seconds (`VETO_SECS` = 120) in which no army may lower it.
* **Who needs a drawbridge:** a travelling army or group whose route ahead runs over the deck within 20 units, or that is on or within 5 units of the deck; soldiers in the fight who stand on a deck or have
  chosen it as their crossing (`World::db_want`, filled by the battle's substeps and consumed in `drawbridge_step` of the next tick; it is empty between ticks, so it is not part of the hash).
* **Raised again** 4 s after the last need (1 s in a battle, so raiders get no time). A manual raise (`drawbridge_set(.., true)`) wins: status 5 with a 120 s hold, and armies whose route ran over the deck are
  re-planned at once (`replan_over_deck`, deterministic: ascending army order). A manual lowering sets status 4 and no timer. Raiders never get dry feet from a lent deck: `bridge_points` and `Battle::fixed` do
  not include drawbridges, so the raiders' wading rule is unchanged.
* **Routes:** for armies (not villagers) the deck of a drawn-up, not vetoed drawbridge is dry ground (`Ov::deck_up`, part of the overlay cache key together with the battle flag and the veto state); otherwise
  water is bridged (`S_BRIDGE`) or ferried as before. The same planning serves marches, sallies, defence marches and reinforcements.
* **In the fight** own soldiers (`Battle::own_walk`) never step into water: a straight way is taken only if it is dry, otherwise they walk to the nearest bridge, soldier-built bridge or drawbridge (asking for
  it), cross, and go on; with no way over they wait at the water's edge. Raiders wade as before.
* Gates: left as they are. A shut stone gate (status 5, or any in a battle) is not opened for armies.
* Tests: `lend_tests.rs` (bridge lowered, crossing on the deck, raised again, manual raise wins, planks for a narrow moat, ferry for a wide one, nobody of ours in water, raiders get no bridge) and
  `replay_sync.rs::a_moat_a_lent_drawbridge_and_a_defending_army_replay_identically` (owner and replicas agree tick by tick, silent / drawn every tick / drawn now and then).
* Rules and hashes differ from older builds (a drawbridge's status is hashed now, and defenders across a moat play out differently), so builds with and without this show "different game version" to each other, as designed.

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
