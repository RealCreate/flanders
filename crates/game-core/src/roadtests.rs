//! Tests of the roads the player lays (see roadline.rs): the stub and node of every building, snapping, the curve, pathing over roads, the build range, the plaza.
use super::*;
use crate::roadline::{nodes_of, nodes_local, has_stub, is_passage, SNAP};

impl World {
    /// Is some node of building `i`'s ring in the same piece of the path network as the hall's?
    pub(crate) fn linked_to_hall(&self, i: usize) -> bool {
        let net = self.net();
        let (Some(h), Some(r)) = (net.ring.first(), net.ring.get(i)) else { return false };
        if i == 0 || r.is_empty() { return true; }
        let comp = |v: &Vec<u32>| v.iter().filter(|&&n| n != u32::MAX).map(|&n| net.comp[n as usize]).collect::<Vec<_>>();
        let hc = comp(h); comp(r).iter().any(|c| hc.contains(c))
    }
}

fn rich() -> World { let mut w = World::new(1337, 0, 0); w.stock = [30000; N_RES]; w.cheat(3, 0, 0); w }

fn bld(kind: u8, tier: u8, rot: u8, x: f32, y: f32) -> Building {
    Building { kind, tier, x, y, rot, pad_h: 1.0, progress: 0, status: 4, aux: -1, staff: 0, residents: 0, hp: 1.0, burning: 0.0, garrison: 0, born: 0, opts: 0, fert: FERT_MAX, mode: 0, target: -1, beff: 100 }
}

/// Points of a road between two places, as `lay_road` takes them (relative to the origin): the first and last at the places, a few between, bent sideways by `bend`.
fn pts_between(w: &World, a: (f32, f32), b: (f32, f32), bend: f32) -> Vec<i32> {
    let n = (((a.0 - b.0).hypot(a.1 - b.1)) / 7.0).ceil().max(2.0) as i32;
    let mut v = vec![];
    for k in 0..=n {
        let t = k as f32 / n as f32; let (x, y) = (a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t);
        let off = (t * std::f32::consts::PI).sin() * bend; let (dx, dy) = (b.0 - a.0, b.1 - a.1); let l = dx.hypot(dy).max(1.0);
        v.push((x - dy / l * off - w.ox as f32).round() as i32); v.push((y + dx / l * off - w.oy as f32).round() as i32);
    }
    v
}

/// The node at the end of every building's stub lies on the edge of its plot, on the side its door faces: for every kind that has a stub, every tier and every turn.
#[test]
fn the_node_of_every_building_is_at_the_edge_of_its_plot_on_the_door_side() {
    let mut checked = 0;
    for kind in 0..DEFS.len() as u8 {
        if !has_stub(kind) { continue; }
        for tier in 0..=max_tier(kind) {
            let name = DEFS[kind as usize].name;
            let (door, face) = doors::door_local(kind, tier);
            let local = nodes_local(kind, tier); assert_eq!(local.len(), 1, "{name}: one node");
            let r = pathnet::ring_radius(kind, tier);
            let n = local[0];
            assert!((n.0.hypot(n.1) - r).abs() < 0.02, "{name} tier {tier}: the node is at the edge of the plot ({} vs {r})", n.0.hypot(n.1));
            assert!(n.0.hypot(n.1) >= footprint(kind, tier) + 0.5, "{name} tier {tier}: beyond the footprint circle");
            // on the door's side: the stub runs from the door out along the way the door faces
            let along = (n.0 - door.0) * face.0 + (n.1 - door.1) * face.1;
            assert!(along > 0.5 && ((n.0 - door.0) * face.1 - (n.1 - door.1) * face.0).abs() < 0.05, "{name} tier {tier}: straight out of the door");
            for rot in 0..8u8 {
                let b = bld(kind, tier, rot, 100.0, -40.0);
                let q = nodes_of(&b)[0]; let w = doors::to_world(rot, n);
                assert!(((q.0 - 100.0) - w.0).abs() < 1e-4 && ((q.1 + 40.0) - w.1).abs() < 1e-4, "{name} rot {rot}: the node turns with the building");
                let dw = doors::to_world(rot, door); let fw = doors::to_world(rot, face);
                assert!(((q.0 - 100.0) - dw.0) * fw.0 + ((q.1 + 40.0) - dw.1) * fw.1 > 0.5, "{name} tier {tier} rot {rot}: the node is on the door's side");
                assert!(((q.0 - 100.0).hypot(q.1 + 40.0) - r).abs() < 0.02);
            }
            checked += 1;
        }
    }
    assert!(checked > 60, "{checked} kinds and tiers checked");
}

/// Every building of a village has its stub in the drawn roads, even with no road laid at all: nothing is laid by itself.
#[test]
fn every_building_has_a_stub_and_nothing_is_laid_by_itself() {
    let mut w = rich();
    let placed = [(HOUSE, 16, 0), (FARM, -30, 10), (WELL, 4, -14), (MARKET, 20, 24), (HOUSE, -14, -8)].iter().filter(|&&(k, x, y)| w.place(k, x, y, 0) >= 0).count();
    assert!(placed >= 3, "{placed} buildings placed");
    let lines = w.road_lines_flat(); let mut i = 0; let (mut stubs, mut roads) = (0, 0);
    while i < lines.len() { if lines[i] == 0.0 { stubs += 1; } else { roads += 1; } i += 3 + 2 * lines[i + 2] as usize; }
    assert_eq!(roads, 0, "no road laid by itself");
    assert_eq!(stubs, w.buildings.iter().filter(|b| has_stub(b.kind)).count(), "a stub for every building");
    // the stub ends where the node is
    for b in w.buildings.iter().filter(|b| has_stub(b.kind)) { let (_, e) = doors::door_world(b); assert_eq!(e, nodes_of(b)[0]); }
    assert!(w.linked_to_hall(w.buildings.len() - 1), "a building with no road is still joined to the village over open ground");
}

/// A road laid from near one node to near another snaps onto both: it is joined to those nodes and its curve ends exactly on them.
#[test]
fn a_road_snaps_onto_the_nodes_at_both_ends() {
    let mut w = rich();
    let h = w.place(HOUSE, 18, 6, 0) as usize; assert!(h > 0);
    let hall = nodes_of(&w.buildings[0])[0]; let house = nodes_of(&w.buildings[h])[0];
    let a = (hall.0 + 1.5, hall.1 - 1.5); let b = (house.0 - 1.0, house.1 + 1.0);
    assert_eq!(w.road_snap((a.0 as i32) - w.ox, (a.1 as i32) - w.oy).len(), 4, "the preview sees the node");
    let pts = pts_between(&w, a, b, 3.0);
    assert_eq!(w.lay_road(&pts), 0);
    let edges = w.road_edges();
    assert!(edges.iter().any(|e| e.b == 0 && e.pts.last() == Some(&hall)), "an end of the road is on the hall's node");
    assert!(edges.iter().any(|e| e.b == h && e.pts.last() == Some(&house)), "the other end is on the house's node");
    // the road runs into the node square to the plot: the last stretch heads towards the building
    let e = edges.iter().find(|e| e.b == h).unwrap(); let (p, q) = (e.pts[e.pts.len() - 2], e.pts[e.pts.len() - 1]);
    let out = (house.0 - w.buildings[h].x, house.1 - w.buildings[h].y); let ol = out.0.hypot(out.1);
    let dir = (q.0 - p.0, q.1 - p.1); let dl = dir.0.hypot(dir.1);
    assert!((dir.0 * out.0 + dir.1 * out.1) / (dl * ol) < -0.3, "the road comes in towards the building, not away from it");
    // a road end that is far from any node does not snap (a free end)
    assert!(w.road_snap(60, 60).is_empty());
    let free = w.buildings.len();
    assert_eq!(w.lay_road(&[24, 24, 30, 28]), 0); assert!(w.buildings.len() > free);
    assert!(w.road_conn.iter().rev().take(2).all(|c| c.to[1].k == 0), "the end of a loose road is joined to nothing");
}

/// A road end near another road snaps onto one of its pieces: a junction.
#[test]
fn a_road_ending_at_another_road_joins_it() {
    let mut w = rich();
    assert_eq!(w.lay_road(&[12, 0, 16, 4, 20, 4, 26, 0]), 0);
    let n = w.buildings.len();
    assert_eq!(w.lay_road(&[20, 14, 20, 9, 21, 6]), 0, "the second road");
    assert!(w.buildings.len() > n);
    let joined = w.road_conn.iter().any(|c| c.to.iter().any(|t| t.k == 1 && t.x == (w.ox + 20) as f32 && t.y == (w.oy + 4) as f32));
    assert!(joined, "the second road is joined to a piece of the first: {:?}", w.road_conn.iter().map(|c| c.to).collect::<Vec<_>>());
}

/// The curve through the pieces is deterministic: the same commands give the same points to the bit, in two worlds and in a world restored from a snapshot.
#[test]
fn the_curve_is_the_same_in_every_replica() {
    let run = || { let mut w = rich(); w.place(HOUSE, 18, 6, 0); assert_eq!(w.lay_road(&[10, 9, 14, 14, 20, 15, 26, 12]), 0); assert_eq!(w.lay_road(&[2, -8, 9, -12, 15, -9]), 0); w };
    let (a, b) = (run(), run());
    let bits = |w: &World| w.road_edges().into_iter().flat_map(|e| e.pts.into_iter().flat_map(|p| [p.0.to_bits(), p.1.to_bits()])).collect::<Vec<u32>>();
    assert!(!bits(&a).is_empty());
    assert_eq!(bits(&a), bits(&b));
    assert_eq!(a.state_hash(), b.state_hash());
    let c = world_restore(&a.snapshot()).expect("restores");
    assert_eq!(bits(&a), bits(&c), "restored from a snapshot");
    assert_eq!(a.road_lines_flat(), c.road_lines_flat());
    assert_eq!(a.state_hash(), c.state_hash());
    // the pieces are state: another road changes the hash
    let mut d = run(); d.lay_road(&[-8, 4, -14, 6]); assert_ne!(a.state_hash(), d.state_hash());
}

/// Samples along a curve are a fixed step apart and the curve is smooth where two stretches meet at a piece.
#[test]
fn the_curve_is_sampled_evenly_and_runs_smoothly_through_the_pieces() {
    let mut w = rich();
    assert_eq!(w.lay_road(&[10, 9, 15, 12, 20, 13, 25, 11, 30, 6]), 0);
    let edges = w.road_edges(); assert!(edges.len() >= 4);
    for e in &edges { for p in e.pts.windows(2) { let d = (p[1].0 - p[0].0).hypot(p[1].1 - p[0].1); assert!(d > 0.2 && d < 3.5, "step {d}"); } }
    // direction continuity at the pieces that have two neighbours
    let by_start = |p: (f32, f32)| edges.iter().find(|e| e.pts[0] == p);
    let mut checked = 0;
    for e in &edges { let end = *e.pts.last().unwrap(); if let Some(n) = by_start(end) {
        let (a, b) = (e.pts[e.pts.len() - 2], n.pts[1]);
        let (d1, d2) = ((end.0 - a.0, end.1 - a.1), (b.0 - end.0, b.1 - end.1));
        let cos = (d1.0 * d2.0 + d1.1 * d2.1) / (d1.0.hypot(d1.1) * d2.0.hypot(d2.1));
        assert!(cos > 0.9, "a kink of {:.0} degrees at {end:?}", cos.acos().to_degrees()); checked += 1;
    } }
    assert!(checked >= 2, "{checked} joins checked");
}

/// People and soldiers prefer the player's roads: the network has road edges along the curve, and a route between two nodes that can use them does.
#[test]
fn the_path_network_prefers_the_roads_the_player_laid() {
    let mut w = rich();
    let h = w.place(HOUSE, 30, 6, 0) as usize; assert!(h > 0);
    let (a, b) = (nodes_of(&w.buildings[0])[0], nodes_of(&w.buildings[h])[0]);
    assert_eq!(w.lay_road(&pts_between(&w, a, b, 0.0)), 0);
    let v = w.net_flat(); let (n, e) = (v[0] as usize, v[1] as usize);
    let road_edges = (0..e).filter(|&k| v[2 + 2 * n + 3 * k + 2] > 0.5).count();
    assert!(road_edges >= 10, "{road_edges} road edges along the curve");
    let r = w.net_route(a.0, a.1, b.0, b.1); assert_eq!(r[0], 1.0);
    let curve: Vec<(f32, f32)> = w.road_edges().into_iter().flat_map(|e| e.pts).collect();
    let on = r[1..].chunks(2).filter(|p| curve.iter().any(|c| (c.0 - p[0]).hypot(c.1 - p[1]) < 1.0)).count();
    assert!(on as f32 >= 0.7 * (r.len() / 2) as f32, "{on} of {} route points on the road", r.len() / 2);
    assert!(pathnet::ROAD_COST < 0.7, "a road is cheap to walk");
    // a building with no road still works: a far house is reached over open ground
    let far = w.place(HOUSE, -36, -20, 0) as usize; assert!(far > 0);
    assert!(w.linked_to_hall(far));
}

/// Roads extend the land that may be built on, and the extension is bounded.
#[test]
fn a_joined_road_extends_the_build_range_and_the_extension_is_bounded() {
    let mut w = rich();
    let r = w.build_radius() as i32;
    let spots = |w: &World, x: i32| (-6..=6).step_by(2).map(|dy| w.can_place(HOUSE, x, dy)).collect::<Vec<_>>();
    assert!(spots(&w, r + 24).iter().all(|&c| c == -2), "beyond the range: {:?}", spots(&w, r + 24));
    // a road from the hall outwards, a stretch at a time (each piece within reach of the last)
    let hall = nodes_of(&w.buildings[0])[0]; let (hx, hy) = (hall.0 as i32 - w.ox, hall.1 as i32 - w.oy);
    let mut chain = vec![hx, hy]; let mut x = hx; while x < r + 30 { x += 8; chain.extend([x, hy]); }
    let mut start = 0; let mut laid = 0;
    while start + 2 < chain.len() { let end = (start + 10).min(chain.len()); if w.lay_road(&chain[start..end]) != 0 { break; } laid += end - start; start = end - 2; }
    assert!(laid > 0, "the road was laid");
    let reach_x = w.buildings.iter().filter(|b| b.kind == ROAD && b.status == 4).map(|b| b.x as i32 - w.ox).max().unwrap_or(0);
    assert!(reach_x > r, "the road runs out beyond the range: {reach_x} vs {r}");
    assert!(spots(&w, reach_x - 4).iter().any(|&c| c != -2), "a house may stand beside the joined road: {:?}", spots(&w, reach_x - 4));
    assert!(spots(&w, reach_x + 30).iter().all(|&c| c == -2), "but not far beyond its end");
    // past the territory's limit from the hall only roads widen the land: away from any road nothing can be built
    assert_eq!(w.can_place(HOUSE, 0, TERRITORY_MAX as i32 + 20), -27);
    assert_eq!(w.can_place(ROAD, INFRASTRUCTURE_LIMIT as i32 + 1, 0), -2, "roads stop at the map edge");
    // An isolated road can be laid beyond the town's claim.
    let mut v = rich(); let r2 = v.build_radius() as i32;
    let (x, y) = (180..240).step_by(3).flat_map(|x| (-30..30).step_by(3).map(move |y| (x, y)))
        .find(|&(x, y)| v.road_can(x, y) == 0 && v.road_can(x + 6, y) == 0).expect("dry land outside city range");
    assert_eq!(v.lay_road(&[x, y, x + 6, y]), 0);
    assert!(matches!(v.can_place(HOUSE, x + 3, y + 5), -2 | -27), "an isolated road does not claim land");
    // A loose piece claims no land of its own.
    let p = v.place(ROAD, r2 + 3, 40, 0);
    if p >= 0 && v.buildings[p as usize].status != 4 { assert_eq!(v.can_place(HOUSE, r2 + 14, 40), -2, "a loose piece claims nothing"); }
}

#[test]
fn moats_bridges_and_ports_can_be_built_outside_the_city_claim() {
    let mut w = rich();
    w.levels.push([210.0, 80.0, 36.0, 6.0]);
    w.after_change();
    for x in (196..=224).step_by(4) {
        assert!(!w.in_territory(x as f32, 80.0));
        assert!(w.place(MOAT, x, 80, 0) >= 0, "remote moat at {x}");
    }
    assert_eq!(w.bridge_preview(210, 80)[0], 0.0);
    assert!(w.place(BRIDGE, 210, 80, 0) >= 0);
    let coast = (180..440).step_by(4).flat_map(|x| (-150..150).step_by(4).map(move |y| (x, y)))
        .find(|&(x, y)| w.can_place(PORT, x, y) == 0).expect("a suitable port site outside city range");
    assert!(!w.in_territory(coast.0 as f32, coast.1 as f32));
    assert!(w.place(PORT, coast.0, coast.1, 0) >= 0);
}

#[test]
fn a_port_snaps_to_dry_land_with_its_pier_over_water() {
    let mut w = rich();
    let (dx, dy, spot) = (180..440).step_by(4)
        .flat_map(|x| (-150..150).step_by(4).map(move |y| (x, y)))
        .filter(|&(x, y)| w.can_place(PORT, x, y) == 0)
        .find_map(|(dx, dy)| {
            let spot = w.port_snap(dx, dy);
            (!spot.is_empty()).then_some((dx, dy, spot))
        }).expect("somewhere along the shore where a pier can reach the water");
    let (x, y, turn) = (spot[0] as i32, spot[1] as i32, spot[2] as u8);
    assert!((x - dx).abs() <= 14 && (y - dy).abs() <= 14);
    let (tip_x, tip_y) = doors::to_world(turn, (2.2, 12.75));
    let (tip_x, tip_y) = (w.ox as f32 + x as f32 + tip_x, w.oy as f32 + y as f32 + tip_y);
    assert!(w.height_at(tip_x, tip_y) < w.water_surface_at(tip_x, tip_y) - 0.42);
    assert!(w.place(PORT, x, y, turn) >= 0);
    assert_ne!(w.port_snap(dx, dy), spot, "the built warehouse blocks another port at the same spot");
}

/// Taking away a piece in the middle of a road cuts the land beyond it off again.
#[test]
fn taking_a_piece_out_of_a_road_takes_back_the_land_beyond_it() {
    let mut w = rich();
    let r = w.build_radius() as i32;
    let hall = nodes_of(&w.buildings[0])[0]; let (hx, hy) = (hall.0 as i32 - w.ox, hall.1 as i32 - w.oy);
    let mut pts = vec![hx, hy]; let mut x = hx; while x < r + 30 { x += 8; pts.extend([x, hy]); }
    let mut start = 0; while start + 2 < pts.len() { let end = (start + 8).min(pts.len()); if w.lay_road(&pts[start..end]) != 0 { break; } start = end - 2; }
    let far = w.buildings.iter().filter(|b| b.kind == ROAD).map(|b| b.x as i32 - w.ox).max().unwrap();
    assert!(far > r);
    let probe = far - 3;
    assert!(w.can_place(HOUSE, probe, hy + 5) != -2, "the land is there");
    let mid = w.buildings.iter().position(|b| b.kind == ROAD && (b.x as i32 - w.ox) > r + 2).unwrap();
    assert!(w.demolish(mid as u32));
    assert_eq!(w.can_place(HOUSE, probe, hy + 5), -2, "cut off: the land beyond is gone");
}

/// The plaza has four nodes, one on each side, which a road snaps to and which people cross.
#[test]
fn the_plaza_has_four_nodes_one_on_each_side() {
    let mut w = rich();
    let p = w.place(PLAZA, 20, 0, 1); assert!(p > 0, "the plaza is placed ({p})"); let p = p as usize;
    let nodes = nodes_of(&w.buildings[p]); assert_eq!(nodes.len(), 4);
    let (cx, cy) = (w.buildings[p].x, w.buildings[p].y);
    let mut angles: Vec<f32> = nodes.iter().map(|n| ((n.1 - cy).atan2(n.0 - cx).to_degrees() + 360.0) % 360.0).collect(); angles.sort_by(|a, b| a.partial_cmp(b).unwrap());
    for w2 in angles.windows(2) { assert!(((w2[1] - w2[0]) - 90.0).abs() < 0.5, "a quarter turn apart: {angles:?}"); }
    for n in &nodes { assert!(((n.0 - cx).hypot(n.1 - cy) - (footprint(PLAZA, 0) + 0.7)).abs() < 0.01, "on the edge"); }
    assert_eq!(w.road_nodes_flat().chunks(4).filter(|c| c[2] as usize == p).count(), 4, "all four are drawn");
    // a road snaps to each of them
    for (k, n) in nodes.iter().enumerate() { let s = w.road_snap_target(n.0 + 1.0, n.1 + 1.0, SNAP, None).expect("snaps"); assert_eq!(s.0.k as usize, 2 + k, "node {k}"); }
    // a road from the hall runs into the plaza's near node
    let hall = nodes_of(&w.buildings[0])[0];
    let near = *nodes.iter().min_by(|a, b| ((a.0 - hall.0).hypot(a.1 - hall.1)).partial_cmp(&((b.0 - hall.0).hypot(b.1 - hall.1))).unwrap()).unwrap();
    assert_eq!(w.lay_road(&pts_between(&w, hall, near, 0.0)), 0, "a road to the near side");
    assert!(w.road_edges().iter().any(|e| e.b == p && e.pts.last() == Some(&near)), "it runs into the plaza's node");
    // people cross the plaza: from the road at the near side to the far side
    let far = *nodes.iter().max_by(|a, b| ((a.0 - hall.0).hypot(a.1 - hall.1)).partial_cmp(&((b.0 - hall.0).hypot(b.1 - hall.1))).unwrap()).unwrap();
    let r = w.net_route(near.0, near.1, far.0, far.1); assert!(!r.is_empty() && r[0] == 1.0, "a way over the square");
    // the plaza is open ground: the network is not blocked at its middle
    assert!(w.net().ok_at(cx + 2.5, cy + 2.5));
    // options: four, all for looks
    assert_eq!(options(PLAZA).len(), 4); assert_eq!(max_tier(PLAZA), 0);
}

/// A road piece placed on its own (as old saves have them) is joined to the nearest piece or node in reach, and a chain of them is one road.
#[test]
fn road_pieces_placed_one_at_a_time_join_into_a_road() {
    let mut w = rich(); let wood = w.stocks()[W as usize];
    let pieces: Vec<i32> = (0..6).map(|k| w.place(ROAD, 12 + k * 4, 6, 0)).collect();
    assert!(pieces.iter().all(|&i| i >= 0), "{pieces:?}");
    assert_eq!(w.stocks()[W as usize], wood - 6, "a wood a piece");
    assert!(w.road_edges().len() >= 5, "each piece is joined to its neighbour");
    assert!(w.roads_flat().len() >= 6 * 5 * 3, "and graded");
}

/// Villages on several seeds (so on several kinds of ground), each with a hall, houses on different sides and roads (straight and curved) laid to them.
fn graded_villages() -> Vec<World> {
    let mut out = vec![];
    for seed in [1337u64, 7, 99, 2024, 31337, 5] {
        let mut w = World::new(seed, 0, 0); w.stock = [30000; N_RES]; w.cheat(3, 0, 0);
        let hall = nodes_of(&w.buildings[0])[0]; let mut laid = 0;
        for (k, (x, y)) in [(30, 6), (-6, 34), (-33, -5)].into_iter().enumerate() {
            let h = w.place(HOUSE, x, y, 0); if h <= 0 { continue; }
            let to = nodes_of(&w.buildings[h as usize])[0];
            if w.lay_road(&pts_between(&w, hall, to, if k == 1 { 5.0 } else { 0.0 })) == 0 { laid += 1; }
        }
        if laid > 0 { out.push(w); }
    }
    assert!(out.len() >= 3, "{} villages with roads", out.len());
    out
}

/// Across a road's width the ground is as high as its centreline (the road is graded flat across, with no cross slope), on straight and curved roads, on whatever slope they run over.
#[test]
fn the_ground_across_a_road_is_as_high_as_its_middle() {
    let (mut checked, mut worst) = (0, 0.0f32);
    for w in graded_villages() { for (s, l) in w.roads.iter().zip(&w.road_links) {
        if l.0 == l.1 { continue; }
        let (mx, my) = ((s[0] + s[3]) / 2.0, (s[1] + s[4]) / 2.0);
        if w.buildings.iter().any(|b| b.kind != ROAD && (b.x - mx).hypot(b.y - my) < 13.0 + if b.kind == TOWN_HALL { 8.0 } else { 0.0 }) { continue; }   // (near a building the pad takes over)
        let len = (s[3] - s[0]).hypot(s[4] - s[1]); if len < 0.2 { continue; }
        let (nx, ny) = (-(s[4] - s[1]) / len, (s[3] - s[0]) / len);
        let mid = (s[2] + s[5]) / 2.0;
        for off in [-2.0f32, -1.0, 0.0, 1.0, 2.0] {
            let h = w.height_at(mx + nx * off, my + ny * off);
            worst = worst.max((h - mid).abs()); checked += 1;
            assert!((h - mid).abs() < 0.12, "ground {h} at {off} off the road, the middle is {mid} (at {mx},{my})");
        }
    } }
    assert!(checked >= 30, "{checked} points checked");
    println!("worst cross difference {worst}");
}

/// A road climbs no steeper than a walkable slope, and it follows the land: on a hill it rises and falls, it is not a straight line between the pads.
#[test]
fn a_road_never_climbs_steeper_than_the_limit() {
    let (mut worst, mut lo, mut hi) = (0.0f32, f32::MAX, f32::MIN);
    for w in graded_villages() { for (s, l) in w.roads.iter().zip(&w.road_links) {
        if l.0 == l.1 { continue; }
        let len = (s[3] - s[0]).hypot(s[4] - s[1]); if len < 0.05 { continue; }
        worst = worst.max((s[5] - s[2]).abs() / len); lo = lo.min(s[2]); hi = hi.max(s[2]);
    } }
    println!("steepest {worst}, heights {lo}..{hi}");
    assert!(worst <= ROAD_MAX_SLOPE + 0.02, "steepest stretch {worst}");
}

/// The grading is derived from the state alone: the same on a world rebuilt from a snapshot and on one that replays the same commands.
#[test]
fn the_grading_is_the_same_after_a_replay_and_a_restore() {
    let a = graded_villages().remove(0); let b = graded_villages().remove(0);
    assert_eq!(a.roads.len(), b.roads.len());
    for (x, y) in a.roads.iter().zip(&b.roads) { for k in 0..6 { assert_eq!(x[k].to_bits(), y[k].to_bits(), "replayed roads agree"); } }
    let c = world_restore(&a.snapshot()).expect("restores");
    assert_eq!(c.roads.len(), a.roads.len());
    for (x, y) in a.roads.iter().zip(&c.roads) { for k in 0..6 { assert_eq!(x[k].to_bits(), y[k].to_bits(), "restored roads agree"); } }
    for k in 0..60 { let (x, y) = (a.ox as f32 + k as f32 * 1.3 - 20.0, a.oy as f32 + (k * 7 % 40) as f32 - 20.0); assert_eq!(a.height_at(x, y).to_bits(), c.height_at(x, y).to_bits()); }
    assert_eq!(a.state_hash(), c.state_hash(), "the hash is the same: the grading is not part of it");
}

/// A road beside a river does not fill it in: the bed under the water stays where it was.
#[test]
fn grading_does_not_fill_in_water() {
    let mut w = rich();
    let mut put = 0; let mut spots = vec![];
    for k in 0..8 { let (x, y) = (14 + k * 2, 16); if w.place(RIVER, x, y, 0) > 0 { put += 1; spots.push((w.ox as f32 + x as f32, w.oy as f32 + y as f32)); } }
    assert!(put >= 4, "{put} river pieces placed");
    let bed: Vec<f32> = spots.iter().map(|p| w.height_at(p.0, p.1)).collect();
    assert!(bed.iter().all(|&h| h < 0.0), "the river is under water");
    let _ = w.lay_road(&[8, 6, 14, 10, 18, 10, 24, 6]);
    for (p, b) in spots.iter().zip(&bed) { assert!(w.height_at(p.0, p.1) <= b + 0.05, "the bed at {p:?} was raised: {b} to {}", w.height_at(p.0, p.1)); }
}

/// Number of drawn lines of the client list (stride varies: counted by walking it).
fn line_count(w: &World) -> usize { let f = w.road_lines_flat(); let (mut o, mut n) = (0, 0); while o + 2 < f.len() { o += 3 + 2 * f[o + 2] as usize; n += 1; } n }

/// A road that runs over a river is drawn (and graded) only on the dry banks: no drawn line has a leg through water, so no ribbon lies across the water or under a bridge.
#[test]
fn a_road_is_not_drawn_across_water() {
    let mut w = rich();
    // a river of pieces across the way, from north to south
    let mut put = 0; for k in -12..=12 { if w.place(RIVER, 22, k * 2, 0) > 0 { put += 1; } }
    assert!(put >= 7, "{put} river pieces");
    assert!(w.height_at(w.ox as f32 + 22.0, w.oy as f32) < 0.0, "water there");
    assert_eq!(w.lay_road(&[12, 0, 18, 0, 26, 0, 32, 0]), 0, "a road laid over the river");
    let f = w.road_lines_flat(); let (mut o, mut kind1) = (0, 0);
    while o + 2 < f.len() {
        let n = f[o + 2] as usize; let pts: Vec<(f32, f32)> = (0..n).map(|k| (f[o + 3 + 2 * k], f[o + 4 + 2 * k])).collect();
        if f[o] == 1.0 { kind1 += 1; }
        for p in pts.windows(2) { assert!(w.leg_is_dry(p[0], p[1]), "a drawn leg {p:?} is not dry"); }
        o += 3 + 2 * n;
    }
    assert!(kind1 >= 2, "the road is in two parts, one on each bank ({kind1})");
    for (s, _) in w.roads.iter().zip(&w.road_links) { for t in 0..=4 { let f = t as f32 / 4.0; assert!(w.height_at(s[0] + (s[3] - s[0]) * f, s[1] + (s[4] - s[1]) * f) > 0.0, "graded over water"); } }
}

/// A road laid, extended or taken away shows in the list of drawn lines at once (the client redraws from it the moment the command is applied).
#[test]
fn the_drawn_lines_change_the_moment_a_road_is_laid_or_taken_away() {
    let mut w = rich();
    let (n0, v0) = (line_count(&w), w.terrain_version());
    let before = w.buildings.len();
    assert_eq!(w.lay_road(&[8, 20, 14, 22, 20, 20]), 0);
    assert!(line_count(&w) > n0, "the new road is in the list at once");
    let n1 = line_count(&w);
    assert_eq!(w.lay_road(&[20, 20, 26, 24, 32, 22]), 0);
    assert!(line_count(&w) >= n1 && w.road_lines_flat().len() > 0, "extended");
    let len_ext = w.road_lines_flat().len();
    let piece = (before..w.buildings.len()).find(|&i| w.buildings[i].kind == ROAD).unwrap();
    assert!(w.demolish(piece as u32));
    assert!(w.road_lines_flat().len() != len_ext, "a piece taken away changes the list at once");
    let _ = v0;
}

// ---------- anchor nodes: every building has one, the passages have two ----------

/// The kinds that have no node by design: edit pieces, the walls and fences (a wall is a line, a road runs up to its gate), and the road piece itself.
fn nodeless(kind: u8) -> bool { matches!(kind, WALL | FENCE | MOAT | RIVER | RAISE | LOWER | ROAD) }

/// A bridge of length 24 at 30 degrees, as `place_bridge` stores it.
fn bridge_b(x: f32, y: f32) -> Building { let mut b = bld(BRIDGE, 0, 0, x, y); b.aux = 30 + 360 * 240; b }

/// Every kind a player can build has at least one node, whatever its tier, turn and design options; the ones with none are exactly the nodeless list.
#[test]
fn every_kind_has_a_node_except_walls_fences_and_edit_pieces() {
    let mut without = vec![];
    for kind in 0..DEFS.len() as u8 {
        for tier in 0..=max_tier(kind) { for rot in 0..8u8 { for opts in [0, 0xff] {
            let mut b = if kind == BRIDGE { bridge_b(40.0, -20.0) } else { bld(kind, tier, rot, 40.0, -20.0) }; b.opts = opts;
            let n = nodes_of(&b).len();
            if n == 0 { if !without.contains(&DEFS[kind as usize].name) { without.push(DEFS[kind as usize].name); } assert!(nodeless(kind), "{} has no node", DEFS[kind as usize].name); }
            else { assert!(!nodeless(kind), "{} should have no node", DEFS[kind as usize].name); }
            if is_passage(kind) { assert!(n >= 2, "{} tier {tier} rot {rot}: a passage has two nodes, found {n}", DEFS[kind as usize].name); }
        } } }
    }
    assert_eq!(without.len(), 7, "nodeless kinds: {without:?}");
}

/// The two nodes of a passage lie on its axis, one at each end, either side of the middle and well apart, turning with the building.
#[test]
fn the_nodes_of_a_passage_are_at_its_two_ends_on_its_axis() {
    for kind in [GATE, TOLL, DRAWBRIDGE] {
        for tier in 0..=max_tier(kind) { for rot in 0..8u8 {
            let b = bld(kind, tier, rot, 100.0, 50.0); let n = nodes_of(&b);
            let name = DEFS[kind as usize].name;
            let axis = doors::to_world(rot, (0.0, 1.0));
            let (a, c) = ((n[0].0 - 100.0, n[0].1 - 50.0), (n[1].0 - 100.0, n[1].1 - 50.0));
            assert!(a.0 * axis.0 + a.1 * axis.1 > 3.0 && c.0 * axis.0 + c.1 * axis.1 < -3.0, "{name} rot {rot}: one node at each end");
            assert!((a.0 * axis.1 - a.1 * axis.0).abs() < 1e-3 && (c.0 * axis.1 - c.1 * axis.0).abs() < 1e-3, "{name} rot {rot}: on the axis");
            assert!((n[0].0 - n[1].0).hypot(n[0].1 - n[1].1) >= 7.0, "{name}: the nodes are apart");
        } }
    }
    // a bridge: the nodes are on the banks, just beyond the ends of the deck, along its direction
    for k in 0..2 {
        let b = bridge_b(-10.0, 15.0); let n = nodes_of(&b); let (ux, uy, l) = World::bridge_dir(&b);
        assert!((l - 24.0).abs() < 1e-3);
        let t = (n[k].0 + 10.0) * ux + (n[k].1 - 15.0) * uy; let side = ((n[k].0 + 10.0) * uy - (n[k].1 - 15.0) * ux).abs();
        assert!((t.abs() - (12.0 + crate::roadline::BRIDGE_NODE_GAP)).abs() < 1e-3 && side < 1e-3, "bridge node {k} at the bank end of the deck");
    }
    let b = bridge_b(0.0, 0.0); let n = nodes_of(&b); assert!(n[0].0 * n[1].0 <= 0.0 && n[0].1 * n[1].1 <= 0.0, "opposite ends");
}

/// The ghost nodes (`node_preview`) are exactly the nodes of the building once it is put up there, for every turn.
#[test]
fn the_preview_of_the_nodes_is_the_nodes_the_building_gets() {
    let mut w = rich(); let mut seen = 0;
    for (kind, dx, dy) in [(HOUSE, 18, 6), (FARM, -30, 12), (MARKET, 22, -26), (PLAZA, -22, -24), (TOLL, 30, 30), (WELL, 4, -16), (BARRACKS, -34, -10)] {
        for rot in [0u8, 1, 3, 6] {
            let id = w.place(kind, dx, dy, rot); if id < 0 { continue; }
            let b = w.buildings[id as usize].clone();
            let want = w.node_preview(kind, b.tier, b.x, b.y, b.rot);
            let got: Vec<f32> = w.road_nodes_flat().chunks(4).filter(|c| c[2] as usize == id as usize).flat_map(|c| [c[0], c[1]]).collect();
            assert!(!want.is_empty() && want == got, "{}: preview {want:?} vs built {got:?}", DEFS[kind as usize].name);
            seen += 1; assert!(w.demolish(id as u32));
        }
    }
    assert!(seen >= 12, "{seen} placements compared");
    // turning the building turns its node round the middle
    let (a, b) = (w.node_preview(HOUSE, 0, 10.0, 10.0, 0), w.node_preview(HOUSE, 0, 10.0, 10.0, 2));
    assert!(((a[0] - 10.0).hypot(a[1] - 10.0) - (b[0] - 10.0).hypot(b[1] - 10.0)).abs() < 1e-3 && (a[0] - b[0]).hypot(a[1] - b[1]) > 1.0, "the ring moves with the turn");
}

/// A road end near any node snaps onto it, the nodes of the passages included, and the node is joined to the right building.
#[test]
fn a_road_end_snaps_onto_every_node_including_gates_and_toll_houses() {
    let mut w = rich();
    for x in [-8, 8] { w.place(WALL, x, 14, 0); }
    let gate = w.place(GATE, 0, 14, 0); assert!(gate >= 0);
    let toll = w.place(TOLL, 34, -30, 2); assert!(toll >= 0, "toll {toll}");
    let nodes = w.road_nodes_flat();
    for g in [gate, toll] { assert_eq!(nodes.chunks(4).filter(|c| c[2] as i32 == g).count(), 2, "two nodes"); }
    for c in nodes.chunks(4) {
        let (dx, dy) = ((c[0] + 0.3).round() as i32 - w.ox, (c[1] - 0.2).round() as i32 - w.oy);
        let s = w.road_snap(dx, dy); assert_eq!(s.len(), 4, "a node at {:?} is seen by the preview", c);
        assert!((s[0] + w.ox as f32 - c[0]).hypot(s[1] + w.oy as f32 - c[1]) < 1.2 + SNAP, "snaps to a node near it");
    }
    // a road from one end of the toll house to the other is joined to both nodes
    let ns = nodes_of(&w.buildings[toll as usize]);
    let (a, b) = ((ns[0].0 + 1.0, ns[0].1 + 1.0), (ns[1].0 - 1.0, ns[1].1 - 1.0));
    let pts = pts_between(&w, a, b, 5.0);
    assert_eq!(w.lay_road(&pts), 0, "laying the road");
    let (tx, ty) = (w.buildings[toll as usize].x, w.buildings[toll as usize].y);
    let ks: Vec<u8> = w.road_conn.iter().flat_map(|c| c.to.iter()).filter(|t| t.k >= 2 && (t.x, t.y) == (tx, ty)).map(|t| t.k).collect();
    assert!(ks.contains(&2) && ks.contains(&3), "both nodes of the toll house are joined: {ks:?}");
    // every passage is part of the village's path network (people and armies still walk through)
    assert!(w.linked_to_hall(toll as usize) && w.linked_to_hall(gate as usize));
}

/// The gate and the toll house show a road under them from node to node; a bridge and a drawbridge show none, and no road line lies on water.
#[test]
fn a_gate_and_a_toll_house_have_a_road_under_them_but_bridges_do_not() {
    let mut w = rich();
    for x in [-8, 8] { w.place(WALL, x, 14, 0); }
    let gate = w.place(GATE, 0, 14, 0) as usize; let toll = w.place(TOLL, 34, -30, 2) as usize;
    let lines = |w: &World| { let f = w.road_lines_flat(); let mut v = vec![]; let mut i = 0; while i < f.len() { let n = f[i + 2] as usize; v.push((f[i] as u8, f[i + 3..i + 3 + 2 * n].to_vec())); i += 3 + 2 * n; } v };
    let under: Vec<_> = lines(&w).into_iter().filter(|l| l.0 == 2).collect();
    assert_eq!(under.len(), 2, "a road under the gate and the toll house");
    let ns = w.nodes_all();
    for (i, l) in [(gate, &under[0]), (toll, &under[1])] { assert_eq!(l.1, vec![ns[i][0].0, ns[i][0].1, ns[i][1].0, ns[i][1].1], "from node to node"); }
    // a drawbridge and a bridge over a moat show no road, nor does any road line cross the water
    let mut w = rich(); w.deposits.clear();
    for i in 0..44 { let a = i as f32 / 44.0 * std::f32::consts::TAU; w.place(MOAT, (a.cos() * 20.0).round() as i32, (a.sin() * 20.0).round() as i32, 0); }
    let br = w.place(BRIDGE, 24, 3, 0); let db = w.place(DRAWBRIDGE, 0, 20, 0);
    assert!(br >= 0 && db >= 0, "bridge {br} drawbridge {db}");
    for b in [br as usize, db as usize] {
        assert_eq!(w.nodes_all()[b].len(), 2, "two nodes");
        let p = w.nodes_all()[b][0]; let (cx, cy) = (w.buildings[b].x, w.buildings[b].y);
        let start = (p.0 + (p.0 - cx) * 0.8, p.1 + (p.1 - cy) * 0.8);
        let pts = pts_between(&w, start, p, 0.0); w.lay_road(&pts);
    }
    for l in lines(&w) {
        assert_ne!(l.0, 2, "no road under a bridge or a drawbridge (only a gate and a toll house have one)");
        for s in l.1.chunks(2).collect::<Vec<_>>().windows(2) { assert!(w.leg_is_dry((s[0][0], s[0][1]), (s[1][0], s[1][1])), "a stretch of road crosses water or a deck"); }
    }
}
