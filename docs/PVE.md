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
* The start screen has "Single player" (PVE: no network, only the computer villages) and "Multiplayer" (the shared world, with the computer villages added locally too); Single player starts a game with world name chosen as usual, with the two AI villages seeded from the world name.

## Determinism and desync checks

* Everything the AI decides is a pure function of `(world seed, AI seed, its own `World` state, a few numbers the page tells it about the target)`; the only randomness is the
  AI's own PCG stream (`Rng` in `ai.rs`, seeded from the world seed, the AI's index and its layout). No `HashMap` iteration, no wall clock, no `Math.random`.
* AI villages are **local only**: nothing of them is signed or broadcast, they are never part of `room` hello/hash messages, and `state_hash` of the player's village is unaffected
  (the AI never writes into the player's world except through the same `raid`/`goods`/`treaty` commands a remote human would, which are committed to the player's own log as usual).
  So `docs/DESYNC.md`'s replica checks do not see them, and replaying the player's log in another client reproduces the player's village exactly.
* PVE games run alone (no `Room` peers are expected); `AI villages` are rebuilt from `(seed, tick)` is **not** claimed: the AI's reaction depends on the player. Persistence is by
  `World::snapshot` + `Ai::snapshot`, kept next to the player's save.
* Tests (`cargo test -p game-core ai_tests`): all 10 layouts build up and differ from one another; the AI never has negative stock, never houses more people than its
  housing plus a small margin and never builds outside its land; the same seed gives the same state hash after N days and a different seed another; a snapshot of the world
  and of the `Ai` restored mid-game continues identically; most seeds raise a barracks, an army and towers within 25 days even though bandits raid them like anyone's; and an
  AI given a target sends an army to its border (`REQ_RAID`). `web/tests/pve.test.mjs` covers the page's choices (layouts, sites, keys, request decoding).

## How it plays (what the numbers are)

* Growth is paced by the calendar, not by a handicap: the AI only builds houses while `housing < 20 + 5·day + day²/10` and the stores can feed its people, one building every
  45–105 ticks (about 2–5 a day). Everything else (farms, woodcutters, sawmills, a barracks from day 2, towers from day 3, a market that lets it buy stone and tools, upgrades) is
  chosen from its real stocks, population and jobs. A village that is sacked by bandits (or by you) rebuilds from what is left.
* It raids on its own timetable: first after day 10 / 16 / 26 for a warlike / balanced / peaceful ruler (seeded), only against a target its army can beat (what it can see of
  your soldiers and towers), sooner when you attacked it (`relation < -30`). A quarter of its soldiers stay home.
* Marching and fighting use the real machinery. The AI forms a field army in its own world and marches it along the invisible road (`link_village`, laid at setup in both
  directions) to just outside your border; when it arrives the page starts the raid in *your* world exactly as for a human attacker (`defendAgainst`: a `raid` command in your
  own signed log), and when the battle report comes the survivors and loot go home (`Ai::returned`). If you are away or the village cannot be attacked the army is turned back
  (`Ai::refused`).
* Diplomacy: it sends envoys every few days (unless it is hostile) and offers a trade pact once its own relation allows it, at most one offer in ten days. As in multiplayer, the
  receiver decides: you accept when `treaty_acceptable`, which depends on *your* relations (send envoys to the computer to warm them; the computer answers your offers by the same
  rule from its side). With a pact it sends surplus grain or stone as caravans, which you pay for like any partner's goods.

## Saving

A PVE game has its own save slot (`...:pve`) with your village's signed history as usual. The computer villages are not part of that history: on loading they are made again
from the world name (same layouts, same sites) and **grown up to your tick** before the game starts (a few seconds for a month of game time). Their exact state therefore may differ
from the session before the reload (they did not see your attacks); that is deliberate for this first version (see below).

## Not in this first version

* Computer villages are not saved themselves (`World::snapshot` + `Ai::snapshot` exist and round-trip in tests; storing them next to your save is the obvious next step).
* The AI keeps no memory of who raided whom beyond the world's `relations`, does not scout, and raids only you (not the other computer village).

* The AI does not use sieges beyond what its barracks tier allows, and has no naval or tunnel tactics.
* AI villages do not move sites and are not shown in the multiplayer peer list as people.
