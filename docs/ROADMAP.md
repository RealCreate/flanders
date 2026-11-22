# Flanders: ideas for what to add next

Written after reading the code (Rust core in `crates/game-core`, three.js client in `web/src`) and looking at what players praise in Banished, Manor Lords, Foundation and Stronghold ([roundup](https://www.gamesgraph.com/best/medieval/city-builder), [Manor Lords on burgage plots](https://www.pcgamer.com/games/city-builder/manor-lords-burgage-plot), [Manor Lords trade rework](https://www.pcgamesn.com/manor-lords/experimental-trade-rework)). The market research is thin (roundups and fan guides), so treat the "why" as a hypothesis, not proof.

## What the game already has

A deterministic core shared by every peer (no server), a production chain from ore to coin, plague, harvests and caravans, bandit raids, fire that spreads, field armies with real pathfinding, sieges (ladders, moat bridges), walls/gates/moats/drawbridges, ports, and a P2P layer with signed commands.
What is missing is mostly *reasons to care between fights*: people are a number, not families; trade is automatic; there is one kind of enemy; and nothing links villages except war.

## Plan, in order of value for effort

### 1. Make people matter (Banished / Manor Lords)
- **Families and ages.** Replace the single population number with households that grow up, marry and die. Houses get a "plot size" (Manor Lords' burgage plot idea: bigger plots hold more families or a workshop).
- **Professions and skills.** A woodcutter who has worked for a year is faster. Players see names on hover and can follow one villager.
- **Needs beyond food:** firewood in winter, clothing, ale, salt. A shortage costs happiness, not just stops growth.
- **Seasons that bite.** Winter halves farm output and raises fuel use; harvest day matters. The core already has day and season text.

### 2. Real trade between players (Manor Lords is reworking this now)
- **Market prices per village** that move with supply, so a village with iron and no grain trades with one that has the opposite.
- **Caravans you can send and escort** between two player villages, and that bandits can raid.
- **Treaties:** trade pacts, non-aggression, tribute. A shared world with only war is a short game.

### 3. Stronghold-style defence depth
- **Wall-walk fighting** now that guards patrol walls: archers on the wall walk, boiling oil, stakes in the moat, murder holes (the gate options already exist as design hooks).
- **Siege towers and rams** for attackers, and **sapping** (undermining a wall) as the answer to thick walls.
- **Morale and routing.** Armies that lose their leader or half their men flee; this keeps battles from being grinds.
- **Heroes/lords** with a name and a few abilities, so an army has a face.

### 4. A reason to explore the bigger map
- **Tunnels are in**; add **fords, passes and a road network** that caravans prefer, and **toll posts** that give the owner coin.
- **Neutral places:** abbeys that trade healing, ruined castles with loot, bandit camps to clear, mines that need a garrison.
- **Fog of war and scouts**, so the large map is not fully visible.

### 5. Events with choices (Banished's strength is hard choices)
- Replace "plague happens" with decisions: quarantine the sick quarter (lose output, save lives) or keep working.
- Famine, a bad winter, a travelling preacher, a noble's visit, heretics. Each offers 2-3 options with different costs.

### 6. Build-your-own-castle depth (what the user asked for)
- **Free-form roads and districts**: draw a road, get plots along it (Foundation's organic layout).
- **Wall editor improvements:** towers that snap onto wall corners, gatehouses with a tower either side, battlements that follow terrain, moat that fills from a river.
- **More option sets per building** (already four each): add a *second tier of options* unlocked by the building's tier, and a visible "style" per village (banner colours, roof tile palette).

### 7. Technical health
- **Performance:** the demo village takes about 8 s to place in the browser. Batch commands into one signed command, and move the road router to run once per batch.
- **Map streaming:** the terrain mesh is ~924 000 vertices. Add a distance LOD so a 2400-unit map stays smooth.
- **Replays and desync checks:** the core already has a state hash; show a warning when two peers disagree.
- **AI agent play:** the MCP server exists; add an `agent` scenario test that plays the first 20 minutes under the pace limit, as a regression check for the economy.

## Suggested order

1. Families + needs + seasons (changes the feel most, touches only the core)
2. Market prices + caravans (gives players a reason to talk)
3. Event choices
4. Wall-walk combat and siege towers
5. Neutral places, scouts and fog
6. Performance and LOD in parallel with any of the above

## Status of this plan

Done, each in its own pull request on top of the last: 1 families, ages, seasons and firewood; 2 market prices, caravans and treaties; 3 events with choices; 4 morale and routing; 5 neutral places and fog of war; 7 batch placement and an economy regression test. The follow-up pull request adds what those left open: a trade form (caravans, trade pact, peace), delivery and payment of caravans between players over the network (checked against the sender's copy, so nobody can push goods or print money), the "enter the place here" action for armies, and the wall pen on one batch command.

Added after that, each in its own pull request: heroes (a lord who leads the defence), boiling oil from hoardings, toll posts and scouts, and the pen with paths and figures. This last one adds streets of houses (the pen now works for houses, farms and gardens, so a path or a figure of houses is a district) and a village banner colour that every peer sees.

Still not done:
- 4: siege towers, rams and sapping (new attacker unit types).
- 6: a second tier of building options (each needs a new drawing), and free-form roads as a separate tool (paths still follow from the buildings).
- 7: terrain level of detail (needs a real browser), the demo village on the batch command, and an agent scenario test through the MCP server.
- Graphify's advisory remarks on `main.ts` (hubs `commit`, `updateHud`, `afterLocalChange`): `main.ts` is still one large file.

## Diplomacy, care and death (done)
Relations (−100..100) with every other village, envoys, marriage, alliances, declared war; chapels with weekly services and tithes; infirmary/hospital (beds, herb garden, quarantine ward); graveyards, burial plots and unburied dead (miasma); a population ledger (`population = 10 + arrived + born − enlisted − left − Σdied`) proven by a per-tick test.
Not done: gifts as a caravan flag, refusing caravans from hostile villages, MCP/agent tools for diplomacy.

## Footprints, deposits, test hall (done)
Buildings take more room as they are upgraded (`footprint(kind, tier)`: farms, keep, hall, chapel, barracks, court, market, store, hospital, graveyard); an upgrade is refused when neighbours are in the way, and hovering Upgrade outlines the bigger building and marks the blockers. Deposits can be cleared (40 wood, 10 tools); hand-drawn road pieces can be selected and demolished. The Test panel has a "Test hall" showing every building at every tier plus all design options.
Not done: the footprint is a circle (fields and courtyards are drawn inside it approximately); the demo village is only roomier, not redesigned.

## Production review and market research (2026-11)
**Research caveat:** a web search for what players want from comparable games returned mostly reviews and forum posts and no retention data, so these are hypotheses, not findings. Sources: [Farthest Frontier review](https://entertainium.co/2025/10/22/farthest-frontier-review/), [Manor Lords forum thread](https://www.rpgcodex.net/forums/threads/manor-lords-medieval-city-building-with-large-scale-battles.133844/page-12), [Manor Lords summary](https://vaporlens.app/app/1363080/manor_lords), [Farthest Frontier summary](https://vaporlens.app/app/1044720/farthest_frontier).

What the comparison suggests:
- **Production and farming depth** is what Farthest Frontier and Foundation are praised for (crop rotation, many resources); Manor Lords is criticised for thin production cycles and static animals. Flanders already has a long ore-to-coin chain; soil fertility and crop rotation are the cheapest depth to add.
- **Combat feel** is Manor Lords' strength and Farthest Frontier's weak spot (clumsy melee). Siege towers, rams and sapping (open above) matter more than more unit types.
- **No tutorial and late-game performance** recur as genre complaints. Flanders has gentle goals but no guided first ten minutes; a tutorial and a population soft-cap warning are worth doing.
- **Narrative** is missed in Manor Lords; events with choices and diplomacy put Flanders ahead. Naming and persisting notable villagers and lords builds on that.

Done in this review: save backup/restore, error and unsupported-browser screens, hardened multiplayer ([SECURITY.md](SECURITY.md)), a fuzz test of every network command, the first army no longer freezes the game (the navigation grid is built behind the loading screen), 14% smaller wasm, split bundle, CSP, CI audits and Dependabot.
**Done afterwards (2026-11, second pass):** a guided tutorial (`tutorial.ts`: 13 steps that complete from what the village has, outline the control to use, skippable, restartable from Help); replay and spectating (`replay.ts`: any signed history can be played, paused, rewound and scrubbed; your own from Display settings → Watch my history, other players from "Watch history" in the neighbours list; a test proves a replay reproduces the live village's state hash exactly); soil fertility and crop rotation (farms wear their soil down when sown every cycle, a fallow field recovers, Rotate rests and re-sows a field by itself; per-farm control in the selection panel); cross-checked battle loot (`ledger.ts`, see below); photo mode (F9: hides the interface, saves a PNG); an optional build-time TURN relay plus a hint when nobody connects; `main.ts` lost its command, goal and model-village code to `commands.ts`, `goals.ts` and `modelrunner.ts`.

**Still open:**
- Battle loot is checked only when a copy of the defender's village is held and its battle was played out live; a history loaded later (a late joiner's replay of an attacker's log) still takes the attacker's claim, limited by the core to what was sent and a raider's share of a full store. Closing that fully needs histories replayed together in lockstep.
- No TURN relay is configured by default (none that is safe to point every player at); set `VITE_TURN_*` at build time or per player.
- `main.ts` is still about 1 400 lines: the pen tool, trade/diplomacy handlers, selection panel and input still live there and share a lot of mutable state. The next cut would be a small `state.ts` holding that state so these can move out without long parameter lists.
- The replay UI was checked in a real browser by script, not by a person playing through.
- Tutorial (2026-11, third pass): 15 steps, one action each, in short sentences; defences (well, watchtower, barracks, archers) now come before the growth step, because raids can start on day 3. A scripted tutorial village: open `?world=tutorial` (fixed map, site 0); `web/src/tutorialvillage.ts` holds a build order, and `tests/tutorialvillage.wasm.test.mjs` (in `npm run test:demo`) replays it on the real core and checks the guide reaches its last step. That check runs the core headless; it is not a click-through in a browser. Soil is covered by one light step only.
- Next ideas: soil in the farm tooltip and a winter fallow bonus, replay of a battle from the defender's side.
