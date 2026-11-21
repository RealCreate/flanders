# PVE mode: two computer-run villages

A PVE game is a normal world with your village and **two AI villages** on other sites. The AI villages are real `World`s: same rules, same stock, population, food, housing,
territory and building costs as yours. The AI has **no economy of its own**: it can only do what a player can do, by calling the same public `World` methods a signed command
would call (`place`, `upgrade`, `train`, `garrison_set`, `journey_start`, `caravan_send`, `det_form`, `det_march`, `det_send`, …). If a call is refused (cannot afford, no room,
no barracks) the AI simply waits.

## Where the code lives

* `crates/game-core/src/ai.rs`: the `Ai` controller (a wasm class, kept **outside** `World` so snapshots, `state_hash` and `rules_fingerprint` do not change).
  `Ai::new(seed, layout)`, `Ai::step(&mut World, tick)`; `Ai::layout_count()`; `Ai::snapshot()/restore()`.
  * `layouts`: 10 demo layouts (ring, grid, cross, crescent, riverside line, citadel, farmstead, walled square, spiral, twin hamlets). A layout is an **ordered wish list** of plots
    `(kind, dx, dy)` relative to the hall, grouped by role (housing, food, wood, stone, industry, civic, defence).
  * Build planner: every `PLAN_EVERY` ticks it looks at the village's real numbers (housing vs population, food reserve, stocks, jobs vs hands, day count) and picks **which role is
    most needed**, then takes the next unbuilt plot of that role in the layout, trying nearby spots when the exact one is blocked (and falling back to a ring scan for buildings that
    need a deposit or forest). One building at a time, and only if `can_place` says 0 (so territory, slope, water, obstruction and cost all apply). Upgrades follow once the
    basic set stands. This is what makes the village grow "slowly, by itself, from the start stock".
  * Military: once there is a barracks and the economy is stable the AI trains a mix by tier, researches upgrades, garrisons its towers and, when its army is big enough relative to
    what it knows of the target, **forms an army and marches** (`det_form`/`det_march`). When the army has arrived it asks the page to start the raid (see below). Raid timing,
    size and the choice of target all come from the AI's own seeded stream.
  * Diplomacy: envoys (20 coins, as for a player) every few days, then a trade-pact offer once relations allow, and caravans of surplus goods to a friend. Hostile personality
    (seeded) skips diplomacy and raids early.
* `web/src/pve.ts`: the glue. It owns the two AI `Village`s (as non-online rivals flagged `ai`), steps their worlds with the player's world (one `step()` per tick, followed by
  `Ai::step`), and carries out the things that cross villages the way the multiplayer code does it:
  * AI raid on the player: the same path as a human attacker's `sendatk`: `lv.world.start_raid_equipped` + a committed `raid` command, so the player's defence code is unchanged.
  * The player's attack on an AI village: the existing `attackAway` path (AI villages are never "online"), except that an AI village is stepped continuously, so it fights back with
    whatever it has trained, garrisoned and walled.
  * Envoys, treaty offers and caravans from the AI arrive at the player through the existing `onTrade` handlers; the player's own envoys and caravans to the AI are answered by the AI
    (accepts when `treaty_acceptable`, pays for goods).
* A menu option "Play against the computer (PVE)" on the start screen starts a game with world name chosen as usual, with the two AI villages seeded from the world name.

## Determinism and desync checks

* Everything the AI decides is a pure function of `(world seed, AI seed, its own `World` state, a few numbers the page tells it about the target)`; the only randomness is the
  AI's own PCG stream (`Rng` in `ai.rs`, seeded from the world seed, the AI's index and its layout). No `HashMap` iteration, no wall clock, no `Math.random`.
* AI villages are **local only**: nothing of them is signed or broadcast, they are never part of `room` hello/hash messages, and `state_hash` of the player's village is unaffected
  (the AI never writes into the player's world except through the same `raid`/`goods`/`treaty` commands a remote human would, which are committed to the player's own log as usual).
  So `docs/DESYNC.md`'s replica checks do not see them, and replaying the player's log in another client reproduces the player's village exactly.
* PVE games run alone (no `Room` peers are expected); `AI villages` are rebuilt from `(seed, tick)` is **not** claimed: the AI's reaction depends on the player. Persistence is by
  `World::snapshot` + `Ai::snapshot`, kept next to the player's save.
* Tests (`cargo test -p game-core ai::`): 10 layouts are distinct and each builds up; the same seed gives the same hash after N days; AI never has negative stock and never
  exceeds housing/food rules (population limited by housing, food reserve checked); a starved start does not "cheat" (no stock appears other than by production);
  the AI trains soldiers and forms an army; two different seeds diverge; snapshot/restore continues identically.

## Not in this first version

* The AI does not use sieges beyond what its barracks tier allows, and has no naval or tunnel tactics.
* AI villages do not move sites and are not shown in the multiplayer peer list as people.
