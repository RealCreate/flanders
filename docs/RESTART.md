# Restart: starting a village again from nothing

The player can pull their whole village down and begin again (Display settings, bottom of the panel: "Restart village…"). This note says what a restart is, what it resets, how
the other players' copies follow it, and what protects it. Code: `World::restart` (`crates/game-core/src/lib.rs`), `web/src/restart.ts` (the rules: epochs, archive, the dialog's
state machine), `web/src/ui/restartui.ts` (the dialog), `restartVillage` / `restoreArchivedVillage` / `onRivalRestart` in `web/src/main.ts`, epoch handling in `net/validate.ts`,
`net/sync.ts`, `net/p2p.ts` and `checkpoint.ts`.

## What a restart is

A restart is a **new epoch** of the village's history. A village's history is its signed command log. Epoch 0 is the log every village starts with. A restart is one signed command,

```
{ op: 'restart', tick: 0, n: 0, e: k }      // k = the previous epoch + 1
```

and it is the **first command of the new epoch**. The active history (what is saved, sent to other players, replayed by a newcomer, checkpointed) is from then on only that epoch: `restart`,
then the commands of the new life. Every command of an epoch >= 1 carries `e`. Numbers (`n`) and the clock (`tick`) start again with the epoch: the restart is `n` 0 at tick 0, the new life's
first command is `n` 1.

The core command is `World::restart()`: `*self = World::new(seed, ox, oy)` and the flag (`style`) put back. So the world after a restart is *exactly* the world a brand-new village starts as, the
clock back at 0. Nothing is cleared one field at a time, so nothing can be forgotten when a field is added later; `restart_tests.rs` compares state hash, every hash section and the snapshot bytes
with a new world. (A new field of `World` that is a plain `Vec` is reset by construction; one that must survive a restart has to be copied across in `restart()` on purpose.)

### What resets

Everything in the world: buildings, roads, walls, fields, bridges, every raise / lower / level / flatten piece and moat or river ditch (the `levels`, `flats` and ground that buildings of those
kinds shape), felled trees and groves, deposits (back to their first amounts and awake), stock and the market stock, people (population, children, elders, the ledger of births and deaths, graves),
soldiers, queued and away units, field armies, the lord, treaties, marriages, relations, envoys, caravans and journeys on the road, battles, wildfires, plague, ruins, craters and scorch,
fog of war, the season and the day count (a fresh start is tick 0, day 1), pending choices and moods. The tutorial starts again at its first step (it can be skipped), and the goals follow the new village.

### What stays

The village's **site** on the map (`ox`, `oy`), the **flag** (`style`: it is how the village looks on the map, so it is not a thing "touched"), the player's **name, key and identity**, and the
browser settings (sound, graphics, controls, the tutorial's choices). The player's own *saved history* is replaced by the new epoch, but the old one is archived (below).

### Relations and treaties with other players: decision

A fresh start means no treaties, no marriages and a neutral relation with everybody. Your own copy of your world has them cleared by the restart. Every other player's world keeps its own copy of
the agreement, which would otherwise outlive it on one side only: so when a player's copy of your village sees your restart (`onRivalRestart`), it **ends every treaty it had with you** with an ordinary
signed `treaty` end command in its own history (`{ op: 'treaty', idx: your tag, kind, y: 0 }`: the existing way to cancel), and shows a toast. Marriages and relations (how they feel about you)
are left alone on their side: nobody can end a marriage for someone else. The invisible roads between the villages (`link`) vanish with the restart, so each player's client re-links to every
village it knows after a restart (`chainTo`).

### What it refuses

Restart is refused (and the dialog says why) while the player's own village is in a **battle**, while any **army is away** (field armies, units out), while watching a **replay**, while a command is
still **being signed or saved**, and for 5 minutes after the last restart. (`restartBlocker` in `restart.ts`; the core itself restarts unconditionally, because a replica applies what the owner
signed and must reach the same state whatever the owner's client checked.) A raider's army that is in another player's village at the time of a restart is a case the refusal covers, since a
village with armies away cannot restart.

## The protocol

Owner (`restartVillage`):

1. Checks the blockers. Waits for every command that is still being signed.
2. **Archives** the active history (`flanders-archive` record: the whole signed log, site, name, tick, day, building count) in IndexedDB under `<save key>:archive`. One life is kept; an earlier archive
   is replaced. If the archive cannot be written (storage blocked or full) **nothing is changed** and the dialog says so.
3. Signs `restart` with epoch k+1, replaces the active log with `[restart]`, resets `n` to 1, the shared-command count to 1 and the "testing tools used" flag, and applies the command to its world.
4. Writes the new save, deletes the checkpoint (see below), broadcasts the restart command and a new hello, resets the screen (terrain pads, trees, deposits, selection, camera back on the town hall).

Replicas (`onCmd` → `onRivalRestart`, all in `net/` and `main.ts`):

* A live `restart` from the owner's key is accepted by `Sequence.classify` when its epoch is higher than the epoch the copy knows. Numbers and the clock of that sequence are reset to the command's
  (`n` 0, tick 0). The copy is rebuilt from `[restart]` alone (`loadReplica`), the replica's bookkeeping (`ReplicaTrack.restarted`) goes to epoch k with one command, and `r.log` is replaced: the old life's
  commands are dropped, not kept.
* Every hash message carries `e`. A copy judges a hash only inside its own epoch: a hash of a **newer** epoch than the copy has seen is "a command we are missing" (wait, then lost, then the usual
  re-sync: ask the owner for the history); a hash of an **older** epoch is stale. So a lost restart message heals by itself, exactly like any lost command.
* A command of a newer epoch than the copy knows (`gap`) is not applied and not punished: the copy asks for the history.
* A history (`log` message) must be one epoch: `Sequence.checkLog` cuts it at the first entry of another epoch or at a `restart` that is not first.

### Replay protection

* Everything is still checked against the owner's key before anything else: a `restart` signed by anybody else is a bad signature (the replica of village X only listens to X's key; `onHello` / `check`
  in `p2p.ts`). Only the owner can restart their village.
* **An old epoch cannot be brought back by replaying it**: a command with an epoch below the one a copy has seen is dropped quietly (`dup`), a `restart` with an epoch that is not higher is `dup` too,
  and a whole history of an older epoch (`acceptLog`) is ignored when the copy is already in a newer one. The epoch only grows. Inside an epoch the existing rules still hold (strictly increasing
  `n`, a clock that never goes back, a bounded jump).
* A `restart` command is validated at the door (`sanitizeCmd`): epoch >= 1 and below 100000, `n` 0, tick 0; the epoch field of every other command is bounded.
* The history a newcomer is sent is only the active epoch; the archive never leaves the browser.

## Checkpoints (PR #80)

A checkpoint's meta holds the epoch. `checkpointFits` refuses one whose epoch is not the history's, so a world checkpointed before a restart can never stand in for a history that starts with the
restart. The checkpoint is also deleted at the restart, and the usual checks (the command at the checkpoint's index must be the same text, the restored world's hash must be the recorded one) still
apply. A village never restarted has no epoch in its checkpoints and keeps resuming from them.

## The archive and bringing it back

The archive is the whole signed log of the life that ended, in IndexedDB next to the checkpoints, **once** (the next restart replaces it). The dialog offers "Download a backup of this village first"
(the existing backup file, which holds the save and the key), and Display settings shows "Bring back the old village" when an archive exists.

Bringing it back (`restoreArchivedVillage`) is a restart again, to epoch k+1, whose commands are the archive's: `rebaseLog` makes `restart`, then every archived command with `n` counted again and
`e` = k+1, and the owner **signs them all again** with the same key. The new world is built from them behind the scenes first (so a damaged archive never replaces the village in play), the active
log is replaced, the checkpoint and the archive are deleted, and the owner broadcasts the restart and then their whole history (`Room.pushLog`) so replicas rebuild. The result is the archived village to
the bit (`restart.wasm.test.mjs::bringing the archived village back gives exactly the village that was archived`). The village the player had just before is lost, and the game asks first.

## Limits, said plainly

* One life is archived. A second restart replaces the archive; download the backup file if two matter.
* A backup file made before a restart and restored after it puts the player back in an older epoch. Players already in the world who saw the newer epoch ignore the older log until they reload (their
  per-session sequence knows the later epoch); a fresh session takes it as it is. This is the cost of "the epoch only grows".
* Another player's marriage with you, and how they feel about you, survive on their side (see above).
* Other players' *own* villages are never touched: a restart changes only the village of the key that signs it.
* The core's `restart` is not part of `rules_fingerprint`'s scripted game, so the fingerprint is **unchanged**; the sync protocol (`SYNC_PROTOCOL`) is **bumped to 3** because commands and hash messages gained
  the epoch field, so builds with and without restart see each other as "different game version" until the page is reloaded.

## Tests

* Rust, `restart_tests.rs`: a restart gives a world identical to a new one (state hash, all hash sections, snapshot bytes) for several seeds, undoes terrain edits, felled trees, deposits and a battle in
  progress, restarting twice is the same as once, the flag is kept, and a log of many commands, a restart and a few more commands agrees between the owner, a replica that applies the restart live, and a
  newcomer that replays everything. `tests/replay_sync.rs::a_restart_in_the_middle_of_a_history_replays_identically`: two long random sessions with a restart between them, tick by tick, with the host looking
  at everything every tick.
* Node (`restart.test.mjs`): the checks on a restart command, the epoch rules of `Sequence` (live restart, old-epoch replay dropped, gap, one-epoch histories), hashes across epochs in `ReplicaTrack`,
  checkpoint refusal, saved-history reading, `rebaseLog`, the archive checks, the blockers and cooldown, and the dialog's state machine (nothing happens until the phrase is typed and a moment has passed,
  no double start, cancel only before it works).
* Node with the real core (`restart.wasm.test.mjs`): a signing owner and a replica that trusts only the owner's key stay in step through restart; a stranger's restart is refused; a replay of the whole old
  epoch changes nothing; a lost restart is noticed; bringing the archive back gives the archived village exactly; a pre-restart checkpoint is refused.
