//! Do a farm's fields lie on top of the ground at every tier and every turn? The fields are flat at the farm's pad height, so the ground under all of them must be levelled to it
//! (it used to be levelled only under the circle of the farm, and the fields that a bigger farm adds lay out in the slope, buried).
use super::*;

fn rich() -> World { let mut w = World::new(1337, 0, 0); w.stock = [30000; N_RES]; w.cheat(3, 0, 0); w }

/// Spots on slopes where a farm can be placed, steepest first.
fn sloped_spots(w: &World, n: usize) -> Vec<(i32, i32, f32)> {
    let mut v = vec![];
    for x in (-60..=60).step_by(5) { for y in (-60..=60).step_by(5) {
        if w.can_place(FARM, x, y) != 0 { continue; }
        let (cx, cy) = ((w.ox + x) as f32, (w.oy + y) as f32);
        let hs: Vec<f32> = [(0.0, 0.0), (8.0, 0.0), (-8.0, 0.0), (0.0, 8.0), (0.0, -8.0), (11.0, 11.0), (-11.0, -11.0), (11.0, -11.0), (-11.0, 11.0)].iter().map(|(a, b)| w.height_at(cx + a, cy + b)).collect();
        let sl = hs.iter().cloned().fold(f32::MIN, f32::max) - hs.iter().cloned().fold(f32::MAX, f32::min);
        v.push((x, y, sl));
    } }
    v.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap());
    v.truncate(n); v
}

/// How far the ground rises above the field surface, over the fields of a farm (the worst point, in the farm's own frame turned by its rotation).
pub(crate) fn worst_buried(w: &World, i: usize) -> f32 {
    let b = &w.buildings[i];
    let th = b.rot as f32 * std::f32::consts::FRAC_PI_4; let (c, s) = (th.cos(), th.sin());
    let mut worst = f32::MIN;
    for r in pathnet::field_rects(b.kind, b.tier) {
        let (nx, nz) = (((r.2 * 2.0) / 0.7).ceil() as i32, ((r.3 * 2.0) / 0.7).ceil() as i32);
        for p in 0..=nx { for q in 0..=nz {
            let (lx, lz) = (r.0 - r.2 + 2.0 * r.2 * p as f32 / nx as f32, r.1 - r.3 + 2.0 * r.3 * q as f32 / nz as f32);
            let (wx, wy) = (b.x + lx * c + lz * s, b.y - lx * s + lz * c);   // (the model is turned by th about the vertical: local (x, z) lands here)
            worst = worst.max(w.height_at(wx, wy) - (b.pad_h + 0.02 + 0.1));   // the field box is 0.1 thick, 0.02 above the pad
        } }
    }
    worst
}

#[test]
fn farm_fields_lie_above_the_ground_at_every_tier_and_turn() {
    let probe = rich(); let spots = sloped_spots(&probe, 6);
    assert!(!spots.is_empty(), "there are places to put a farm");
    eprintln!("slopes tried: {:?}", spots);
    let mut worst_all = f32::MIN; let mut n = 0;
    for &(x, y, _) in &spots { for rot in 0..8u8 {
        let mut w = rich();
        let i = w.place(FARM, x, y, rot);
        if i < 0 { continue; }
        for tier in 0..=3u8 {
            if tier > 0 { assert_eq!(w.upgrade(i as u32), 0, "upgrade to tier {tier}"); }
            let worst = worst_buried(&w, i as usize); n += 1; worst_all = worst_all.max(worst);
            assert!(worst < 0.05, "farm at {x},{y} turn {rot} tier {tier}: the ground rises {worst:.2} above its fields");
        }
    } }
    eprintln!("{n} farm states checked, ground at worst {worst_all:.3} above the field surface");
}
