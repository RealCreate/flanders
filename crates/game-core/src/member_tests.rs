//! Check the actual tracks sent to the renderer, including sub-tick positions and every released soldier.
use super::*;

fn ring(w: &mut World, r: f32, n: usize, kind: u8) {
    for i in 0..n { let a = i as f32 / n as f32 * std::f32::consts::TAU; let (x, y) = ((a.cos() * r).round() as i32, (a.sin() * r).round() as i32); w.place(kind, x, y, 0); }
}
/// A round wall of radius 30 with a gate in its south side (the wall piece there is taken down for it).
fn walled(w: &mut World) {
    ring(w, 30.0, 40, WALL);
    let i = w.buildings.iter().position(|b| b.kind == WALL && (b.x).abs() < 1.5 && b.y > 28.0).expect("a wall piece on the south side");
    w.demolish(i as u32);
    assert!(w.place(GATE, 0, 30, 0) >= 0, "a gate on the south wall");
}
fn tick(w: &mut World) { w.step(); w.stock = [30000; N_RES]; }

/// Is this spot somewhere a person may not be? Written out afresh from the geometry (not from members.rs), so it checks the check: inside a building's solid part, on a wall or fence run, in a
/// field or bed, or in water that no bridge or lowered deck covers.
fn independent_blocked(w: &World, x: f32, y: f32) -> Option<&'static str> {
    for b in &w.buildings {
        match b.kind {
            ROAD | MOAT | RIVER | RAISE | LOWER | BRIDGE | DRAWBRIDGE | GATE => {}
            WALL | FENCE => { if (b.x - x).hypot(b.y - y) < solid_radius(b.kind, b.tier) - 0.6 { return Some("wall"); } }
            _ => { if (b.x - x).hypot(b.y - y) < solid_radius(b.kind, b.tier) { return Some("building"); } }
        }
        if matches!(b.kind, FARM | GARDEN | PARK | MARKET) && pathnet::in_fields(b, x, y, 0.0) { return Some("field"); }
        if b.kind == GATE && w.gate_shut(b) && (b.x - x).hypot(b.y - y) < 3.0 { return Some("shut gate"); }
    }
    let (segs, _) = w.wall_lines();
    for s in &segs {
        let (dx, dy) = (s.bx - s.ax, s.by - s.ay); let l2 = (dx * dx + dy * dy).max(1e-6);
        let t = (((x - s.ax) * dx + (y - s.ay) * dy) / l2).clamp(0.0, 1.0);
        if (x - (s.ax + dx * t)).hypot(y - (s.ay + dy * t)) < s.r - 0.3 { return Some("wall run"); }
    }
    if w.height_ground(x, y) < 0.2 && !w.on_deck(x, y) && !w.bridges.iter().any(|g| { let (dx, dy) = (g[2] - g[0], g[3] - g[1]); let l2 = (dx * dx + dy * dy).max(1e-6); let t = (((x - g[0]) * dx + (y - g[1]) * dy) / l2).clamp(0.0, 1.0); (x - (g[0] + dx * t)).hypot(y - (g[1] + dy * t)) < 1.7 })
        && !w.buildings.iter().any(|b| b.kind == BRIDGE && { let (ux, uy, l) = World::bridge_dir(b); let (px, py) = (x - b.x, y - b.y); (px * ux + py * uy).abs() <= l / 2.0 + 1.0 && (-px * uy + py * ux).abs() < 2.0 }) { return Some("water"); }
    None
}

/// Read the exported track exactly as the renderer does, sampling time between ticks and spacing every soldier along the same polyline.
fn walk(w: &mut World, units: [u32; NK], dest: (f32, f32)) -> (usize, u64) {
    w.army = units;
    let id = w.det_form(&units);
    assert!(id > 0);
    assert_eq!(w.det_march(id, dest.0, dest.1, false, 0.0, 0.0), 0);
    let mut previous = [0.0f32; 5];
    let mut hash = 0xcbf29ce484222325u64;
    let mut samples = 0;
    for _ in 0..1200 {
        tick(w);
        let f = w.det_flat();
        assert_ne!(f[8] as u8, march::S_BLOCKED, "stopped at ({:.1},{:.1})", f[1], f[2]);
        if f[8] as u8 == march::S_IDLE {
            assert!((f[1] - dest.0).hypot(f[2] - dest.1) < 7.5, "did not arrive: {f:?}");
            return (samples, hash);
        }
        let groups = w.det_groups_flat();
        let tracks = w.det_files_flat();
        let mut cursor = 0;
        while cursor + 4 < tracks.len() {
            let k = tracks[cursor + 1] as usize;
            let (dispatch, gap) = (tracks[cursor + 2], tracks[cursor + 3]);
            let count = tracks[cursor + 4] as usize;
            let pts = &tracks[cursor + 5..cursor + 5 + count * 4];
            cursor += 5 + count * 4;
            let end = pts[pts.len() - 1];
            let size = if k == 0 { units.iter().sum::<u32>() - groups.chunks_exact(8).map(|c| c[2] as u32).sum::<u32>() }
                else { groups.chunks_exact(8).find(|c| c[1] as usize == k).unwrap()[2] as u32 };
            for substep in 1..=12 {
                let progress = lerp(previous[k], dispatch, substep as f32 / 12.0);
                for rank in 0..size {
                    let at = progress - gap * rank as f32;
                    if at <= 0.0 || at >= end { continue; }
                    let b = pts.chunks_exact(4).position(|p| p[3] >= at).unwrap() * 4;
                    if b == 0 || pts[b + 2] == 2.0 { continue; } // on a ferry
                    let a = b - 4;
                    let t = (at - pts[a + 3]) / (pts[b + 3] - pts[a + 3]);
                    let (x, y) = (lerp(pts[a], pts[b], t), lerp(pts[a + 1], pts[b + 1], t));
                    assert!(independent_blocked(w, x, y).is_none(), "file {k}, rank {rank} entered an obstacle at ({x:.2},{y:.2})");
                    assert!(!w.member_blocked(x, y, 0), "file {k}, rank {rank} left walkable ground at ({x:.2},{y:.2})");
                    for bits in [x.to_bits(), y.to_bits()] { hash = (hash ^ bits as u64).wrapping_mul(0x100000001b3); }
                    samples += 1;
                }
            }
            previous[k] = dispatch;
        }
    }
    panic!("army did not finish its march: {:?}", w.det_flat());
}
const MIXED: [u32; NK] = [6, 3, 4, 2, 1, 1];

#[test]
fn individual_approaches_start_at_distinct_safe_positions_and_join_the_network() {
    let mut w = World::new(1337, 0, 0); w.stock = [30000; N_RES];
    assert_eq!(w.flatten(53, 6.0), 0);
    for (kind, x, y) in [(BARRACKS, 10, 15), (HOUSE, 21, 21), (MOAT, 4, 27)] { w.place(kind, x, y, 0); }
    let units = [15, 0, 0, 0, 0, 0]; w.army = units;
    let id = w.det_form(&units); assert!(id > 0);
    let f = w.det_flat(); let anchor = (f[1], f[2]);
    assert!(w.net().nodes.contains(&anchor), "muster joins an actual path node");
    let tracks = w.det_approaches_flat();
    let mut starts = std::collections::BTreeSet::new(); let mut o = 0;
    while o + 4 < tracks.len() {
        let end = o + 4 + tracks[o + 3] as usize * 4;
        let path = &tracks[o + 4..end];
        assert!(starts.insert((path[0].to_bits(), path[1].to_bits())), "each soldier has a distinct start");
        assert_eq!((path[path.len() - 4], path[path.len() - 3], path[path.len() - 1]), (anchor.0, anchor.1, 0.0));
        for p in path.windows(8).step_by(4) {
            for i in 0..=10 {
                let t = i as f32 / 10.0;
                assert!(!w.member_blocked(lerp(p[0], p[4], t), lerp(p[1], p[5], t), 0), "the approach crosses an obstacle");
            }
        }
        o = end;
    }
    assert_eq!(starts.len(), 14);
    assert_eq!(w.det_march(id, 54.0, 27.0, false, 0.0, 0.0), 0);
    tick(&mut w);
    let mut restored = world_restore(&w.snapshot()).unwrap();
    assert_eq!(w.det_approaches_flat(), restored.det_approaches_flat());
    for _ in 0..120 { tick(&mut w); tick(&mut restored); }
    assert_eq!(w.state_hash(), restored.state_hash());
    assert_eq!(w.det_flat()[8], march::S_IDLE as f32);
}

#[test]
fn a_new_obstacle_ahead_of_the_file_replans_the_remaining_route() {
    let mut w = World::new(1337, 0, 0); w.stock = [30000; N_RES];
    assert_eq!(w.flatten(80, 6.0), 0);
    let units = [9, 0, 0, 0, 0, 0]; w.army = units;
    let id = w.det_form(&units);
    assert_eq!(w.det_march(id, 55.0, 26.0, false, 0.0, 0.0), 0);
    let previous = w.det_path(id);
    let start = (previous[0], previous[1]);
    let site = previous.windows(6).step_by(3).flat_map(|leg| (1..=8).map(move |i| {
        let f = i as f32 / 8.0;
        (lerp(leg[0], leg[3], f).round() as i32, lerp(leg[1], leg[4], f).round() as i32)
    })).find(|&(x, y)| (x as f32 - start.0).hypot(y as f32 - start.1) > 13.0 && w.can_place(HOUSE, x, y) == 0)
        .expect("a house can be built across one of the remaining route segments");
    assert!(w.place(HOUSE, site.0, site.1, 0) >= 0);
    for _ in 0..100 {
        tick(&mut w);
        let f = w.det_flat();
        assert!(!w.member_blocked(f[1], f[2], 0), "the army entered the new building");
        if f[8] == march::S_IDLE as f32 {
            assert!((f[1] - 55.0).hypot(f[2] - 26.0) < 0.1);
            return;
        }
    }
    panic!("the army failed to route around the new building: {:?}", w.det_flat());
}

#[test]
fn members_cross_a_drawbridge_over_a_moat_without_ever_entering_water_or_a_building() {
    let mut w = World::new(1337, 0, 0); w.stock = [30000; N_RES]; w.cheat(3, 0, 0); w.population = 20;
    ring(&mut w, 24.0, 52, MOAT);
    assert!(w.place(DRAWBRIDGE, 0, 24, 0) >= 0);
    for (k, x, y) in [(HOUSE, 12, 4), (HOUSE, -12, 6), (HOUSE, 6, 14), (BARRACKS, -14, -12), (WELL, 4, -10)] { w.place(k, x, y, 0); }
    let di = w.buildings.iter().position(|b| b.kind == DRAWBRIDGE).unwrap() as u32;
    assert_eq!(w.drawbridge_set(di, true), 0); w.buildings[di as usize].progress = 0; w.after_change();   // drawn up: the army lowers it
    let dest = (0.0, 62.0);
    let (samples, _) = walk(&mut w, MIXED, dest);
    assert!(samples > 3000, "all soldiers were sampled over a long march: {samples}");
}

#[test]
fn members_pass_the_gate_of_a_walled_village_and_keep_out_of_walls_and_fields() {
    let mut w = World::new(1337, 0, 0); w.stock = [30000; N_RES]; w.cheat(3, 0, 0); w.population = 30;
    walled(&mut w);
    for (k, x, y) in [(HOUSE, 12, 4), (HOUSE, -12, 6), (FARM, -18, 12), (GARDEN, 14, -14), (BARRACKS, 8, 14)] { w.place(k, x, y, 0); }
    let dest = (0.0, 75.0);
    let (samples, _) = walk(&mut w, MIXED, dest);
    assert!(samples > 3000, "all soldiers were sampled over a long march: {samples}");
}

#[test]
fn members_cross_a_river_by_its_bridge() {
    let mut w = World::new(1337, 0, 0); w.stock = [30000; N_RES]; w.cheat(3, 0, 0); w.population = 20;
    for x in (-80..=80).step_by(3) { w.place(RIVER, x, 40, 0); }
    for (k, x, y) in [(HOUSE, 12, 4), (HOUSE, -12, 6), (HOUSE, 6, 22)] { w.place(k, x, y, 0); }
    let b = w.place(BRIDGE, 0, 40, 0);
    assert!(b >= 0, "a bridge over the river: {b}");
    let dest = (0.0, 80.0);
    let (samples, _) = walk(&mut w, MIXED, dest);
    assert!(samples > 3000, "all soldiers were sampled over a long march: {samples}");
}

#[test]
fn members_squeezing_between_buildings_bunch_up_but_never_enter_them() {
    let mut w = World::new(1337, 0, 0); w.stock = [30000; N_RES]; w.cheat(3, 0, 0); w.population = 30;
    // a street of houses with narrow gaps right in front of the barracks
    for k in -4..=4 { w.place(HOUSE, k * 7, 28, 0); }
    w.place(BARRACKS, 0, 12, 0);
    let dest = (0.0, 70.0);
    let (samples, _) = walk(&mut w, [80, 20, 0, 0, 0, 0], dest);
    assert!(samples > 10000, "a hundred soldiers used the street: {samples}");
}

#[test]
fn every_member_walks_the_same_way_every_time() {
    let run = || {
        let mut w = World::new(1337, 0, 0); w.stock = [30000; N_RES]; w.cheat(3, 0, 0); w.population = 30;
        walled(&mut w);
        for (k, x, y) in [(HOUSE, 12, 4), (HOUSE, -12, 6), (BARRACKS, 8, 14)] { w.place(k, x, y, 0); }
        walk(&mut w, MIXED, (0.0, 70.0))
    };
    assert_eq!(run(), run());
}

#[test]
fn a_member_that_is_stuck_gets_a_route_of_its_own_along_the_network() {
    let mut w = World::new(1337, 0, 0); w.stock = [30000; N_RES]; w.cheat(3, 0, 0); w.population = 20;
    for (k, x, y) in [(HOUSE, 12, 4), (HOUSE, -12, 6), (BARRACKS, -14, -12)] { w.place(k, x, y, 0); }
    // from beside the barracks to a place the other side of the houses
    let r = w.member_route(-14.0, -4.0, 30.0, 30.0, 0);
    assert!(r.len() >= 4, "a route exists");
    let mut prev = (-14.0f32, -4.0f32);
    for p in r.chunks(2) {
        let n = ((p[0] - prev.0).hypot(p[1] - prev.1) / 0.5).ceil().max(1.0) as i32;
        for k in 0..=n { let t = k as f32 / n as f32; let (x, y) = (prev.0 + (p[0] - prev.0) * t, prev.1 + (p[1] - prev.1) * t); assert!(independent_blocked(&w, x, y).is_none(), "the route runs through something at ({x:.1}, {y:.1})"); }
        prev = (p[0], p[1]);
    }
    assert!((prev.0 - 30.0).hypot(prev.1 - 30.0) < 3.0, "and it ends at the goal");
    assert!(w.member_route(f32::NAN, 0.0, 1.0, 1.0, 0).is_empty(), "hostile numbers give nothing");
    // an engine's route keeps more clear of buildings than a soldier's
    let e = w.member_route(-14.0, -4.0, 30.0, 30.0, 3);
    for p in e.chunks(2) { assert!(!w.member_blocked(p[0], p[1], 3) || (p[0] - 30.0).hypot(p[1] - 30.0) < 3.0, "engine route clear of buildings at ({:.1}, {:.1})", p[0], p[1]); }
}

#[test]
fn the_step_slides_round_a_building_and_never_into_it() {
    let mut w = World::new(1337, 0, 0); w.stock = [30000; N_RES]; w.cheat(3, 0, 0);
    w.place(HOUSE, 40, 0, 0);
    let (hx, hy) = (w.buildings.last().unwrap().x, w.buildings.last().unwrap().y);
    let (mut x, mut y) = (hx - 9.0, hy + 0.2);
    for _ in 0..200 { let r = w.member_step(x, y, hx + 12.0, hy, 0.5, 0); x = r[0]; y = r[1]; assert!(independent_blocked(&w, x, y).is_none(), "inside the house at ({x:.1}, {y:.1})"); }
    assert!(x > hx + 6.0, "and it got round to the far side: x {x:.1}");
    assert!(w.member_blocked(hx, hy, 0) && !w.member_blocked(hx - 20.0, hy + 20.0, 0));
    assert!(w.member_reach(hx - 9.0, hy, 1.0, 0.0, 12.0, 0) < 9.0, "an offset towards the house is cut short before it");
}

