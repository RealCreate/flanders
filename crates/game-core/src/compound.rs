//! The walled compounds: the Castle (a town hall of the top tier) and the Embassy. Each is drawn as a whole fortress (web/src/render/buildings.ts), so a single circle round its middle is a poor
//! picture of what stands in the way: the curtain wall runs outside that circle and the gardens, courts and halls inside it are open ground between buildings. Here the compound is laid out as
//! it is drawn, in the building's own frame (x right, z forward, the middle at the origin, the same frame as `doors`): the wall runs, the towers and buildings that people cannot walk
//! through, and the invisible paths inside it from the way out at the gate to the doors of its halls. `members` (what stops a person) and `pathnet` (the network they follow) both read it.
//!
//! The Castle has doors at its two gates (the barbican's outer arch and the inner screen wall's gate): they stand open, and are shut while a battle is on (see `World::compound_shut`).
use super::*;

/// One piece of wall or building that is solid: a capsule round the line (ax, az)-(bx, bz) of half-thickness r (a zero-length line is a circle). `front`: it belongs to the gate at the
/// front of the compound (the army navigation grid leaves those out, so that the way to the door stays open for it).
#[derive(Clone, Copy)]
pub(crate) struct Piece { pub ax: f32, pub az: f32, pub bx: f32, pub bz: f32, pub r: f32, pub front: bool }

pub(crate) struct Compound {
    /// Wall runs, towers and buildings, as capsules.
    pub pieces: Vec<Piece>,
    /// The doors that close the gate while the compound is shut (capsules too).
    pub doors: Vec<Piece>,
    /// Path nodes inside and in front of the compound; node 0 is where the building's road leaves its plot (the exit), which the caller joins to the ring round the building.
    pub nodes: Vec<(f32, f32)>,
    pub edges: Vec<(usize, usize)>,
}

impl Compound {
    fn new(exit: (f32, f32)) -> Compound { Compound { pieces: vec![], doors: vec![], nodes: vec![exit], edges: vec![] } }
    fn wall(&mut self, ax: f32, az: f32, bx: f32, bz: f32, r: f32) { self.pieces.push(Piece { ax, az, bx, bz, r, front: false }); }
    fn front_wall(&mut self, ax: f32, az: f32, bx: f32, bz: f32, r: f32) { self.pieces.push(Piece { ax, az, bx, bz, r, front: true }); }
    fn round(&mut self, x: f32, z: f32, r: f32) { self.wall(x, z, x, z, r); }
    fn front_round(&mut self, x: f32, z: f32, r: f32) { self.front_wall(x, z, x, z, r); }
    /// A building drawn as a box w wide and d deep: a capsule along its longer side, a little fat so that the rounded ends keep its corners.
    fn block(&mut self, cx: f32, cz: f32, w: f32, d: f32) {
        let r = w.min(d) / 2.0 + 0.1; let h = (w.max(d) - w.min(d)) / 2.0;
        if w >= d { self.wall(cx - h, cz, cx + h, cz, r); } else { self.wall(cx, cz - h, cx, cz + h, r); }
    }
    fn node(&mut self, x: f32, z: f32) -> usize { self.nodes.push((x, z)); self.nodes.len() - 1 }
    fn path(&mut self, ids: &[usize]) { for w in ids.windows(2) { self.edges.push((w[0], w[1])); } }
}

/// The compound a building of this kind and tier is, if it is one.
pub(crate) fn compound(kind: u8, tier: u8) -> Option<Compound> {
    match kind {
        TOWN_HALL if tier >= 3 => Some(castle()),
        EMBASSY => Some(embassy(tier)),
        _ => None,
    }
}

/// How far a compound reaches from its middle (0 for the buildings that are not one).
pub(crate) fn extent(kind: u8, tier: u8) -> f32 { match kind { TOWN_HALL if tier >= 3 => CASTLE_REACH, EMBASSY => EMBASSY_REACH, _ => 0.0 } }
const CASTLE_REACH: f32 = 32.6;   // the corner towers (22, 19) are 29.1 from the middle and 3.3 wide at the foot
const EMBASSY_REACH: f32 = 25.7;  // the corner towers (16, 18) are 24.1 from the middle and 1.55 wide at the foot

/// A point of the compound's own frame in the world, for a building (turned by its `rot`).
pub(crate) fn at(b: &Building, p: (f32, f32)) -> (f32, f32) { let d = crate::doors::to_world(b.rot, p); (b.x + d.0, b.y + d.1) }

/// Do the segments a-b and c-d cross?
pub(crate) fn crosses(a: (f32, f32), b: (f32, f32), c: (f32, f32), d: (f32, f32)) -> bool {
    let side = |p: (f32, f32), q: (f32, f32), r: (f32, f32)| (q.0 - p.0) * (r.1 - p.1) - (q.1 - p.1) * (r.0 - p.0);
    side(a, b, c) * side(a, b, d) < 0.0 && side(c, d, a) * side(c, d, b) < 0.0
}

impl World {
    /// Are the doors of a compound shut? The Castle shuts its gates while a battle is on, like every stone gatehouse, and opens them again afterwards.
    pub(crate) fn compound_shut(&self, b: &Building) -> bool { b.kind == TOWN_HALL && b.tier >= 3 && self.battle.is_some() }
}

/// The Embassy: a walled rectangle (32 x 36) with its gate between two towers in front (+z), the keep across the back, two gardens either side of the gravel way, a well, the guest house,
/// the treasury and the guard houses, the archery range and the dungeon by the gate.
fn embassy(tier: u8) -> Compound {
    let exit = crate::doors::exit_local(EMBASSY, tier);
    let mut c = Compound::new(exit);
    let (x, zb, zf) = (16.0f32, -18.0f32, 18.0f32);
    c.wall(-x, zb, x, zb, 0.3); for s in [-1.0f32, 1.0] { c.wall(s * x, zb, s * x, zf, 0.3); }
    for s in [-1.0f32, 1.0] { c.front_wall(s * 2.9, zf, s * 8.0, zf, 0.3); c.wall(s * 8.0, zf, s * x, zf, 0.3); }
    for s in [-1.0f32, 1.0] { for z in [zb, zf] { c.round(s * x, z, 1.6); } c.front_round(s * 1.9, zf, 1.2); }
    // the keep across the back (granary, chapel, great hall, armoury, smithy) and the hall's porch
    c.wall(-14.1, -13.2, 14.1, -13.2, 2.8); c.wall(-0.8, -9.9, 0.8, -9.9, 0.8);
    // the gardens either side of the gravel way, the well, the lantern post and the cypresses
    for s in [-1.0f32, 1.0] { c.wall(s * 4.75, -4.75, s * 4.75, -1.25, 2.8); for z in [-6.0f32, -2.0, 2.0] { c.round(s * 8.9, z, 0.7); } }
    c.round(-5.0, 6.5, 1.1); c.round(5.0, 6.5, 0.35);
    // the guest house, the scriptorium and the treasury
    c.round(7.2, 6.6, 1.8); c.round(-8.4, 10.0, 1.3); c.round(7.4, 9.9, 1.5);
    // by the gate: a guard house either side, the archery range on the left and the dungeon on the right
    for s in [-1.0f32, 1.0] { c.wall(s * 4.2, 13.8, s * 4.2, 14.2, 1.45); }
    c.wall(-11.35, 13.95, -9.85, 13.95, 2.5); c.wall(9.85, 13.95, 11.35, 13.95, 2.5);
    // the paths: the gravel way from the gate up to the door of the great hall, and the walk along the front of the keep to the doors of the other halls
    let g = [c.node(0.0, 20.2), c.node(0.0, 16.4), c.node(0.0, 12.5), c.node(0.0, 8.5), c.node(0.0, 4.0), c.node(0.0, 0.0), c.node(0.0, -4.0), c.node(0.0, -8.4)];
    c.path(&[0, g[0], g[1], g[2], g[3], g[4], g[5], g[6], g[7]]);
    let (mut west, mut east) = (vec![g[7]], vec![g[7]]);
    for k in 1..=4 { west.push(c.node(-3.0 * k as f32, -8.4)); east.push(c.node(3.0 * k as f32, -8.4)); }
    c.path(&west); c.path(&east);
    for s in [-1.0f32, 1.0] { let n = c.node(s * 4.2, 16.4); c.path(&[g[1], n]); }   // the doors of the guard houses
    c
}

/// The Castle: a concentric fortress (44 x 38 curtain wall with sixteen towers, a gatehouse, a barbican and a bridge in front (+z), an inner screen wall with its own gate, the palace across the
/// back with the donjon, the wards at the sides and the outer ward in front).
fn castle() -> Compound {
    let exit = crate::doors::exit_local(TOWN_HALL, 3);
    let mut c = Compound::new(exit);
    let (x, z, iz) = (22.0f32, 19.0f32, 2.6f32);
    // the curtain wall and its towers
    c.wall(-x, -z, x, -z, 0.7); for s in [-1.0f32, 1.0] { c.wall(s * x, -z, s * x, z, 0.7); c.front_wall(s * 3.6, z, s * 8.0, z, 0.7); c.wall(s * 8.0, z, s * x, z, 0.7); }
    for s in [-1.0f32, 1.0] {
        for t in [-z, z] { c.round(s * x, t, 3.3); }
        for t in [-9.5f32, 0.0, 9.5] { c.round(s * x, t, 2.1); }
        c.round(s * 11.0, -z, 2.1); c.round(s * 12.0, z, 2.1);
        c.front_round(s * 3.7, z + 0.4, 2.3);                                     // the gatehouse towers
        c.front_wall(s * 2.7, z + 0.4, s * 2.7, z + 5.6, 0.5); c.front_round(s * 2.7, z + 5.4, 1.3);   // the barbican
    }
    // the inner screen wall, with its gate between two towers
    for s in [-1.0f32, 1.0] { c.wall(s * 2.4, iz, s * 15.0, iz, 0.5); c.round(s * 2.4, iz + 0.4, 1.5); c.round(s * 15.0, iz, 1.9); }
    // the palace: the back range with its corner pavilions and the donjon, the two wings, the great hall and the columns of its porch
    c.wall(-11.0, -14.2, 11.0, -14.2, 3.1); for s in [-1.0f32, 1.0] { c.round(s * 14.9, -14.2, 2.9); c.wall(s * 11.9, -9.15, s * 11.9, -0.55, 2.2); c.round(s * 1.8, -6.2, 0.3); }
    c.round(0.0, -14.2, 3.7); c.wall(-3.2, -9.0, 3.2, -9.0, 1.9);
    // the palace court: four flower beds and the fountain
    for s in [-1.0f32, 1.0] { for cz in [-5.3f32, 0.7] { c.wall(s * 5.2 - 1.1, cz, s * 5.2 + 1.1, cz, 1.2); } }
    c.round(0.0, -2.3, 1.7);
    // the west ward (the chapel and its tower, the granary) and the east ward (the kitchen, the pantry, the bakehouse and its oven)
    c.wall(-18.0, -13.7, -18.0, -9.3, 2.3); c.round(-18.0, -5.4, 1.5); c.round(-18.0, -0.4, 2.8);
    c.wall(18.0, -13.3, 18.0, -11.9, 2.6); c.block(18.0, -5.4, 5.0, 4.2); c.block(18.0, -0.2, 4.6, 3.2); c.round(20.6, -0.2, 1.2);
    // the outer ward: the stables and their paddock, the haystacks, the crops and the orchard; the smithy, the furnace, the training dummies, the well and the stalls
    c.block(-14.0, 7.6, 9.5, 4.2); c.round(-20.0, 5.4, 1.2); c.round(-19.4, 12.0, 1.0); c.wall(-17.8, 12.4, -10.6, 12.4, 0.15); c.wall(-12.6, 15.3, -9.0, 15.3, 2.1);
    for (tx, tz) in [(-19.4f32, 16.4f32), (-16.4, 16.8), (-8.0, 17.4)] { c.round(tx, tz, 0.45); }
    c.block(15.0, 7.6, 5.4, 4.2); c.round(17.8, 8.0, 0.5); for dx in [12.6f32, 14.4] { c.round(dx, 15.2, 0.45); } for k in 0..3 { c.round(16.0 + 1.6 * k as f32, 17.2, 0.6); }
    c.round(9.0, 11.0, 1.2); for s in [-7.0f32, 7.0] { c.wall(s - 0.3, 15.4, s + 0.3, 15.4, 0.95); }
    for bx in [-5.6f32, -4.8] { c.round(bx, 16.8, 0.45); } c.round(5.2, 17.0, 0.6);
    // the doors: the barbican's arch, and the inner gate (open, they lie against the walls of the passages)
    c.doors.push(Piece { ax: -1.6, az: 24.1, bx: 1.6, bz: 24.1, r: 0.25, front: true });
    c.doors.push(Piece { ax: -1.1, az: 3.22, bx: 1.1, bz: 3.22, r: 0.25, front: false });
    // the paths. Out of the barbican over the bridge, through the gatehouse and up the gravel way to the inner gate (the door at z 24.1 and the inner gate at z 3.2 are crossed between nodes 2 and 3 and nodes 7 and 8)
    let n: Vec<usize> = [(0.0f32, 28.6f32), (0.0, 25.6), (0.0, 22.6), (0.0, 19.2), (0.0, 15.0), (0.0, 13.0), (0.0, 10.9), (0.0, 4.4), (0.0, 1.6)].iter().map(|&(a, b)| c.node(a, b)).collect();
    c.path(&[0, n[0], n[1], n[2], n[3], n[4], n[5], n[6], n[7], n[8]]);
    // the court: round the fountain, and to the door of the great hall
    let ring: Vec<usize> = (0..8).map(|k| { let a = k as f32 * std::f32::consts::FRAC_PI_4; c.node(3.0 * a.sin(), -2.3 + 3.0 * a.cos()) }).collect();
    c.path(&[n[8], ring[0]]); for k in 0..8 { c.edges.push((ring[k], ring[(k + 1) % 8])); }
    let porch = c.node(0.0, -6.2); c.path(&[ring[4], porch]);
    // the outer ward: west along the front of the stables to their doors, east to the smithy and round to the bakehouse
    let mut w = vec![n[6]]; for wx in [-4.0f32, -8.0, -10.5, -12.8, -15.1, -17.4] { w.push(c.node(wx, 10.9)); } c.path(&w);
    let mut e = vec![n[5]]; for (ex, ez) in [(6.0f32, 13.0f32), (12.0, 13.0), (15.0, 13.0), (19.2, 13.0), (19.2, 8.0), (19.2, 3.0), (18.0, 2.6)] { e.push(c.node(ex, ez)); } c.path(&e);
    let smithy = c.node(15.0, 11.2); c.path(&[e[3], smithy]);
    c
}
