//! Places arriving soldiers on nearby paths, or in rows on open ground, using the same dry
//! segment check as the march itself. The reversed paths also serve as their next departures.
use super::*;

type Point = (f32, f32);
const ENTRY_REACH: f32 = 4.0;
const SPREAD_SPEED: f32 = 5.0;

fn distance(a: Point, b: Point) -> f32 { (a.0 - b.0).hypot(a.1 - b.1) }

impl MarchFile {
    fn spread_stagger(units: &[u32; NK]) -> f32 { (4.0 / units.iter().sum::<u32>().max(1) as f32).min(0.45) }

    pub(super) fn formation_step(&mut self, units: &[u32; NK]) -> bool {
        let stagger = Self::spread_stagger(units);
        let end = self.approaches.iter().enumerate().filter_map(|(rank, p)| {
            p.first().map(|start| -start.dist + rank as f32 * stagger)
        }).fold(0.0, f32::max);
        if self.dispatch < end {
            self.dispatch = (self.dispatch + SPREAD_SPEED).min(end);
            false
        } else {
            self.hold_formation(units);
            true
        }
    }

    pub(super) fn check_formation(&mut self, stamp: u64, walk: impl Fn(Wp, Wp) -> bool) -> bool {
        if self.checked_stamp == Some(stamp) { return true; }
        let clear = self.approaches.iter().all(|p| p.windows(2).all(|ab| walk(ab[0].wp, ab[1].wp)));
        if clear { self.checked_stamp = Some(stamp); }
        clear
    }

    pub(super) fn formation_occupied(&self, units: &[u32; NK], spreading: bool, on: impl Fn(f32, f32) -> bool) -> bool {
        let stagger = Self::spread_stagger(units);
        self.approaches.iter().enumerate().any(|(rank, p)| {
            p.first().is_some_and(|q| on(q.wp.x, q.wp.y))
                || (spreading && file_position(p, -(self.dispatch - rank as f32 * stagger).max(0.0)).is_some_and(|(x, y)| on(x, y)))
        })
    }

    /// An order issued during the spread starts each soldier at the point they have reached.
    pub(crate) fn hold_formation(&mut self, units: &[u32; NK]) {
        let checked = self.checked_stamp;
        let stagger = Self::spread_stagger(units);
        let mut approaches = std::mem::take(&mut self.approaches);
        for (rank, path) in approaches.iter_mut().enumerate() {
            let at = -(self.dispatch - rank as f32 * stagger).max(0.0);
            let i = path.partition_point(|p| p.dist < at);
            if i == 0 { continue; }
            let (a, b) = (path[i - 1], path[i]);
            let fraction = (at - a.dist) / (b.dist - a.dist);
            path.drain(..i);
            if at < b.dist {
                path.insert(0, FilePoint { wp: Wp {
                    x: lerp(a.wp.x, b.wp.x, fraction), y: lerp(a.wp.y, b.wp.y, fraction), mode: 0,
                }, dist: at });
            }
        }
        self.assign_approaches(approaches, units);
        self.checked_stamp = checked;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn world() -> World {
        let mut w = World::new(1337, 0, 0);
        w.stock = [10_000; N_RES];
        assert_eq!(w.flatten(88, 7.0), 0);
        w
    }

    #[test]
    fn a_spread_on_a_road_stays_on_the_connected_paths() {
        let mut w = world();
        assert_eq!(w.lay_road(&[12, 0, 18, 0, 24, 0, 30, 0, 36, 0, 42, 0, 48, 0, 54, 0]), 0);
        let anchor = (30.0, 0.0);
        let net = w.net();
        let ns = nav_static(1337);
        let obst = w.obst();
        let walk = |a, b| w.walk_segment(&ns, &obst, a, b, members::FOOT_MARGIN, 1.6, false);
        let paths = path_slots(&net, anchor, 12, 12, 1.25, walk);
        assert_eq!(paths.len(), 12);
        for path in paths {
            let p = path[0].wp;
            assert!(p.y.abs() < 0.01, "slot at {},{} left the straight road", p.x, p.y);
            assert!(path.windows(2).all(|s| walk((s[0].wp.x, s[0].wp.y), (s[1].wp.x, s[1].wp.y))));
        }
    }

    #[test]
    fn a_march_spreads_only_after_arrival_and_checks_the_slots_for_obstacles() {
        let mut w = world();
        assert!(w.place(HOUSE, 20, 16, 0) >= 0);
        for x in [19, 23, 27] { assert!(w.place(MOAT, x, 32, 0) >= 0); }
        assert!(w.cheat(2, 0, 15));
        let id = w.det_form(&[15, 0, 0, 0, 0, 0]);
        assert!(id > 0);
        assert_eq!(w.det_march(id, 23.0, 24.0, false, 0.0, 0.0), 0);
        let mut checkpoint = None;
        for _ in 0..100 {
            w.step();
            let d = &w.dets[0];
            if d.state == S_FORMATION { checkpoint = Some(w.snapshot()); break; }
            assert!(d.wi < d.path.len() || !d.file.mustered());
        }
        let mut w = world_restore(&checkpoint.expect("a spread at the end of the march")).unwrap();
        let (x, y) = (w.dets[0].x, w.dets[0].y);
        let ns = nav_static(1337);
        let obst = w.obst();
        let paths = &w.dets[0].file.approaches;
        assert_eq!(paths.len(), 15);
        for (i, path) in paths.iter().enumerate() {
            let slot = path[0].wp;
            assert!(!w.member_blocked_inner(slot.x, slot.y, 0));
            assert!(paths[..i].iter().all(|p| distance((slot.x, slot.y), (p[0].wp.x, p[0].wp.y)) > 1.15));
            assert!(path.windows(2).all(|s| w.walk_segment(&ns, &obst, (s[0].wp.x, s[0].wp.y), (s[1].wp.x, s[1].wp.y), members::FOOT_MARGIN, 1.6, false)));
            assert_eq!((path.last().unwrap().wp.x, path.last().unwrap().wp.y), (x, y));
        }
        for _ in 0..20 { w.step(); if w.dets[0].state == S_IDLE { break; } }
        assert_eq!(w.dets[0].state, S_IDLE);
        let starts: Vec<_> = w.dets[0].file.approaches.iter().map(|p| (p[0].wp.x, p[0].wp.y)).collect();
        assert_eq!(w.det_march(id, 26.0, 25.0, false, 0.0, 0.0), 0);
        let departing: Vec<_> = w.dets[0].file.approaches.iter().map(|p| (p[0].wp.x, p[0].wp.y)).collect();
        assert_eq!(starts, departing, "the next march starts at each soldier's slot");
    }

    #[test]
    fn engines_keep_their_clearance_in_a_mixed_formation() {
        let mut w = world();
        w.demo(0, 100, 0, 0);
        let units = [3, 0, 0, 0, 2, 1];
        let anchor = (31.0, 23.0);
        let ns = nav_static(w.seed);
        let muster = w.muster_approaches(&ns, anchor, &units, 0.0, &[]);
        let arrival = w.arrival_formation(&ns, anchor, 0.0, &units);
        for paths in [&muster, &arrival.approaches] {
            assert_eq!(paths.len(), 6);
            let slot = |i: usize| (paths[i][0].wp.x, paths[i][0].wp.y);
            assert!(distance(slot(0), slot(1)) < 4.0, "foot soldiers keep their smaller gap");
            for i in 3..6 {
                for j in 3..i {
                    assert!(distance(slot(i), slot(j)) >= SIEGE_SPACING * 0.94);
                }
            }
        }
        assert!(MarchFile::gap(&[0, 0, 0, 0, 2, 1]) >= SIEGE_SPACING);
    }

    #[test]
    fn siege_engines_spread_when_they_start_at_the_same_battle_position() {
        let mut w = world();
        w.demo(0, 100, 0, 0);
        assert!(w.start_raid(0.0, &[0, 0, 0, 0, 1, 1], 0));
        let b = w.battle.as_mut().unwrap();
        for u in &mut b.units[..2] { (u.x, u.y) = (32.0, 26.0); }
        for _ in 0..5 { w.battle_substep(); }
        let b = w.battle.as_ref().unwrap();
        assert!(distance((b.units[0].x, b.units[0].y), (b.units[1].x, b.units[1].y)) >= SIEGE_SPACING - 0.01);
    }
}

#[derive(Clone, Copy)]
struct Slot {
    point: Point,
    via: Option<usize>,
    length: f32,
}

/// Find a single nearby entry, then fan from it along connected edges. Sample each edge in
/// both directions as needed so a close dead end doesn't hide usable branches behind it.
fn path_slots(net: &pathnet::Net, anchor: Point, count: usize, engine_start: usize, spacing: f32, walk: impl Fn(Point, Point) -> bool) -> Vec<Vec<FilePoint>> {
    let mut entry = None;
    let mut entry_dist = ENTRY_REACH;
    for (i, edges) in net.adj.iter().enumerate() {
        let a = net.nodes[i];
        for &(j, len, _) in edges.iter().filter(|&&(j, len, _)| j as usize > i && len > 0.01) {
            let j = j as usize;
            let b = net.nodes[j];
            let fraction = (((anchor.0 - a.0) * (b.0 - a.0) + (anchor.1 - a.1) * (b.1 - a.1)) / (len * len)).clamp(0.0, 1.0);
            let p = (lerp(a.0, b.0, fraction), lerp(a.1, b.1, fraction));
            let length = distance(anchor, p);
            if length < entry_dist && walk(anchor, p) {
                entry = Some((p, [i, j]));
                entry_dist = length;
            }
        }
    }
    let Some((entry, ends)) = entry else { return vec![]; };
    let budget = (8.0 + (count as f32).sqrt() * spacing * 3.0).clamp(12.0, 42.0);
    let mut slots = vec![Slot { point: entry, via: None, length: entry_dist }];
    let mut dist = vec![f32::INFINITY; net.nodes.len()];
    let mut via = vec![None; net.nodes.len()];
    let mut todo = BinaryHeap::new();
    let mut sample_edge = |a: Point, b: Point, length: f32, from: Option<usize>| {
        let len = distance(a, b);
        let mut step = spacing;
        while step < len && length + step <= budget {
            let t = step / len;
            let point = (lerp(a.0, b.0, t), lerp(a.1, b.1, t));
            if !walk(a, point) { break; }
            slots.push(Slot { point, via: from, length: length + step });
            step += spacing;
        }
    };
    for i in ends {
        let p = net.nodes[i];
        sample_edge(entry, p, entry_dist, None);
        let length = entry_dist + distance(entry, p);
        if length <= budget && walk(entry, p) { dist[i] = length; todo.push(Node { f: length, i: i as u32 }); }
    }
    while let Some(Node { f, i }) = todo.pop() {
        let i = i as usize;
        if f > dist[i] { continue; }
        let a = net.nodes[i];
        for &(j, len, _) in &net.adj[i] {
            let j = j as usize;
            if dist[j] < f || f >= budget { continue; }
            let b = net.nodes[j];
            sample_edge(a, b, f, Some(i));
            if f + len < dist[j] && f + len <= budget && walk(a, b) {
                dist[j] = f + len; via[j] = Some(i);
                todo.push(Node { f: dist[j], i: j as u32 });
            }
        }
    }
    slots.extend(dist.iter().enumerate().filter(|(_, d)| d.is_finite()).map(|(i, &length)| Slot { point: net.nodes[i], via: Some(i), length }));
    slots.sort_by(|a, b| a.length.total_cmp(&b.length));
    let mut used = Vec::new();
    let mut paths = Vec::new();
    for slot in slots {
        let engine = used.len() >= engine_start;
        if used.iter().enumerate().any(|(i, &p)| {
            let gap = if engine && i >= engine_start { SIEGE_SPACING } else { spacing };
            distance(p, slot.point) < gap * 0.94
        }) { continue; }
        used.push(slot.point);
        let mut path = vec![slot.point];
        let mut index = slot.via;
        while let Some(i) = index { path.push(net.nodes[i]); index = via[i]; }
        path.extend([entry, anchor]);
        path.dedup();
        paths.push(MarchFile::approach(path));
        if paths.len() == count { break; }
    }
    paths
}

impl World {
    pub(super) fn arrival_formation(&self, ns: &NavStatic, anchor: Point, heading: f32, units: &[u32; NK]) -> MarchFile {
        let count = units.iter().sum::<u32>() as usize;
        if count < 2 { return MarchFile::default(); }
        let spacing = MarchFile::formation_spacing(units);
        let room = if units[4] + units[5] > 0 { 0.95 } else { members::FOOT_MARGIN };
        let obst = self.obst();
        let terrain = self.ground_samples();
        let walk = |a, b| self.walk_segment_with(ns, &obst, a, b, room, if room > 0.6 { 0.85 } else { 1.6 }, false, |x, y| terrain.height(self, x, y));
        if !walk(anchor, anchor) { return MarchFile::default(); }
        let engine_start = count - (units[4] + units[5]) as usize;
        let mut approaches = path_slots(&self.net(), anchor, count, engine_start, spacing, walk);
        if approaches.len() < count {
            let occupied: Vec<_> = approaches.iter().map(|p| (p[0].wp.x, p[0].wp.y)).collect();
            approaches.extend(self.muster_approaches(ns, anchor, units, heading, &occupied));
        }
        if approaches.len() < 2 { return MarchFile::default(); }
        let mut file = MarchFile::default();
        file.record(anchor.0, anchor.1, 0);
        file.approaches = approaches;
        file
    }
}
