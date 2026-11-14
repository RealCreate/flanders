//! The path network: a graph of invisible paths over the village that people and soldiers follow instead of working out their way step by step on the open ground.
//!
//! The graph has three kinds of edges, all of them over dry ground that nothing blocks:
//!  - road edges: the village's dirt roads (cheap: roads get priority), snapped to the doorstep ring of the buildings they join;
//!  - ring edges: a ring of nodes round every solid building, so that somebody who has to get round a building has a way to pass along it (no more walking into a wall and standing there);
//!  - link edges: short straight connections between nodes that can see each other, which join separate roads and rings into one network.
//! Whatever is built or demolished changes the stamp of the world, and the next route rebuilds the graph: an obstacle breaks the edges it crosses, a new building brings a ring of its own
//! that links itself to the paths nearby.
use super::*;
use std::cmp::Ordering;
use std::collections::{BTreeMap, BinaryHeap};

const RC: f32 = 1.0;
/// What a road is worth next to open ground: walking a road costs this much of the distance.
pub const ROAD_COST: f32 = 0.55;
/// How fast one walks a road compared to open ground.
pub const ROAD_SPEED: f32 = 1.35;
const LINK_RANGE: f32 = 12.0;
const MAX_CELLS: i32 = 100_000;

pub struct Net {
    x0: f32, y0: f32, nx: i32, ny: i32,
    ok: Vec<bool>,
    pub nodes: Vec<(f32, f32)>,
    /// (to, length, road)
    pub adj: Vec<Vec<(u32, f32, bool)>>,
}

#[derive(Copy, Clone, PartialEq)]
struct Q { f: f32, i: u32 }
impl Eq for Q {}
impl Ord for Q { fn cmp(&self, o: &Self) -> Ordering { o.f.partial_cmp(&self.f).unwrap_or(Ordering::Equal).then_with(|| o.i.cmp(&self.i)) } }
impl PartialOrd for Q { fn partial_cmp(&self, o: &Self) -> Option<Ordering> { Some(self.cmp(o)) } }

/// How much room a building keeps clear for the network: its solid part plus a little, and never less than its footprint with a margin (so a path never grazes the yard).
fn net_radius(b: &Building) -> f32 { (crate::solid_radius(b.kind, b.tier) + 0.4).max(crate::footprint(b.kind, b.tier) + 0.6) }

impl Net {
    fn empty() -> Net { Net { x0: 0.0, y0: 0.0, nx: 0, ny: 0, ok: vec![], nodes: vec![], adj: vec![] } }

    fn cell(&self, x: f32, y: f32) -> Option<usize> {
        let (i, j) = (((x - self.x0) / RC).floor() as i32, ((y - self.y0) / RC).floor() as i32);
        if i < 0 || j < 0 || i >= self.nx || j >= self.ny { None } else { Some((j * self.nx + i) as usize) }
    }
    pub fn ok_at(&self, x: f32, y: f32) -> bool { self.cell(x, y).map_or(false, |k| self.ok[k]) }

    /// Can one walk the straight line between two points? `slack`: the stretch at each end that is not checked (somebody standing in the margin of a building).
    pub fn clear(&self, a: (f32, f32), b: (f32, f32), slack: f32) -> bool {
        let l = (b.0 - a.0).hypot(b.1 - a.1); let st = (l / (RC * 0.5)).ceil().max(1.0) as i32;
        (0..=st).all(|q| {
            let t = q as f32 / st as f32; let d = l * t;
            if d < slack || l - d < slack { return true; }
            self.ok_at(a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t)
        })
    }

    fn add(&mut self, x: f32, y: f32) -> u32 { self.nodes.push((x, y)); self.adj.push(vec![]); (self.nodes.len() - 1) as u32 }

    fn link(&mut self, a: u32, b: u32, road: bool) {
        if a == b { return; }
        let (pa, pb) = (self.nodes[a as usize], self.nodes[b as usize]);
        let l = (pa.0 - pb.0).hypot(pa.1 - pb.1);
        if let Some(e) = self.adj[a as usize].iter_mut().find(|e| e.0 == b) { if road { e.2 = true; } }
        else { self.adj[a as usize].push((b, l, road)); }
        if let Some(e) = self.adj[b as usize].iter_mut().find(|e| e.0 == a) { if road { e.2 = true; } }
        else { self.adj[b as usize].push((a, l, road)); }
    }

    /// Nodes a point can step onto: the nearest few that it can see.
    fn reach(&self, p: (f32, f32)) -> Vec<(u32, f32)> {
        let mut c: Vec<(u32, f32)> = self.nodes.iter().enumerate().map(|(i, q)| (i as u32, (q.0 - p.0).hypot(q.1 - p.1))).filter(|c| c.1 <= LINK_RANGE + 2.0).collect();
        c.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(Ordering::Equal).then(a.0.cmp(&b.0)));
        c.into_iter().filter(|&(i, _)| self.clear(p, self.nodes[i as usize], 1.7)).take(6).collect()
    }

    /// A route over the network from `s` towards `g`. `Some((points, complete))`: when complete the points lead all the way to `g` (the caller adds the goal itself);
    /// otherwise they lead to the node nearest to it that the network reaches, and the rest of the way is for the caller to find over open ground.
    pub fn route(&self, s: (f32, f32), g: (f32, f32)) -> Option<(Vec<(f32, f32)>, bool)> {
        if self.nodes.is_empty() { return None; }
        let n = self.nodes.len();
        let starts = self.reach(s); if starts.is_empty() { return None; }
        let mut dist = vec![f32::MAX; n]; let mut from = vec![u32::MAX; n];
        let mut heap = BinaryHeap::new();
        for &(i, l) in &starts { dist[i as usize] = l; heap.push(Q { f: l, i }); }
        while let Some(Q { f, i }) = heap.pop() {
            if f > dist[i as usize] { continue; }
            for &(to, l, road) in &self.adj[i as usize] {
                let nd = f + l * if road { ROAD_COST } else { 1.0 };
                if nd < dist[to as usize] { dist[to as usize] = nd; from[to as usize] = i; heap.push(Q { f: nd, i: to }); }
            }
        }
        let e = |a: (f32, f32), b: (f32, f32)| (a.0 - b.0).hypot(a.1 - b.1);
        // the best way to finish: a node that sees the goal, or (failing that) the reached node nearest to it
        let mut best: Option<(f32, u32, bool)> = None;
        for &(i, l) in &self.reach(g) { if dist[i as usize] < f32::MAX { let c = dist[i as usize] + l; if best.map_or(true, |b| c < b.0) { best = Some((c, i, true)); } } }
        let mut part: Option<(f32, u32)> = None;
        for i in 0..n { if dist[i] < f32::MAX { let c = dist[i] + 1.1 * e(self.nodes[i], g); if part.map_or(true, |b| c < b.0) { part = Some((c, i as u32)); } } }
        let (i, complete) = match (best, part) {
            (Some(b), Some(p)) => if b.0 <= p.0 + 0.5 { (b.1, true) } else { (p.1, false) },
            (Some(b), None) => (b.1, true),
            (None, Some(p)) => (p.1, false),
            _ => return None,
        };
        if !complete && e(self.nodes[i as usize], g) > e(s, g) - 8.0 { return None; }   // the network does not get any nearer to the goal
        let mut pts = vec![self.nodes[i as usize]]; let mut c = i;
        while from[c as usize] != u32::MAX { c = from[c as usize]; pts.push(self.nodes[c as usize]); }
        pts.reverse();
        Some((pts, complete))
    }
}

impl World {
    /// Everything the network depends on, as a number: when it changes the network is built again.
    pub(crate) fn net_stamp(&self) -> u64 {
        let mut h: u64 = 0xcbf29ce484222325;
        let mut mix = |v: u64| { h ^= v; h = h.wrapping_mul(0x100000001b3); };
        for b in &self.buildings { mix(b.kind as u64); mix(b.tier as u64); mix(b.x.to_bits() as u64); mix(b.y.to_bits() as u64); mix(b.rot as u64); mix(b.aux as u64); if matches!(b.kind, DRAWBRIDGE | GATE) { mix(b.status as u64); } }
        for l in &self.levels { for v in l { mix(v.to_bits() as u64); } }
        for c in &self.craters { mix(c[0].to_bits() as u64); mix(c[1].to_bits() as u64); }
        mix(self.battle.is_some() as u64); mix(self.terrain_ver as u64); mix(self.road_paths.len() as u64);
        h
    }

    /// The path network (rebuilt only when the village changed).
    pub(crate) fn net(&self) -> std::rc::Rc<Net> {
        let stamp = self.net_stamp();
        if let Some((s, n)) = &*self.net_cache.borrow() { if *s == stamp { return n.clone(); } }
        let n = std::rc::Rc::new(self.build_net());
        *self.net_cache.borrow_mut() = Some((stamp, n.clone()));
        n
    }

    fn build_net(&self) -> Net {
        if self.buildings.is_empty() { return Net::empty(); }
        let (mut bx0, mut by0, mut bx1, mut by1) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
        for b in &self.buildings { bx0 = bx0.min(b.x); by0 = by0.min(b.y); bx1 = bx1.max(b.x); by1 = by1.max(b.y); }
        let m = 16.0;
        let (mut x0, mut y0, mut x1, mut y1) = (bx0 - m, by0 - m, bx1 + m, by1 + m);
        if (((x1 - x0) / RC) as i32 + 2) * (((y1 - y0) / RC) as i32 + 2) > MAX_CELLS {   // an enormous village: the network covers the part round the hall
            let hx = self.buildings[0].x; let hy = self.buildings[0].y; let half = (MAX_CELLS as f32).sqrt() * RC / 2.0 - 4.0;
            x0 = hx - half; x1 = hx + half; y0 = hy - half; y1 = hy + half;
        }
        let (nx, ny) = (((x1 - x0) / RC).ceil() as i32 + 1, ((y1 - y0) / RC).ceil() as i32 + 1);
        let cxy = |i: i32, j: i32| (x0 + (i as f32 + 0.5) * RC, y0 + (j as f32 + 0.5) * RC);
        let cnt = (nx * ny) as usize;
        let mut h = vec![0.0f32; cnt];
        for j in 0..ny { for i in 0..nx { let (x, y) = cxy(i, j); h[(j * nx + i) as usize] = self.height_ground(x, y); } }
        let mut blocked = vec![false; cnt]; let mut deck = vec![false; cnt];
        let mark = |g: &mut [bool], x: f32, y: f32, r: f32| {
            let (i0, i1) = ((((x - r - x0) / RC).floor() as i32).max(0), (((x + r - x0) / RC).ceil() as i32).min(nx - 1));
            let (j0, j1) = ((((y - r - y0) / RC).floor() as i32).max(0), (((y + r - y0) / RC).ceil() as i32).min(ny - 1));
            for j in j0..=j1 { for i in i0..=i1 { let (cx, cy) = cxy(i, j); if (cx - x).powi(2) + (cy - y).powi(2) <= r * r { g[(j * nx + i) as usize] = true; } } }
        };
        for q in &self.buildings {
            match q.kind {
                GATE => if self.gate_shut(q) { mark(&mut blocked, q.x, q.y, 3.0); },   // a barred gate breaks the path through the wall
                MOAT | RIVER | RAISE | LOWER | ROAD => {}
                BRIDGE => { let (ux, uy, l) = Self::bridge_dir(q); let st = (l / 0.8) as i32; for t in 0..=st { let t = t as f32 * 0.8 - l / 2.0; mark(&mut deck, q.x + ux * t, q.y + uy * t, 1.7); } }
                DRAWBRIDGE => {
                    if q.status == 5 || self.battle.is_some() { continue; }   // drawn up: no way across
                    let an = q.rot as f32 * std::f32::consts::FRAC_PI_4; let (sx, sy) = (an.sin(), an.cos());
                    for t in -9..=9 { let t = t as f32 * 0.8; mark(&mut deck, q.x + sx * t, q.y + sy * t, 1.7); }
                }
                _ => mark(&mut blocked, q.x, q.y, net_radius(q)),
            }
        }
        let mut ok = vec![false; cnt];
        for j in 0..ny { for i in 0..nx {
            let k = (j * nx + i) as usize;
            if deck[k] { ok[k] = true; continue; }
            if blocked[k] || h[k] < 0.2 { continue; }
            let mut sl = 0.0f32;
            for (di, dj) in [(1, 0), (-1, 0), (0, 1), (0, -1)] { let (p, q) = (i + di, j + dj); if p >= 0 && q >= 0 && p < nx && q < ny { sl = sl.max((h[(q * nx + p) as usize] - h[k]).abs() / RC); } }
            ok[k] = sl <= 1.6;
        } }
        let mut net = Net { x0, y0, nx, ny, ok, nodes: vec![], adj: vec![] };

        // a ring of nodes round every solid building
        let mut ring: Vec<Vec<u32>> = vec![vec![]; self.buildings.len()];
        for (i, b) in self.buildings.iter().enumerate() {
            if matches!(b.kind, WALL | FENCE | GATE | MOAT | RIVER | RAISE | LOWER | ROAD | BRIDGE | DRAWBRIDGE) { continue; }
            let r = net_radius(b) + 1.2;
            let k = ((std::f32::consts::TAU * r / 3.5).ceil() as usize).clamp(10, 32);
            for q in 0..k {
                let a = q as f32 * std::f32::consts::TAU / k as f32; let (px, py) = (b.x + a.cos() * r, b.y + a.sin() * r);
                ring[i].push(if net.ok_at(px, py) { net.add(px, py) } else { u32::MAX });
            }
            for q in 0..k {
                let (a, c) = (ring[i][q], ring[i][(q + 1) % k]);
                if a != u32::MAX && c != u32::MAX && net.clear(net.nodes[a as usize], net.nodes[c as usize], 0.0) { net.link(a, c, false); }
            }
        }
        // the roads, from the doorstep ring of one building to the ring of the other (their crossings of other roads and their own bends become nodes that are shared)
        let mut shared: BTreeMap<(i32, i32), u32> = BTreeMap::new();
        let mut road_node = vec![];   // nodes that belong to a road
        let toward = |net: &Net, ring: &Vec<Vec<u32>>, bi: usize, p: (f32, f32)| -> Option<u32> {
            let b = &self.buildings[bi]; let r = &ring[bi]; if r.is_empty() { return None; }
            let k = r.len(); let a = (p.1 - b.y).atan2(p.0 - b.x).rem_euclid(std::f32::consts::TAU);
            let c = (a / std::f32::consts::TAU * k as f32).round() as usize % k;
            for d in 0..k { for s in [c + d, c + k - d % k] { let id = r[s % k]; if id != u32::MAX && net.nodes.len() > id as usize { return Some(id); } } }
            None
        };
        for (c, p, pts) in &self.road_paths {
            if pts.len() < 2 { continue; }
            let (ci, pi) = (*c as usize, *p as usize);
            let mut chain: Vec<u32> = vec![];
            if let Some(a) = toward(&net, &ring, ci, pts[1]) { chain.push(a); }
            for q in &pts[1..pts.len() - 1] {
                if !net.ok_at(q.0, q.1) { chain.push(u32::MAX); continue; }
                let key = ((q.0 / 1.2).round() as i32, (q.1 / 1.2).round() as i32);
                let id = *shared.entry(key).or_insert_with(|| { let id = net.add(q.0, q.1); road_node.push(id); id });
                chain.push(id);
            }
            if let Some(b) = toward(&net, &ring, pi, pts[pts.len() - 2]) { chain.push(b); }
            for w in chain.windows(2) {
                if w[0] == u32::MAX || w[1] == u32::MAX { continue; }
                if net.clear(net.nodes[w[0] as usize], net.nodes[w[1] as usize], 0.0) { net.link(w[0], w[1], true); }
            }
        }
        let is_road: std::collections::BTreeSet<u32> = road_node.into_iter().collect();
        // links: separate roads and rings that can see one another become one network (a ring node next to a road snaps onto it)
        let n = net.nodes.len();
        let mut bins: BTreeMap<(i32, i32), Vec<u32>> = BTreeMap::new();
        for i in 0..n { let (x, y) = net.nodes[i]; bins.entry(((x / 8.0).floor() as i32, (y / 8.0).floor() as i32)).or_default().push(i as u32); }
        for a in 0..n {
            let (ax, ay) = net.nodes[a]; let (bi, bj) = ((ax / 8.0).floor() as i32, (ay / 8.0).floor() as i32);
            let mut cand: Vec<(u32, f32)> = vec![];
            for di in -2..=2 { for dj in -2..=2 { if let Some(v) = bins.get(&(bi + di, bj + dj)) { for &b in v {
                if b as usize == a { continue; }
                let l = (net.nodes[b as usize].0 - ax).hypot(net.nodes[b as usize].1 - ay); if l <= LINK_RANGE { cand.push((b, l)); }
            } } } }
            cand.sort_by(|p, q| p.1.partial_cmp(&q.1).unwrap_or(Ordering::Equal).then(p.0.cmp(&q.0)));
            let mut added = 0;
            for (b, l) in cand {
                if added >= 5 { break; }
                if net.adj[a].iter().any(|e| e.0 == b) { continue; }
                if net.clear(net.nodes[a], net.nodes[b as usize], 0.0) { net.link(a as u32, b, is_road.contains(&(a as u32)) && is_road.contains(&b) && l <= 6.0); added += 1; }
            }
        }
        net
    }

    /// Is somebody at this spot on a road (a dirt road piece or a bridge deck, which are made to be walked)?
    pub(crate) fn on_road(&self, x: f32, y: f32) -> bool {
        self.roads.iter().any(|s| {
            if x < s[0].min(s[3]) - 1.6 || x > s[0].max(s[3]) + 1.6 || y < s[1].min(s[4]) - 1.6 || y > s[1].max(s[4]) + 1.6 { return false; }
            let (dx, dy) = (s[3] - s[0], s[4] - s[1]); let l2 = (dx * dx + dy * dy).max(1e-6); let t = (((x - s[0]) * dx + (y - s[1]) * dy) / l2).clamp(0.0, 1.0);
            (x - (s[0] + dx * t)).hypot(y - (s[1] + dy * t)) <= 1.5
        }) || self.on_deck(x, y)
    }

    /// The network as flat numbers: [n, e, x, y (n times), a, b, road (e times)], for drawing it while debugging and for tests.
    pub(crate) fn net_flat_inner(&self) -> Vec<f32> {
        let net = self.net();
        let mut edges: Vec<[f32; 3]> = vec![];
        for (a, list) in net.adj.iter().enumerate() { for &(b, _, road) in list { if (a as u32) < b { edges.push([a as f32, b as f32, if road { 1.0 } else { 0.0 }]); } } }
        let mut v = vec![net.nodes.len() as f32, edges.len() as f32];
        for p in &net.nodes { v.extend_from_slice(&[p.0, p.1]); }
        for e in &edges { v.extend_from_slice(e); }
        v
    }

    /// A route over the network, for villagers: [complete (1 or 0), x, y, x, y, ...], or nothing when the network does not help.
    pub(crate) fn net_route_inner(&self, sx: f32, sy: f32, gx: f32, gy: f32) -> Vec<f32> {
        let net = self.net();
        match net.route((sx, sy), (gx, gy)) {
            Some((pts, complete)) => { let mut v = vec![if complete { 1.0 } else { 0.0 }]; for p in pts { v.extend_from_slice(&[p.0, p.1]); } v }
            None => vec![],
        }
    }
}
