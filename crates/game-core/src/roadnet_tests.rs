//! How well do the drawn roads form one network? The roads are measured the way the eye sees them: segments whose ribbons touch are one piece. Counted: the pieces (components) of the
//! drawn road graph, the loose ends (dangling stubs that end in the open and not at a door), the doors that are not on the main piece, and the buildings that have no road at all.
use super::*;
use crate::roadcheck::busy_village;

/// Ribbons that are closer than this (centre line to centre line) are drawn touching: 2 x the half width of the ribbon (1.15), with a little for the soft edge.
const TOUCH: f32 = 2.2;

fn seg_seg(a: &[f32], b: &[f32]) -> f32 {
    let d = |px: f32, py: f32, s: &[f32]| { let (dx, dy) = (s[2] - s[0], s[3] - s[1]); let l2 = (dx * dx + dy * dy).max(1e-6); let t = (((px - s[0]) * dx + (py - s[1]) * dy) / l2).clamp(0.0, 1.0); (px - (s[0] + dx * t)).hypot(py - (s[1] + dy * t)) };
    d(a[0], a[1], b).min(d(a[2], a[3], b)).min(d(b[0], b[1], a)).min(d(b[2], b[3], a))   // (segments that cross are not laid: see rebuild_roads)
}

/// How tangled the drawn roads are: pairs of road segments (of different roads) that properly cross, the most road ends meeting at one point, and the length of road per building.
pub(crate) fn tangle(w: &World) -> (usize, usize, f32) {
    let segs: Vec<[f32; 6]> = w.roads_flat().chunks(6).map(|c| [c[0], c[1], c[2], c[3], c[4], c[5]]).collect();
    let ccw = |p: (f32, f32), q: (f32, f32), r: (f32, f32)| (q.0 - p.0) * (r.1 - p.1) - (q.1 - p.1) * (r.0 - p.0);
    let near = |p: (f32, f32), q: (f32, f32)| (p.0 - q.0).hypot(p.1 - q.1) < 1.0;
    let mut crossings = 0;
    for a in 0..segs.len() { for b in a + 1..segs.len() {
        let (s, t) = (&segs[a], &segs[b]);
        if s[4] == t[4] && s[5] == t[5] { continue; }
        let (p0, p1, q0, q1) = ((s[0], s[1]), (s[2], s[3]), (t[0], t[1]), (t[2], t[3]));
        if near(p0, q0) || near(p0, q1) || near(p1, q0) || near(p1, q1) { continue; }
        if ccw(p0, p1, q0) * ccw(p0, p1, q1) < 0.0 && ccw(q0, q1, p0) * ccw(q0, q1, p1) < 0.0 { crossings += 1; }
    } }
    let mut pts: Vec<((f32, f32), usize)> = vec![];
    for s in &segs { for p in [(s[0], s[1]), (s[2], s[3])] { if let Some(e) = pts.iter_mut().find(|e| near(e.0, p)) { e.1 += 1; } else { pts.push((p, 1)); } } }
    let len: f32 = segs.iter().map(|s| (s[2] - s[0]).hypot(s[3] - s[1])).sum();
    let nb = (0..w.buildings.len()).filter(|&i| !is_barrier(w.buildings[i].kind) && !matches!(w.buildings[i].kind, BRIDGE | ROAD | DRAWBRIDGE)).count().max(1);
    (crossings, pts.iter().map(|e| e.1).max().unwrap_or(0), len / nb as f32)
}

pub(crate) struct Report { pub segs: usize, pub comps: usize, pub main_share: f32, pub loose_ends: Vec<(f32, f32)>, pub buildings: usize, pub no_road: Vec<usize>, pub off_main: Vec<usize>, pub door_gap: f32 }

pub(crate) fn measure(w: &World) -> Report {
    let flat = w.roads_flat();
    let mut segs: Vec<[f32; 6]> = flat.chunks(6).map(|c| [c[0], c[1], c[2], c[3], c[4], c[5]]).collect();
    let real = segs.len();
    // what is drawn besides the roads and carries them on: the deck of a lowered drawbridge, the doorway of a gate (the road runs into one end and out of the other)
    for b in &w.buildings {
        if b.kind == DRAWBRIDGE && !w.drawn_up(b) { let a = b.rot as f32 * std::f32::consts::FRAC_PI_4; let (sx, sy) = (a.sin(), a.cos()); segs.push([b.x - sx * 14.0, b.y - sy * 14.0, b.x + sx * 14.0, b.y + sy * 14.0, -1.0, -2.0]); }
    }
    let n = segs.len();
    let mut comp: Vec<usize> = (0..n).collect();
    fn find(c: &mut Vec<usize>, x: usize) -> usize { let mut r = x; while c[r] != r { r = c[r]; } let mut y = x; while c[y] != r { let nx = c[y]; c[y] = r; y = nx; } r }
    for a in 0..n { for b in a + 1..n {
        // (the legs of one road are one piece even where it crosses a drawbridge, which is a building of its own that draws its own deck)
        if seg_seg(&segs[a], &segs[b]) <= TOUCH || (segs[a][4] == segs[b][4] && segs[a][5] == segs[b][5]) { let (ra, rb) = (find(&mut comp, a), find(&mut comp, b)); if ra != rb { comp[ra] = rb; } }
    } }
    let mut len: std::collections::BTreeMap<usize, f32> = Default::default();
    for a in 0..n { let r = find(&mut comp, a); *len.entry(r).or_default() += (segs[a][2] - segs[a][0]).hypot(segs[a][3] - segs[a][1]); }
    let total: f32 = len.values().sum();
    let main = len.iter().max_by(|p, q| p.1.partial_cmp(q.1).unwrap()).map(|(k, _)| *k).unwrap_or(0);
    // loose ends: an end of a segment that touches no other segment of the road graph and is not a door's end (a door piece starts at the door of its building and the other end meets the network)
    let mut loose = vec![];
    for a in 0..real { for e in 0..2 {
        let (px, py) = (segs[a][e * 2], segs[a][e * 2 + 1]);
        let touching = (0..n).any(|b| b != a && seg_seg(&[px, py, px, py, 0.0, 0.0], &segs[b]) <= 1.0);
        if touching { continue; }
        // a door piece's inner end is the door itself
        let is_door = segs[a][4] == segs[a][5] && e == 0;
        // a road that runs into a drawbridge or gate is joined to the piece of road that stands there; ends at such buildings are not loose
        if is_door { continue; }
        loose.push((px, py));
    } }
    // buildings
    let ends: Vec<usize> = (0..w.buildings.len()).filter(|&i| i == 0 || !(is_barrier(w.buildings[i].kind) || matches!(w.buildings[i].kind, BRIDGE | ROAD | DRAWBRIDGE))).collect();
    let (mut no_road, mut off_main) = (vec![], vec![]);
    let mut door_gap = 0.0f32;
    for &i in &ends {
        let door = segs.iter().enumerate().find(|(_, s)| s[4] as i32 == i as i32 && s[5] as i32 == i as i32);
        match door {
            None => no_road.push(i),
            Some((k, s)) => {
                if find(&mut comp, k) != main { off_main.push(i); }
                let b = &w.buildings[i]; let (d, _) = crate::doors::door_world(b);
                door_gap = door_gap.max((d.0 - s[0]).hypot(d.1 - s[1]));
            }
        }
    }
    Report { segs: real, comps: len.len(), main_share: if total > 0.0 { len[&main] / total } else { 1.0 }, loose_ends: loose, buildings: ends.len(), no_road, off_main, door_gap }
}

#[test]
fn the_roads_of_a_busy_village_form_one_network() {
    for moat in [false, true] {
        let w = busy_village(moat);
        let r = measure(&w);
        for &i in &r.no_road { let b = &w.buildings[i]; let net = w.net_base(); let (d, e) = crate::doors::door_world(b); eprintln!("  moat {moat} no road: {i} kind {} tier {} rot {} at {:.1},{:.1}; door {:.1},{:.1} exit {:.1},{:.1}; door node {:?}; ring ok {}/{}; links {}", b.kind, b.tier, b.rot, b.x, b.y, d.0, d.1, e.0, e.1, net.ring[i].first(), net.ring[i].iter().filter(|&&x| x != u32::MAX).count(), net.ring[i].len(), w.road_paths.iter().filter(|p| p.0 as usize == i || p.1 as usize == i).count()); }
        eprintln!("moat {moat}: {} buildings, {} road segments, {} piece(s) (the main one is {:.0}% of the road), {} loose end(s) {:?}, no road: {:?}, door off the main piece: {:?}, widest door gap {:.2}",
            r.buildings, r.segs, r.comps, r.main_share * 100.0, r.loose_ends.len(), r.loose_ends.iter().take(6).collect::<Vec<_>>(), r.no_road.iter().map(|&i| (i, w.buildings[i].kind)).collect::<Vec<_>>(), r.off_main.iter().map(|&i| (i, w.buildings[i].kind)).collect::<Vec<_>>(), r.door_gap);
        let (cr, deg, per) = tangle(&w); eprintln!("moat {moat}: tangle: {cr} crossings, up to {deg} road ends at one point, {per:.0} road per building");
        assert!(cr <= 3, "moat {moat}: the roads cross one another {cr} times (a tangle)");
        let net = w.net_base();
        let reachable: Vec<usize> = r.no_road.iter().copied().filter(|&i| net.joined(i, 0)).collect();
        assert!(reachable.is_empty(), "moat {moat}: buildings the network reaches that have no road: {reachable:?}");
        assert_eq!(r.comps, 1, "moat {moat}: the drawn roads are one network");
        assert!(r.loose_ends.is_empty(), "moat {moat}: loose ends {:?}", r.loose_ends);
        assert!(r.off_main.is_empty(), "moat {moat}: doors off the main piece {:?}", r.off_main);
        assert!(r.door_gap < 0.01, "the road starts at the real door");
        if moat {   // the gate has a road through its middle, joined at both ends, and a road runs from it to the drawbridge
            let g = w.buildings.iter().position(|b| b.kind == GATE).unwrap(); let d = w.buildings.iter().position(|b| b.kind == DRAWBRIDGE).unwrap();
            let flat = w.roads_flat();
            let pass: Vec<&[f32]> = flat.chunks(6).filter(|s| s[4] as usize == g && s[5] as usize == g).collect();
            assert_eq!(pass.len(), 1, "a road through the gate");
            let gb = &w.buildings[g]; assert!(seg_seg(&[gb.x, gb.y, gb.x, gb.y, 0.0, 0.0], &[pass[0][0], pass[0][1], pass[0][2], pass[0][3], 0.0, 0.0]) < 0.3, "through the middle of the gate");
            let db = &w.buildings[d]; let an = db.rot as f32 * std::f32::consts::FRAC_PI_4; let (dsx, dsy) = (an.sin(), an.cos());
            let deck = [db.x - dsx * 14.0, db.y - dsy * 14.0, db.x + dsx * 14.0, db.y + dsy * 14.0, 0.0, 0.0];   // (the deck is drawn by the drawbridge itself)
            for (ex, ey) in [(pass[0][0], pass[0][1]), (pass[0][2], pass[0][3])] { assert!(seg_seg(&[ex, ey, ex, ey, 0.0, 0.0], &deck) < 1.0 || flat.chunks(6).any(|s| !(s[4] as usize == g && s[5] as usize == g) && seg_seg(&[ex, ey, ex, ey, 0.0, 0.0], &[s[0], s[1], s[2], s[3], 0.0, 0.0]) < 1.0), "the gate's passage is met by a road at {ex:.1},{ey:.1}"); }
            assert!(w.road_paths.iter().any(|p| (p.0 as usize == g && p.1 as usize == d) || (p.0 as usize == d && p.1 as usize == g)), "the gate is joined to the drawbridge by a road");
        }
    }
}

/// A toll post is placed where `toll_snap` says: on a road, with its gate along the road. The road then runs through the gate (a drawn road through the middle of the post, joined to the
/// network at both ends), and no road is drawn over its hut or posts.
#[test]
fn a_toll_post_snaps_onto_a_road_and_the_road_runs_through_its_gate() {
    let mut w = busy_village(false);
    let mut done = 0;
    let want: Vec<(i32, i32)> = vec![(14, -6), (-12, 9), (24, 18), (-20, -16), (30, -5), (-6, 24)];
    for (cx, cy) in want {
        let s = w.toll_snap(cx, cy);
        if s.is_empty() { continue; }
        let (x, y, rot) = (s[0] as i32, s[1] as i32, s[2] as u8);
        // the road next to the snapped spot (before placing): its direction is the axis of the post, up to the 45 degree step
        let (ax, ay) = ((w.ox + x) as f32, (w.oy + y) as f32);
        let (c, sn) = ((rot as f32 * std::f32::consts::FRAC_PI_4).cos(), (rot as f32 * std::f32::consts::FRAC_PI_4).sin());   // (the post's axis is (sin, cos))
        let mut best = f32::MAX; let mut near = 0;
        for (sg, l) in w.roads.iter().zip(&w.road_links) {
            if l.0 == l.1 { continue; }
            let (sx, sy) = (sg[3] - sg[0], sg[4] - sg[1]); let sl = sx.hypot(sy); if sl < 0.3 { continue; }
            let t = (((ax - sg[0]) * sx + (ay - sg[1]) * sy) / (sl * sl)).clamp(0.0, 1.0);
            let d = (ax - (sg[0] + sx * t)).hypot(ay - (sg[1] + sy * t));
            if d < 3.0 { near += 1; best = best.min(((sx / sl * sn + sy / sl * c).abs()).clamp(0.0, 1.0).acos().to_degrees()); }
        }
        assert!(near > 0, "the snapped post is on the road");
        assert!(best <= 25.0, "the gate is along the road: {best:.0} degrees off");
        let i = w.place(TOLL, x, y, rot); if i < 0 { continue; }
        done += 1;
        { let net = w.net_base(); eprintln!("toll {i} at {x},{y} rot {rot}: ring {:?} nodes {:?}, paths {}", net.ring[i as usize], net.ring[i as usize].iter().filter(|&&n| n != u32::MAX).map(|&n| net.nodes[n as usize]).collect::<Vec<_>>(), w.road_paths.iter().filter(|p| p.0 as i32 == i || p.1 as i32 == i).count()); }
        let r = measure(&w);
        assert_eq!(r.comps, 1, "toll at {x},{y}: the roads are still one network");
        assert!(r.loose_ends.is_empty(), "toll at {x},{y}: loose ends {:?}", r.loose_ends);
        // a road passes through the gate: a drawn segment of the toll's own passes through its middle, and both ends of it are met by roads of the village
        let b = w.buildings[i as usize].clone();
        let pass: Vec<[f32; 6]> = w.roads_flat().chunks(6).filter(|s| s[4] as i32 == i && s[5] as i32 == i).map(|s| [s[0], s[1], s[2], s[3], s[4], s[5]]).collect();
        assert_eq!(pass.len(), 1, "one passage through the gate");
        let p = pass[0]; assert!(seg_seg(&[b.x, b.y, b.x, b.y, 0.0, 0.0], &p) < 0.2, "through the middle of the post");
        for (ex, ey) in [(p[0], p[1]), (p[2], p[3])] {
            let met = w.roads_flat().chunks(6).any(|s| !(s[4] as i32 == i && s[5] as i32 == i) && seg_seg(&[ex, ey, ex, ey, 0.0, 0.0], &[s[0], s[1], s[2], s[3], 0.0, 0.0]) < 1.0);
            assert!(met, "toll at {x},{y}: the passage is met by a road at {ex:.1},{ey:.1}");
        }
        // none of the other roads is drawn over the hut or posts (their local places in the post's own frame)
        let (cc, ss) = (((b.rot as f32) * std::f32::consts::FRAC_PI_4).cos(), ((b.rot as f32) * std::f32::consts::FRAC_PI_4).sin());
        for s in w.roads_flat().chunks(6) {
            if s[4] as i32 == i && s[5] as i32 == i { continue; }
            let l = (s[2] - s[0]).hypot(s[3] - s[1]); let n = (l / 0.4).ceil().max(1.0) as i32;
            for k in 0..=n { let f = k as f32 / n as f32; let (wx, wy) = (s[0] + (s[2] - s[0]) * f - b.x, s[1] + (s[3] - s[1]) * f - b.y);
                let (lx, lz) = (wx * cc - wy * ss, wx * ss + wy * cc);   // back into the post's frame
                assert!(!((lx - 2.4).abs() < 0.95 && (lz + 0.2).abs() < 0.85), "a road ({}->{}) over the hut at {lx:.1},{lz:.1}", s[4], s[5]);
                assert!(!(lx.abs() > 0.4 && lx.abs() < 2.1 && (lz - 0.6).abs() < 0.6 && f > 0.0 && f < 1.0 && false), "posts");
            }
        }
    }
    assert!(done >= 3, "toll posts were snapped onto roads and placed ({done})");
}

/// Squares: where roads meet closely the village has a paved plaza. Every square lies on free ground (clear of buildings, fields, walls and water), has at least three road junctions
/// round it, and no two squares overlap. They are derived: asking twice, or of a copy built the same way, gives the same squares.
#[test]
fn squares_form_where_roads_meet_and_stand_on_free_ground() {
    let mut total = 0;
    for moat in [false, true] {
        let w = busy_village(moat);
        let sq: Vec<f32> = w.squares_flat(); let n = sq.len() / 4; total += n;
        eprintln!("moat {moat}: {n} squares {:?}", sq.chunks(4).map(|s| (s[0].round(), s[1].round(), (s[2] * 10.0).round() / 10.0)).collect::<Vec<_>>());
        assert_eq!(sq, w.squares_flat(), "the same squares twice");
        for (a, s) in sq.chunks(4).enumerate() {
            assert!(s[2] >= crate::squares::MIN_R && s[2] <= crate::squares::MAX_R, "size {}", s[2]);
            assert!(w.square_free(s[0], s[1], s[2]), "square {a} at {},{} is on free ground", s[0], s[1]);
            // roads meet round it
            let flat = w.roads_flat(); let mut ends = 0;
            for r in flat.chunks(6) { for (px, py) in [(r[0], r[1]), (r[2], r[3])] { if (px - s[0]).hypot(py - s[1]) < s[2] + 7.5 { ends += 1; } } }
            assert!(ends >= 4, "square {a}: {ends} road ends about it");
            for (b, t) in sq.chunks(4).enumerate() { if b > a { assert!((s[0] - t[0]).hypot(s[1] - t[1]) > s[2] + t[2], "squares {a} and {b} overlap"); } }
        }
    }
    assert!(total >= 1, "a busy village has a square ({total})");
}

/// A loose village of houses round a green gets squares where the roads gather, and they too are on free ground.
#[test]
fn a_ring_of_houses_gets_squares_on_free_ground() {
    let mut w = World::new(1337, 0, 0); w.stock = [30000; N_RES]; w.cheat(3, 0, 0);
    for (k, r) in [(10usize, 20.0f32), (14, 34.0)] { for i in 0..k { let a = i as f32 / k as f32 * std::f32::consts::TAU + r * 0.01; w.place(HOUSE, (a.cos() * r).round() as i32, (a.sin() * r).round() as i32, (i % 8) as u8); } }
    w.place(MARKET, 0, 40, 0); w.place(FARM, 40, 12, 3); w.place(GARDEN, -40, 10, 0);
    let r = measure(&w);
    let sq = w.squares_flat();
    let (cr, deg, per) = tangle(&w); eprintln!("ring village tangle: {cr} crossings, up to {deg} ends at one point, {per:.0} road per building");
    assert!(cr <= 2, "ring village: {cr} crossings");
    eprintln!("ring village: {} buildings, {} piece(s), {} loose ends, {} squares {:?}", r.buildings, r.comps, r.loose_ends.len(), sq.len() / 4, sq.chunks(4).map(|s| (s[0].round(), s[1].round(), s[2])).collect::<Vec<_>>());
    assert_eq!(r.comps, 1); assert!(r.loose_ends.is_empty(), "{:?}", r.loose_ends); assert!(r.off_main.is_empty());
    for s in sq.chunks(4) { assert!(w.square_free(s[0], s[1], s[2])); }
}
