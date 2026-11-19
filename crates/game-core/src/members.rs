//! Individual soldiers on a march. The core moves an army as one body along the unified path network (`march.rs`); the soldiers drawn round it are only a picture of that, but each one still has to
//! walk like a person: never through a building, a wall or fence, a field, or water that is not bridged, through gates and over (lowered) drawbridges and bridges as the army does.
//! These functions are the checks the client's soldiers use every frame, kept here so the rules are the core's own (and testable): where one may stand (`member_blocked`), how one steps
//! towards a goal and slides round what is in the way (`member_step`), how far one may be offset sideways from the path inside the free width (`member_reach`), and a route for one soldier
//! along the network when it has got stuck (`member_route`). They only read the village; they change nothing and do not enter the state hash.
use super::*;
use std::collections::HashMap;
use std::rc::Rc;

/// What stops a person: solid circles (buildings, shut gates), wall and fence runs, fields, and the decks that make water passable.
pub(crate) struct Obst {
    solids: HashMap<(i32, i32), Vec<Solid>>,
    decks: Vec<(f32, f32, f32, f32, f32)>,
    lendable: Vec<(f32, f32, f32, f32, f32)>,
}

#[derive(Clone)]
enum Solid {
    Circle(f32, f32, f32),
    Wall(f32, f32, f32, f32, f32),
    Field(Rc<Building>),
}

fn bucket(v: f32) -> i32 { (v / 12.0).floor() as i32 }

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
    pub(crate) fn obst(&self) -> Rc<Obst> {
        let mut h: u64 = self.net_stamp() ^ 0x9e3779b97f4a7c15;
        let mut mix = |v: u64| { h ^= v; h = h.wrapping_mul(0x100000001b3); };
        for b in &self.bridges { for v in b { mix(v.to_bits() as u64); } }
        for b in self.buildings.iter().filter(|b| b.kind == DRAWBRIDGE || b.kind == GATE) { mix((b.status as u64) << 1 | (b.progress > 0) as u64); }
        mix(self.battle.is_some() as u64);
        if let Some((st, o)) = &*self.mem_cache.borrow() { if *st == h { return o.clone(); } }
        let mut o = Obst { solids: HashMap::new(), decks: vec![], lendable: vec![] };
        for b in &self.buildings {
            match b.kind {
                GATE => { if self.gate_shut(b) { o.add(Solid::Circle(b.x, b.y, 3.4)); } }
                ROAD | MOAT | RIVER | RAISE | LOWER => {}
                BRIDGE | DRAWBRIDGE => {} // handled with the battle's crossing geometry below
                TOLL => {
                    for (lx, ly, r) in [(2.4, -0.2, 1.6), (-1.25, 0.6, 0.55), (1.25, 0.6, 0.55)] {
                        let (dx, dy) = crate::doors::to_world(b.rot, (lx, ly));
                        o.add(Solid::Circle(b.x + dx, b.y + dy, r));
                    }
                }
                PLAZA => o.add(Solid::Circle(b.x, b.y, if b.opts & 4 != 0 { 1.3 } else { 0.4 })),
                _ => {
                    if matches!(b.kind, FARM | GARDEN | PARK | MARKET) { o.add(Solid::Field(Rc::new(b.clone()))); }
                    o.add(Solid::Circle(b.x, b.y, crate::solid_radius(b.kind, b.tier)));
                }
            }
        }
        let (segs, _) = self.wall_lines();
        for sg in &segs { o.add(Solid::Wall(sg.ax, sg.ay, sg.bx, sg.by, sg.r)); }
        for c in self.crossings() {
            let deck = (c.ax, c.ay, c.bx, c.by, c.half);
            if c.down { o.decks.push(deck); } else if c.lendable { o.lendable.push(deck); }
        }
        let o = Rc::new(o);
        *self.mem_cache.borrow_mut() = Some((h, o.clone()));
        o
    }

    fn blocked_with(&self, o: &Obst, x: f32, y: f32, m: f32) -> bool {
        !o.solid_clear((x, y), (x, y), m) || (self.ground_is_wet(x, y, self.height_ground(x, y)) && !o.on_deck(x, y, false))
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
        for (k, a) in [0.0f32, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 2.0, -2.0].iter().enumerate() {
            let (c, sn) = ((base + a).cos(), (base + a).sin());
            let (px, py) = (x + c * s, y + sn * s);
            if !self.blocked_with(&o, px, py, m) && !self.blocked_with(&o, x + c * s * 0.5, y + sn * s * 0.5, m) { return [px, py, if k == 0 { 0.0 } else { 1.0 }]; }
        }
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

impl Obst {
    fn add(&mut self, solid: Solid) {
        let (ax, ay, bx, by, r) = match &solid {
            Solid::Circle(x, y, r) => (*x, *y, *x, *y, *r),
            Solid::Wall(ax, ay, bx, by, r) => (*ax, *ay, *bx, *by, *r),
            Solid::Field(b) => (b.x, b.y, b.x, b.y, 18.0),
        };
        for y in bucket(ay.min(by) - r)..=bucket(ay.max(by) + r) {
            for x in bucket(ax.min(bx) - r)..=bucket(ax.max(bx) + r) {
                self.solids.entry((x, y)).or_default().push(solid.clone());
            }
        }
    }

    pub(crate) fn solid_clear(&self, a: (f32, f32), b: (f32, f32), room: f32) -> bool {
        if [a.0, a.1, b.0, b.1].iter().any(|v| !v.is_finite() || v.abs() > MAP_LIMIT) { return false; }
        let (ax, ay, bx, by) = (a.0.min(b.0) - room, a.1.min(b.1) - room, a.0.max(b.0) + room, a.1.max(b.1) + room);
        let steps = ((b.0 - a.0).hypot(b.1 - a.1) / 0.45).ceil().max(1.0) as u32;
        let samples = || (0..=steps).map(|i| {
            let t = i as f32 / steps as f32;
            (lerp(a.0, b.0, t), lerp(a.1, b.1, t))
        });
        for y in bucket(ay)..=bucket(by) {
            for x in bucket(ax)..=bucket(bx) {
                let Some(solids) = self.solids.get(&(x, y)) else { continue; };
                for solid in solids {
                    let clear = match *solid {
                        Solid::Circle(x, y, r) => x + r < ax || x - r > bx || y + r < ay || y - r > by
                            || seg_dist(x, y, a.0, a.1, b.0, b.1) >= r + room,
                        Solid::Wall(x0, y0, x1, y1, r) => x0.max(x1) + r < ax || x0.min(x1) - r > bx || y0.max(y1) + r < ay || y0.min(y1) - r > by
                            || samples().all(|(x, y)| seg_dist(x, y, x0, y0, x1, y1) >= r + room),
                        Solid::Field(ref f) => f.x + 18.0 < ax || f.x - 18.0 > bx || f.y + 18.0 < ay || f.y - 18.0 > by
                            || samples().all(|(x, y)| (f.x - x).abs() >= 18.0 || (f.y - y).abs() >= 18.0 || !crate::pathnet::in_fields(f, x, y, room)),
                    };
                    if !clear { return false; }
                }
            }
        }
        true
    }

    pub(crate) fn on_deck(&self, x: f32, y: f32, lend: bool) -> bool {
        self.decks.iter().chain(self.lendable.iter().filter(|_| lend)).any(|d| {
            let (dx, dy) = (d.2 - d.0, d.3 - d.1);
            let length = dx.hypot(dy).max(0.001);
            let (px, py) = (x - d.0, y - d.1);
            let along = (px * dx + py * dy) / length;
            (-0.2..=length + 0.2).contains(&along) && (px * dy - py * dx).abs() <= d.4 * length
        })
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
