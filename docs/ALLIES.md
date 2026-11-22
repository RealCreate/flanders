# Allies helping allies

An alliance (treaty kind 2, needs a trade pact and warm relations) used to mean only "we cannot attack each other" and better prices. Now allies can send soldiers to stand with each other. This is **stage 1**
of three; the rest is listed at the end.

## Stage 1: defending an ally (built)

The rule that keeps every player's copy identical: a village's world is changed only by commands **that village's owner signed**. So an ally's soldiers have to come into the host's world through a command of the host.

1. **Send.** An army of ours is selected, and "Send the selected army to help" (village list, attack box, only for an ally) marches it to the ally's border with the same planner as an attack (`marchOn`). On arrival
   (`checkArrivals`) it is handed over with the signed command `sendaid {idx, to, units}`: its soldiers leave our field and count as *away*, exactly like an attack (`det_send`). An ally who is not here (away, or a
   computer village) cannot answer: the army comes home at once.
2. **Accept.** The host's page shows "X sends N soldiers: let them in?" (`receiveAid`). Declining, not answering for 90 s, being away from the keyboard (steward mode), or no alliance in force: `refuse`, the existing
   command, which brings the soldiers home. Accepting: `World::host_guests(tag, units)` in the host's world, then the signed command `host {from, tag, units}`, which every copy of the host's village replays.
3. **Guests.** A guest army is a normal field army (`Det`) with `ally` = the sender's tag (hashed, in the snapshot). Rules in the core (`crates/game-core`, `combat_tests.rs` tests them):
   * only with an alliance in force; at most `GUEST_MAX` = 120 soldiers at a time and `GUEST_ARMIES` = 6 guest armies in all (the numbers come from a peer: checked before they are added up, and the
     `hostile_input` fuzz test throws random guests at the core);
   * the host cannot order them (`det_march`, `det_defend`, `det_send`, `det_split`, `det_merge`, `det_halt` refuse), they are not in the host's standing army, and they are not selectable;
   * they **fight beside the defenders by themselves**: when a battle starts, every idle guest army marches to the fight and joins it within reach (`defence_step`);
   * they eat from the host's stores (`appetite` counts every field army), like any soldier of the village;
   * guests in a fight cannot leave until it is over.
4. **Going home.** Either side ends it. The host: "Send their soldiers home" (`release_guests`, then the signed `unhost {to, tag, units}`); the sender: "Recall my soldiers" (`recallaid {to}`), which the host's
   page answers by sending them home. The survivors in `unhost` are what the sender takes back into its army (`return_refused_army`, which is capped by what the sender has away).
5. **Ask for help.** `ask {to, kind}` (1 defence) is a message only; the ally's page shows it. It changes no village.

### What it does not do (known limits)

* The sender is credited from the `unhost` the host signs. If the sender is offline when it is signed, it is not replayed into their game (a history that is loaded does not run the handlers), and the soldiers
  stay *away* until they send them home again by hand. (The same limit exists today for a `refuse`.)
* Guests use the host's research and veterancy.
* The sender's own village is not defended meanwhile: the soldiers are really away.

## Stage 2: joining an ally's raid (not built)

The battle in the victim's world has one attacker tag; loot and survivors are accounted per tag (`ledger.rs`). Joining needs a contributor tag on every attacking soldier, per-contributor survivors and loot in the
report, and a victim's rule for when an ally of the attacker may add soldiers. Design before code: the ledger's claim check must learn about several claimants of one battle.

## Stage 3: economic help (not built)

A labour loan (workers travel as a journey of a new kind, work for a number of days in the ally's workforce and come home) and goods aid, on the caravan machinery. The core needs a notion of borrowed workers in
`staffing()`.

## Compatibility

Rules fingerprint and state hash changed (`Det.ally` is hashed and serialized), so builds before and after this one see "different game version" and are asked to update (see `MULTIPLAYER.md`).
