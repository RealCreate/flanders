# Flanders balance review

One farm covered the opening on all 12 sampled sites when the village built one extra house. Adding a second house before expanding food production caused shortages on six sites. All completed first-year runs lost villagers to war with no player response to raids.

## Opening with per-person rations

The audit runs the actual game core on 12 fixed seeds. Each run uses the starting site closest to the map center, the same selection the game makes for the first player. The script places an affordable build order at tick zero using ordinary placement checks and the Fishing Hut’s bank snap. It samples food each tick and compares villages after two completed days, before bandits can arrive.

| Opening | Built on sampled sites | Population | Meals remaining | Sites with an empty larder | Sites with hunger deaths |
| --- | ---: | ---: | ---: | ---: | ---: |
| Hall only | 12/12 | 8 | 1–30 | 12 | 0 |
| One house and one farm | 12/12 | 13 | 83–283 | 0 | 0 |
| Two houses and one farm | 12/12 | 18 | 8–85 | 6 | 1 |
| One house and two farms | 12/12 | 13 | 590–600 | 0 | 0 |
| One house, farm, bakery and woodcutter | 12/12 | 12–13 | 237.5–456 | 0 | 0 |
| One house, farm and Hunter’s Lodge | 12/12 | 13 | 323–523 | 0 | 0 |
| One house, farm and pasture | 12/12 | 13 | 363–563 | 0 | 0 |
| One house, farm and Fishing Hut | 0/12 | — | — | — | — |
| One house, two farms, woodcutter and haystacks on one farm | 12/12 | 13 | 591–599 | 0 | 0 |

An empty larder means the stock held under one meal for at least one tick. The old formula increased demand from 240 to 480 meals per day at 15 mouths. The new formula moves from 336 to 360 meals per day. With two houses and one farm, shortages fell from 11 sites to six. One site had a hunger death with the new formula. A fully staffed tier-zero farm on fresh soil can produce up to 300 spring meals per day, before soil wear and other conditions.

Pastures and hunting use a separate meat stockpile when grain reaches the 600-unit limit. Pastures ran without a shortage on all sampled sites during the two-day opening. In winter, herders need grain for feed and stop using it at the player's reserve. A tier-zero bakery can add up to 90 net meals per day while consuming up to 30 wood if it stays staffed and supplied. A tier-zero fishing hut can add up to 120 meals per day. The placement search found no buildable fishing spot at the sampled starting sites.

## First-year stress test

The 40-day run includes natural raids, fires, disease and default event responses. The script issues no orders after the opening build. One-farm, two-farm, and farm-plus-pasture villages recorded war deaths on all 12 sites. Hunger killed villagers on four one-farm sites, four two-farm sites and five farm-plus-pasture sites. The results combine food shortages with raid damage and lost workers.

Two farms without a woodcutter started winter with 60–98 wood. The same opening with a woodcutter and one set of haystacks started winter with 267–600 wood. Both groups needed 24 wood per day at that point. The initial hall replenishes a small amount of wood when stock runs low, and no sampled run recorded a cold death.

## Player controls and remaining balance questions

- Grain and firewood reserves keep automatic processing, livestock feed and trade from spending stock earmarked for meals and heating. The audit used the default zero targets. [Farthest Frontier resource guide](https://www.farthestfrontier.com/guide/gameplay/resources/) · [Against the Storm rationing update](https://eremitegames.com/rationing-update/)
- The bandit warning now pauses the local countdown by default and can station ready archers in nearby defensive buildings. The first-year results measure unattended losses. Active defence, bribes and competitive multiplayer still need separate playtests.

## Reproduce

From `web/`, run the following commands. If the Node WASM already exists from a recent `npm run test:demo`, start with the third command.

```sh
wasm-pack build ../crates/game-core --target nodejs --release --no-opt --out-dir ../../web/tests/.wasm
node -e "require('node:fs').writeFileSync('tests/.wasm/package.json', JSON.stringify({ type: 'commonjs' }))"
node --experimental-strip-types tools/balance-audit.mjs
node --experimental-strip-types tools/balance-audit.mjs --year
node --experimental-strip-types tools/balance-audit.mjs --legacy
```

Add `--json` for per-seed records, including the first raid-warning tick and stocks just before winter. The audit reports incomplete building plans separately.
