//! Which wall and fence pieces join up into runs, and where a gate's doorway lies. This is the same arrangement the client draws (web/src/render/wallgraph.ts and walls.ts), so
//! what you see is what blocks the way: pieces stand several units apart and the wall is the run between them, which circles round the pieces alone would leave open.
use super::*;

pub const GATE_HALF: f32 = 3.6;   // a doorway 5.2 wide between the pillars: a siege engine (1.6 clear each side) rolls through with room to spare
const REACH: f32 = 8.6;
const FENCE_REACH: f32 = 5.6;
const GATE_TRIM: f32 = GATE_HALF + 0.7;

/// A piece of wall, fence or gate: its building index, position and kind.
#[derive(Clone, Copy)]
pub struct Piece { pub b: usize, pub x: f32, pub y: f32, pub kind: u8, pub rot: u8 }

/// A solid line (wall run, fence run, a shut gate's doors) of the given half-thickness.
pub struct Seg { pub ax: f32, pub ay: f32, pub bx: f32, pub by: f32, pub r: f32 }

/// The doorway of a gate: its centre and the direction of the wall through it (one walks through it square to that).
pub struct Door { pub b: usize, pub x: f32, pub y: f32, pub ux: f32, pub uy: f32 }

fn group(k: u8) -> u8 { if k == FENCE { 1 } else { 0 } }
fn reach(k: u8) -> f32 { if k == FENCE { FENCE_REACH } else { REACH } }

fn dist_seg(px: f32, py: f32, ax: f32, ay: f32, bx: f32, by: f32) -> f32 {
    let (dx, dy) = (bx - ax, by - ay); let l2 = (dx * dx + dy * dy).max(1e-6); let t = (((px - ax) * dx + (py - ay) * dy) / l2).clamp(0.0, 1.0);
    (px - (ax + dx * t)).hypot(py - (ay + dy * t))
}

/// The links between pieces: shortest candidates first, each piece linking to its two nearest of its own kind; a link that would close a triangle or run past another piece is skipped.
pub fn link(nodes: &[Piece]) -> (Vec<(usize, usize)>, Vec<Vec<usize>>) {
    let n = nodes.len();
    let mut cand: Vec<(usize, usize, f32)> = vec![]; let mut seen: std::collections::BTreeSet<(usize, usize)> = Default::default();
    for i in 0..n {
        let a = nodes[i];
        let mut near: Vec<(usize, f32)> = (0..n).filter(|&j| j != i && group(nodes[j].kind) == group(a.kind)).map(|j| (j, (a.x - nodes[j].x).hypot(a.y - nodes[j].y))).filter(|o| o.1 <= reach(a.kind)).collect();
        near.sort_by(|p, q| p.1.partial_cmp(&q.1).unwrap_or(std::cmp::Ordering::Equal));
        for o in near.into_iter().take(2) { let (lo, hi) = (i.min(o.0), i.max(o.0)); if seen.insert((lo, hi)) { cand.push((lo, hi, o.1)); } }
    }
    cand.sort_by(|p, q| p.2.partial_cmp(&q.2).unwrap_or(std::cmp::Ordering::Equal));
    let mut edges = vec![]; let mut adj: Vec<Vec<usize>> = vec![vec![]; n];
    for (i, j, _) in cand {
        let (a, b) = (nodes[i], nodes[j]); let (dx, dy) = (b.x - a.x, b.y - a.y); let l2 = (dx * dx + dy * dy).max(1e-6);
        if adj[i].iter().any(|k| adj[j].contains(k)) { continue; }
        let blocked = nodes.iter().enumerate().any(|(k, p)| {
            if k == i || k == j || group(p.kind) != group(a.kind) { return false; }
            let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
            t > 0.08 && t < 0.92 && (p.x - (a.x + dx * t)).hypot(p.y - (a.y + dy * t)) < 1.3
        });
        if blocked { continue; }
        edges.push((i, j)); adj[i].push(j); adj[j].push(i);
    }
    (edges, adj)
}

impl World {
    /// Every solid line of walls and fences, and the doorways of the gates. A shut gate's doors are a solid line across its doorway.
    pub(crate) fn wall_lines(&self) -> (Vec<Seg>, Vec<Door>) {
        let nodes: Vec<Piece> = self.buildings.iter().enumerate().filter(|(_, b)| matches!(b.kind, WALL | FENCE | GATE)).map(|(i, b)| Piece { b: i, x: b.x, y: b.y, kind: b.kind, rot: b.rot }).collect();
        if nodes.is_empty() { return (vec![], vec![]); }
        let (edges, adj) = link(&nodes);
        let axis: Vec<Option<(f32, f32)>> = nodes.iter().enumerate().map(|(i, n)| {
            if n.kind != GATE { return None; }
            let nb: Vec<Piece> = adj[i].iter().map(|&j| nodes[j]).collect();
            if nb.len() >= 2 { let (dx, dy) = (nb[1].x - nb[0].x, nb[1].y - nb[0].y); let d = dx.hypot(dy).max(1e-6); return Some((dx / d, dy / d)); }
            if nb.len() == 1 { let (dx, dy) = (nb[0].x - n.x, nb[0].y - n.y); let d = dx.hypot(dy).max(1e-6); return Some((dx / d, dy / d)); }
            let a = n.rot as f32 * std::f32::consts::FRAC_PI_4; Some((a.cos(), -a.sin()))
        }).collect();
        let doors: Vec<Door> = nodes.iter().enumerate().filter_map(|(i, n)| axis[i].map(|(ux, uy)| Door { b: n.b, x: n.x, y: n.y, ux, uy })).collect();
        let trim = |g: usize, other: Piece| -> (f32, f32) {
            let (ux, uy) = axis[g].unwrap(); let n = nodes[g];
            let s = if (other.x - n.x) * ux + (other.y - n.y) * uy >= 0.0 { 1.0 } else { -1.0 };
            (n.x + ux * s * GATE_TRIM, n.y + uy * s * GATE_TRIM)
        };
        let mut segs = vec![];
        for &(i, j) in &edges {
            let (a, b) = (nodes[i], nodes[j]);
            if a.kind == FENCE { segs.push(Seg { ax: a.x, ay: a.y, bx: b.x, by: b.y, r: 0.9 }); continue; }
            if a.kind != GATE && b.kind != GATE && nodes.iter().any(|g| g.kind == GATE && dist_seg(g.x, g.y, a.x, a.y, b.x, b.y) < GATE_HALF + 0.4) { continue; }   // a run never crosses a doorway
            let (mut ax, mut ay, mut bx, mut by) = (a.x, a.y, b.x, b.y);
            if a.kind == GATE { (ax, ay) = trim(i, b); }
            if b.kind == GATE { (bx, by) = trim(j, a); }
            if (bx - ax).hypot(by - ay) > 0.4 && (a.kind != GATE || b.kind != GATE) { segs.push(Seg { ax, ay, bx, by, r: 1.2 }); }
        }
        for (i, n) in nodes.iter().enumerate() {   // a piece with no neighbour stands as a short stretch of its own
            if !adj[i].is_empty() || n.kind == GATE { continue; }
            let a = n.rot as f32 * std::f32::consts::FRAC_PI_4; let l = if n.kind == FENCE { 1.8 } else { 2.4 };
            segs.push(Seg { ax: n.x - a.cos() * l, ay: n.y + a.sin() * l, bx: n.x + a.cos() * l, by: n.y - a.sin() * l, r: if n.kind == FENCE { 0.9 } else { 1.2 } });
        }
        for d in &doors {   // the pillars, and the doors across the doorway when they are shut
            for s in [-1.0f32, 1.0] { let (px, py) = (d.x + d.ux * GATE_HALF * s, d.y + d.uy * GATE_HALF * s); segs.push(Seg { ax: px, ay: py, bx: px, by: py, r: 1.0 }); }
            if self.gate_shut(&self.buildings[d.b]) { segs.push(Seg { ax: d.x - d.ux * GATE_HALF, ay: d.y - d.uy * GATE_HALF, bx: d.x + d.ux * GATE_HALF, by: d.y + d.uy * GATE_HALF, r: 1.3 }); }
        }
        (segs, doors)
    }
}
