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
        let net = w.net_base();
        let reachable: Vec<usize> = r.no_road.iter().copied().filter(|&i| net.joined(i, 0)).collect();
        assert!(reachable.is_empty(), "moat {moat}: buildings the network reaches that have no road: {reachable:?}");
        assert_eq!(r.comps, 1, "moat {moat}: the drawn roads are one network");
        assert!(r.loose_ends.is_empty(), "moat {moat}: loose ends {:?}", r.loose_ends);
        assert!(r.off_main.is_empty(), "moat {moat}: doors off the main piece {:?}", r.off_main);
        assert!(r.door_gap < 0.01, "the road starts at the real door");
    }
}
