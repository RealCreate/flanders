//! Individual soldiers on a march. The core moves an army as one body along the unified path network (`march.rs`); the soldiers drawn round it are only a picture of that, but each one still has to
//! walk like a person: never through a building, a wall or fence, a field, or water that is not bridged, through gates and over (lowered) drawbridges and bridges as the army does.
//! These functions are the checks the client's soldiers use every frame, kept here so the rules are the core's own (and testable): where one may stand (`member_blocked`), how one steps
//! towards a goal and slides round what is in the way (`member_step`), how far one may be offset sideways from the path inside the free width (`member_reach`), and a route for one soldier
//! along the network when it has got stuck (`member_route`). They only read the village; they change nothing and do not enter the state hash.
use super::*;
use std::rc::Rc;

/// What stops a person: solid circles (buildings, shut gates), wall and fence runs, fields, and the decks that make water passable.
pub(crate) struct Obst {
    circles: Vec<(f32, f32, f32)>,
    segs: Vec<(f32, f32, f32, f32, f32)>,
    fields: Vec<Building>,
    decks: Vec<(f32, f32, f32, f32, f32)>,
}

/// The room a soldier on foot takes up, and how much more an engine or rider needs (the "engine-width layer": clear of buildings, walls and fields by this much).
pub const FOOT_MARGIN: f32 = 0.3;
pub const ENGINE_MARGIN: f32 = 1.6;
fn margin(lvl: u8) -> f32 { if lvl >= 3 { ENGINE_MARGIN } else { FOOT_MARGIN } }

fn seg_dist(px: f32, py: f32, ax: f32, ay: f32, bx: f32, by: f32) -> f32 {
    let (dx, dy) = (bx - ax, by - ay); let l2 = (dx * dx + dy * dy).max(1e-6);
    let t = (((px - ax) * dx + (py - ay) * dy) / l2).clamp(0.0, 1.0);
    (px - (ax + dx * t)).hypot(py - (ay + dy * t))
}

impl World {
    fn obst(&self) -> Rc<Obst> {
        let mut h: u64 = self.net_stamp() ^ 0x9e3779b97f4a7c15;
        let mut mix = |v: u64| { h ^= v; h = h.wrapping_mul(0x100000001b3); };
        for b in &self.bridges { for v in b { mix(v.to_bits() as u64); } }
        for b in self.buildings.iter().filter(|b| b.kind == DRAWBRIDGE || b.kind == GATE) { mix((b.status as u64) << 1 | (b.progress > 0) as u64); }
        mix(self.battle.is_some() as u64);
        if let Some((st, o)) = &*self.mem_cache.borrow() { if *st == h { return o.clone(); } }
        let mut o = Obst { circles: vec![], segs: vec![], fields: vec![], decks: vec![] };
        for b in &self.buildings {
            match b.kind {
                GATE => { if self.gate_shut(b) { o.circles.push((b.x, b.y, 3.4)); } }
                ROAD | MOAT | RIVER | RAISE | LOWER => {}
                BRIDGE => { let (ux, uy, l) = Self::bridge_dir(b); o.decks.push((b.x - ux * l / 2.0, b.y - uy * l / 2.0, b.x + ux * l / 2.0, b.y + uy * l / 2.0, 1.8)); }
                DRAWBRIDGE => {
                    if self.drawn_up(b) { continue; }
                    let a = b.rot as f32 * std::f32::consts::FRAC_PI_4; let (sx, sy) = (a.sin(), a.cos());
                    o.decks.push((b.x - sx * 7.2, b.y - sy * 7.2, b.x + sx * 7.2, b.y + sy * 7.2, 1.6));
                }
                _ => {
                    if matches!(b.kind, FARM | GARDEN | PARK | MARKET) { o.fields.push(b.clone()); }
                    o.circles.push((b.x, b.y, crate::solid_radius(b.kind, b.tier)));
                }
            }
        }
        let (segs, _) = self.wall_lines();
        for sg in &segs { o.segs.push((sg.ax, sg.ay, sg.bx, sg.by, sg.r)); }
        for br in &self.bridges { o.decks.push((br[0], br[1], br[2], br[3], 1.6)); }
        let o = Rc::new(o);
        *self.mem_cache.borrow_mut() = Some((h, o.clone()));
        o
    }

    fn blocked_with(&self, o: &Obst, x: f32, y: f32, m: f32) -> bool {
        if !x.is_finite() || !y.is_finite() || x.abs() > MAP_LIMIT || y.abs() > MAP_LIMIT { return true; }
        if o.circles.iter().any(|c| (c.0 - x).hypot(c.1 - y) < c.2 + m) { return true; }
        if o.segs.iter().any(|s| seg_dist(x, y, s.0, s.1, s.2, s.3) < s.4 + m) { return true; }
        if o.fields.iter().any(|b| crate::pathnet::in_fields(b, x, y, m)) { return true; }
        if self.height_ground(x, y) < 0.2 && !o.decks.iter().any(|d| seg_dist(x, y, d.0, d.1, d.2, d.3) <= d.4) { return true; }
        false
    }

    /// Is this a place a person (`lvl` < 3) or an engine or rider (`lvl` 3: needs more room) may not stand?
    pub(crate) fn member_blocked_inner(&self, x: f32, y: f32, lvl: u8) -> bool { let o = self.obst(); self.blocked_with(&o, x, y, margin(lvl)) }

    /// One step of up to `step` from (x, y) towards (tx, ty), never into a blocked place: when the straight way is blocked it slides off to either side. [x, y, how]: how 0 straight, 1 round
    /// something, 2 could not move. A soldier standing in a blocked place (pushed there, or a building rose under it) is led out by the first free direction.
    pub(crate) fn member_step_inner(&self, x: f32, y: f32, tx: f32, ty: f32, step: f32, lvl: u8) -> [f32; 3] {
        let (dx, dy) = (tx - x, ty - y); let d = dx.hypot(dy);
        if !(d > 1e-4) || !(step > 0.0) { return [x, y, 0.0]; }
        let o = self.obst(); let m = margin(lvl);
        let s = step.min(d); let base = dy.atan2(dx);
        let inside = self.blocked_with(&o, x, y, m);
        for (k, a) in [0.0f32, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 2.0, -2.0].iter().enumerate() {
            let (c, sn) = ((base + a).cos(), (base + a).sin());
            let (px, py) = (x + c * s, y + sn * s);
            if !self.blocked_with(&o, px, py, m) && !self.blocked_with(&o, x + c * s * 0.5, y + sn * s * 0.5, m) { return [px, py, if k == 0 { 0.0 } else { 1.0 }]; }
        }
        if inside { return [x + dx / d * s, y + dy / d * s, 1.0]; }   // nowhere free to go: do not stand still in a wall, walk on out
        [x, y, 2.0]
    }

    /// How far from (x, y) a soldier may stand in direction (dx, dy), at most `want`: it stops short of the first blocked place on the way (and keeps a little off it).
    pub(crate) fn member_reach_inner(&self, x: f32, y: f32, dx: f32, dy: f32, want: f32, lvl: u8) -> f32 {
        let l = dx.hypot(dy); if !(l > 1e-6) || !(want > 0.0) { return 0.0; }
        let (ux, uy) = (dx / l, dy / l); let o = self.obst(); let m = margin(lvl);
        let mut free = 0.0f32; let mut t = 0.4f32;
        while t <= want + 0.2 {
            let s = t.min(want);
            if self.blocked_with(&o, x + ux * s, y + uy * s, m) { break; }
            free = s; if s >= want { break; } t += 0.4;
        }
        (free - 0.4).max(0.0).min(want)
    }

    /// A route for one soldier from where it stands to a place, along the path network (the same graph the army's route comes from): [x, y, x, y, ...] without the start, empty when there is none.
    /// `lvl` 3 asks for the engine-width layer.
    pub(crate) fn member_route_inner(&self, sx: f32, sy: f32, tx: f32, ty: f32, lvl: u8) -> Vec<f32> {
        if ![sx, sy, tx, ty].iter().all(|v| v.is_finite() && v.abs() <= MAP_LIMIT) { return vec![]; }
        let units: [u32; NK] = if lvl >= 3 { [0, 0, 0, 0, 1, 0] } else { [1, 0, 0, 0, 0, 0] };
        match self.route_on_graph(&units, sx, sy, tx, ty, true) {
            Ok(p) => p.iter().skip(1).flat_map(|w| [w.x, w.y]).collect(),
            Err(_) => vec![],
        }
    }
}

#[wasm_bindgen]
impl World {
    /// Is this a place a soldier may not stand (inside a building, wall, field, or in water)? `lvl` 3 is the engine width.
    pub fn member_blocked(&self, x: f32, y: f32, lvl: u8) -> bool { self.member_blocked_inner(x, y, lvl) }
    /// One step towards a goal that never enters a blocked place: [x, y, 0 straight / 1 round an obstacle / 2 stuck].
    pub fn member_step(&self, x: f32, y: f32, tx: f32, ty: f32, step: f32, lvl: u8) -> Vec<f32> { self.member_step_inner(x, y, tx, ty, step, lvl).to_vec() }
    /// How far (at most `want`) one may be offset from (x, y) in direction (dx, dy) before something blocks the way.
    pub fn member_reach(&self, x: f32, y: f32, dx: f32, dy: f32, want: f32, lvl: u8) -> f32 { self.member_reach_inner(x, y, dx, dy, want, lvl) }
    /// A soldier's own route along the path network from (sx, sy) to (tx, ty): [x, y, ...] (empty if none). `lvl` 3: engine width.
    pub fn member_route(&self, sx: f32, sy: f32, tx: f32, ty: f32, lvl: u8) -> Vec<f32> { self.member_route_inner(sx, sy, tx, ty, lvl) }
}
