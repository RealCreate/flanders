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

#[derive(Clone)]
pub struct Net {
    x0: f32, y0: f32, nx: i32, ny: i32,
    ok: Vec<bool>,
    pub nodes: Vec<(f32, f32)>,
    /// The nodes of the doorstep ring round each building (indexed like the buildings; u32::MAX where a ring node would stand on ground that is not walkable). Empty for buildings without a ring.
    pub ring: Vec<Vec<u32>>,
    /// (to, length, road)
    pub adj: Vec<Vec<(u32, f32, bool)>>,
    /// The piece of the network each node belongs to (nodes that can be walked between have the same number): what water and walls keep apart is different pieces.
    pub comp: Vec<u32>,
}

#[derive(Copy, Clone, PartialEq)]
struct Q { f: f32, i: u32 }
impl Eq for Q {}
impl Ord for Q { fn cmp(&self, o: &Self) -> Ordering { o.f.partial_cmp(&self.f).unwrap_or(Ordering::Equal).then_with(|| o.i.cmp(&self.i)) } }
impl PartialOrd for Q { fn partial_cmp(&self, o: &Self) -> Option<Ordering> { Some(self.cmp(o)) } }

/// How much room a building keeps clear for the network: its solid part plus a little, and never less than its footprint with a margin (so a path never grazes the yard).
fn net_radius(b: &Building) -> f32 { net_radius_kt(b.kind, b.tier) }
fn net_radius_kt(kind: u8, tier: u8) -> f32 { (crate::solid_radius(kind, tier) + 0.4).max(crate::footprint(kind, tier) + 0.6) }

/// The ground that a building's fields and yards cover, as rectangles in the building's own frame: (centre x, centre z, half width, half depth), the same ones its model draws
/// (web/src/render/buildings.ts). People and soldiers never walk across them: they are blocked as the rectangles they are, not as a circle.
pub fn field_rects(kind: u8, tier: u8) -> Vec<(f32, f32, f32, f32)> {
    let t = tier as f32;
    match kind {
        // the fenced square of beds (the fence runs at 4.4 each way, the tool shed is inside it)
        GARDEN => return vec![(0.0, 0.0, 4.4, 4.4)],
        // the four trees (canopies grow with the tier), the fountain in the middle and, from tier 2, the pavilion; the gravel cross between them stays walkable
        PARK => {
            let h = 1.3 + 0.15 * t;
            let mut v: Vec<_> = [(-2.8f32, -2.8f32), (2.9, -2.6), (-2.7, 2.9), (3.0, 2.8)].iter().map(|&(x, z)| (x, z, h, h)).collect();
            v.push((0.0, 0.0, 1.2, 1.2));
            if tier >= 2 { v.push((3.0, 0.0, 1.8, 1.8)); }
            return v;
        }
        // the stalls stand round a ring (3 + tier of them, as the model puts them), each as a square about its middle; the market cross and well sit in the centre
        MARKET => {
            let n = 3 + tier as usize;
            let mut v: Vec<_> = (0..n).map(|i| { let a = i as f32 / n as f32 * std::f32::consts::TAU + 0.5; (a.cos() * 3.4, a.sin() * 3.4, 1.5, 1.5) }).collect();
            v.push((0.0, 0.0, if tier >= 2 { 1.1 } else { 0.6 }, if tier >= 2 { 1.1 } else { 0.6 }));
            return v;
        }
        FARM => {}
        _ => return vec![],
    }
    let mut v = vec![(0.0, 1.4, 5.2, 4.2), (-1.2, -2.6, 2.2, 1.7), (2.6, -3.0, 2.2, 1.7)];   // the field, the barn, the silo and haystacks
    let extra = [(7.9f32, 1.4f32, 2.5f32, 4.2f32), (0.0, 8.0, 5.2, 2.3), (7.9, 8.0, 2.5, 2.3)];   // a bigger farm works more fields
    for e in extra.iter().take((tier as usize).min(3)) { v.push(*e); }
    v
}

/// How far from a building's middle the ring of path round it runs.
pub fn ring_radius(kind: u8, tier: u8) -> f32 {
    let rects = field_rects(kind, tier);
    if rects.is_empty() { return net_radius_kt(kind, tier) + 1.2; }
    // (and always out past the building's plot, the circle of its footprint: the road from the door leaves the plot where it meets the ring)
    (rects.iter().flat_map(|r| [(-1.0f32, -1.0f32), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)].map(|(sx, sz)| (r.0 + sx * r.2).hypot(r.1 + sz * r.3))).fold(0.0f32, f32::max) + 1.6).max(crate::footprint(kind, tier) + 1.0)
}

/// Does the point lie in one of the building's field rectangles (grown by `margin`)? `rot` is the building's turn in 45-degree steps.
pub fn in_fields(b: &Building, x: f32, y: f32, margin: f32) -> bool {
    let th = b.rot as f32 * std::f32::consts::FRAC_PI_4; let (c, s) = (th.cos(), th.sin());
    let (dx, dy) = (x - b.x, y - b.y);
    let (lx, lz) = (dx * c - dy * s, dx * s + dy * c);   // back into the building's own frame (the model is turned by th about the vertical)
    field_rects(b.kind, b.tier).iter().any(|r| (lx - r.0).abs() <= r.2 + margin && (lz - r.1).abs() <= r.3 + margin)
}

/// How far a point is from the building's fields and beds (0 inside them; a large number when it has none), in the building's own frame turned by its rotation: the distance to the nearest rectangle.
pub fn field_distance(b: &Building, x: f32, y: f32) -> f32 {
    let th = b.rot as f32 * std::f32::consts::FRAC_PI_4; let (c, s) = (th.cos(), th.sin());
    let (dx, dy) = (x - b.x, y - b.y);
    let (lx, lz) = (dx * c - dy * s, dx * s + dy * c);
    field_rects(b.kind, b.tier).iter().map(|r| ((lx - r.0).abs() - r.2).max(0.0).hypot(((lz - r.1).abs() - r.3).max(0.0))).fold(1e9f32, f32::min)
}

impl Net {
    fn empty() -> Net { Net { x0: 0.0, y0: 0.0, nx: 0, ny: 0, ok: vec![], nodes: vec![], ring: vec![], adj: vec![], comp: vec![] } }

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

    /// The node of building `i`'s ring that its roads start from: the one at the door's exit point, or when that stands on ground that is not walkable (a neighbour's yard), the nearest
    /// walkable one round the ring, a few steps along it at most.
    pub fn door_node(&self, i: usize) -> Option<u32> {
        let r = self.ring.get(i)?; let k = r.len() as i32; if k == 0 { return None; }
        for d in 0..=3.min(k / 2) { for s in [d, -d] { let id = r[((s % k) + k) as usize % k as usize]; if id != u32::MAX { return Some(id); } } }
        None
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
        for b in &self.buildings { mix(b.kind as u64); mix(b.tier as u64); mix(b.x.to_bits() as u64); mix(b.y.to_bits() as u64); mix(b.rot as u64); mix(b.aux as u64); if matches!(b.kind, DRAWBRIDGE | GATE | ROAD) { mix(b.status as u64); } }
        for c in &self.road_conn { mix(c.x.to_bits() as u64); mix(c.y.to_bits() as u64); for t in &c.to { mix(t.x.to_bits() as u64); mix(t.y.to_bits() as u64); mix(t.k as u64); } }
        for l in &self.levels { for v in l { mix(v.to_bits() as u64); } }
        for l in &self.flats { for v in l { mix(v.to_bits() as u64); } }
        for c in &self.craters { mix(c[0].to_bits() as u64); mix(c[1].to_bits() as u64); }
        mix(self.battle.is_some() as u64); mix(self.terrain_ver as u64);
        for pl in &self.links { mix(pl.len() as u64); for q in pl { mix(q.0.to_bits() as u64); mix(q.1.to_bits() as u64); } }
        h
    }

    /// Everything `height_ground` adds to the natural land: the levelled ground, the ditches and earthworks, the drawbridges (their banks) and craters.
    fn ground_stamp(&self) -> u64 {
        let mut h: u64 = 0xcbf29ce484222325 ^ self.seed;
        let mut mix = |v: u64| { h ^= v; h = h.wrapping_mul(0x100000001b3); };
        for l in &self.levels { for v in l { mix(v.to_bits() as u64); } }
        for l in &self.flats { for v in l { mix(v.to_bits() as u64); } }
        for c in &self.craters { for v in c { mix(v.to_bits() as u64); } }
        mix(self.terrain_ver as u64);
        for b in self.buildings.iter().filter(|b| is_edit(b.kind) || b.kind == DRAWBRIDGE) { mix(b.kind as u64); mix(b.x.to_bits() as u64); mix(b.y.to_bits() as u64); mix(b.rot as u64); mix(b.aux as u64); mix(b.pad_h.to_bits() as u64); }
        h
    }

    /// The path network (rebuilt only when the village changed).
    pub(crate) fn net_base(&self) -> std::rc::Rc<Net> {
        let stamp = self.net_stamp();
        if let Some((s, n)) = &*self.net_base.borrow() { if *s == stamp { return n.clone(); } }
        let n = std::rc::Rc::new(self.build_net());
        *self.net_base.borrow_mut() = Some((stamp, n.clone()));
        n
    }

    /// The path network that people and soldiers walk (the roads the player laid are edges of it: cheap to walk, see `build_net`).
    pub(crate) fn net(&self) -> std::rc::Rc<Net> { self.net_base() }

    pub(crate) fn build_net(&self) -> Net {
        if self.buildings.is_empty() { return Net::empty(); }
        let (mut bx0, mut by0, mut bx1, mut by1) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
        for b in &self.buildings { bx0 = bx0.min(b.x); by0 = by0.min(b.y); bx1 = bx1.max(b.x); by1 = by1.max(b.y); }
        let m = 16.0;
        // (the box is snapped to a 16-unit lattice, so that it stays the same while the village grows inside it and the ground heights below can be reused)
        let snap = |v: f32, up: bool| if up { (v / 16.0).ceil() * 16.0 } else { (v / 16.0).floor() * 16.0 };
        let (mut x0, mut y0, mut x1, mut y1) = (snap(bx0 - m, false), snap(by0 - m, false), snap(bx1 + m, true), snap(by1 + m, true));
        if (((x1 - x0) / RC) as i32 + 2) * (((y1 - y0) / RC) as i32 + 2) > MAX_CELLS {   // an enormous village: the network covers the part round the hall
            let hx = self.buildings[0].x; let hy = self.buildings[0].y; let half = (MAX_CELLS as f32).sqrt() * RC / 2.0 - 4.0;
            x0 = hx - half; x1 = hx + half; y0 = hy - half; y1 = hy + half;
        }
        let (nx, ny) = (((x1 - x0) / RC).ceil() as i32 + 1, ((y1 - y0) / RC).ceil() as i32 + 1);
        let (nx0, ny0) = (x0, y0);
        let cxy = |i: i32, j: i32| (x0 + (i as f32 + 0.5) * RC, y0 + (j as f32 + 0.5) * RC);
        let cnt = (nx * ny) as usize;
        // the natural land under the box, which never changes (levelling, ditches, drawbridge banks and craters are added on top of it, cell by cell)
        let gstamp = self.seed ^ (nx as u64) << 20 ^ (ny as u64) << 40 ^ (x0.to_bits() as u64) << 7 ^ (y0.to_bits() as u64).rotate_left(13);
        let cached = self.ground_cache.borrow().as_ref().filter(|(g, _)| *g == gstamp).map(|(_, v)| v.clone());
        let land: std::rc::Rc<Vec<f32>> = match cached {
            Some(v) => v,
            None => {
                let mut l = vec![0.0f32; cnt];
                for j in 0..ny { for i in 0..nx { let (x, y) = cxy(i, j); l[(j * nx + i) as usize] = self.base(x, y); } }
                let v = std::rc::Rc::new(l); *self.ground_cache.borrow_mut() = Some((gstamp, v.clone())); v
            }
        };
        // and the ground as it stands (levelling, ditches, drawbridge banks, craters on top of the land): it changes only when the ground does, not when a house goes up
        let hstamp = self.ground_stamp() ^ gstamp.rotate_left(29);
        let cached_h = self.height_cache.borrow().as_ref().filter(|(g, _)| *g == hstamp).map(|(_, v)| v.clone());
        let h: std::rc::Rc<Vec<f32>> = match cached_h {
            Some(v) => v,
            None => {
                let mut h = vec![0.0f32; cnt];
                for j in 0..ny { for i in 0..nx { let (x, y) = cxy(i, j); let k = (j * nx + i) as usize; h[k] = self.height_from(x, y, true, false, land[k]); } }
                let v = std::rc::Rc::new(h); *self.height_cache.borrow_mut() = Some((hstamp, v.clone())); v
            }
        };
        let mut blocked = vec![false; cnt]; let mut deck = vec![false; cnt];
        let mark = |g: &mut [bool], x: f32, y: f32, r: f32| {
            let (i0, i1) = ((((x - r - x0) / RC).floor() as i32).max(0), (((x + r - x0) / RC).ceil() as i32).min(nx - 1));
            let (j0, j1) = ((((y - r - y0) / RC).floor() as i32).max(0), (((y + r - y0) / RC).ceil() as i32).min(ny - 1));
            for j in j0..=j1 { for i in i0..=i1 { let (cx, cy) = cxy(i, j); if (cx - x).powi(2) + (cy - y).powi(2) <= r * r { g[(j * nx + i) as usize] = true; } } }
        };
        for q in &self.buildings {
            match q.kind {
                GATE | WALL | FENCE => {}   // (pillars, shut doors and the runs of wall and fence are lines: see below)
                MOAT | RIVER | RAISE | LOWER | ROAD => {}
                BRIDGE => { let (ux, uy, l) = Self::bridge_dir(q); let st = (l / 0.8) as i32; for t in 0..=st { let t = t as f32 * 0.8 - l / 2.0; mark(&mut deck, q.x + ux * t, q.y + uy * t, 1.7); } }
                DRAWBRIDGE => {
                    if self.drawn_up(q) { continue; }   // drawn up: no way across
                    let an = q.rot as f32 * std::f32::consts::FRAC_PI_4; let (sx, sy) = (an.sin(), an.cos());
                    for t in -9..=9 { let t = t as f32 * 0.8; mark(&mut deck, q.x + sx * t, q.y + sy * t, 1.7); }
                }
                FARM | GARDEN | PARK | MARKET => {   // the fields, beds and stalls: the rectangles they are
                    let (x0, x1, y0, y1) = (q.x - 18.0, q.x + 18.0, q.y - 18.0, q.y + 18.0);
                    let (i0, i1) = ((((x0 - nx0) / RC).floor() as i32).max(0), (((x1 - nx0) / RC).ceil() as i32).min(nx - 1));
                    let (j0, j1) = ((((y0 - ny0) / RC).floor() as i32).max(0), (((y1 - ny0) / RC).ceil() as i32).min(ny - 1));
                    for j in j0..=j1 { for i in i0..=i1 { let (cx, cy) = cxy(i, j); if in_fields(q, cx, cy, 0.9) { blocked[(j * nx + i) as usize] = true; } } }
                }
                TOLL => {   // only the hut and the two posts of the gate stand in the way: the road runs between the posts, through the middle of the building
                    for (lx, lz, r) in [(2.4f32, -0.2f32, 1.6f32), (-1.25, 0.6, 0.55), (1.25, 0.6, 0.55)] { let (dx, dy) = crate::doors::to_world(q.rot, (lx, lz)); mark(&mut blocked, q.x + dx, q.y + dy, r); }
                }
                PLAZA => mark(&mut blocked, q.x, q.y, if q.opts & 4 != 0 { 1.3 } else { 0.4 }),   // a square is open ground (only its fountain is in the way)
                _ => mark(&mut blocked, q.x, q.y, net_radius(q)),
            }
        }
        let (segs, doors) = self.wall_lines();
        for sg in &segs {   // walls, fences, pillars and shut doors: the line between the pieces, not just a circle round each
            let l = (sg.bx - sg.ax).hypot(sg.by - sg.ay); let st = (l / 0.5).ceil().max(1.0) as i32;
            for k in 0..=st { let t = k as f32 / st as f32; mark(&mut blocked, sg.ax + (sg.bx - sg.ax) * t, sg.ay + (sg.by - sg.ay) * t, sg.r + 0.5); }
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
        let mut net = Net { x0, y0, nx, ny, ok, nodes: vec![], ring: vec![], adj: vec![], comp: vec![] };

        // a ring of nodes round every solid building
        let mut ring: Vec<Vec<u32>> = vec![vec![]; self.buildings.len()];
        let mut road_pre: Vec<u32> = vec![];
        for (i, b) in self.buildings.iter().enumerate() {
            if b.kind == GATE {   // the way through a wall: a straight line of nodes through the middle of the doorway, square to the wall (cut when the doors are shut)
                let Some(d) = doors.iter().find(|d| d.b == i) else { continue };
                let (nx, ny) = (-d.uy, d.ux);
                let ts = [-11.0f32, -7.5, -3.8, 0.0, 3.8, 7.5, 11.0];
                let mut id = [u32::MAX; 7]; let mut lk = [false; 7];
                for (k, t) in ts.into_iter().enumerate() {
                    let (px, py) = (b.x + nx * t, b.y + ny * t);
                    if !net.ok_at(px, py) { continue; }
                    id[k] = net.add(px, py); road_pre.push(id[k]);
                    if k > 0 && id[k - 1] != u32::MAX && net.clear(net.nodes[id[k - 1] as usize], net.nodes[id[k] as usize], 0.0) { net.link(id[k - 1], id[k], true); lk[k] = true; }
                }
                // the two ends of the way through the gate, where the roads of the village join it (none while the doors are shut)
                let joined = |k: usize| -> bool { if id[k] == u32::MAX || id[3] == u32::MAX { return false; } if k > 3 { (4..=k).all(|q| lk[q] && id[q] != u32::MAX) } else { (k + 1..=3).all(|q| lk[q] && id[q - 1] != u32::MAX) } };
                let hi = [4usize, 5, 6].into_iter().find(|&k| joined(k)).map_or(u32::MAX, |k| id[k]);
                let lo = [2usize, 1, 0].into_iter().find(|&k| joined(k)).map_or(u32::MAX, |k| id[k]);
                ring[i] = vec![hi, lo];
                continue;
            }
            if b.kind == DRAWBRIDGE {   // along the deck, which only exists while the bridge is down (a drawn-up bridge leaves water, which is not walkable)
                let an = b.rot as f32 * std::f32::consts::FRAC_PI_4; let (sx, sy) = (an.sin(), an.cos());
                let mut prev = u32::MAX; let mut ring_ends = [u32::MAX; 2];
                for t in [-16.0f32, -12.5, -9.0, -6.0, -3.0, 0.0, 3.0, 6.0, 9.0, 12.5, 16.0] {
                    let (px, py) = (b.x + sx * t, b.y + sy * t);
                    if !net.ok_at(px, py) { prev = u32::MAX; continue; }
                    let id = net.add(px, py); road_pre.push(id);
                    if prev != u32::MAX && net.clear(net.nodes[prev as usize], net.nodes[id as usize], 0.0) { net.link(prev, id, true); }
                    prev = id;
                    if t == 9.0 { ring_ends[0] = id; } else if t == -9.0 { ring_ends[1] = id; }
                }
                ring[i] = ring_ends.to_vec();
                continue;
            }
            if b.kind == BRIDGE {   // the two nodes on the banks, joined across the deck (the deck cells are walkable, so the way is clear)
                let (ux, uy, l) = Self::bridge_dir(b);
                let ids: Vec<u32> = crate::roadline::bridge_nodes(b.x, b.y, ux, uy, l).iter().map(|&(px, py)| if net.ok_at(px, py) { let id = net.add(px, py); road_pre.push(id); id } else { u32::MAX }).collect();
                if ids[0] != u32::MAX && ids[1] != u32::MAX && net.clear(net.nodes[ids[0] as usize], net.nodes[ids[1] as usize], 0.0) { net.link(ids[0], ids[1], true); }
                ring[i] = ids;
                continue;
            }
            if b.kind == ROAD { continue; }   // (the roads the player laid are nodes of the network too: see below)
            if b.kind == PLAZA {   // a square is walked across: its four nodes (one on each side) are joined to the next side round
                let np = crate::roadline::nodes_of(b);
                let ids: Vec<u32> = np.iter().map(|&(px, py)| if net.ok_at(px, py) { let id = net.add(px, py); road_pre.push(id); id } else { u32::MAX }).collect();
                for k in 0..4 { let (a, c) = (ids[k], ids[(k + 1) % 4]); if a != u32::MAX && c != u32::MAX && net.clear(net.nodes[a as usize], net.nodes[c as usize], 0.0) { net.link(a, c, true); } }
                ring[i] = ids;
                continue;
            }
            if matches!(b.kind, WALL | FENCE | MOAT | RIVER | RAISE | LOWER | BRIDGE) { continue; }
            if b.kind == TOLL {   // the road runs through the gate: a straight line of road along the axis of the building (the way its posts face); the nodes at its two ends are where roads join it
                let ts = [-9.0f32, -7.0, -5.0, -3.5, 0.0, 3.5, 5.0, 7.0, 9.0];
                let mut id = [u32::MAX; 9]; let mut lk = [false; 9];   // lk[k]: node k is linked to the one before it
                for (k, t) in ts.into_iter().enumerate() {
                    let (dx, dy) = crate::doors::to_world(b.rot, (0.0, t)); let (px, py) = (b.x + dx, b.y + dy);
                    if !net.ok_at(px, py) { continue; }
                    id[k] = net.add(px, py); road_pre.push(id[k]);
                    if k > 0 && id[k - 1] != u32::MAX && net.clear(net.nodes[id[k - 1] as usize], net.nodes[id[k] as usize], 0.0) { net.link(id[k - 1], id[k], true); lk[k] = true; }
                }
                // each end: the farthest-in node on its side that is joined to the middle all the way
                let joined = |k: usize| -> bool { if id[k] == u32::MAX { return false; } if k > 4 { (5..=k).all(|q| lk[q] && id[q] != u32::MAX) && id[4] != u32::MAX } else { (k + 1..=4).all(|q| lk[q] && id[q - 1] != u32::MAX) && id[4] != u32::MAX } };
                let hi = [6usize, 7, 8, 5].into_iter().find(|&k| joined(k)).map_or(u32::MAX, |k| id[k]);
                let lo = [2usize, 1, 0, 3].into_iter().find(|&k| joined(k)).map_or(u32::MAX, |k| id[k]);
                ring[i] = vec![hi, lo];
                continue;
            }
            let r = ring_radius(b.kind, b.tier);
            let k = ((std::f32::consts::TAU * r / 3.5).ceil() as usize).clamp(10, 32);
            let a0 = crate::doors::exit_angle(b);   // (the first node of the ring is where the door's road leaves the plot: every road of this building starts there)
            for q in 0..k {
                let a = a0 + q as f32 * std::f32::consts::TAU / k as f32; let (px, py) = (b.x + a.cos() * r, b.y + a.sin() * r);
                ring[i].push(if net.ok_at(px, py) { net.add(px, py) } else { u32::MAX });
            }
            for q in 0..k {
                let (a, c) = (ring[i][q], ring[i][(q + 1) % k]);
                if a != u32::MAX && c != u32::MAX && net.clear(net.nodes[a as usize], net.nodes[c as usize], 0.0) { net.link(a, c, false); }
            }
        }
        // the roads the player laid: a node at every point of the curve (the pieces and the samples between them), joined as road edges, so people and soldiers prefer them; the end of a road
        // that runs into a building's node is joined to the ring node there (the end of the building's stub), and into a square to its node on that side
        let mut at: BTreeMap<(u32, u32), u32> = BTreeMap::new();
        for e in self.road_edges() {
            let mut prev = u32::MAX;
            let last = e.pts.len() - 1;
            for (k, &(px, py)) in e.pts.iter().enumerate() {
                let key = (px.to_bits(), py.to_bits());
                let mut id = at.get(&key).copied().unwrap_or(u32::MAX);
                if k == last && self.buildings[e.b].kind != ROAD {   // the node of the building it runs into
                    let nodes = Self::nodes_in(&self.buildings[e.b], e.b, &doors);
                    let which = nodes.iter().position(|q| q.0.to_bits() == px.to_bits() && q.1.to_bits() == py.to_bits());
                    id = match (self.buildings[e.b].kind, which) { (PLAZA, Some(w)) => ring[e.b].get(w).copied().unwrap_or(u32::MAX), (GATE | TOLL | BRIDGE | DRAWBRIDGE, Some(w)) => ring[e.b].get(w).copied().filter(|&n| n != u32::MAX).or_else(|| net.door_node(e.b)).unwrap_or(u32::MAX), _ => net.door_node(e.b).unwrap_or(u32::MAX) };
                } else if id == u32::MAX && net.ok_at(px, py) { id = net.add(px, py); at.insert(key, id); road_pre.push(id); }
                if prev != u32::MAX && id != u32::MAX && prev != id && net.clear(net.nodes[prev as usize], net.nodes[id as usize], 0.0) { net.link(prev, id, true); }
                prev = id;
            }
        }
        let mut shared: BTreeMap<(i32, i32), u32> = BTreeMap::new();
        let mut road_node = vec![];   // nodes that belong to a road
        // the paths chained out to other villages: their points are nodes too (they were found over open ground, so they need no check against the village's own grid)
        for pl in &self.links {
            let mut prev = u32::MAX;
            for q in pl {
                let key = ((q.0 / 1.2).round() as i32, (q.1 / 1.2).round() as i32);
                let id = *shared.entry(key).or_insert_with(|| { let id = net.add(q.0, q.1); road_node.push(id); id });
                if prev != u32::MAX && prev != id { net.link(prev, id, true); }
                prev = id;
            }
        }
        road_node.extend(road_pre);
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
        // every building is chained to the castle: whatever part of the network is not yet joined to the hall's is joined to it by the shortest walkable link, from node to node, so the
        // chain runs from building to building (through the rings of the ones between) all the way back to the hall. Only what is cut off by water or walls stays apart.
        let mut comp: Vec<usize> = (0..net.nodes.len()).collect();
        fn find(c: &mut Vec<usize>, x: usize) -> usize { let mut r = x; while c[r] != r { r = c[r]; } let mut y = x; while c[y] != r { let nx = c[y]; c[y] = r; y = nx; } r }
        for a in 0..net.nodes.len() { for e in net.adj[a].clone() { let (ra, rb) = (find(&mut comp, a), find(&mut comp, e.0 as usize)); if ra != rb { comp[ra] = rb; } } }
        let hall: Option<usize> = ring.first().and_then(|r| r.iter().copied().find(|&id| id != u32::MAX)).map(|id| id as usize);
        if let Some(h) = hall {
            for _round in 0..64 {
                let main = find(&mut comp, h);
                // the nearest walkable link between any node outside the hall's network and any node inside it
                let mut best: Option<(f32, usize, usize)> = None;
                let nn = net.nodes.len();
                for a in 0..nn {
                    if find(&mut comp, a) == main { continue; }
                    let (ax, ay) = net.nodes[a]; let (bi, bj) = ((ax / 8.0).floor() as i32, (ay / 8.0).floor() as i32);
                    for di in -6..=6 { for dj in -6..=6 { if let Some(v) = bins.get(&(bi + di, bj + dj)) { for &b in v {
                        let b = b as usize; if find(&mut comp, b) != main { continue; }
                        let l = (net.nodes[b].0 - ax).hypot(net.nodes[b].1 - ay);
                        if l < 48.0 && best.map_or(true, |o| l < o.0) && net.clear(net.nodes[a], net.nodes[b], 0.0) { best = Some((l, a, b)); }
                    } } } }
                }
                let Some((_, a, b)) = best else { break };
                net.link(a as u32, b as u32, false);
                let (ra, rb) = (find(&mut comp, a), find(&mut comp, b)); if ra != rb { comp[ra] = rb; }
            }
        }
        net.ring = ring;
        // which nodes can be walked between (water and walls keep the rest apart)
        let nn = net.nodes.len(); let mut cn = vec![u32::MAX; nn]; let mut k = 0u32;
        for s0 in 0..nn { if cn[s0] != u32::MAX { continue; } cn[s0] = k; let mut st = vec![s0]; while let Some(a) = st.pop() { for e in &net.adj[a] { if cn[e.0 as usize] == u32::MAX { cn[e.0 as usize] = k; st.push(e.0 as usize); } } } k += 1; }
        net.comp = cn;
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
