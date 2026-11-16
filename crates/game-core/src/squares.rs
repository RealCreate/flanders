//! Squares: where several roads of the village meet closely, the ground between them is a paved square (a stone plaza with benches and a well or a fountain) instead of a tangle of ribbons.
//! They are worked out from the roads and the free ground, never stored: the same village always has the same squares (see `World::squares_flat`; nothing here is hashed).
use super::*;

/// Junctions (places where three road ends or more meet) closer to one another than this belong to one square.
const JOIN: f32 = 7.5;
/// The smallest and largest square (radius), and the ring of room kept clear of buildings and fields beyond its edge.
pub const MIN_R: f32 = 2.6;
pub const MAX_R: f32 = 6.5;
const MARGIN: f32 = 0.3;

impl World {
    /// The squares of the village as (x, y, radius, kind) for each. `kind` picks what stands in the middle (0 a well, 1 a fountain, 2 a tree with benches round it), by the place alone.
    pub(crate) fn squares_inner(&self) -> Vec<[f32; 4]> {
        // the nodes of the drawn road graph: the ends of its segments, the ones within a unit of each other being one place
        let mut nodes: Vec<((f32, f32), u32)> = vec![];
        for (s, l) in self.roads.iter().zip(&self.road_links) {
            if l.0 == l.1 && self.buildings[l.0 as usize].kind == FARM { continue; }   // (a farm's lane runs through its fields)
            for p in [(s[0], s[1]), (s[3], s[4])] {
                if let Some(n) = nodes.iter_mut().find(|n| (n.0 .0 - p.0).hypot(n.0 .1 - p.1) < 1.0) { n.1 += 1; } else { nodes.push((p, 1)); }
            }
        }
        let junctions: Vec<(f32, f32)> = nodes.iter().filter(|n| n.1 >= 3).map(|n| n.0).collect();
        // clusters of junctions
        let m = junctions.len();
        let mut comp: Vec<usize> = (0..m).collect();
        fn find(c: &mut Vec<usize>, x: usize) -> usize { let mut r = x; while c[r] != r { r = c[r]; } let mut y = x; while c[y] != r { let nx = c[y]; c[y] = r; y = nx; } r }
        for a in 0..m { for b in a + 1..m { if (junctions[a].0 - junctions[b].0).hypot(junctions[a].1 - junctions[b].1) < JOIN { let (ra, rb) = (find(&mut comp, a), find(&mut comp, b)); if ra != rb { comp[ra] = rb; } } } }
        let mut groups: std::collections::BTreeMap<usize, Vec<(f32, f32)>> = Default::default();
        for a in 0..m { let r = find(&mut comp, a); groups.entry(r).or_default().push(junctions[a]); }
        let net = self.net_base();
        let mut cands: Vec<(usize, [f32; 4])> = vec![];
        for g in groups.values() {
            if g.len() < 3 { continue; }
            let (mx, my) = (g.iter().map(|p| p.0).sum::<f32>() / g.len() as f32, g.iter().map(|p| p.1).sum::<f32>() / g.len() as f32);
            // the roomiest spot about the middle of the junctions (the junctions themselves sit on the edge of the buildings' yards: the square is the open ground between them)
            let (mut cx, mut cy, mut room) = (mx, my, net.clearance(mx, my));
            for i in -5..=5 { for j in -5..=5 {
                let (px, py) = (mx + i as f32 * 0.8, my + j as f32 * 0.8); let c = net.clearance(px, py) - 0.05 * (i * i + j * j) as f32 * 0.1;   // (a little for the middle)
                if c > room + 0.01 { room = c; cx = px; cy = py; }
            } }
            let spread = g.iter().map(|p| (p.0 - cx).hypot(p.1 - cy)).fold(0.0f32, f32::max);
            // as large as the junctions need, as the free ground allows (the network keeps clear of buildings, fields, walls and water)
            let r = (spread + 1.6).clamp(MIN_R, MAX_R).min(net.clearance(cx, cy) - MARGIN);
            if r < MIN_R || !self.square_free(cx, cy, r) { if std::env::var("SQ_DEBUG").is_ok() { eprintln!("  cluster of {} at {mx:.0},{my:.0}: best room {room:.1} at {cx:.0},{cy:.0}, r {r:.1}", g.len()); } continue; }
            let kind = ((cx.to_bits() ^ cy.to_bits().rotate_left(11)) % 3) as f32;
            cands.push((g.len(), [cx, cy, r, kind]));
        }
        // the bigger gatherings first, and no two squares on one another
        cands.sort_by(|a, b| b.0.cmp(&a.0).then(b.1[2].partial_cmp(&a.1[2]).unwrap_or(std::cmp::Ordering::Equal)).then(a.1[0].partial_cmp(&b.1[0]).unwrap_or(std::cmp::Ordering::Equal)).then(a.1[1].partial_cmp(&b.1[1]).unwrap_or(std::cmp::Ordering::Equal)));
        let mut out: Vec<[f32; 4]> = vec![];
        for (_, c) in cands { if out.iter().all(|o| (o[0] - c[0]).hypot(o[1] - c[1]) > o[2] + c[2] + 1.0) { out.push(c); } }
        out
    }

    /// Does a disc of this size stand clear of every solid part of a building, every field and bed, every wall and the water?
    pub(crate) fn square_free(&self, x: f32, y: f32, r: f32) -> bool {
        for b in &self.buildings {
            match b.kind { WALL | FENCE | GATE | MOAT | RIVER | RAISE | LOWER | ROAD | BRIDGE | DRAWBRIDGE | TOLL => continue, _ => {} }
            if (x - b.x).hypot(y - b.y) < solid_radius(b.kind, b.tier) + r { return false; }
            if pathnet::field_distance(b, x, y) < r { return false; }
        }
        for s in &self.wall_lines().0 {
            let (dx, dy) = (s.bx - s.ax, s.by - s.ay); let l2 = (dx * dx + dy * dy).max(1e-6);
            let t = (((x - s.ax) * dx + (y - s.ay) * dy) / l2).clamp(0.0, 1.0);
            if (x - (s.ax + dx * t)).hypot(y - (s.ay + dy * t)) < s.r + r { return false; }
        }
        for k in 0..12 { let a = k as f32 * std::f32::consts::TAU / 12.0; if self.height_ground(x + a.cos() * r, y + a.sin() * r) < 0.3 { return false; } }
        self.height_ground(x, y) >= 0.3
    }
}
