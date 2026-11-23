# Roads

Roads are chains of road pieces (kind `ROAD`) the player lays; each piece is a building with joins (`road_conn`, see `roadline.rs`). This note covers what roads are *for* and how they look (`roadnet.rs`, `web/src/render/road*.ts`).

## Surface (tier) and design (options)

* A piece's `tier` is its **surface**: 0 dirt, 1 gravel, 2 cobbles, 3 flagstones (`max_tier(ROAD)` is 3). `upgrade_road(idx)` resurfaces the whole **stretch** the piece belongs to (`road_stretch`: pieces joined piece to piece, up to and including a junction piece with three or more neighbours, never through one) to the next surface, one cost for all its pieces (`road_upgrade_cost`: 1 stone for gravel, 3 stone + 1 plank for cobbles, 5 stone + 2 planks + 1 brick for flagstones, per piece).
* A piece's `opts` is its **design**: bit 0 trees, 1 hedges and flowers, 2 benches (needs gravel), 3 lanterns (needs cobbles). `set_road_option(idx, bit, on)` sets it along the stretch (`road_option_cost`: 1 plank + 1 stone a piece). Purely for looks.
* Both are part of the state (they are the `tier` and `opts` of buildings, already in the hash and the snapshot). Commands: `upgrade` with `kind: 1` and `option` with `y: 1` act on the stretch; without them they act on the one building (old logs replay unchanged).
* `road_lines_flat` now has five numbers of header per line: `[kind, born, tier, opts, n, x, y, ...]`. The tier and design of a line between two joined things are the lower surface and the common design of its two ends.

## Roads and work

* `road_reach()` joins buildings by the roads laid between them (union over `road_conn`); a building is *joined to the castle* when its set holds the town hall. A plaza, gate or bridge is a link like any other building.
* A building that makes something (`cycle > 0`) which is not joined to the castle and stands outside the castle's yard (`CASTLE_YARD` = 14 beyond the hall's plot, so the opening of a game needs no roads) works at `UNROADED_PACE` (50%) of its pace. It is not a stop: the production-problem list gives reason 9, and `road_access_flat()` tells the client which buildings are served. Derived every tick from hashed state, nothing cached.
* People and soldiers already prefer roads: a road edge costs `ROAD_COST` (0.55) of its length in the path network and is walked `ROAD_SPEED` (1.35) times as fast, soldiers faster still (`march.rs`).

## Look

* One array texture holds the four surfaces; every mesh vertex carries a `mat` number (0..3). Where two surfaces meet, each ribbon runs into the *mean* surface of the roads at that place over `BLEND_LEN` units, so the shader (a noisy threshold between layer `floor(mat)` and the next) shows a ragged, gradual change; junction fans and dead-end caps take the node's surface, so corners and junctions blend too. A stub or the road under a gate takes the surface of the road it runs into.
* The verge is ragged (noise on the soft edge), the road is one width for every surface, flagstones and cobbles have kerb stones.
* The design (`roadplan.ts`) is planned from the lines alone: trees on both verges every ~8.5 units, hedges and flower beds close to the road, benches and lanterns alternating sides; clear of both ends of a stretch and of other roads. Lanterns light the night like the village's own.
