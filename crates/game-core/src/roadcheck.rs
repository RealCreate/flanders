//! Do the drawn roads keep to the free ground that the invisible path network keeps to? A busy village (farms turned every way, gardens, parks, markets, houses, walls with a gate, a moat with a
//! drawbridge) is built, and every drawn road segment is sampled along its length, with the width of its ribbon, against the solid part of every building, the fields and beds, the runs of wall, and water.
use super::*;

/// Half the width of the ribbon that is drawn solid (web/src/render/paths.ts: 1.15, 1.45 once the hall is a castle, but never more than the room the road has). The soft edge beyond it fades out.
const RIBBON_HALF: f32 = 1.15;

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

fn seg_dist(px: f32, py: f32, a: (f32, f32), b: (f32, f32)) -> f32 {
    let (dx, dy) = (b.0 - a.0, b.1 - a.1); let l2 = (dx * dx + dy * dy).max(1e-6);
    let t = (((px - a.0) * dx + (py - a.1) * dy) / l2).clamp(0.0, 1.0);
    (px - (a.0 + dx * t)).hypot(py - (a.1 + dy * t))
}

/// What is wrong with a road point: its ribbon (a disc of `half` round the centre line) touches the solid part of a building, a field or bed, a wall, or water. None if it is clear.
fn fault(w: &World, x: f32, y: f32, half: f32) -> Option<String> {
    for (i, b) in w.buildings.iter().enumerate() {
        match b.kind {
            WALL | FENCE | GATE | MOAT | RIVER | RAISE | LOWER | ROAD | BRIDGE | DRAWBRIDGE | TOLL => continue,   // (a toll post is driven through: its hut and posts are checked in roadnet_tests)
            _ => {}
        }
        let d = (x - b.x).hypot(y - b.y);
        if d < solid_radius(b.kind, b.tier) + half { return Some(format!("inside the solid part of building {i} (kind {}, tier {}): {d:.2} from its middle", b.kind, b.tier)); }
        if pathnet::field_distance(b, x, y) < half { return Some(format!("in the fields of building {i} (kind {}, tier {}, rot {})", b.kind, b.tier, b.rot)); }
    }
    let (segs, _) = w.wall_lines();
    for s in &segs { let d = seg_dist(x, y, (s.ax, s.ay), (s.bx, s.by)); if d < s.r + half { return Some(format!("{d:.2} from a wall (it is {:.1} thick)", s.r)); } }
    // water, over the whole width of the ribbon
    for (ox, oy) in [(0.0f32, 0.0f32), (half, 0.0), (-half, 0.0), (0.0, half), (0.0, -half)] {
        let (px, py) = (x + ox, y + oy);
        if w.height_ground(px, py) < 0.2 && !w.on_deck(px, py) { return Some(format!("in the water at {px:.1},{py:.1}")); }
    }
    None
}

fn faults(w: &World, half: f32) -> (usize, usize, Vec<String>) {
    let (mut samples, mut bad, mut msgs) = (0usize, 0usize, vec![]);
    for s in w.roads_flat().chunks(6) {
        if s[4] == s[5] { continue; }   // a door's own short road runs inside its building's plot, from the door out
        let l = (s[2] - s[0]).hypot(s[3] - s[1]); let n = (l / 0.5).ceil().max(1.0) as i32;
        for k in 0..=n {
            let f = k as f32 / n as f32; let (x, y) = (s[0] + (s[2] - s[0]) * f, s[1] + (s[3] - s[1]) * f);
            samples += 1;
            if let Some(m) = fault(w, x, y, half) { bad += 1; if msgs.len() < 8 { msgs.push(format!("road {}->{} at {x:.1},{y:.1}: {m}", s[4], s[5])); } }
        }
    }
    (samples, bad, msgs)
}

fn road_length(w: &World) -> f32 { w.roads_flat().chunks(6).filter(|s| s[4] != s[5]).map(|s| (s[2] - s[0]).hypot(s[3] - s[1])).sum() }

/// Every road sample (with its ribbon) is on free ground, whether or not the village has a moat. A road that has no way with all its width squeezes through with `ROAD_TIGHT`
/// (the drawing narrows the ribbon there); that may happen on a few samples of a crowded village, never on many.
#[test]
fn drawn_roads_never_touch_a_building_a_field_a_wall_or_water() {
    for moat in [false, true] {
        let w = busy_village(moat);
        let (samples, bad_tight, msgs_tight) = faults(&w, pathnet::ROAD_TIGHT);
        let (_, bad, msgs) = faults(&w, RIBBON_HALF);
        eprintln!("moat {moat}: {} buildings, {} road pieces, {samples} samples, {bad} without the full ribbon room, {bad_tight} touching, length {:.0}", w.buildings.len(), w.roads_flat().len() / 6, road_length(&w));
        for m in &msgs { eprintln!("  {m}"); }
        assert!(samples > 150, "the village has roads ({samples} samples)");
        assert_eq!(bad_tight, 0, "{bad_tight} road samples touch an obstacle, e.g. {msgs_tight:?}");
        assert!(bad * 20 <= samples, "{bad} of {samples} road samples are squeezed, e.g. {msgs:?}");
    }
}

/// The new roads are not absurdly longer than the old ones, and every building the old finder could link still has a road to its parent.
#[test]
fn roads_over_the_network_are_not_absurdly_long_and_reach_every_building() {
    for moat in [false, true] {
        let w = busy_village(moat);
        let (mut old_len, mut linked, mut old_linked) = (0.0f32, 0usize, 0usize);
        let have: std::collections::HashSet<u32> = w.road_paths.iter().flat_map(|p| [p.0, p.1]).collect();
        let mut seen: std::collections::HashSet<u32> = Default::default();
        for (c, p, pts) in &w.road_paths {
            if !seen.insert(*c) { continue; }
            if let Some(o) = w.route_local(*c as usize, *p as usize) { old_linked += 1; old_len += o.windows(2).map(|q| (q[1].0 - q[0].0).hypot(q[1].1 - q[0].1)).sum::<f32>(); linked += 1; let _ = pts; }
        }
        let new_len: f32 = w.road_paths.iter().filter(|p| seen.contains(&p.0)).map(|p| p.2.windows(2).map(|q| (q[1].0 - q[0].0).hypot(q[1].1 - q[0].1)).sum::<f32>()).sum();
        let straight: f32 = w.road_paths.iter().filter(|p| seen.contains(&p.0)).map(|p| (w.buildings[p.0 as usize].x - w.buildings[p.1 as usize].x).hypot(w.buildings[p.0 as usize].y - w.buildings[p.1 as usize].y)).sum();
        eprintln!("moat {moat}: {linked} links, old finder {old_len:.0} over the same pairs, network {new_len:.0} (straight between the middles {straight:.0}), {} buildings with a road", have.len());
        // (every road now starts and ends at the door of its building, which a walker would round the building to reach, so the roads are longer than the free-form ones, but a village of doors on one network)
        assert!(new_len < old_len * 2.3 + 40.0, "roads over the network: {new_len:.0} against {old_len:.0}");
        // every building that the old finder could reach from some earlier one has a road
        let ends: Vec<usize> = (0..w.buildings.len()).filter(|&i| i == 0 || !(is_barrier(w.buildings[i].kind) || matches!(w.buildings[i].kind, DRAWBRIDGE | BRIDGE))).collect();
        let mut missing = vec![];
        for (pos, &i) in ends.iter().enumerate().skip(1) {
            if have.contains(&(i as u32)) { continue; }
            let could = ends[..pos].iter().any(|&j| (w.buildings[j].x - w.buildings[i].x).hypot(w.buildings[j].y - w.buildings[i].y) < 80.0 && w.route_local(i, j).is_some());
            if could { missing.push((i, w.buildings[i].kind, w.buildings[i].x, w.buildings[i].y)); }
        }
        assert!(missing.len() <= 1 + have.len() / 20, "buildings without a road that the old finder reached: {missing:?}");
        eprintln!("moat {moat}: missing {missing:?}; old linked {old_linked}");
    }
}


