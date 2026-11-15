# Bosses: a design proposal

Status: approved. Step 1 (core), 2 (client) and 3 (lairs) are built: see the "As built" section at the end. The rest of this text is the original proposal. It is written against the code on `master` (the combat overhaul with defending, the ram, ladders, and the neutral places are in).

## Why

Today every fight is "N soldiers against M soldiers": bandit raids scale with population and time (`bandit_force` in `battle.rs`), neutral bandit camps are a power check (`visit_neutral` in `lib.rs`, `9000 + 14000 * h` against the army's combined `hp * dmg / cd`). There is no moment that is memorable, no unit that is more than a bigger number, and nothing that asks the player to change tactics. A boss gives a fight a face, a story and a rule of its own.

## What a boss is

A named unit with a large body, a health bar that everybody sees, a small set of special rules, and an escort. It is a normal unit of the battle simulation (`Unit` in `battle.rs`) with extra fields, so everything built for combat keeps working: defending armies join the fight, retreat, ladders, rams, fire, wading, replay on every peer.

Proposed first bosses (each teaches something different):

| Boss | Where it appears | Rules | Counter |
|---|---|---|---|
| **Warlord** (raid boss) | leads a large bandit raid (after a threshold of days and population) | heavy armour, a war horn that makes the escort strike faster for 8 s every 30 s, rides in with a ram train | kill the horn carrier or the warlord; walls and ladders matter |
| **Ogre of the Marches** (camp boss) | a bandit camp that is marked "lair" on the map | huge hp, slow, area slam that hits everything within 3 units; throws boulders at walls | archers and kiting; stone walls help |
| **Plague Doctor / Witch** (event boss) | a plague wave (see the longer plagues) | does not fight: stands in a plague camp near the village and re-infects; dies in one hit but is guarded | a fast knight raid; the plague ends when it falls |
| **Ironclad Knight Captain** (rival-style boss) | late raids and ruined castles | heavy armour that only siege engines, rams and heavy hits hurt; steps back when hurt | catapults and the hero |

Start with two (Warlord, Ogre): one raid boss and one placed boss cover both code paths.

## Where it plugs in

* **Raids:** `begin_battle(atk, angle, tag)`. Add an optional boss in the attacking list (`BossKind`, hp, rules). `bandit_force` gains a boss roll: for example at most one boss per 12 raids once the village has stood 20 days, raised by wealth. The banner already shows direction (`attack banner`) and learns "led by <name>".
* **Neutral places:** `terrain::neutrals` gets a fourth kind, 3 = lair. Visiting is no longer a one-line power check: it starts a real battle on the spot (the same system as a raid, with the army as attackers and the camp as defenders), so the player's army fights visibly.
* **Plagues:** the witch/doctor is a boss attached to a plague wave (depends on the plague rework).
* **Rewards:** a boss drops a named reward: gold and iron as today, plus a trophy (a banner on the hall, +happiness for N days), and for the Warlord a captured ram. Hero experience from a boss is large (`HERO_XP`).
* **Difficulty:** boss strength scales from the same inputs as `bandit_force` (time, population, wealth) and from the hero level, with a hard cap so a village cannot be wiped out by one roll (the existing "no instant extinction" rule for plagues applies here too).

## Simulation changes (core)

* `Unit` gains `boss: u8` (0 none, else the kind), `phase: u8`, `rage: f32` and two cooldown timers; the boss table (`BOSSES`) lives in `military.rs` next to `UNITS`, so every number is in one place.
* Special rules are small functions called from the battle step: horn (aura on escort), slam (area damage with falloff), armour (damage multiplier by attacker kind: stone-like for non-siege), retreat threshold (phase change at 50 % hp).
* Everything is deterministic and part of the state: add boss fields to the `battle` section of `state_hash_parts`, so the replay and desync checks cover them (see `docs/DESYNC.md`). The rules fingerprint changes: old logs replay differently, which `hello` reports.
* `battle_units_flat` widens by `boss`/`phase`/hp fraction so the client can draw them; widen the stride once and document it.
* Reports (`last_report`) name the boss and whether it was killed, so the loot ledger and the multiplayer cross-check (`onRivalReport`) stay consistent.

## Client

* Models: large figures built like the other models in `web/src/render/crowd.ts`/`army.ts` (the warlord as a mounted figure with a banner and horn, the ogre as a scaled brute with a club), twice the height of a soldier, unmistakable by silhouette and colour.
* A health bar over the boss and a boss strip in the battle banner (name, hp, phase), the direction and "look" button that already exist.
* Effects: horn ring, slam shockwave and dust, rage glow below 50 %; sounds through the existing audio module.
* Announcement: "The Warlord Garrick rides on your village from the north-west", camera jump as for any raid (setting already exists).
* Map: lairs show on the map and minimap with a skull-and-banner icon drawn in `icons.ts`.

## Multiplayer

Boss fights are ordinary battles, so the defender's client runs them and every copy replays them. A player attacking an away village fights its defenders only (no bosses invented on someone else's copy: a boss belongs to raids on you and to lairs). Lairs are part of the world seed (`neutrals`), the same for everyone; whether a lair is cleared is per village, as for the other neutral places today (`neutral_done`).

## Plan

1. Core: boss table, `Unit` fields, the horn and the armour rule, raid roll, tests (deterministic replay, boss cannot kill an unprepared village in one raid, rewards).
2. Client: models, health bar, banner strip, effects.
3. Lairs: neutral kind 3, real battle on visit, reward, map marks.
4. Second boss rules (slam, retreat), then the plague boss once plagues are reworked.

Each step is a branch with its own PR and the usual checks (cargo tests, `replay_sync`, web tests, build, mcp).

## Risks and open questions

* **Balance.** The numbers need hand play. Put them in `BOSSES` and keep a test that fixes the intended outcomes (a village with a barracks and a few towers survives a Warlord raid after 20 days; an empty village does not).
* **Fun versus fairness.** A boss must be answerable: always a counter and always a warning (the banner appears about 20 s before the attackers arrive).
* **Wire size.** Widening `battle_units_flat` costs a little per frame: check the cost with the fight display on.
* **Saves.** Adding rules changes old replays. The rules fingerprint reports it, as for the other simulation changes.

Decisions for the owner: how many bosses to start with (proposal: two), whether lairs replace the camp power check or sit beside it (proposal: beside it, as a rarer, harder place), and whether a boss may appear in player-versus-player attacks (proposal: no).


## As built

* `BOSSES` in `military.rs` holds every number: hit points, blow, speed, plate (`heavy`/`soft`), horn (`horn_*`), slam (`slam_*`), boulders, rage, strength scale, escort, rewards. Warlord = 1, Ogre of the Marches = 2.
* `Unit` has `maxhp`, `boss`, `bname`, `phase`, `t1` (horn clock), `t2` (slam clock). `Battle` has `lair`, `lair_at`, `boss`, `bname`. All of it is in the `battle` section of the state hash.
* Raids: `boss_due()` (after `BOSS_FROM_DAYS` days and `BOSS_FROM_POP` people, one raid in `BOSS_ONE_IN`, more often for each `BOSS_WEALTH_STEP` coin held) draws a Warlord raid; it only draws from the random stream when it could happen. `begin_boss_raid` scales boss and escort with `boss_scale` (village size, age, lord's level). Bosses never come to player attacks (`begin_battle_boss` ignores the boss unless the tag is 0) and the attacker's copy of an away village never invents one.
* Plate: a hit below `heavy` damage from anything but a catapult or ram does `soft` of its damage (`damage_from`). Horn: the escort within reach recovers from each swing faster while it sounds (`boss_step`). Rage: below `rage_at` of its hit points a boss hits harder and moves faster. Slam: area damage with falloff. The ogre throws boulders at buildings, stone included, from `BOULDER_REACH`.
* Rewards (`boss_rewards`): gold, iron, lord's experience, a lift in spirits, a captured ram for the Warlord; event `EV_BOSS` (25).
* `battle_units_flat` stride is now **14**: side, kind, x, y, hp, maxhp, alive, swing, facing, elevation, boss, phase, name, aura. `battle_boss()` gives [boss, name, hp, maxhp, phase, alive]. `last_report` carries [boss, name, fell, lair] just before the two "fled" numbers at the end (so loot still starts at 12 and the fled numbers are still the last two).
* Testing: `cheat(10, angle*100, strength 0..1000)` starts a Warlord raid (replicated like the other cheats).
* Lairs: neutral kind 3 (about one place in seven; `terrain::neutrals`), beside the camp's power check. `visit_neutral` on a lair returns 3 at once and starts a real battle at the lair (`begin_lair_battle`): the lair's ogre and escort are side 1 and hold their ground, the army's soldiers join as side 0 (`det_join`), no village building is involved. Winning (every one of them dead) clears the lair, pays the table's rewards and marks it done; losing leaves it standing and the survivors where they are; marching the army away breaks the fight off. `battle_lair()` says where; reports carry the lair flag; `-4` means a fight is already on.
* Client: `web/src/bosses.ts` (pure: stride, titles, strip, announcements, report lines; tested in `tests/bosses.test.mjs`), boss figures in `render/army.ts` (the warlord mounted at one and a half times a soldier with a standard and horn on his back, the ogre at two and a half times with a club; a gold ring while the horn sounds, a red glow and embers when enraged), horn blast and slam effects in `render/fx.ts` with sounds in `audio.ts`, a health bar floating over the boss and a strip in the battle banner (`main.ts`), the announcement ("Garrick, the Warlord, rides on your village from the north-west!" with the usual camera jump; for a lair the camera goes to the lair), lair marks on the minimap (a banner with a skull) and the icons `lair`, `horn` and `boss` in `ui/icons.ts`.
* Not checked by eye: no screenshots were taken. The numbers (positions, hit points over time, hashes) are tested; how the models, ring, glow and bar look and sit on screen still wants a look in the browser.
