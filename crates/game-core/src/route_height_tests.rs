//! The march router's ground heights (`height_ground_in`, over the ditches, earthworks and drawbridges it keeps) must be exactly the heights of `height_ground`, to the bit:
//! routes decide where armies walk, so any difference would split the villages of two players apart.
use super::*;

fn world(seed: u64, ox: i32, oy: i32) -> World { let mut w = World::new(seed, ox, oy); w.stock = [30000; N_RES]; w.cheat(3, 0, 0); w }

/// A village with a ring of moat, a short river, raised and lowered earth and a drawbridge, among ordinary buildings, as a late village has.
fn busy_village(seed: u64) -> World {
    let mut w = world(seed, 0, 0);
    for i in 0..16 { let a = i as f32 / 16.0 * std::f32::consts::TAU; w.place(HOUSE, (a.cos() * 18.0).round() as i32, (a.sin() * 18.0).round() as i32, 0); w.cheat(3, 0, 0); }
    for i in 0..60 { let a = i as f32 / 60.0 * std::f32::consts::TAU; w.place(MOAT, (a.cos() * 40.0).round() as i32, (a.sin() * 40.0).round() as i32, (i % 3) as u8); w.cheat(3, 0, 0); }
    for i in 0..8 { w.place(RIVER, 52 + i * 3, -20, 0); w.cheat(3, 0, 0); }
    w.place(RAISE, -30, 30, 0); w.cheat(3, 0, 0);
    w.place(LOWER, 30, 30, 0); w.cheat(3, 0, 0);
    let s = w.drawbridge_snap(40, 0);
    if s.len() >= 3 { w.place(DRAWBRIDGE, s[0].round() as i32, s[1].round() as i32, s[2] as u8); }
    w
}

#[test]
fn router_heights_are_the_ground_heights_to_the_bit() {
    let mut checked = 0;
    for seed in [1337u64, 7, 42] {
        let w = busy_village(seed);
        let edits: Vec<Building> = w.buildings.iter().filter(|b| is_edit(b.kind) || b.kind == DRAWBRIDGE).cloned().collect();
        assert!(edits.iter().filter(|b| b.kind == MOAT).count() >= 20, "seed {seed}: the moat was placed");
        // a fine grid over the village and its banks, plus points off the grid (routes sample anywhere along a segment)
        for j in -70..=70 { for i in -70..=70 {
            for (fx, fy) in [(0.0f32, 0.0f32), (0.37, 0.71)] {
                let (x, y) = (w.ox as f32 + i as f32 + fx, w.oy as f32 + j as f32 + fy);
                let (a, b) = (w.height_ground(x, y), w.height_ground_in(x, y, &edits));
                assert_eq!(a.to_bits(), b.to_bits(), "seed {seed} at ({x}, {y}): {a} against {b}");
                checked += 1;
            }
        } }
    }
    assert!(checked > 100_000);
}
