//! The multiplayer promise: a copy of a village that replays the owner's command log arrives at exactly the owner's state, whatever else the copy's host
//! did in between (draw the village every tick, ask for routes, step in bursts, be built from the log in one go). These tests record a busy session in one
//! world and replay it in others with different habits, comparing `state_hash` tick by tick. The first tick at which two worlds differ names the culprit.
use game_core::World;

#[derive(Clone, Debug)]
enum C {
    Place(u8, i32, i32, u8), Upgrade(u32), Demolish(u32), Train(u8, u32), Cheat(u8, i32, i32), Form([u32; 5]), March(u32, f32, f32), Recall(u32), Halt(u32),
    Link(f32, f32), Bridge(u32, bool), Gate(u32, bool), Raid(f32, [u32; 5], i32), Batch(Vec<i32>), Split(u32, [u32; 5]),
}

fn apply(w: &mut World, c: &C) {
    match c {
        C::Place(k, x, y, r) => { w.place(*k, *x, *y, *r); }
        C::Upgrade(i) => { w.upgrade(*i); }
        C::Demolish(i) => { w.demolish(*i); }
        C::Train(k, n) => { w.train(*k, *n); }
        C::Cheat(a, b, d) => { w.cheat(*a, *b, *d); }
        C::Form(u) => { w.det_form(u); }
        C::March(id, x, y) => { w.det_march(*id, *x, *y, false, 0.0, 0.0); }
        C::Recall(id) => { w.det_recall(*id); }
        C::Halt(id) => { w.det_halt(*id); }
        C::Link(x, y) => { w.link_village(*x, *y); }
        C::Bridge(i, up) => { w.drawbridge_set(*i, *up); }
        C::Gate(i, s) => { w.gate_set(*i, *s); }
        C::Raid(a, u, t) => { w.start_raid(*a, u, *t); }
        C::Batch(v) => { w.place_batch(v); }
        C::Split(id, u) => { w.det_split(*id, u); }
    }
}

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 { self.0 ^= self.0 << 13; self.0 ^= self.0 >> 7; self.0 ^= self.0 << 17; self.0 }
    fn below(&mut self, n: u64) -> u64 { self.next() % n }
    fn range(&mut self, lo: i32, hi: i32) -> i32 { lo + self.below((hi - lo + 1) as u64) as i32 }
}

/// Everything a client's renderer asks the core every tick. These calls fill the core's caches (paths, overlays) at moments of the host's choosing.
fn look(w: &World) -> usize {
    let mut n = w.det_flat().len() + w.buildings_flat().len() + w.roads_flat().len() + w.road_paths_flat().len() + w.felled_flat().len() + w.bridges_flat().len();
    let f = w.det_flat(); for o in (0..f.len()).step_by(16) { n += w.det_path(f[o] as u32).len(); }
    n + w.net_route(-30.0, -30.0, 60.0, 40.0).len() + w.walk_route(10.0, 10.0, -50.0, 80.0).len()
}

/// A busy session on a live world: returns the log, with the tick each command was issued at, and the hash after each tick.
fn session(seed: u64, ox: i32, oy: i32, ticks: u64, mut rng: Rng, watch: bool) -> (Vec<(u64, C)>, Vec<u64>, Vec<f32>) {
    let mut w = World::new(seed, ox, oy);
    let mut log: Vec<(u64, C)> = vec![]; let mut hashes = vec![];
    let issue = |w: &mut World, log: &mut Vec<(u64, C)>, c: C| { apply(w, &c); log.push((w.tick(), c)); };
    issue(&mut w, &mut log, C::Cheat(3, 0, 0));
    for t in 0..ticks {
        if t % 25 == 0 { issue(&mut w, &mut log, C::Cheat(3, 0, 0)); }   // keep the store full: the test is about replay, not about the economy
        if t % 6 == 0 {
            let n = w.building_count().max(1) as u64;
            let c = match rng.below(24) {
                0..=5 => { let ang = rng.below(628) as f32 / 100.0; let r = rng.range(10, 70) as f32; C::Place([0u8, 1, 4, 0, 19, 18, 1, 25, 2, 3][rng.below(10) as usize], (ang.cos() * r) as i32, (ang.sin() * r) as i32, rng.below(8) as u8) }
                6 => C::Upgrade(rng.below(n) as u32),
                7 => C::Demolish(rng.below(n) as u32 + 1),
                8 => C::Train(rng.below(4) as u8, rng.range(1, 6) as u32),
                9 | 10 => { let u = [rng.range(0, 6) as u32, rng.range(0, 3) as u32, rng.range(0, 3) as u32, 0, 0]; C::Form(u) }
                11..=14 => { let ang = rng.below(628) as f32 / 100.0; let r = rng.range(80, 260) as f32; C::March(rng.range(1, 4) as u32, ox as f32 + ang.cos() * r, oy as f32 + ang.sin() * r) }
                15 => C::Recall(rng.range(1, 4) as u32),
                16 => C::Halt(rng.range(1, 4) as u32),
                17 => { let ang = rng.below(628) as f32 / 100.0; C::Link(ox as f32 + ang.cos() * 400.0, oy as f32 + ang.sin() * 400.0) }
                18 => C::Bridge(rng.below(n) as u32, rng.below(2) == 0),
                19 => C::Gate(rng.below(n) as u32, rng.below(2) == 0),
                20 => { let items: Vec<i32> = (0..rng.range(2, 8)).flat_map(|i| { let a = i as f32 * 0.9; [2, (a.cos() * 26.0) as i32, (a.sin() * 26.0) as i32, 0] }).collect(); C::Batch(items) }
                21 => C::Split(rng.range(1, 4) as u32, [rng.range(0, 2) as u32, 0, 0, 0, 0]),
                22 => C::Cheat(2, rng.range(0, 2), 12),
                _ => C::Raid(rng.below(628) as f32 / 100.0, [3, 2, 1, 0, 0], 7),
            };
            issue(&mut w, &mut log, c);
        }
        w.step();
        if watch { let _ = look(&w); }
        hashes.push(w.state_hash());
    }
    if std::env::var("STATS").is_ok() { eprintln!("seed {seed}: {} commands, {} buildings, {} felled, {} armies, {} road paths, pop {}", log.len(), w.building_count(), w.felled_flat().len() / 3, w.det_flat().len() / 16, w.road_paths_flat().len(), w.population()); }
    (log, hashes, w.road_paths_flat())
}

/// Replay `log` into a fresh world; `habit` runs after every tick (the host doing whatever it does); returns the first tick whose hash differs from `want`.
fn replay(seed: u64, ox: i32, oy: i32, log: &[(u64, C)], want: &[u64], habit: &mut dyn FnMut(&mut World, u64)) -> Option<(usize, usize)> { replay_roads(seed, ox, oy, log, want, habit).0 }
/// Also returns the paths the replica ended with (derived data that is not in the hash but decides where soldiers walk).
fn replay_roads(seed: u64, ox: i32, oy: i32, log: &[(u64, C)], want: &[u64], habit: &mut dyn FnMut(&mut World, u64)) -> (Option<(usize, usize)>, Vec<f32>) {
    let mut w = World::new(seed, ox, oy); let mut i = 0;
    for t in 0..want.len() as u64 {
        while i < log.len() && log[i].0 <= w.tick() { apply(&mut w, &log[i].1); i += 1; }
        w.step(); habit(&mut w, t);
        if w.state_hash() != want[t as usize] { return (Some((t as usize + 1, i)), w.road_paths_flat()); }
    }
    (None, w.road_paths_flat())
}

fn check(seed: u64, ox: i32, oy: i32, ticks: u64) {
    let (log, hashes, roads) = session(seed, ox, oy, ticks, Rng(0x2545F4914F6CDD1D ^ seed), true);
    let say = |what: &str, r: Option<(usize, usize)>| if let Some((t, c)) = r { panic!("seed {seed} at {ox},{oy}: replay ({what}) diverged at tick {t} after {c} of {} commands", log.len()) };
    say("silent", replay(seed, ox, oy, &log, &hashes, &mut |_, _| {}));
    say("drawn every tick", replay(seed, ox, oy, &log, &hashes, &mut |w, _| { look(w); }));
    say("drawn now and then", replay(seed, ox, oy, &log, &hashes, &mut |w, t| if t % 7 == 3 { look(w); }));
    let (_, r2) = replay_roads(seed, ox, oy, &log, &hashes, &mut |_, _| {});
    assert!(r2 == roads, "seed {seed}: the replica ended with different paths from the owner's ({} against {} numbers)", r2.len(), roads.len());
    say("routes asked for only at the end", replay(seed, ox, oy, &log, &hashes, &mut |w, t| if t + 1 == hashes.len() as u64 { look(w); }));
}

#[test]
fn a_replay_with_other_habits_reaches_the_same_state() {
    game_core::warm_navigation(1337);
    for seed in [1337u64] { check(seed, 0, 0, 2500); }
}

#[test]
fn a_replay_far_from_the_origin_reaches_the_same_state() {
    game_core::warm_navigation(1337);
    check(1337, 220, -140, 2500);
}

/// The overlay and route caches are derived data: wiping them (as a fresh replica effectively does) must never change a result.
#[test]
fn a_world_rebuilt_from_its_log_matches_one_that_lived_it() {
    game_core::warm_navigation(1337);
    for k in 0..3u64 {
        let (log, hashes, _) = session(1337, 0, 0, 2000, Rng(0xDEADBEEF + k * 977), k % 2 == 0);
        let r = replay(1337, 0, 0, &log, &hashes, &mut |_, _| {});
        assert!(r.is_none(), "run {k}: diverged at {r:?}");
    }
}

#[test]
fn the_hash_is_the_fold_of_its_named_parts_and_a_difference_names_its_section() {
    let names: Vec<&str> = game_core::state_hash_part_names().leak().split(',').collect();
    let mut a = World::new(1337, 0, 0); a.cheat(3, 0, 0); a.place(0, 12, 4, 0);
    let b = { let mut b = World::new(1337, 0, 0); b.cheat(3, 0, 0); b.place(0, 12, 4, 0); b };
    assert_eq!(a.state_hash_parts().len(), names.len(), "one name for each part");
    assert_eq!(a.state_hash_parts(), b.state_hash_parts());
    assert_eq!(a.state_hash(), b.state_hash());
    let which = |x: &World, y: &World| -> Vec<&str> { x.state_hash_parts().iter().zip(y.state_hash_parts()).enumerate().filter(|(_, (p, q))| *p != q).map(|(i, _)| names[i]).collect() };
    let mut c = World::new(1337, 0, 0); c.cheat(3, 0, 0); c.place(0, 12, 4, 0); c.place(0, 18, 8, 0);
    assert!(which(&a, &c).contains(&"buildings"), "an extra building shows in the buildings part: {:?}", which(&a, &c));
    let mut d = World::new(1337, 0, 0); d.cheat(3, 0, 0); d.place(0, 12, 4, 0); d.cheat(2, 0, 5);
    assert_eq!(which(&a, &d), vec!["army"], "five more spearmen change only the army");
    let mut e = World::new(1337, 0, 0); e.cheat(3, 0, 0); e.place(0, 12, 4, 0); e.cheat(0, 3, -50);
    assert_eq!(which(&a, &e), vec!["stock"]);
    assert_ne!(a.state_hash(), c.state_hash());
}

#[test]
fn the_rules_fingerprint_is_stable_and_depends_on_the_map() {
    game_core::warm_navigation(1337);
    let f = game_core::rules_fingerprint(1337);
    assert_eq!(f, game_core::rules_fingerprint(1337), "the same build always gives the same fingerprint");
    assert_eq!(f.len(), 16);
}

/// A raid led by the Warlord: the horn, the plate, the rage and the slam clocks are all part of the hash, so an owner and a replica that watch the same fight in different ways stay equal tick by tick.
#[test]
fn a_boss_raid_replays_tick_by_tick() {
    game_core::warm_navigation(1337);
    let seed = 1337u64;
    let script: Vec<(u64, C)> = vec![
        (0, C::Cheat(3, 0, 0)), (1, C::Place(0, 14, 4, 0)), (1, C::Place(0, 18, 4, 0)), (2, C::Place(19, 0, 18, 0)), (2, C::Place(19, 14, -12, 0)), (3, C::Place(18, -14, 14, 0)),
        (4, C::Cheat(2, 0, 12)), (4, C::Cheat(2, 1, 8)), (4, C::Cheat(2, 2, 5)), (10, C::Cheat(9, 150, 500)), (60, C::Cheat(3, 0, 0)), (200, C::Cheat(9, 400, 900)),
    ];
    let mut w = World::new(seed, 0, 0); let mut log: Vec<(u64, C)> = vec![]; let mut hashes = vec![]; let mut i = 0;
    let (mut boss_ticks, mut max_hp_seen, mut aura_seen) = (0, 0.0f32, false);
    for _ in 0..420u64 {
        while i < script.len() && script[i].0 <= w.tick() { apply(&mut w, &script[i].1); log.push((w.tick(), script[i].1.clone())); i += 1; }
        w.step();
        let b = w.battle_boss(); if !b.is_empty() { boss_ticks += 1; max_hp_seen = max_hp_seen.max(b[3]); }
        if w.battle_units_flat().chunks(14).any(|u| u[10] > 0.0 && u[13] > 0.0) { aura_seen = true; }
        hashes.push(w.state_hash());
    }
    assert!(boss_ticks > 40 && max_hp_seen > 300.0, "the script really fights a boss ({boss_ticks} ticks, {max_hp_seen} hit points)");
    assert!(aura_seen, "and the horn sounds");
    let said = |what: &str, r: Option<(usize, usize)>| if let Some((t, c)) = r { panic!("boss raid, replay ({what}) diverged at tick {t} after {c} of {} commands", log.len()) };
    said("silent", replay(seed, 0, 0, &log, &hashes, &mut |_, _| {}));
    said("drawn every tick", replay(seed, 0, 0, &log, &hashes, &mut |w, _| { look(w); let _ = (w.battle_units_flat(), w.battle_boss(), w.take_shots()); }));
    said("drawn now and then", replay(seed, 0, 0, &log, &hashes, &mut |w, t| if t % 5 == 2 { let _ = (w.battle_units_flat(), w.battle_boss()); }));
}
