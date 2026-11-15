# Combat and army review

Written on branch `combat-review-and-defence` (cut from `mcp-headless-and-polish`, built on the attack-banner commit `e884b46`). First half: how combat works. Second half: what was changed and why. Every number that sets how hard combat bites lives in one block at the top of `crates/game-core/src/battle.rs` ("Tunables") and, for the client, `SIEGE_*` at the top of `web/src/render/field.ts`.

## 1. How combat works

### One battle sim, owned by the defender
A village world holds at most one `Battle` (`military.rs`). Raiders come from three places, all through `begin_battle(atk, angle, tag)`: the random bandit roll in `World::step`, the `cheat` test tool, and `start_raid` (another player's field army; `tag` is that player's id, 0 = bandits). Every peer has a copy of every village and replays its signed command log, so the fight is a pure function of the village state and the RNG: all peers see the same battle, and `state_hash` includes the units' positions and hit points.

For a player-versus-player attack the *defender's* client is authoritative: the attacker's `sendatk` command arrives, the defender's `defendAgainst` (main.ts) calls `start_raid` on their own world and commits a `raid` command; everybody (including the attacker) replays that. If the owner has left, `attackAway` runs the raid on the attacker's local copy and `stepAwayFights` ticks it. When the battle ends the report (`last_report`) feeds `onLocalReport` / `onRivalReport`, and the attacker's survivors and loot come home through a `return` command, checked against the ledger.

### Inside `battle_substep` (4 sub-steps of 0.25 s per tick)
* Units: side 0 defenders (standing army at posts on walls/towers near the attackers' side, tower archers, hall guards, militia = population/5, max 14, plus perks), side 1 attackers in a block `build_radius + 22` out at `angle`.
* AI: every unit goes for the nearest enemy within aggro (26 attackers, 34 defenders, shorter for held posts), otherwise attackers walk to the nearest building (catapults keep 15 units from foes and shell buildings; defenders drift back to their post). Archers hit 72 % of the time, melee always. Damage is reduced by armour and 20 % on a wall.
* Morale: a side that has lost much of its strength sends hurt soldiers running for 7 s; they leave the field alive (`fled`).
* Barriers: walls, fences and gates are in `bars`; an attacker that bumps one climbs it (spearmen and swordsmen only, fences at once, walls and gates with a ladder: one ladder per four spear/swordsmen, at most one climber per ladder, boiling oil on a hoarding hurts them) or hacks at it.
* Water: moats and rivers are `wet`; attackers enter them, are marked `wading`, cannot fight, move at `WADE_SPEED` and take extra damage.
* Siege: attacking catapults shell the nearest building (3.2 x damage, craters, fire, forest fires); defending catapults shoot back.
* Fire (`fire_substep`): burning buildings lose hit points, spread to neighbours within range (wind, flammability by tier, wells halve the chance), may start forest fires, and are fought by villagers (population/6, max 8) only when a well is near.
* End: attackers all gone / defenders all gone for 14 s (pillage) / 170 s. `finish_battle` removes fallen army units from `army`, loots, reports, hero xp.

### Field armies (`march.rs`, `military.rs`)
`Det` = a field army: `det_form` takes soldiers out of `army`, `det_march` plans a route over one graph (grid of 2.5-unit cells for the whole world + the village path network), walks it a tick at a time (felling trees on the way, bridging narrow water, ferrying wide water), `det_send` hands an arrived army to an attack (`away`), `return_army` brings survivors home. `det_*` are the only command entry points; `main.ts` mirrors each with a `commit`.

### Client
* `web/src/render/army.ts` draws the battle from `battle_units_flat` (stride 10) and `take_shots`; rafts for wading raiders; `field.ts` draws marching armies (each soldier steers along the army's trail) and catapults.
* `main.ts`: `doAttack`/`doAttackSelected` form and march; `checkArrivals` sends an arrived army in; `defendAgainst` / `attackAway` start the raid; `onRivalReport` / `onLocalReport` finish it; `battleBanner` shows the fight.

### What was wrong before
1. The defender could do nothing: the army stayed at its posts, field armies were ignored by the sim, and `doAttack` refused to march during a raid.
2. Wading raiders crawled at 0.3 and took double damage, but archers still missed 28 % and they were dry again the moment they left the water.
3. The banner told you the direction but the camera never went there.
4. The attacker had no way to retreat and a second army sent to a running fight was simply refused.
5. Catapults used the footpath network and the foot soldiers' slope limit in the middle of ordinary routes, and the client strung them out in a file hundreds of units long (`colBack = members * GAP`), blending straight-line formation with the trail, which cut corners over cliffs and water.
6. Fire jumped 11 units at 28 %/s and burnt 4 + 14 x flammability hit points a second: a thatched house was gone in about 12 s. Fighters were useless without a well, and a well did nothing by itself.
7. Infantry hacked at stone walls (0.7 x damage) when they had no ladder.

## 2. What changed

### Defending raids (core `battle.rs`, `march.rs`; client `main.ts`, `defence.ts`)
* **A field army can be sent to the fight**: new command `defend` (`det_defend`): the army marches to a point just short of the nearest attacker and, once within `JOIN_REACH` (26) of any attacker, its soldiers join the defenders' side of the same battle, free of posts (`Unit.det`, `Det.defend`, state `S_FIGHT`). `defence_step` runs once per tick, after `march_step`, so it is part of the deterministic sim. Soldiers that die are gone; at the end of the fight survivors (including those who fled alive) become the army again, idle where they stood. `det_recall` (or `march`) in the middle of a fight pulls the soldiers out of the battle first. Splitting, merging, halting and sending an army that is in the fight are refused.
* **The standing army can sally**: `det_form` during a fight takes living soldiers out of their posts (`battle_release_army`), then `defend` sends them. The standing army that stays still defends the walls as before.
* **Reinforcements**: a second `sendatk` from the same attacker during a running fight is no longer refused; the defender's village adds the soldiers (`battle_reinforce`, committed as `reinforce`).
* UI: the banner has buttons (Send armies out, Sally out, Retreat), right-clicking the raiders with an army selected sends it, the field view shows an engaged army's banner but lets the battle draw its soldiers.

### Same rules for player-versus-player (point 4)
An attack on an online player is a raid by a field army, with the same options on both sides: the defender sends armies and the standing army out; the attacker can `retreat` (command `retreat` with `to` = defender; the defender's client runs `battle_retreat` and commits the result with `tag`, so every replica routs the attackers on the same tick) or send more soldiers (`reinforce`). Against an away village the attacker's own copy runs the battle and retreat is local. The attacker watches the same battle because he replays the defender's commands, which now include `defend`, `retreat` and `reinforce`. The test `a_replica_replaying_the_commands_sees_the_same_battle_hash_for_hash` replays the commands on a second world and compares `state_hash` every ten ticks.

### Wading handicap (point 2)
`WADE_SPEED` 0.3 -> 0.15, `WADE_KNIGHT` 0.18 -> 0.08, `WADE_DAMAGE` 2 -> 3, arrows hit a wading raider 97 % of the time (`WADE_HIT`, otherwise `HIT_CHANCE` 72 %), and for `SOAK_SECS` (5 s) after leaving the water raiders are sodden: speed x 0.6, damage x 0.6. Client: rafts wallow and sit lower, soaked raiders get a grey-blue tint. (Design choice: a sodden period instead of a flat weaker-everywhere rule keeps dry land balanced.)

### Banner and camera (point 3)
Builds on `battle_angle()` and the compass banner of `e884b46`. A click on the banner text moves the camera to the attackers (`foeFocus`). New setting "Jump to raiders" (off by default, Settings > Overall) moves it by itself on the tick a raid on your own village begins (`shouldAutoJump`).

### Catapults (point 5)
Core: a siege route looks for the widest road first: level 3 keeps one cell (2.5) clear of cliffs (slope > 0.85), water, buildings, walls and fields; failing that level 2 (terrain and water only), then level 1 (the old rules). The village footpath network is not used by siege engines. Slope limit 0.85 and "dense forest needs felling" are unchanged. Client: catapults ride two abreast in a short column (`SIEGE_*`) on the very path the head took, in a block behind the ranks when standing; a target in water or on a steep face falls back to the middle of the path; position is pushed out of buildings and trees, a step into water is undone, height follows the higher of the two ends of the frame and changes at a bounded rate, and the model tilts with the slope. Test: `a_catapult_never_crosses_cliffs_water_or_buildings_on_a_long_march` marches a siege train to eight places up to ~300 units away and checks every tick that it is not in water (unless on a bridge or ferry), not on a slope above 1.1, not inside a building.

### Fire (point 6)
`FIRE_DAMAGE` 0.4 x the old rate, `FIRE_SPREAD` 0.28 -> 0.1 and `FIRE_RANGE` 11 -> 9, forest-fire spawn and growth about halved. Stone does not burn: stone walls (tier >= 2) have flammability 0 and cannot be set alight; gatehouses 0.04 (oak doors); stone and great-stone buildings 0.12 / 0.06 (were 0.22 / 0.12). Wells: each well within 18 adds `WELL_CREW` (2) of bucket-chain help even with nobody told to man it (at most two count) on top of the firefighting villagers; each well beside a building halves the chance of a spark taking (at most two). Staffed builders' yards within 45 add `BUILDER_CREW` (3) each (at most two). Help takes 6 % per point off the damage, at most 75 %. Measured over 30 s on a burning thatched house: bare 216 hp, with a well 56, with builders 58.

### Walls (point 7)
`is_stone(kind, tier)`: WALL and GATE with tier >= 2. Foot soldiers (spearmen, swordsmen, archers, knights, militia) deal no damage to them and no longer pick them as targets: spearmen and swordsmen need a ladder (one per four, as before), archers and knights slide along the wall looking for another way. Timber walls and fences (tier 0/1) are still hacked down by infantry and burn. Catapults still smash everything. A shut stone gatehouse is a stone bar, so its doors need catapults. **There is no ram unit**: the unit list has five kinds and adding a sixth changes the army arrays in the core, `validate.ts`, the UI and the MCP tools, so rams are left as a follow-up; for now catapults are the only way through stone.

## 3. Things to know
* **Old saves and logs**: these changes alter the simulation (wading and fire numbers, stone rules, the siege route level search and anything that touches `state_hash`: `Det.defend`, `Unit.det`, `Unit.soak`). A command log recorded before replays differently, and a peer on the old build will report "out of sync" against one on the new build. Saved villages are rebuilt from their logs, so a village that was mid-raid or had catapults marching may come out different; the wasm in `web/` and `mcp/` must be rebuilt together.
* New commands `defend`, `retreat`, `reinforce` are in `PEER_OPS` (validated by `sanitizeCmd`) and applied in `applyCmd`. A `retreat` without `tag` is only a request and does nothing to the world it is applied to; the defender's client turns it into one with `tag`. A peer that ignores a retreat request keeps its raiders fighting (there is no server to force it), which only hurts the cheater's own attacker.
* Not done / follow-ups: no ram unit; the MCP tool set has no `defend` / `retreat` action; a "reinforce" button on the banner (reinforcement happens by sending another army with Attack); knights and archers that reach a stone wall with no way round circle until the 170 s limit.
* **Not checked by eye** (no screenshots were allowed): the look of the banner buttons, the catapult column, rafts and the grey-blue tint. Checked numerically: stone immunity, ladder use, handicap factors, fire loss, join/leave of armies, retreat, per-tick catapult positions on long marches, replica state hashes.
