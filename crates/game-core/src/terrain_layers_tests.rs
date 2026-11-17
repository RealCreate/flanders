//! Terrain layering (docs/TERRAIN.md): natural land -> flatten discs and level-tool patches (later wins) -> raise/lower, moats and rivers relative to that surface -> drawbridge banks -> roads -> pads.
use super::*;
use crate::flatten::level_cost;

fn world() -> World { let mut w = World::new(1337, 0, 0); w.stock = [30000; N_RES]; w.cheat(3, 0, 0); w }
fn ring(w: &mut World, r: f32, n: usize, kind: u8) -> usize {
    (0..n).filter(|&i| { let a = i as f32 / n as f32 * std::f32::consts::TAU; { let c = w.place(kind, (a.cos() * r).round() as i32, (a.sin() * r).round() as i32, 0); c >= 0 } }).count()
}
/// The biggest step between neighbouring samples (0.5 apart) on a grid over the village, and where.
fn max_step(w: &World, half: f32) -> (f32, f32, f32) {
    let n = (half * 4.0) as i32; let mut worst = (0.0f32, 0.0, 0.0);
    let at = |i: i32, j: i32| w.height_at(-half + i as f32 * 0.5, -half + j as f32 * 0.5);
    let mut prev: Vec<f32> = (0..=n).map(|j| at(0, j)).collect();
    for i in 1..=n { for j in 0..=n {
        let h = at(i, j);
        let s = (h - prev[j as usize]).abs(); if s > worst.0 { worst = (s, -half + i as f32 * 0.5, -half + j as f32 * 0.5); }
        if j > 0 { let s = (h - at(i, j - 1)).abs(); if s > worst.0 { worst = (s, -half + i as f32 * 0.5, -half + j as f32 * 0.5); } }
        prev[j as usize] = h;
    } }
    worst
}
/// Every sample on a grid, as bits (to compare worlds exactly).
fn grid(w: &World) -> Vec<u32> { let mut v = vec![]; for i in -20..=20 { for j in -20..=20 { v.push(w.height_at(i as f32 * 3.0, j as f32 * 3.0).to_bits()); } } v }
fn bed(h: f32) -> f32 { MOAT_BED + (h - CHANNEL_REF_TOP).max(0.0) }
const SMOOTH: f32 = 2.2;   // steepest designed slope without ditches, per 0.5 (a 24 high hill eased over 9 units)
const DITCHED: f32 = 8.5;  // and with a ditch (about 12 deep over 1.6)

#[test]
fn flatten_then_moat_digs_relative_to_the_levelled_ground_and_the_water_follows() {
    for h in [3.0f32, 5.0, 12.0, 24.0] {
        let mut w = world();
        assert_eq!(w.flatten(60, h), 0);
        assert!((w.height_ground(25.0, 0.0) - h).abs() < 0.01, "flat at {h}");
        let n = ring(&mut w, 24.0, 52, MOAT); assert!(n > 20, "{n} pieces at flat {h}");
        let hole = w.height_at(24.0, 0.0);
        assert!((hole - bed(h)).abs() < 0.2, "moat bed at flat {h}: {hole}, want {}", bed(h));
        assert!((w.height_at(31.0, 0.0) - h).abs() < 0.05, "the ground beside the moat is untouched");
        let water = w.moat_level_at(24.0, 0.0);
        assert!(water > bed(h) + 1.0 && water < h, "water {water} under the rim {h}");
        let (s, x, y) = max_step(&w, 45.0);
        assert!(s < DITCHED, "step {s} at {x},{y} (flat {h})");
    }
}

#[test]
fn moat_then_flatten_keeps_the_ditch_and_the_water_moves_with_the_new_ground() {
    for h in [3.0f32, 9.0, 18.0] {
        let mut w = world();
        ring(&mut w, 24.0, 52, MOAT);
        assert!(w.height_at(24.0, 0.0) < -3.0);
        let before = w.moat_level_at(24.0, 0.0);
        assert_eq!(w.flatten(60, h), 0);
        assert!((w.height_at(24.0, 0.0) - bed(h)).abs() < 0.2, "still dug, at {}", w.height_at(24.0, 0.0));
        let after = w.moat_level_at(24.0, 0.0);
        assert!((after - (h - 0.8)).abs() < 0.2, "water {after} follows a flat at {h} (was {before})");
        let (s, x, y) = max_step(&w, 45.0); assert!(s < DITCHED, "step {s} at {x},{y} (flat {h})");
    }
}

#[test]
fn raise_and_lower_are_relative_to_the_levelled_ground() {
    for h in [2.0f32, 7.0, 15.0] {
        let mut w = world();
        w.flatten(60, h);
        assert!(w.place(RAISE, 14, 10, 0) >= 0 && w.place(LOWER, -14, 10, 0) >= 0);
        assert!((w.height_at(14.0, 10.0) - (h + 2.2)).abs() < 0.05, "raised {}", w.height_at(14.0, 10.0));
        assert!((w.height_at(-14.0, 10.0) - (h - 2.2)).abs() < 0.05, "lowered {}", w.height_at(-14.0, 10.0));
        assert!(max_step(&w, 45.0).0 < SMOOTH);
        // flattening again: the earthworks dig relative to the new ground
        w.flatten(60, h + 1.0);
        assert!((w.height_at(14.0, 10.0) - (h + 3.2)).abs() < 0.05, "the raising follows the new ground: {}", w.height_at(14.0, 10.0));
        assert!((w.height_at(-14.0, 10.0) - (h - 1.2)).abs() < 0.05);
    }
}

#[test]
fn the_level_tool_over_a_moat_takes_the_pieces_in_it_and_never_half_fills_the_rest() {
    let mut w = world();
    w.flatten(60, 5.0);
    ring(&mut w, 24.0, 52, MOAT);
    let pieces = |w: &World| w.buildings.iter().filter(|b| b.kind == MOAT).count();
    let n0 = pieces(&w);
    assert_eq!(w.level_ground(24, 0, 6, 8.0), 0);
    assert!(pieces(&w) < n0, "pieces inside the patch are gone");
    assert!((w.height_at(24.0, 0.0) - 8.0).abs() < 0.05, "the patch is at its height: {}", w.height_at(24.0, 0.0));
    // every piece still standing is still a full-depth ditch, however close it is to the patch
    for b in w.buildings.iter().filter(|b| b.kind == MOAT) {
        assert!((w.height_at(b.x, b.y) - bed(5.0)).abs() < 0.7, "piece at {},{} is {}", b.x, b.y, w.height_at(b.x, b.y));
    }
    for p in w.moat_water.iter() { assert!(p[3] >= 0.4 && p[3] < 8.0, "water {}", p[3]); }
    assert!(max_step(&w, 45.0).0 < DITCHED);
}

#[test]
fn repeated_flattening_the_last_one_wins_and_old_patches_do_not_come_back() {
    let mut w = world();
    w.flatten(40, 5.0);
    assert_eq!(w.level_ground(20, 0, 8, 9.0), 0);
    assert!((w.height_at(20.0, 0.0) - 9.0).abs() < 0.05);
    assert_eq!(w.flatten(50, 3.0), 0);
    for (x, y) in [(20.0, 0.0), (22.0, 3.0), (30.0, 0.0), (-25.0, 10.0)] { assert!((w.height_ground(x, y) - 3.0).abs() < 0.05, "at {x},{y}: {}", w.height_ground(x, y)); }
    assert!(w.flats.is_empty(), "the patch inside the new disc is dropped");
    // a patch made after a flatten wins over it; a later flatten that covers only part of a patch leaves it on top
    assert_eq!(w.level_ground(30, 0, 4, 6.0), 0);
    assert_eq!(w.flatten(10, 12.0), 0);
    assert_eq!(w.flats.len(), 1);
    assert!((w.height_ground(30.0, 0.0) - 6.0).abs() < 0.05);
    assert!(max_step(&w, 45.0).0 < SMOOTH);
}

#[test]
fn flatten_sets_what_stands_inside_on_the_new_ground() {
    let mut w = world();
    assert!(w.place(HOUSE, 14, 6, 0) >= 0);
    w.flatten(40, 12.0);
    for b in w.buildings.iter().filter(|b| matches!(b.kind, HOUSE | TOWN_HALL)) { assert!((b.pad_h - 12.0).abs() < 0.01, "{} pad {}", b.kind, b.pad_h); assert!((w.height_at(b.x, b.y) - 12.0).abs() < 0.05); }
    w.flatten(40, 2.0);
    assert!((w.height_at(w.ox as f32 + 14.0, w.oy as f32 + 6.0) - 2.0).abs() < 0.05, "no pedestal left under the house");
    assert!(max_step(&w, 45.0).0 < SMOOTH);
}

#[test]
fn flatten_with_a_drawbridge_keeps_deck_gate_and_banks_level() {
    for h in [4.0f32, 10.0] {
        let mut w = world();
        for x in [-8, 8] { w.place(WALL, x, 14, 0); }
        let gate = w.place(GATE, 0, 14, 0); assert!(gate >= 0);
        ring(&mut w, 24.0, 52, MOAT);
        let br = w.place(DRAWBRIDGE, 0, 24, 0); assert!(br >= 0);
        w.flatten(60, h);
        let (gh, bh) = (w.buildings[gate as usize].pad_h, w.buildings[br as usize].pad_h);
        assert!((gh - h).abs() < 0.01 && (bh - gh).abs() < 0.01, "gate {gh} deck {bh} flat {h}");
        for e in [-1.0f32, 1.0] { let y = 24.0 + 12.4 * e; assert!((w.height_at(0.0, y) - h).abs() < 0.3, "bank at {y}: {}", w.height_at(0.0, y)); }
        assert!(w.height_at(0.0, 24.0) < 0.0, "water under the deck");
        assert!(max_step(&w, 45.0).0 < DITCHED);
    }
}

#[test]
fn level_heights_are_checked_and_cost_the_same_as_auto() {
    let mut w = world(); w.flatten(40, 5.0);
    assert_eq!(w.level_check(20, 0, 6, 0.5), -28, "below the shore");
    assert_eq!(w.level_check(20, 0, 6, 24.5), -28);
    assert_eq!(w.level_check(20, 0, 6, f32::NAN), -28);
    assert_eq!(w.level_check(20, 0, 6, 12.0), 0);
    assert!((w.level_target(20, 0, 6, 12.0) - 12.0).abs() < 0.07);
    assert!((w.level_target(20, 0, 6, -1.0) - 5.0).abs() < 0.5, "auto takes the land round it");
    assert_eq!(w.level_target(20, 0, 6, 99.0), -1000.0);
    let s0 = w.stock; assert_eq!(w.level_ground(20, 0, 6, 12.0), 0);
    let manual = (s0[W as usize] - w.stock[W as usize], s0[ST as usize] - w.stock[ST as usize]);
    assert_eq!(manual, (level_cost(6)[0].1, level_cost(6)[1].1));
}

#[test]
fn every_replica_gets_the_same_ground_after_a_mixed_log() {
    let run = || {
        let mut w = world();
        w.flatten(50, 6.0); ring(&mut w, 22.0, 48, MOAT); w.place(RAISE, 10, 8, 0);
        w.level_ground(-22, 0, 7, 9.5); w.flatten(30, 4.0); w.place(LOWER, -12, -10, 0);
        w.level_ground(22, 0, 5, -1.0); w.level_ground(0, 30, 6, 7.0);
        for _ in 0..20 { w.step(); }
        (w.state_hash(), grid(&w), w.moat_water_flat().iter().map(|v| v.to_bits()).collect::<Vec<_>>())
    };
    assert!(run() == run(), "same log, same ground, same water");
}
