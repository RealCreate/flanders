//! The resource ledger: complete (sources minus sinks is the change of the stock), harmless (never in the hash) and the same on every replica.
use super::*;

fn village() -> World {
    let mut w = World::new(1337, 0, 0); w.stock = [400; N_RES]; w.population = 24;
    for (k, x, y) in [(HOUSE, 12, 4), (HOUSE, 17, 4), (HOUSE, 22, 4), (FARM, -14, 8), (FARM, -14, 16), (HOUSE, -12, 6)] { w.place(k, x, y, 0); }
    w.after_change(); w
}
/// (gained, lost) per resource over the whole ledger.
fn sums(flat: &[i32]) -> ([i32; N_RES], [i32; N_RES]) {
    let (mut g, mut l) = ([0; N_RES], [0; N_RES]);
    for e in flat[3..].chunks(4) { g[e[1] as usize] += e[2]; l[e[1] as usize] += e[3]; }
    (g, l)
}

#[test]
fn sources_minus_sinks_is_the_change_of_the_stock() {
    let mut w = village();
    w.stock = [400; N_RES]; let start = w.stock;
    for _ in 0..200 { w.step(); }   // (under one day: the whole run is inside the window)
    let flat = w.ledger_flat(); assert_eq!(flat[0], 200, "ticks covered");
    let (g, l) = sums(&flat);
    for r in 0..N_RES { assert_eq!(g[r] - l[r], w.stock[r] - start[r], "resource {r}: +{} -{}", g[r], l[r]); }
}

#[test]
fn orders_between_ticks_and_one_off_changes_are_accounted_for_too() {
    let mut w = village(); let start = w.stock; w.step();
    assert!(w.place(HOUSE, 30, 4, 0) >= 0);   // a command between ticks
    for _ in 0..90 { w.step(); }
    w.stock[GR as usize] += 7;   // (and a meddling test: still no gap)
    for _ in 0..30 { w.step(); }
    let flat = w.ledger_flat(); let (g, l) = sums(&flat);
    let orders = flat[1] as usize + ledger::EX_ORDERS;
    assert!(flat[3..].chunks(4).any(|e| e[0] as usize == orders && e[3] > 0), "the house's cost is among the orders");
    for r in 0..N_RES { assert_eq!(g[r] - l[r], w.stock[r] - start[r], "resource {r}"); }
}

#[test]
fn every_meal_and_every_harvest_has_its_own_line() {
    let mut w = village(); w.stock[GR as usize] = 300; w.stock[SF as usize] = 0; w.army[0] = 10;
    for _ in 0..120 { w.step(); }
    let flat = w.ledger_flat(); let nk = flat[1] as usize;
    let line = |cat: usize, r: u8| flat[3..].chunks(4).find(|e| e[0] as usize == cat && e[1] == r as i32).map(|e| (e[2], e[3])).unwrap_or((0, 0));
    let (_, villagers) = line(nk + ledger::EX_VILLAGERS, GR); let (_, soldiers) = line(nk + ledger::EX_SOLDIERS, GR);
    assert!(villagers > 0 && soldiers > 0, "villagers {villagers}, soldiers {soldiers}");
    assert!(soldiers < villagers, "ten soldiers eat less than twenty-four villagers");
    let (farm_in, _) = line(FARM as usize, GR); assert!(farm_in > 0, "the farms' grain is its own line");
    let total = (24 + 10 + 5) / 10 * 120; assert!((villagers + soldiers - total).abs() <= 120, "about {total} eaten, ledger says {}", villagers + soldiers);
}

#[test]
fn the_ledger_never_touches_the_state_hash_and_replicas_agree() {
    let mut a = village(); let mut b = village();
    for i in 0..400 { a.step(); b.step(); if i % 100 == 0 { let _ = a.ledger_flat(); } }
    assert_eq!(a.state_hash(), b.state_hash());
    assert_eq!(a.ledger_flat(), b.ledger_flat(), "the same moves give the same numbers");
    let mut c = village(); for _ in 0..400 { c.step(); }
    assert_eq!(c.ledger_flat(), a.ledger_flat());
}

#[test]
fn the_window_rolls_over_one_day() {
    let mut w = village(); for _ in 0..(DAY * 3) { w.step(); }
    let flat = w.ledger_flat(); assert!(flat[0] as u64 <= DAY && flat[0] as u64 >= DAY - ledger::BUCKET, "covered {}", flat[0]);
    let (g, l) = sums(&flat); for r in 0..N_RES { assert!(g[r] >= 0 && l[r] >= 0); }
}
