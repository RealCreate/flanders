//! Restart (see docs/RESTART.md): the world after a restart is the world a brand-new village starts as, whatever was done to it before, and a log that holds a restart
//! plays the same for the owner and for a replica that applies the commands one at a time.
use super::*;

/// A command as the web client records it (the ones that matter here).
#[derive(Clone, Debug)]
enum C { Place(u8, i32, i32), Level(i32, i32, i32), Cheat(u8, i32, i32), Clear(u32), Treaty(i32, u8, u32), Hero, Style(u32), Restart }

fn apply(w: &mut World, c: &C) {
    match *c {
        C::Place(k, x, y) => { w.place(k, x, y, 0); }
        C::Level(x, y, r) => { w.level_ground(x, y, r, -1.0); }
        C::Cheat(a, x, y) => { w.cheat(a, x, y); }
        C::Clear(i) => { w.clear_deposit(i); }
        C::Treaty(t, k, d) => { w.treaty_set(t, k, d); }
        C::Hero => { w.hero_hire(); }
        C::Style(s) => { w.set_style(s); }
        C::Restart => w.restart(),
    }
}

/// Play `cmds` as a log: (tick, command) pairs, stepping to each tick first (what the web client's replay does).
fn play(seed: u64, log: &[(u64, C)]) -> World {
    let mut w = World::new(seed, 0, 0);
    for (t, c) in log { while w.tick < *t { w.step(); } apply(&mut w, c); }
    w
}

fn busy_log() -> Vec<(u64, C)> {
    let mut v = vec![(0, C::Cheat(3, 0, 0)), (0, C::Style((1 << 24) + 77))];
    for (i, (k, x, y)) in [(HOUSE, 12, 4), (HOUSE, 18, 8), (FARM, -14, 6), (BARRACKS, -20, 16), (TOWER, 30, 30), (WALL, 34, 30), (RAISE, 22, -20), (LOWER, -26, -22), (MOAT, -30, 30)].iter().enumerate() { v.push((10 + i as u64 * 7, C::Place(*k, *x, *y))); }
    v.push((90, C::Level(-12, 24, 8)));
    v.push((100, C::Clear(0)));
    v.push((110, C::Treaty(5, TREATY_PEACE, 20)));
    v.push((120, C::Hero));
    v
}

#[test]
fn a_restart_gives_exactly_a_brand_new_village() {
    for seed in [1337u64, 7, 90210] {
        let mut w = play(seed, &busy_log());
        for _ in 0..900 { w.step(); }
        assert_ne!(w.state_hash(), World::new(seed, 0, 0).state_hash(), "the village had grown");
        w.restart();
        let mut fresh = World::new(seed, 0, 0);
        // the flag is kept (it is the player's mark on the map): the fresh one gets it too
        fresh.set_style((1 << 24) + 77);
        assert_eq!(w.state_hash(), fresh.state_hash(), "seed {seed}: state hash");
        assert_eq!(w.state_hash_parts(), fresh.state_hash_parts(), "seed {seed}: every section");
        assert_eq!(w.tick(), 0, "the clock starts again");
        assert!(w.snapshot() == fresh.snapshot(), "seed {seed}: even the derived data and caches are the same bytes");
        assert_eq!(w.building_count(), 1, "only the town hall");
        // and it plays on like a new village
        for _ in 0..300 { w.step(); fresh.step(); }
        assert_eq!(w.state_hash(), fresh.state_hash());
    }
}

#[test]
fn a_restart_undoes_terrain_edits_trees_deposits_and_the_fight() {
    let mut w = crate::roadcheck::busy_village(true);
    for (t, c) in &busy_log() { if *t > 0 { while w.tick < *t { w.step(); } } apply(&mut w, c); }
    let before_terrain = World::new(1337, 0, 0).height_at(-12.0, 24.0);
    assert_ne!(w.height_at(-12.0, 24.0), before_terrain, "the ground was reshaped");
    assert!(w.start_raid(0.7, &[12, 6, 6, 2, 0, 0], 1), "a raid begins");
    for _ in 0..40 { w.step(); }
    assert!(w.battle_active(), "a raid is on");
    w.restart();
    assert!(!w.battle_active(), "the battle is gone");
    assert_eq!(w.height_at(-12.0, 24.0), before_terrain, "the ground is as it was made");
    assert_eq!(w.deposits_flat(), World::new(1337, 0, 0).deposits_flat(), "deposits back to their first amounts");
    assert!(w.felled_flat().is_empty());
    assert_eq!(w.population(), 10);
}

#[test]
fn restarting_twice_or_at_once_is_the_same_as_once() {
    let mut w = play(7, &busy_log());
    w.restart(); let a = w.state_hash();
    w.restart(); assert_eq!(a, w.state_hash());
    let mut z = World::new(7, 0, 0); z.restart(); assert_eq!(z.state_hash(), World::new(7, 0, 0).state_hash(), "restarting a new village changes nothing");
}

/// The owner plays many commands, restarts, plays a few more; a replica that is sent the same log command by command (stepping to each tick as the live messages do, and
/// restarting on the spot) ends where the owner is, and so does a copy rebuilt from only the commands since the restart.
#[test]
fn many_commands_a_restart_and_a_few_more_agree_between_owner_and_replica() {
    let seed = 1337u64;
    let mut log = busy_log();
    log.push((400, C::Cheat(3, 0, 0)));
    log.push((420, C::Restart));
    let after = vec![(0u64, C::Cheat(3, 0, 0)), (5, C::Place(HOUSE, 12, 4)), (30, C::Place(FARM, -14, 6)), (60, C::Level(10, 20, 6))];
    // the owner: one world that is never rebuilt, the clock restarted by the restart itself
    let mut owner = World::new(seed, 0, 0);
    for (t, c) in &log { while owner.tick < *t { owner.step(); } apply(&mut owner, c); }
    assert_eq!(owner.tick(), 0);
    for (t, c) in &after { while owner.tick < *t { owner.step(); } apply(&mut owner, c); }
    // a replica that has followed the old village and gets the restart live
    let mut replica = World::new(seed, 0, 0);
    for (t, c) in &log[..log.len() - 1] { while replica.tick < *t { replica.step(); } apply(&mut replica, c); }
    while replica.tick < 420 { replica.step(); }
    apply(&mut replica, &C::Restart);
    for (t, c) in &after { while replica.tick < *t { replica.step(); } apply(&mut replica, c); }
    assert_eq!(owner.state_hash(), replica.state_hash());
    // a newcomer replays the whole log, restart included
    let mut whole = log.clone(); whole.extend(after.iter().map(|(t, c)| (*t, c.clone())));
    let mut newcomer = World::new(seed, 0, 0);
    for (t, c) in &whole { while newcomer.tick < *t { newcomer.step(); } apply(&mut newcomer, c); }   // (the clock restarts with the restart: later commands carry the new clock)
    // (the `after` ticks are new-life ticks, the `log` ticks old-life ones: the loop above steps each world to the tick its command names)
    assert_eq!(owner.state_hash(), newcomer.state_hash());
    // an archived-and-cut log (only the commands of the new epoch, as the web client keeps it) gives the same village again
    let mut cut = World::new(seed, 0, 0); cut.set_style((1 << 24) + 77); cut.restart();
    for (t, c) in &after { while cut.tick < *t { cut.step(); } apply(&mut cut, c); }
    assert_eq!(owner.state_hash(), cut.state_hash());
}

#[test]
fn the_flag_is_kept_everything_else_goes() {
    let mut w = World::new(1337, 0, 0);
    w.set_style((1 << 24) + 5); w.cheat(3, 0, 0); w.place(HOUSE, 12, 4, 0);
    w.restart();
    assert_eq!(w.style, (1 << 24) + 5);
    assert_eq!(w.building_count(), 1);
}
