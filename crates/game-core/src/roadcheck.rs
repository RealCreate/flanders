//! A busy village for the tests (farms turned every way, gardens, parks, markets, houses, walls with a gate, a moat with a drawbridge).
use super::*;

fn rich() -> World { let mut w = World::new(1337, 0, 0); w.stock = [30000; N_RES]; w.cheat(3, 0, 0); w }

fn ring(w: &mut World, r: f32, n: usize, kind: u8, skip: usize) {
    for i in 0..n { if i == skip { continue; } let a = i as f32 / n as f32 * std::f32::consts::TAU; w.place(kind, (a.cos() * r).round() as i32, (a.sin() * r).round() as i32, 0); }
}

/// A busy village: two walled-in rings of things inside a moat, a gate, a drawbridge, and houses and fields outside.
pub(crate) fn busy_village(with_moat: bool) -> World {
    let mut w = rich();
    // (kind, x, y, rot, upgrades): placed nearest first, and the ones that did not fit yet are tried again (the land a village may use grows with what stands in it)
    let mut todo: Vec<(u8, i32, i32, u8, u32)> = vec![];
    for (k, (x, y)) in [(22, 4), (-24, 6), (6, 26), (-8, -26), (26, -18), (-26, -20), (30, 20), (-30, 24)].into_iter().enumerate() { todo.push((FARM, x, y, (k % 8) as u8, (k % 3) as u32)); }
    for (k, (x, y)) in [(16, -8), (-16, -10), (-14, 16), (14, 18)].into_iter().enumerate() { todo.push((GARDEN, x, y, (k * 2 % 8) as u8, (k % 3) as u32)); }
    todo.extend([(PARK, 8, -18, 1, 2), (PARK, -12, 8, 5, 0), (MARKET, 0, 14, 0, 1), (MARKET, -20, -4, 3, 3), (MARKET, 18, 8, 6, 0), (BARRACKS, 24, -30, 0, 0), (WELL, 4, 4, 0, 0), (TOWER, -28, -34, 0, 0)]);
    for (x, y) in [(10, 8), (-8, 4), (4, -10), (-4, -14), (12, -2), (-18, 12), (20, -12), (-10, -20), (2, 20), (-22, 20), (28, 4), (-30, 0), (0, 32), (34, -6), (-34, -10), (6, -34)] { todo.push((HOUSE, x, y, 0, 0)); }
    for t in todo.iter_mut() { t.1 = t.1 * 3 / 2; t.2 = t.2 * 3 / 2; }   // (spread out: the upgraded farms are big)
    todo.sort_by_key(|t| t.1 * t.1 + t.2 * t.2);
    for _ in 0..4 { let mut left = vec![]; for t in todo { let i = w.place(t.0, t.1, t.2, t.3); if i >= 0 { for _ in 0..t.4 { let _ = w.upgrade(i as u32); } } else { left.push(t); } } todo = left; }
    eprintln!("busy village: {} of the buildings did not fit: {:?}", todo.len(), todo.iter().map(|t| (t.0, t.1, t.2, w.can_place(t.0, t.1, t.2))).collect::<Vec<_>>());
    if with_moat {
        eprintln!("build radius {}; wall codes {:?}; moat codes {:?}", w.build_radius(), (0..8).map(|k| { let a = k as f32 / 8.0 * 6.283; w.can_place(WALL, (a.cos() * 62.0) as i32, (a.sin() * 62.0) as i32) }).collect::<Vec<_>>(), (0..8).map(|k| { let a = k as f32 / 8.0 * 6.283; w.can_place(MOAT, (a.cos() * 74.0) as i32, (a.sin() * 74.0) as i32) }).collect::<Vec<_>>());
        ring(&mut w, 56.0, 60, WALL, 0); w.place(GATE, 56, 0, 0);
        ring(&mut w, 66.0, 76, MOAT, 0); w.place(DRAWBRIDGE, 66, 0, 2);
        for (k, (x, y)) in [(76, 6), (78, -10), (0, 78), (-12, 76), (-76, 6), (14, -80)].into_iter().enumerate() { let i = w.place(if k < 4 { HOUSE } else { FARM }, x, y, (k * 3 % 8) as u8); if i >= 0 && k >= 4 { let _ = w.upgrade(i as u32); } }
    }
    w
}

