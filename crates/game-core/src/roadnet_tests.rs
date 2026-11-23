//! Tests of what roads are for (roadnet.rs): the castle's roads, the pace of a workplace with and without one, and the surface and design of a road.
use super::*;

const SAWMILL_K: u8 = 5;
fn rich() -> World { let mut w = World::new(1337, 0, 0); w.stock = [30000; N_RES]; w.cheat(3, 0, 0); w }

/// The points of a straight road from the node of building `a` to the node of building `b`, as `lay_road` takes them (relative to the origin).
fn road_between(w: &World, a: usize, b: usize) -> Vec<i32> {
    let (na, nb) = (roadline_nodes(w, a), roadline_nodes(w, b));
    let n = (((na.0 - nb.0).hypot(na.1 - nb.1)) / 7.0).ceil().max(2.0) as i32;
    let mut v = vec![];
    for k in 0..=n { let t = k as f32 / n as f32; v.push((na.0 + (nb.0 - na.0) * t - w.ox as f32).round() as i32); v.push((na.1 + (nb.1 - na.1) * t - w.oy as f32).round() as i32); }
    v
}
fn roadline_nodes(w: &World, i: usize) -> (f32, f32) { let f = w.road_nodes_flat(); let o = f.chunks(4).find(|c| c[2] as usize == i).expect("a node"); (o[0], o[1]) }

/// A workplace (a sawmill) beyond the castle's yard, and a road from the hall to it that the core accepts (its door turned and the road bent until one fits).
fn sawmill_far_from_the_hall(w: &mut World) -> (usize, Vec<i32>) {
    let hall = (w.buildings[0].x, w.buildings[0].y);
    let yard = footprint(TOWN_HALL, w.buildings[0].tier) + roadnet::CASTLE_YARD + footprint(SAWMILL_K, 0) * 0.5;
    for r in (32..70).step_by(2) { for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1)] { for rot in 0..8u8 {
        let (x, y) = ((dx * r) as i32, (dy * r) as i32);
        let i = w.place(SAWMILL_K, x, y, rot);
        if i < 0 { continue; }
        let i = i as usize; let b = &w.buildings[i];
        if (b.x - hall.0).hypot(b.y - hall.1) > yard + 1.0 {
            let pts = road_between(w, 0, i);
            let mut trial = world_restore(&w.snapshot()).unwrap();
            if trial.lay_road(&pts) == 0 { return (i, pts); }
        }
        w.demolish(i as u32);
    } } }
    panic!("no room for a sawmill");
}

fn pace(w: &mut World, i: usize) -> u32 {
    w.buildings[i].progress = 0; w.buildings[i].beff = 100; w.staffing();
    let before = w.buildings[i].progress;
    w.step();
    w.buildings[i].progress.saturating_sub(before)
}

#[test]
fn a_workplace_far_from_the_castle_works_at_half_pace_until_a_road_joins_it() {
    let mut w = rich(); let (f, road) = sawmill_far_from_the_hall(&mut w);
    assert_eq!(w.road_access_flat()[f], 0, "no road yet");
    w.stock[PL as usize] = 0; w.stock[W as usize] = 500;
    assert_eq!(w.production_problems_flat(f as u32).first(), Some(&9), "the client is told why");
    let slow = pace(&mut w, f);
    let code = w.lay_road(&road); assert_eq!(code, 0, "a road from the castle to the farm");
    assert_eq!(w.road_access_flat()[f], 1, "joined");
    assert!(w.road_joined_flat()[f] == 1);
    let fast = pace(&mut w, f);
    assert!(slow > 0 && fast == slow * 2, "full pace is twice the slow one: {slow} vs {fast}");
}

#[test]
fn a_road_that_does_not_reach_the_castle_does_not_help() {
    let mut w = rich(); let (f, _road) = sawmill_far_from_the_hall(&mut w);
    // a second workplace beside it, and a road between the two: neither is joined to the castle
    let (fx, fy) = (w.buildings[f].x - w.ox as f32, w.buildings[f].y - w.oy as f32);
    let mut done = false;
    'search: for (dx, dy) in [(16, 0), (-16, 0), (0, 16), (0, -16), (14, 14), (-14, -14), (14, -14), (-14, 14)] { for rot in 0..8u8 {
        let mut t = world_restore(&w.snapshot()).unwrap();
        let g = t.place(SAWMILL_K, fx as i32 + dx, fy as i32 + dy, rot);
        if g < 0 { continue; }
        let pts = road_between(&t, f, g as usize);
        if t.lay_road(&pts) == 0 { w = t; done = true; break 'search; }
    } }
    assert!(done, "a road between two sawmills");
    assert!(w.buildings.iter().any(|b| b.kind == ROAD));
    let acc = w.road_access_flat();
    assert_eq!(acc[f], 0, "joined to a neighbour, not to the castle");
    let joined = w.road_joined_flat(); let g = w.buildings.len() - 1 - w.buildings.iter().filter(|b| b.kind == ROAD).count();
    assert_eq!((joined[f], joined[g]), (0, 0), "the pair is not part of the castle's roads");
}

#[test]
fn buildings_in_the_castles_yard_and_houses_need_no_road() {
    let mut w = rich();
    let near = w.place(WELL, 12, 0, 0); let house = w.place(HOUSE, 50, 10, 0);
    let a = w.road_access_flat();
    if near >= 0 { assert_eq!(a[near as usize], 1); }
    if house >= 0 { assert_eq!(a[house as usize], 1, "a house makes nothing: it needs no road"); }
    assert_eq!(a[0], 1, "the hall is joined to itself");
}

#[test]
fn a_stretch_is_resurfaced_as_one_and_costs_by_the_piece() {
    let mut w = rich(); let (f, road) = sawmill_far_from_the_hall(&mut w);
    assert_eq!(w.lay_road(&road), 0);
    let pieces: Vec<u32> = (0..w.buildings.len() as u32).filter(|&i| w.buildings[i as usize].kind == ROAD).collect();
    let n = pieces.len() as i32; assert!(n >= 2, "{n}");
    assert_eq!(w.road_stretch(pieces[n as usize / 2]).len() as i32, n, "one chain of pieces is one stretch");
    let st = w.stocks()[ST as usize];
    assert_eq!(w.upgrade_road(pieces[0]), 0);
    assert!(pieces.iter().all(|&i| w.buildings[i as usize].tier == 1), "every piece is gravel now");
    assert_eq!(w.stocks()[ST as usize], st - n, "a stone a piece for gravel");
    for want in 2..=3u8 { assert_eq!(w.upgrade_road(pieces[0]), 0); assert!(pieces.iter().all(|&i| w.buildings[i as usize].tier == want)); }
    assert_eq!(w.upgrade_road(pieces[0]), -10, "flagstones are the best there is");
    assert_eq!(w.upgrade_road(0), -1, "the town hall is not a road");
    let f = w.road_lines_flat(); let mut o = 0; let mut seen = false;
    while o + 4 < f.len() { if f[o] == 1.0 { assert_eq!(f[o + 2], 3.0, "the drawn lines carry the surface"); seen = true; } o += 5 + 2 * f[o + 4] as usize; }
    assert!(seen);
}

#[test]
fn a_junction_ends_a_stretch() {
    let mut w = rich(); let (f, road) = sawmill_far_from_the_hall(&mut w);
    assert_eq!(w.lay_road(&road), 0);
    let main: Vec<u32> = (0..w.buildings.len() as u32).filter(|&i| w.buildings[i as usize].kind == ROAD).collect();
    // a side road that ends on a piece in the middle of the main one
    let mid = main[main.len() / 2]; let (mx, my) = (w.buildings[mid as usize].x, w.buildings[mid as usize].y);
    let (tx, ty) = (mx - w.ox as f32, my - w.oy as f32);
    assert_eq!(w.lay_road(&[tx as i32, ty as i32 + 8, tx as i32, ty as i32 + 16, tx as i32, ty as i32 + 24]), 0);
    let all: Vec<u32> = (0..w.buildings.len() as u32).filter(|&i| w.buildings[i as usize].kind == ROAD).collect();
    let side: Vec<u32> = all.iter().copied().filter(|i| !main.contains(i)).collect();
    assert!(!side.is_empty());
    assert_eq!(w.road_stretch(side[0]).iter().filter(|i| main.contains(i)).count() <= 1, true, "the side road reaches the junction piece but not beyond it");
    assert_eq!(w.upgrade_road(side[0]), 0);
    assert!(main.iter().filter(|&&i| w.buildings[i as usize].tier == 1).count() <= 1, "the main road is not resurfaced with it");
}

#[test]
fn design_options_cover_a_stretch_and_wait_for_the_surface() {
    let mut w = rich(); let (f, road) = sawmill_far_from_the_hall(&mut w);
    assert_eq!(w.lay_road(&road), 0);
    let p: Vec<u32> = (0..w.buildings.len() as u32).filter(|&i| w.buildings[i as usize].kind == ROAD).collect();
    assert_eq!(options(ROAD).len(), 4);
    assert_eq!(w.set_road_option(p[0], 0, true), 0, "trees on dirt");
    assert!(p.iter().all(|&i| w.buildings[i as usize].opts & 1 != 0));
    assert_eq!(w.set_road_option(p[0], 2, true), -10, "benches need gravel");
    assert_eq!(w.set_road_option(p[0], 3, true), -10, "lanterns need cobbles");
    w.upgrade_road(p[0]); assert_eq!(w.set_road_option(p[0], 2, true), 0);
    w.upgrade_road(p[0]); assert_eq!(w.set_road_option(p[0], 3, true), 0);
    let f = w.road_lines_flat(); let mut o = 0; let mut seen = false;
    while o + 4 < f.len() { if f[o] == 1.0 { assert_eq!(f[o + 3] as u8, 0b1101, "trees, benches and lanterns in the drawn lines"); seen = true; } o += 5 + 2 * f[o + 4] as usize; }
    assert!(seen);
    assert_eq!(w.set_road_option(p[0], 0, false), 0);
    assert!(p.iter().all(|&i| w.buildings[i as usize].opts & 1 == 0), "and off again");
    let poor = { let mut v = rich(); let (f, road) = sawmill_far_from_the_hall(&mut v); v.lay_road(&road); v.stock = [0; N_RES]; v };
    let q = (0..poor.buildings.len() as u32).find(|&i| poor.buildings[i as usize].kind == ROAD).unwrap();
    let mut poor = poor; assert_eq!(poor.set_road_option(q, 0, true), -6, "no planks or stone");
    assert_eq!(poor.upgrade_road(q), -6);
}

#[test]
fn the_surface_and_design_survive_a_save_and_are_part_of_the_hash() {
    let mut w = rich(); let (f, road) = sawmill_far_from_the_hall(&mut w);
    assert_eq!(w.lay_road(&road), 0);
    let p = (0..w.buildings.len() as u32).find(|&i| w.buildings[i as usize].kind == ROAD).unwrap();
    let h0 = w.state_hash();
    w.upgrade_road(p); w.set_road_option(p, 1, true);
    assert_ne!(w.state_hash(), h0, "a resurfaced road is another state");
    let back = world_restore(&w.snapshot()).expect("restores");
    assert_eq!(back.road_lines_flat(), w.road_lines_flat());
    assert_eq!(back.road_access_flat(), w.road_access_flat());
    assert_eq!(back.state_hash(), w.state_hash());
}
