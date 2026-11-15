//! Bosses: the Warlord's raid and the Ogre's lair. The outcomes the numbers in `BOSSES` are meant to give are fixed here.
use super::*;

fn put(w: &mut World, kind: u8, x: f32, y: f32) {
    let pad_h = w.base(x, y);
    w.buildings.push(Building { kind, tier: 0, x, y, rot: 0, pad_h, progress: 0, status: 4, aux: -1, staff: 0, residents: 0, hp: battle::max_hp(kind, 0), burning: 0.0, garrison: 0, born: 0, opts: 0, fert: FERT_MAX, mode: 0 });
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
        w.army = [12, 8, 5, 0, 0, 0];
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
        assert!(w.cheat(9, 150, 500));
        let b = w.battle_boss(); assert_eq!(b[0], 1.0, "the warlord leads"); assert!(b[3] > 400.0 && b[3] < 800.0, "hit points {}", b[3]);
        let mut hashes = vec![];
        while w.battle_active() && hashes.len() < 700 { w.step(); w.stock[GR as usize] = 3000; hashes.push(w.state_hash()); }
        (hashes, w.last_report())
    };
    let (a, ra) = run(7); let (b, rb) = run(7);
    assert_eq!(a, b, "same village, same raid, same fight"); assert_eq!(ra, rb);
    let (c, _) = run(8);
    assert_ne!(a, c, "another random stream plays out differently");
    let w = { let mut w = village(true); w.cheat(9, 0, 500); w };
    let rams = w.battle.as_ref().unwrap().units.iter().filter(|u| u.side == 1 && u.kind == RAM).count();
    assert!(rams >= 1, "he rides in with a ram");
}

#[test]
fn a_prepared_village_survives_a_warlord_raid_and_an_empty_one_does_not() {
    for (seed, rf) in [(3u64, 0), (11, 500), (23, 1000), (41, 300)] {
        let mut w = village(true); w.rng = Rng(seed); assert!(w.cheat(9, (seed as i32) * 37 % 628, rf));
        fight(&mut w); let r = w.last_report();
        assert_eq!(r[1], 1, "seed {seed}: barracks, towers and soldiers hold: {r:?}");
        assert_eq!(boss_part(&r)[2], 1, "seed {seed}: and the warlord falls");
        let mut w = village(false); w.rng = Rng(seed); assert!(w.cheat(9, (seed as i32) * 37 % 628, rf));
        fight(&mut w); let r = w.last_report();
        assert_eq!(r[1], 0, "seed {seed}: an empty village is overrun: {r:?}");
        assert_eq!(boss_part(&r)[2], 0, "seed {seed}: nobody could hurt him");
        assert!(w.population >= 2, "but it is never wiped out");
    }
}

#[test]
fn the_horn_spurs_the_escort_for_eight_seconds_and_ends_with_the_warlord() {
    let mut w = village(true); w.rng = Rng(5); assert!(w.cheat(9, 0, 500));
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
        assert!((cd - want).abs() < 0.01, "the escort recovers {} (sounding {sounding})", 9.0 - cd);
        if sounding { on += 1; if !was_on { blasts += 1; } } else { off += 1; }
        was_on = sounding;
    }
    eprintln!("on {on} off {off} blasts {blasts}");
    assert!(blasts >= 2, "the horn sounds again and again ({blasts} blasts)");
    assert!(on > 0 && off > on, "it sounds for a part of the time only: {on} steps on, {off} off");
    let secs = on as f32 * 0.25 / blasts as f32; assert!(secs > 7.0 && secs <= bd.horn_secs + 0.3, "each blast lasts about {} seconds, measured {secs}", bd.horn_secs);
    // the client's data says the same: an aura flag on the warlord and the men round him while it sounds
    let mut w2 = village(true); w2.rng = Rng(5); w2.cheat(9, 0, 500);
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
    let mut w = village(false); w.cheat(9, 0, 500);
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
    let mut w = village(false); w.cheat(9, 0, 500);
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
    let mut w = village(true); w.rng = Rng(3); w.stock = [200; N_RES]; w.hero = Some((0, 0)); assert!(w.cheat(9, 2, 500));   // (name index 2)
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
