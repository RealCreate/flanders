//! Winter: lean but fair. A prepared village gets through it, an unprepared one suffers (slower than it used to), and the books still balance.
use super::*;

/// The standard opening: the starting stocks and a few buildings, with `cutters` woodcutters at the nearest forest.
fn village(cutters: usize) -> World {
    let mut w = World::new(1337, 0, 0);
    for (k, x, y) in [(HOUSE, 12, 4), (HOUSE, 17, 4), (HOUSE, 22, 4), (HOUSE, -12, 6), (FARM, -14, 14), (FARM, -14, 22), (FARM, 14, 14)] { w.place(k, x, y, 0); }
    let mut placed = 0;
    'f: for r in (6..60).step_by(4) { for a in 0..16 {
        if placed >= cutters { break 'f; }
        let t = a as f32 * std::f32::consts::TAU / 16.0; let (dx, dy) = ((r as f32 * t.cos()) as i32, (r as f32 * t.sin()) as i32);
        if terrain::forest_near(w.seed, dx as f32, dy as f32, 12.0) > 0.3 && w.place(4, dx, dy, 0) >= 0 { placed += 1; }
    } }
    assert_eq!(placed, cutters, "forest for the woodcutters");
    w.after_change(); w
}

/// Plays `days`, keeping the grain and the gold topped up (this is about firewood and cold, not about farming).
fn play(w: &mut World, days: u64, wood: Option<i32>) {
    for _ in 0..days * DAY { w.step(); w.stock[GR as usize] = w.stock[GR as usize].max(400); if let Some(k) = wood { w.stock[W as usize] = k; } }
}

#[test]
fn the_winter_numbers_are_the_documented_ones() {
    let mut w = village(0); w.tick = DAY * SEASON_DAYS * 3;
    assert_eq!(w.grain_percent(), WINTER_GRAIN as u32);
    assert!(WINTER_GRAIN >= 50 && WINTER_GRAIN_HAYSTACKS > WINTER_GRAIN, "winter grain is {WINTER_GRAIN}% ({WINTER_GRAIN_HAYSTACKS}% with haystacks)");
    let n = w.winter_numbers(); assert_eq!(n.len(), 21);
    assert_eq!((n[0], n[1]), (WINTER_GRAIN, WINTER_GRAIN_HAYSTACKS));
    assert_eq!(n[2], w.winter_need() * (DAY / WINTER_BURN_EVERY) as i32);
    assert_eq!(n[3], w.stock[W as usize] * 10 / n[2], "days of wood left, in tenths");
    assert_eq!(n[14], (SEASON_DAYS * 4 - SEASON_DAYS * 3) as i32, "a full winter ahead");
    w.tick = DAY * 5; assert_eq!(w.winter_numbers()[8], 25, "25 days to winter from day 5");
}

#[test]
fn a_prepared_village_gets_through_three_winters() {
    let mut w = village(3);
    play(&mut w, SEASON_DAYS * 4 * 3 + 2, None);
    assert!(w.tick > DAY * SEASON_DAYS * 4 * 3 - 1);
    assert!(w.died[DIED_COLD] <= 2, "{} froze", w.died[DIED_COLD]);
    assert!(w.died[DIED_HUNGER] <= 2, "{} starved", w.died[DIED_HUNGER]);
    assert!(w.population >= 8, "population {}", w.population);
}

/// How many are dead of cold after one winter without any firewood, from the first winter day on.
fn frozen_in_a_woodless_winter(pop: u32, days: u64) -> (u32, u32) {
    let mut w = village(0); w.population = pop; w.children = 4; w.elders = 4; w.tick = DAY * SEASON_DAYS * 3;
    let mut first_death = 0;
    for d in 0..days { for _ in 0..DAY { w.step(); w.stock[W as usize] = 0; w.stock[GR as usize] = 400; }
        if first_death == 0 && w.died[DIED_COLD] > 0 { first_death = d as u32 + 1; } }
    (w.died[DIED_COLD], first_death)
}

#[test]
fn an_unprepared_village_still_suffers_but_slowly() {
    let (dead, first) = frozen_in_a_woodless_winter(30, SEASON_DAYS);
    assert!(dead >= 1, "ten days without wood cost someone their life");
    assert!(first > WINTER_COLD_GRACE as u32, "nobody dies in the grace days (first death on day {first})");
    assert!(dead <= 8, "but not a massacre: {dead} dead in ten days");
}

#[test]
fn cold_hurts_happiness_first_and_a_little_wood_keeps_the_hearth_lit() {
    let mut w = village(0); w.tick = DAY * SEASON_DAYS * 3; w.population = 30;
    w.stock[W as usize] = 1; for _ in 0..WINTER_BURN_EVERY { w.step(); w.stock[GR as usize] = 400; }
    assert!(w.warmth(), "a single log on the hearth is warmth");
    let h0 = w.happiness(); w.warm = false; w.cold_days = 0; let h1 = w.happiness(); w.cold_days = 3; let h2 = w.happiness();
    assert!(h1 < h0 && h2 < h1, "{h0} {h1} {h2}");
    w.cold_days = WINTER_COLD_GRACE; assert_eq!(w.cold_death_chance(), 0);
    w.cold_days = WINTER_COLD_GRACE + 2; assert_eq!(w.cold_death_chance(), 2 * WINTER_DEATH_STEP);
    w.cold_days = 99; assert_eq!(w.cold_death_chance(), WINTER_DEATH_MAX);
}

#[test]
fn the_books_balance_through_a_winter() {
    let mut w = village(2); w.tick = DAY * SEASON_DAYS * 3 - 10;
    let start = w.stock;
    for _ in 0..50 { w.step(); }
    let flat = w.ledger_flat();
    let (mut g, mut l) = ([0; N_RES], [0; N_RES]);
    for e in flat[3..].chunks(4) { g[e[1] as usize] += e[2]; l[e[1] as usize] += e[3]; }
    for r in 0..N_RES { assert_eq!(g[r] - l[r], w.stock[r] - start[r], "resource {r}"); }
    let mut cold = village(0); cold.tick = DAY * SEASON_DAYS * 3; cold.stock[W as usize] = 100; cold.population = 30;
    for _ in 0..40 { cold.step(); }
    assert!(cold.stock[W as usize] < 100, "winter burns wood");
}
