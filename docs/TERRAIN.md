# Terrain layers

The ground height anywhere is `World::height_from` (crates/game-core/src/lib.rs). It is built in layers, each one working on what the layers below left:

1. **Natural land** (`terrain::base_height_s`, from the seed).
2. **Flatten discs** (`World::levels`, command `flatten`, a testing tool in the dev panel): the ground eases to the chosen height inside the radius, over `LEVEL_BLEND` beyond it. A later flatten wins over an earlier one where they overlap. A flatten also
   - drops every Level ground patch that lies wholly inside the new disc (otherwise the old patch, applied on top, would bring its old height back), and
   - sets the footing (`pad_h`) of every building inside the disc to the new height (a standing building is never left on a pedestal or in a pit).
3. **Raise / lower pieces, moats and rivers** (`is_edit` buildings) dig *relative to the surface below*: a raising adds 2.2, a lowering takes 2.2, a ditch digs to its bed. The bed is `MOAT_BED` / `RIVER_BED` (below the sea) on ordinary ground; on ground higher than `CHANNEL_REF_TOP` (9) the bed rises by the excess, so a moat on a hill levelled to 24 is as deep as one at 9 and never a 27-high shaft.
4. **Level ground patches** (`World::flats`, command `level` with an optional height `h`, see flatten.rs): applied after the earthworks, so a pit or bump in the patch is made level. Ditch and earthwork pieces whose middle is inside the patch are removed with it. A ditch that is still standing (its middle lies outside the patch) is never filled in: the patch's pull is weighted by `1 - ditch` so the ditch keeps its full depth and the ground eases around it. Later patches win over earlier ones.
5. **Drawbridge banks** (levelled to the deck, on dry ground only).
6. **Roads** (graded, on dry ground only), 7. **building pads**, 8. **craters**.

Water follows: `compute_moat_water` samples the ground without ditches (layers 1–2 and 4) round every moat piece, so a moat's water level is always just under its lowest bank, whatever levelled it.

`level` commands carry `h` (negative or absent: Auto, the median of the dry land in a ring just outside the patch; otherwise 1 to 24, rounded to 1/16). `flatten` keeps its own height (`y / 10`, negative: the average of the land).

Raise Ground and Lower Ground also accept target heights from 1 to 24. An explicit height blends from the center of the piece into the surrounding ground and leaves standing ditches intact. It applies to a single placement or an entire pen stroke. Auto raises or lowers by 2.2 units, including when replaying commands without a height.

## What changed for old saves

Terrain is identical for every log that has no Level ground patch beside a standing ditch and no flatten over standing buildings (both were bugs). A ditch beside a patch used to be half-filled by the patch's shoulder; it is now intact. Moats on ground above height 9 now have a bed that rises with the ground (shallower than the old fixed bed); natural land that high is rare near a village.
