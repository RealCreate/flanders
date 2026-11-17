//! The level-ground tool (see flatten.rs): the stuck pit of the report, the shoulder, the limits and what refuses a patch.
use super::*;

fn rich() -> World { let mut w = World::new(1337, 0, 0); w.stock = [30000; N_RES]; w.cheat(3, 0, 0); w.flatten(40, 5.0); w }

/// A spot (relative to the origin) well inside the land with nothing built within 30 units.
fn free_spot(w: &World) -> (i32, i32) {
    for &(x, y) in &[(-24, 18), (24, 18), (-24, -18), (24, -18), (0, 26), (0, -26), (-30, 0), (30, 0)] {
        let (fx, fy) = ((w.ox + x) as f32, (w.oy + y) as f32);
        if w.in_territory(fx, fy) && !w.buildings.iter().any(|b| !is_edit(b.kind) && (b.x - fx).hypot(b.y - fy) < 30.0) { return (x, y); }
    }
    panic!("no free spot");
}

/// The pit of the report: a ditch with a lowered square round it, deep, with a bit of water at the bottom.
fn dig_pit(w: &mut World, (px, py): (i32, i32)) {
    for (dx, dy) in [(0, 0), (4, 0), (-4, 0), (0, 4), (0, -4)] { w.place(LOWER, px + dx, py + dy, 0); }
    assert!(w.place(MOAT, px, py, 0) >= 0, "the pit's ditch");
}

#[test]
fn raising_cannot_fill_a_ditch_but_levelling_can() {
    let mut w = rich();
    let (px, py) = free_spot(&w);
    let (fx, fy) = ((w.ox + px) as f32, (w.oy + py) as f32);
    let rim = w.height_at(fx + 12.0, fy);
    dig_pit(&mut w, (px, py));
    assert!(w.height_at(fx, fy) < -2.0, "a deep pit");
    // raising on top of it does nothing about the bed of a ditch, and a second raising cannot go on the same spot
    assert!(w.place(RAISE, px, py, 0) >= 0);
    assert!(w.place(RAISE, px, py, 0) < 0, "no second raising on the same spot");
    assert!(w.height_at(fx, fy) < -2.0, "still a pit: a ditch bed is dug after the raisings are added");
    let hash0 = w.state_hash();
    let v0 = w.terrain_ver;
    assert_eq!(w.level_check(px, py, 8), 0);
    assert_eq!(w.level_ground(px, py, 8), 0);
    assert!(w.terrain_ver > v0 && w.state_hash() != hash0, "the change is part of the hashed state");
    for (dx, dy) in [(0.0, 0.0), (3.0, 2.0), (-5.0, 0.0), (0.0, 6.5), (7.0, -3.0)] {
        assert!((w.height_at(fx + dx, fy + dy) - rim).abs() < 0.35, "ground at ({dx}, {dy}) is {} not {rim}", w.height_at(fx + dx, fy + dy));
    }
    assert!(!w.buildings.iter().any(|b| is_edit(b.kind) && (b.x - fx).hypot(b.y - fy) < 8.0), "the ditch and earthworks in the patch are gone");
    assert!(w.stock[W as usize] < 30000 && w.stock[ST as usize] < 30000, "it costs wood and stone");
}

#[test]
fn a_bump_is_cut_down_and_a_crater_filled() {
    let mut w = rich();
    let (px, py) = free_spot(&w);
    let (fx, fy) = ((w.ox + px) as f32, (w.oy + py) as f32);
    let rim = w.height_at(fx + 12.0, fy);
    w.place(RAISE, px, py, 0);
    assert!(w.height_at(fx, fy) > rim + 1.5);
    w.craters.push([fx + 3.0, fy, 4.0, 2.0]);
    assert_eq!(w.level_ground(px, py, 7), 0);
    assert!((w.height_at(fx, fy) - rim).abs() < 0.3);
    assert!((w.height_at(fx + 3.0, fy) - rim).abs() < 0.3, "the crater is filled");
    assert!(w.craters.is_empty());
}

#[test]
fn the_shoulder_eases_into_the_land() {
    let mut w = rich();
    let (px, py) = free_spot(&w);
    let (fx, fy) = ((w.ox + px) as f32, (w.oy + py) as f32);
    w.place(RAISE, px + 9, py, 0);   // a bump just outside the patch: the ring sees it, the shoulder has to bring the ground down to the patch
    assert_eq!(w.level_ground(px, py, 5), 0);
    let mut prev = w.height_at(fx, fy); let mut x = 0.5;
    while x < 14.0 { let h = w.height_at(fx + x, fy); assert!((h - prev).abs() < 0.6, "a step of {} at {x}", (h - prev).abs()); prev = h; x += 0.5; }
}

#[test]
fn limits_and_refusals() {
    let mut w = rich();
    let (px, py) = free_spot(&w);
    assert_eq!(w.level_check(px, py, 2), -24);
    assert_eq!(w.level_check(px, py, 15), -24);
    assert_eq!(w.level_check(300, 300, 6), -2, "outside the village's land");
    // a building standing in it
    assert!(w.place(HOUSE, px + 14, py, 0) >= 0);
    let i = w.buildings.iter().position(|b| !is_edit(b.kind) && DEFS[b.kind as usize].pad && b.kind != TOWN_HALL).expect("a building");
    let (bx, by) = (w.buildings[i].x, w.buildings[i].y);
    w.buildings[i].pad_h += 3.0;
    assert_eq!(w.level_check((bx - w.ox as f32) as i32, (by - w.oy as f32) as i32, 6), -26);
    // cannot afford
    w.stock = [0; N_RES];
    assert_eq!(w.level_check(px, py, 6), -6);
    assert_eq!(w.level_ground(px, py, 6), -6);
    assert!(w.flats.is_empty(), "a refused patch changes nothing");
}

#[test]
fn every_replica_levels_alike() {
    let run = || {
        let mut w = rich();
        let (px, py) = free_spot(&w);
        dig_pit(&mut w, (px, py));
        for _ in 0..30 { w.step(); }
        assert_eq!(w.level_ground(px, py, 9), 0);
        for _ in 0..30 { w.step(); }
        (w.state_hash(), w.height_at((w.ox + px) as f32 + 2.0, (w.oy + py) as f32 - 1.0).to_bits())
    };
    assert_eq!(run(), run());
}
