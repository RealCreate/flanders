//! Bosses: the Warlord's raid and the Ogre's lair. The outcomes the numbers in `BOSSES` are meant to give are fixed here.
use super::*;

fn put(w: &mut World, kind: u8, x: f32, y: f32) {
    let pad_h = w.base(x, y);
    w.buildings.push(Building { kind, tier: 0, x, y, rot: 0, pad_h, progress: 0, status: 4, aux: -1, staff: 0, residents: 0, hp: battle::max_hp(kind, 0), burning: 0.0, garrison: 0, born: 0, opts: 0, fert: FERT_MAX, mode: 0, target: -1, beff: 100 });
}
/// A village 20 days old with houses; `ready` adds a barracks, three garrisoned towers and a standing army.
fn village(ready: bool) -> World {
    let mut w = World::new(1337, 0, 0);
    w.stock = [3000; N_RES]; w.population = 40; w.tick = 20 * DAY;
    for (k, x, y) in [(HOUSE, 12, 4), (HOUSE, 17, 4), (HOUSE, 22, 4), (HOUSE, -12, 6), (HOUSE, -16, 10)] { w.place(k, x, y, 0); }
    if ready {
        let (hx, hy) = (w.buildings[0].x, w.buildings[0].y);
        put(&mut w, BARRACKS, hx - 14.0, hy + 14.0);
        for (x, y) in [(0.0, 16.0), (14.0, -12.0), (-10.0, -16.0)] { put(&mut w, TOWER, hx + x, hy + y); let n = w.buildings.len() - 1; w.buildings[n].garrison = 4; }
        w.army = [14, 10, 8, 1, 0, 0];
    }
    w
}
fn fight(w: &mut World) -> u32 { let mut n = 0; while w.battle_active() && n < 700 { w.step(); w.stock[GR as usize] = 3000; n += 1; } n }
/// The boss's section of a report: [boss, name, fell, lair] (just before the two "fled" numbers at the end).
fn boss_part(r: &[i32]) -> [i32; 4] { let l = r.len(); [r[l - 6], r[l - 5], r[l - 4], r[l - 3]] }

#[test]
fn a_boss_raid_is_deterministic_and_leads_with_the_warlord() {
    let run = |seed: u64| -> (Vec<u64>, Vec<i32>) {
        let mut w = village(true); w.rng = Rng(seed);
        assert!(w.cheat(10, 150, 500));
        let b = w.battle_boss(); assert_eq!(b[0], 1.0, "the warlord leads"); assert!(b[3] > 400.0 && b[3] < 800.0, "hit points {}", b[3]);
        let mut hashes = vec![];
        while w.battle_active() && hashes.len() < 700 { w.step(); w.stock[GR as usize] = 3000; hashes.push(w.state_hash()); }
        (hashes, w.last_report())
    };
    let (a, ra) = run(7); let (b, rb) = run(7);
    assert_eq!(a, b, "same village, same raid, same fight"); assert_eq!(ra, rb);
    let (c, _) = run(8);
    assert_ne!(a, c, "another random stream plays out differently");
    let w = { let mut w = village(true); w.cheat(10, 0, 500); w };
    let rams = w.battle.as_ref().unwrap().units.iter().filter(|u| u.side == 1 && u.kind == RAM).count();
    assert!(rams >= 1, "he rides in with a ram");
}

/// Over many random streams, angles and strengths: the share of prepared villages that hold (and kill the warlord), and of empty ones that are overrun.
fn rates(n: u64) -> (u64, u64, u64) {
    let (mut held, mut killed, mut overrun) = (0, 0, 0);
    for seed in 0..n {
        let (ang, rf) = ((seed as i32 * 37) % 628, (seed as i32 * 211) % 1001);
        let mut w = village(true); w.rng = Rng(seed * 7919 + 3); assert!(w.cheat(10, ang, rf));
        fight(&mut w); let r = w.last_report();
        if r[1] == 1 { held += 1; } if boss_part(&r)[2] == 1 { killed += 1; }
        let mut w = village(false); w.rng = Rng(seed * 7919 + 3); assert!(w.cheat(10, ang, rf));
        fight(&mut w); let r = w.last_report();
        if r[1] == 0 && boss_part(&r)[2] == 0 && w.population >= 2 { overrun += 1; }
    }
    (held, killed, overrun)
}

#[test]
fn a_prepared_village_survives_a_warlord_raid_and_an_empty_one_does_not() {
    let n = 100; let (held, killed, overrun) = rates(n);
    eprintln!("prepared village held {held}/{n}, killed the warlord {killed}/{n}; empty village overrun {overrun}/{n}");
    assert!(held * 100 >= n * 90, "barracks, towers and soldiers hold: {held}/{n}");
    assert!(killed * 100 >= n * 90, "and the warlord falls: {killed}/{n}");
    assert_eq!(overrun, n, "an empty village is overrun, never wiped out, and nobody could hurt him");
}

#[test]
fn the_horn_spurs_the_escort_for_eight_seconds_and_ends_with_the_warlord() {
    let mut w = village(false); w.rng = Rng(5); assert!(w.cheat(10, 0, 500));
    // a far-off, unkillable defender keeps the fight (and the horn's clock) going whatever the village's strength
    { let b = w.battle.as_mut().unwrap(); let mut u = Unit::new(0, 0, -400.0, -400.0, 0.0); u.hp = 1e9; u.maxhp = 1e9; b.units.push(u); b.start_side[0] += 1; }
    let bd = &BOSSES[0];
    // an escort spearman is kept beside the warlord with its swing timer set far ahead, so only the haste changes the timer
    let probe = |w: &mut World| -> Option<(f32, bool)> {
        let b = w.battle.as_ref()?; let bi = b.units.iter().position(|u| u.boss > 0 && u.alive)?;
        let i = b.units.iter().position(|u| u.side == 1 && u.alive && u.boss == 0 && u.kind == 0)?;
        let (bx, by, t1) = (b.units[bi].x, b.units[bi].y, b.units[bi].t1);
        let mut t = t1 + 0.25; if t >= bd.horn_every { t = 0.0; }
        let b = w.battle.as_mut().unwrap(); b.units[i].x = bx + 1.0; b.units[i].y = by; b.units[i].cd = 9.0; b.units[i].climb = 0.0;
        w.battle_substep();
        Some((w.battle.as_ref()?.units[i].cd, t < bd.horn_secs))
    };
    let (mut on, mut off, mut blasts, mut was_on) = (0, 0, 0, false);
    for _ in 0..(75.0 / 0.25) as usize {
        let Some((cd, sounding)) = probe(&mut w) else { break };
        let want = if sounding { 9.0 - 0.25 * (1.0 + bd.horn_haste) } else { 8.75 };
        if cd >= 9.0 || cd < 8.0 { continue; }   // that step the probe was routed, climbing or swinging: it says nothing about the horn
        assert!((cd - want).abs() < 0.01, "the escort recovers {} (sounding {sounding})", 9.0 - cd);
        if sounding { on += 1; if !was_on { blasts += 1; } } else { off += 1; }
        was_on = sounding;
    }
    eprintln!("on {on} off {off} blasts {blasts}");
    assert!(blasts >= 2, "the horn sounds again and again ({blasts} blasts)");
    assert!(on > 0 && off > on, "it sounds for a part of the time only: {on} steps on, {off} off");
    let secs = on as f32 * 0.25 / blasts as f32; assert!(secs > 7.0 && secs <= bd.horn_secs + 0.3, "each blast lasts about {} seconds, measured {secs}", bd.horn_secs);
    // the client's data says the same: an aura flag on the warlord and the men round him while it sounds
    let mut w2 = village(true); w2.rng = Rng(5); w2.cheat(10, 0, 500);
    let mut flagged = 0; for _ in 0..(40.0 / 0.25) as usize { w2.battle_substep(); if w2.battle_units_flat().chunks(14).any(|u| u[10] > 0.0 && u[13] > 0.0) { flagged += 1; } }
    assert!(flagged > 10 && flagged < 60, "the aura flag is on while the horn sounds: {flagged} of 160 steps");
    // kill the warlord: the horn is silent for good
    let bi = w.battle.as_ref().unwrap().units.iter().position(|u| u.boss > 0).unwrap();
    { let b = w.battle.as_mut().unwrap(); b.units[bi].hp = 0.0; b.units[bi].alive = false; }
    for _ in 0..200 {
        if !w.battle_active() { break; }
        let flat = w.battle_units_flat(); assert!(flat.chunks(14).all(|u| u[13] == 0.0), "no aura without the warlord");
        let cd = { let Some(i) = w.battle.as_ref().and_then(|b| b.units.iter().position(|u| u.side == 1 && u.alive && u.boss == 0 && u.kind == 0)) else { break }; w.battle.as_mut().unwrap().units[i].cd = 9.0; w.battle_substep(); let Some(b) = w.battle.as_ref() else { break }; b.units[i].cd };
        assert!((cd - 8.75).abs() < 0.01, "no haste without the warlord: {cd}");
    }
}

#[test]
fn plate_yields_only_to_siege_and_heavy_hits() {
    let mut w = village(false); w.cheat(10, 0, 500);
    let hit = |w: &mut World, dmg: f32, siege: bool| -> f32 {
        let b = w.battle.as_mut().unwrap(); let i = b.units.iter().position(|u| u.boss > 0).unwrap(); b.units[i].hp = b.units[i].maxhp; b.units[i].phase = 0;
        World::damage_from(b, i, dmg, siege); b.units[i].maxhp - b.units[i].hp
    };
    let (spear, archer, sword, knight, cat) = (hit(&mut w, 10.0, false), hit(&mut w, 8.0, false), hit(&mut w, 17.0, false), hit(&mut w, 24.0, false), hit(&mut w, 55.0, true));
    eprintln!("spear {spear:.1} archer {archer:.1} sword {sword:.1} knight {knight:.1} catapult {cat:.1}");
    assert!(spear < 3.0 && archer < 2.5, "spears and arrows barely scratch plate");
    assert!(sword > 9.0 && knight > 12.0, "a heavy blow gets through");
    assert!(cat > 30.0, "and a catapult shatters it");
    assert!(hit(&mut w, 10.0, true) > 5.0, "even a light hit from a siege engine counts in full");
    // a plain soldier has no plate
    let b = w.battle.as_mut().unwrap(); let j = b.units.iter().position(|u| u.boss == 0 && u.side == 1 && u.kind == 0).unwrap(); let hp = b.units[j].hp;
    World::damage_from(b, j, 10.0, false); assert!(hp - b.units[j].hp > 5.0, "a spearman takes the full blow");
}

#[test]
fn a_boss_is_enraged_below_half_its_hit_points() {
    let mut w = village(false); w.cheat(10, 0, 500);
    let b = w.battle.as_mut().unwrap(); let i = b.units.iter().position(|u| u.boss > 0).unwrap();
    let calm = unit_stat(&b.units[i]);
    b.units[i].hp = b.units[i].maxhp * 0.52; World::damage_from(b, i, 40.0, true);
    assert_eq!(b.units[i].phase, 1, "wounded to the bone he is enraged");
    let mad = unit_stat(&b.units[i]); assert!(mad.dmg > calm.dmg && mad.speed > calm.speed);
}

#[test]
fn bosses_never_come_to_player_attacks_or_to_a_young_village() {
    for tag in [1, 7, -3] {
        let mut w = village(false);
        assert!(w.begin_battle_boss([6, 0, 0, 0, 0, 0], 0.0, tag, WARLORD, 1, 1.0));
        assert!(w.battle_boss().is_empty(), "tag {tag}: no boss in an attack by a player");
        assert!(w.battle.as_ref().unwrap().units.iter().all(|u| u.boss == 0));
    }
    let mut w = village(false); assert!(w.start_raid(1.0, &[6, 0, 0, 0, 0, 0], 9)); assert!(w.battle_boss().is_empty());
    // young villages and small ones are spared; old, grown ones draw a boss about one raid in twelve (more when rich)
    let mut young = village(false); young.tick = 10 * DAY; let r0 = young.rng.0;
    for _ in 0..200 { assert!(!young.boss_due()); } assert_eq!(young.rng.0, r0, "and the random stream is left alone");
    let mut small = village(false); small.population = 10; for _ in 0..200 { assert!(!small.boss_due()); }
    let mut old = village(false); old.stock[GD as usize] = 0; let n = (0..2400).filter(|_| old.boss_due()).count();
    assert!(n > 120 && n < 290, "about one in twelve: {n} of 2400");
    old.stock[GD as usize] = 3000; let m = (0..2400).filter(|_| old.boss_due()).count();
    assert!(m > n, "the rich draw bosses more often: {m} against {n}");
}

#[test]
fn reports_name_the_boss_and_a_kill_pays() {
    let mut w = village(true); w.rng = Rng(3); w.stock = [200; N_RES]; w.hero = Some((0, 0)); assert!(w.cheat(10, 2, 500));   // (name index 2)
    w.take_events();
    let (xp0, rams0) = (w.hero.unwrap().1, w.army[RAM as usize]);
    let mut n = 0; while w.battle_active() && n < 700 { w.step(); n += 1; }
    let r = w.last_report(); let bp = boss_part(&r);
    assert_eq!(bp, [1, 2, 1, 0], "the report names the boss (1 = warlord), his name (2) and that he fell: {r:?}");
    assert!(w.hero.unwrap().1 >= xp0 + BOSSES[0].xp, "the lord learns a lot from it");
    assert_eq!(w.army[RAM as usize], rams0 + BOSSES[0].prize_rams, "a captured ram joins the army");
    assert!(w.stock[GD as usize] >= 200 + BOSSES[0].gold - 5 || w.stock[GD as usize] == w.storage_cap(), "gold: {}", w.stock[GD as usize]);
    assert!(w.mood >= BOSSES[0].mood && w.mood_until > w.tick, "spirits are high");
    let ev = w.take_events(); assert!(ev.chunks(4).any(|e| e[0] == EV_BOSS && e[1] == 16 + 2), "an event says who fell: {ev:?}");
    // a raid without him reports none
    let mut w = village(true); assert!(w.cheat(4, 0, 300)); fight(&mut w); assert_eq!(boss_part(&w.last_report()), [0, 0, 0, 0]);
}

fn lair_of(seed: u64) -> Option<(usize, f32, f32)> { terrain::neutrals(seed).iter().enumerate().find(|(_, n)| n.0 == 3).map(|(i, n)| (i, n.1, n.2)) }
fn army_at(w: &mut World, x: f32, y: f32, units: [u32; NK]) -> u32 { w.army = units; let id = w.det_form(&units); let i = w.dets.iter().position(|d| d.id == id).unwrap(); w.dets[i].x = x; w.dets[i].y = y - 8.0; id }

#[test]
fn a_lair_is_a_real_fight_that_can_be_lost_and_tried_again_and_pays_when_won() {
    for seed in [1u64, 7, 1337, 99999] { assert!(terrain::neutrals(seed).iter().any(|n| n.0 == 3), "seed {seed} has a lair"); }
    let (ni, x, y) = lair_of(1337).expect("a lair on the main test map");
    let mut w = World::new(1337, 0, 0); w.stock = [100; N_RES]; w.army = [7, 3, 0, 0, 0, 0];
    let (hall_hp, stock, army) = (w.buildings[0].hp, w.stock, w.army);
    // too few soldiers: they lose, the lair stays, and they may try again
    let weak = army_at(&mut w, x, y, [3, 2, 0, 0, 0, 0]); w.army = army;
    assert_eq!(w.visit_neutral(weak), 3, "the fight begins at once");
    assert!(w.battle_active() && !w.battle_lair().is_empty() && w.battle_boss()[0] == 2.0, "a real battle, at the lair, with the ogre in it");
    assert_eq!(w.visit_neutral(weak), -4, "one fight at a time");
    fight(&mut w);
    let r = w.last_report(); assert_eq!(r[1], 0); assert_eq!(boss_part(&r), [2, boss_part(&r)[1], 0, 1], "a lair report: the ogre stood, lair = 1");
    assert!(!w.neutral_done[ni], "a lair that held is not cleared");
    // a proper army wins, pays, and the lair is done
    let mut w = World::new(1337, 0, 0); w.stock = [100; N_RES]; w.hero = Some((0, 0)); w.army = [7, 3, 0, 0, 0, 0];
    let id = army_at(&mut w, x, y, [20, 12, 8, 4, 0, 0]); w.army = army;
    assert_eq!(w.visit_neutral(id), 3);
    let (bx0, by0) = { let u = w.battle.as_ref().unwrap().units.iter().find(|u| u.boss > 0).unwrap(); (u.x, u.y) };
    let hp0 = w.battle_boss()[2]; let mut hp_min = hp0; let (mut secs, mut moved) = (0, 0.0f32);
    while w.battle_active() && secs < 400 {
        w.step(); secs += 1;
        let b = w.battle_boss(); if !b.is_empty() { hp_min = hp_min.min(b[2]); }
        if let Some(bt) = &w.battle { if let Some(u) = bt.units.iter().find(|u| u.boss > 0) { moved = moved.max(((u.x - bx0).powi(2) + (u.y - by0).powi(2)).sqrt()); } }
    }
    let r = w.last_report(); eprintln!("{secs}s, report {r:?}, boss moved {moved:.1}, hp {hp0} -> {hp_min}");
    assert!(secs > 12, "a fight with a hit-point-rich boss takes time: {secs}s");
    assert!(hp_min < 0.05 * hp0, "the ogre fell: {hp_min} of {hp0}"); assert!(moved >= 0.0);
    assert_eq!(r[1], 1); assert_eq!(boss_part(&r)[0], 2); assert_eq!(boss_part(&r)[2], 1); assert_eq!(boss_part(&r)[3], 1);
    assert!(w.neutral_done[ni], "cleared"); assert_eq!(w.visit_neutral(id), -3, "and done");
    assert!(w.stock[GD as usize] >= 100 + BOSSES[1].gold && w.stock[IR as usize] >= 100 + BOSSES[1].iron, "the reward: gold {} iron {}", w.stock[GD as usize], w.stock[IR as usize]);
    assert!(w.hero.unwrap().1 >= BOSSES[1].xp, "the lord's experience");
    assert!(w.dets.iter().any(|d| d.units.iter().sum::<u32>() > 0), "the survivors are still an army in the field");
    assert_eq!(w.buildings[0].hp, hall_hp, "the village was not touched"); assert_eq!(w.army, army, "nor its standing army"); let _ = stock;
}

#[test]
fn the_ogre_slams_everything_near_and_throws_boulders_at_stone() {
    // the slam: soldiers within reach are hurt (less at the rim), soldiers beyond it are not
    let mut w = village(false); assert!(w.begin_battle_boss([0; NK], 0.0, 0, OGRE, 0, 1.0));
    { let b = w.battle.as_mut().unwrap();
      b.t = battle::DEPLOY_SECS;
      let (ox, oy) = { let o = b.units.iter().find(|u| u.boss > 0).unwrap(); (o.x, o.y) };
      for (dx, side) in [(1.0f32, 0u8), (3.0, 0), (9.0, 0), (1.0, 1)] { let mut u = Unit::new(side, 0, ox + dx, oy + 8.0 - 8.0, 0.0); u.hp = 70.0; b.units.push(u); }
      b.units.iter_mut().find(|u| u.boss > 0).unwrap().t2 = 0.0; }
    w.battle_substep();
    let b = w.battle.as_ref().unwrap(); let hp = |i: usize| b.units[b.units.len() - 4 + i].hp;
    eprintln!("slam: near {} rim {} far {} own side {}", hp(0), hp(1), hp(2), hp(3));
    assert!(hp(0) < 50.0 && hp(1) < 60.0 && hp(1) > hp(0), "the slam hurts, most at the middle");
    assert_eq!(hp(2), 70.0, "beyond its reach nothing happens"); assert_eq!(hp(3), 70.0, "and his own side is spared");
    // boulders: a stone wall that no spearman can scratch breaks under an ogre
    let wall = |w: &mut World| { let (hx, hy) = (w.buildings[0].x, w.buildings[0].y); for k in -9..=9 { put(w, WALL, hx + 24.0, hy + k as f32 * 3.0); let n = w.buildings.len() - 1; w.buildings[n].tier = 2; w.buildings[n].hp = battle::max_hp(WALL, 2); } };
    let hp_of = |w: &World| -> f32 { w.buildings.iter().filter(|b| b.kind == WALL).map(|b| b.hp).sum() };
    let mut a = village(false); a.population = 4; wall(&mut a); let full = hp_of(&a);
    assert!(a.begin_battle_boss([0; NK], 0.0, 0, OGRE, 0, 1.0)); for _ in 0..90 { a.step(); a.stock[GR as usize] = 3000; if !a.battle_active() { break; } }
    let lost = full - hp_of(&a); eprintln!("ogre: stone wall lost {lost:.0} of {full:.0}");
    assert!(lost > 150.0, "boulders break stone: {lost}");
    let mut c = village(false); c.population = 4; wall(&mut c); assert!(c.begin_battle([8, 0, 0, 0, 0, 0], 0.0, 0)); c.battle.as_mut().unwrap().ladders = 0;
    for _ in 0..90 { c.step(); c.stock[GR as usize] = 3000; if !c.battle_active() { break; } }
    assert_eq!(hp_of(&c), full, "while spearmen cannot touch it");
}

#[test]
fn lair_outcomes_hold_across_every_lair_and_seed() {
    let (mut strong_won, mut weak_lost, mut n) = (0, 0, 0);
    for seed in [1337u64, 7, 99999] {
        for (ni, x, y) in terrain::neutrals(seed).iter().enumerate().filter(|(_, p)| p.0 == 3).map(|(i, p)| (i, p.1, p.2)) {
            n += 1;
            for (army, strong) in [([20u32, 12, 8, 4, 0, 0], true), ([3, 2, 0, 0, 0, 0], false)] {
                let mut w = World::new(seed, 0, 0); w.stock = [100; N_RES]; w.rng = Rng(ni as u64 * 31 + 5);
                let id = army_at(&mut w, x, y, army); assert_eq!(w.visit_neutral(id), 3);
                fight(&mut w); let r = w.last_report();
                if strong && r[1] == 1 && w.neutral_done[ni] { strong_won += 1; } if !strong && r[1] == 0 { weak_lost += 1; }
            }
        }
    }
    eprintln!("lairs: strong army won {strong_won}/{n}, weak army lost {weak_lost}/{n}");
    assert!(strong_won * 10 >= n * 9, "a strong army clears a lair: {strong_won}/{n}");
    assert_eq!(weak_lost, n, "a handful of soldiers never does");
}

/// Where the attackers stand at the start of a raid, against the point the banner sends the camera to (`battle_spawn`, and the same formula in `defence.ts`: out from the village
/// centre by build radius + 22 along the raid angle): the middle of the line of attackers is within a few paces of it, for any direction, for the owner's village and for a copy of
/// another village at an offset, and for a boss raid.
#[test]
fn the_camera_target_is_where_the_attackers_stand() {
    for (ox, oy) in [(0, 0), (420, -310), (-700, 515)] {
        for k in 0..8 {
            for boss in [0u8, 1] {
                let angle = -3.0 + k as f32 * 0.8;
                let mut w = World::new(1337, ox, oy);
                w.stock = [3000; N_RES]; w.population = 40; w.tick = 20 * DAY;
                for (kind, x, y) in [(HOUSE, 12, 4), (HOUSE, 17, 4), (HOUSE, -12, 6), (HOUSE, -16, 10)] { w.place(kind, x, y, 0); }
                let r = w.build_radius() as f32 + 22.0;
                let atk = [14, 6, 3, 0, 0, 0];
                assert!(if boss > 0 { w.begin_battle_boss(atk, angle, 0, boss, 0, 1.0) } else { w.begin_battle(atk, angle, 7) });
                let sp = w.battle_spawn(); assert_eq!(sp.len(), 2);
                let (fx, fy) = (ox as f32 + angle.cos() * r, oy as f32 + angle.sin() * r);   // what the client computes from the angle alone
                assert!((sp[0] - fx).hypot(sp[1] - fy) < 0.01, "the stored spawn is the formula's point: {sp:?} vs ({fx}, {fy})");
                let u = w.battle_units_flat();
                let (mut n, mut cx, mut cy) = (0.0f32, 0.0f32, 0.0f32);
                for c in u.chunks(14) { if c[0] == 1.0 && c[6] > 0.0 { n += 1.0; cx += c[2]; cy += c[3]; } }
                let (cx, cy) = (cx / n, cy / n);
                assert!((cx - fx).hypot(cy - fy) < 6.0, "attackers' centre ({cx:.1}, {cy:.1}) vs target ({fx:.1}, {fy:.1}) at angle {angle}, origin ({ox}, {oy}), boss {boss}");
                // and the first seconds: they have not gone far
                for _ in 0..3 { w.step(); w.stock[GR as usize] = 3000; }
                let u = w.battle_units_flat();
                let (mut n, mut cx, mut cy) = (0.0f32, 0.0f32, 0.0f32);
                for c in u.chunks(14) { if c[0] == 1.0 && c[6] > 0.0 { n += 1.0; cx += c[2]; cy += c[3]; } }
                assert!(((cx / n) - fx).hypot((cy / n) - fy) < 14.0, "three seconds in they are still near the target");
            }
        }
    }
}

/// Why the spawn point alone is not enough: the raiders march on, so some seconds into the fight nobody stands where they formed up.
#[test]
fn the_raiders_leave_the_spawn_point_within_seconds() {
    let mut w = World::new(1337, 0, 0); w.stock = [3000; N_RES]; w.population = 40; w.tick = 20 * DAY;
    for (kind, x, y) in [(HOUSE, 12, 4), (HOUSE, -12, 6)] { w.place(kind, x, y, 0); }
    assert!(w.begin_battle([14, 6, 3, 0, 0, 0], 1.0, 7));
    let sp = w.battle_spawn();
    let mut at = |w: &World| { let u = w.battle_units_flat(); let (mut n, mut x, mut y) = (0.0f32, 0.0f32, 0.0f32); for c in u.chunks(14) { if c[0] == 1.0 && c[6] > 0.0 { n += 1.0; x += c[2]; y += c[3]; } } (x / n - sp[0]).hypot(y / n - sp[1]) };
    let d0 = at(&w); for _ in 0..25 { w.step(); w.stock[GR as usize] = 3000; if !w.battle_active() { break; } }
    let d1 = at(&w); eprintln!("centroid {d0:.1} from the spawn at the start, {d1:.1} after 25s");
    assert!(d0 < 6.0 && d1 > 20.0, "{d0} {d1}");
}
