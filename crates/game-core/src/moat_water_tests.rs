//! Moat water must never float: its level is capped by the lowest bank round each piece, and it never lies over ground that was not dug.
use super::*;

fn ring(w: &mut World, r: f32, n: usize) -> usize {
    let mut ok = 0;
    for i in 0..n { let a = i as f32 / n as f32 * std::f32::consts::TAU; if w.place(MOAT, (a.cos() * r).round() as i32, (a.sin() * r).round() as i32, 0) >= 0 { ok += 1; } }
    ok
}
fn world(seed: u64, ox: i32, oy: i32) -> World { let mut w = World::new(seed, ox, oy); w.stock = [30000; N_RES]; w.cheat(3, 0, 0); w }

/// (worst height of a water surface above the undug ground it lies over, number of samples where water lies over undug ground that is below it, pieces looked at)
fn survey(w: &World) -> (f32, usize, usize) {
    let (mut worst, mut bad, mut n) = (0.0f32, 0usize, 0usize);
    for p in w.moat_water.iter() {
        n += 1;
        for ri in 0..=6 { let r = p[2] + 0.6 - ri as f32 * 0.25;   // the outer ring of the drawn disc, over the bank
            for k in 0..16 {
                let a = k as f32 * std::f32::consts::TAU / 16.0; let (x, y) = (p[0] + a.cos() * r, p[1] + a.sin() * r);
                let (dug, nat) = (w.height_core(x, y, true), w.height_core(x, y, false));
                if dug < p[3] && nat >= 0.4 && nat < p[3] - 0.05 {   // (undug ground under 0.4 is the sea or its shore: water there is not floating)
                    bad += 1; worst = worst.max(p[3] - nat); }
            }
        }
    }
    (worst, bad, n)
}

#[test]
fn moat_water_never_lies_over_undug_ground_on_any_layout() {
    let mut report = vec![];
    for (seed, ox, oy) in [(1337u64, 0, 0), (1337, 150, -90), (7, 0, 0), (7, -200, 120), (42, 60, 60), (42, 400, -300), (99, -500, 200)] {
        for r in [14.0f32, 24.0, 40.0] {
            let mut w = world(seed, ox, oy);
            if ring(&mut w, r, (r * 2.2) as usize) < 8 { continue; }
            let (worst, bad, n) = survey(&w);
            report.push(format!("seed {seed} at {ox},{oy} r{r}: {n} pieces, {bad} bad samples, worst {worst:.2}"));
            assert_eq!(bad, 0, "floating water: {}", report.last().unwrap());
        }
    }
    assert!(report.len() >= 8, "enough fixture layouts were placed: {report:?}");
}

#[test]
fn moat_water_stays_under_every_bank_beside_a_slanted_chain_and_after_levelling() {
    let mut w = world(1337, 150, -90);
    for i in 0..14 { w.place(MOAT, -26 + i * 4, 12 + i, 0); }
    assert_eq!(survey(&w).1, 0, "a diagonal chain over a slope");
    assert_eq!(w.level_ground(-5, 8, 6), 0, "levelling a patch beside the chain");
    assert_eq!(survey(&w).1, 0, "after the level ground tool");
}

#[test]
fn neighbouring_pieces_have_water_levels_that_differ_by_a_gentle_slope_only() {
    for (ox, oy) in [(0, 0), (150, -90), (-200, 120)] {
        let mut w = world(7, ox, oy);
        ring(&mut w, 24.0, 52);
        for p in &w.moat_water { for q in &w.moat_water { let d = (p[0] - q[0]).hypot(p[1] - q[1]); if d < 9.0 { assert!((p[3] - q[3]).abs() <= 0.05 * d + 0.01, "step of {:.2} over {d:.1}", (p[3] - q[3]).abs()); } } }
    }
}

#[test]
fn every_point_dug_below_the_water_is_under_a_drawn_disc() {
    for (seed, ox, oy, r) in [(1337u64, 0, 0, 24.0f32), (7, 0, 0, 24.0), (42, 60, 60, 40.0)] {
        let mut w = world(seed, ox, oy);
        ring(&mut w, r, (r * 2.2) as usize);
        let (mut under, mut uncovered, mut worst) = (0, 0, 0.0f32);
        for xi in -70..=70 { for yi in -70..=70 {
            let (x, y) = (ox as f32 + xi as f32, oy as f32 + yi as f32);
            let near = w.moat_water.iter().filter(|p| (p[0] - x).hypot(p[1] - y) < p[2] + 4.0).map(|p| (p[3], (p[0] - x).hypot(p[1] - y) - p[2])).collect::<Vec<_>>();
            if near.is_empty() { continue; }
            let lvl = near.iter().map(|q| q.0).fold(f32::MAX, f32::min);
            let h = w.height_core(x, y, true);
            if h < lvl - 0.05 { under += 1; if !w.moat_water.iter().any(|p| (p[0] - x).hypot(p[1] - y) < p[2] + 0.6) { uncovered += 1; worst = worst.max(lvl - h); } }
        } }
        assert!(under > 500, "enough of the ditch was looked at: {under}");
        assert_eq!(uncovered, 0, "seed {seed} r{r}: ditch ground below the water with no disc over it (worst depth {worst:.2})");
    }
}
