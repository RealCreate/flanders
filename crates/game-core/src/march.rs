//! Field armies: detachments that march across the map. Pathfinding goes around buildings, cliffs, water and (for siege
//! engines) dense forest. Soldiers fell trees to open a way for catapults, build bridges over narrow water and ferry
//! themselves across wide water. All of it is deterministic, so every peer sees the same march.
use super::*;
use crate::military::*;
use std::cell::RefCell;
use std::cmp::Ordering;
use std::collections::BinaryHeap;
use std::rc::Rc;

pub const CELL: f32 = 2.5;
pub const NC: i32 = 960; // cells per side, covering [-1200, 1200)
const ORG: f32 = -1200.0;
const MAX_FERRY: f32 = 64.0;
const BRIDGE_MAX: f32 = 12.0;

pub const S_IDLE: u8 = 0;
pub const S_MARCH: u8 = 1;
pub const S_FELL: u8 = 2;
pub const S_BRIDGE: u8 = 3;
pub const S_FERRY: u8 = 4;
pub const S_ARRIVED: u8 = 5;
pub const S_WAIT: u8 = 6;
pub const S_HOME: u8 = 7;
pub const S_FIGHT: u8 = 8;   // its soldiers are in the battle (see battle::det_join)

/// A waypoint; `mode` describes the leg that ends here: 0 walk, 1 fell trees, 2 cross water.
#[derive(Clone, Copy, Debug)]
pub struct Wp { pub x: f32, pub y: f32, pub mode: u8 }

/// Knights, catapults and other riders and engines that travel apart from the foot soldiers of an army, each at their own pace and heading straight for the place the army was sent to.
/// They look for their own way (roads and bridges first, as everybody does); where theirs would need felling or a crossing that only the soldiers can make, they keep to the army's route
/// (`tied`) and wait at such a place until the soldiers have made it passable.
#[derive(Clone)]
pub struct Grp {
    pub units: [u32; NK],
    pub x: f32, pub y: f32,
    pub path: Vec<Wp>,
    pub wi: usize,
    pub heading: f32,
    pub speed: f32,
    pub tied: bool,
}

#[derive(Clone)]
pub struct Det {
    pub id: u32,
    pub units: [u32; NK],
    pub x: f32,
    pub y: f32,
    pub path: Vec<Wp>,
    pub wi: usize,
    pub state: u8,
    pub phase: u8,          // inside a water leg: 0 not started, 1 working (bridge/boat), 2 crossing
    pub work: f32,
    pub work_total: f32,
    pub sx: f32, pub sy: f32, // start of the current leg
    pub atk: Option<(f32, f32)>,
    pub home: bool,
    pub heading: f32,
    pub speed: f32,
    pub since_fell: f32,
    pub grp: Vec<Grp>,      // riders and engines marching apart (see Grp); their soldiers are still counted in `units`
    pub defend: bool,       // sent to fight in the battle at home: joins it as soon as it is close to an attacker
}

pub struct NavStatic { h: Vec<f32>, slope: Vec<f32>, dens: Vec<u8>, tun: Vec<bool> }

thread_local! { static NAV: RefCell<Option<(u64, Rc<NavStatic>)>> = const { RefCell::new(None) }; }

pub fn nav_static(seed: u64) -> Rc<NavStatic> {
    if let Some(n) = nav_cached(seed) { return n; }
    let n = NC as usize;
    let h = terrain::grid(seed, ORG + CELL / 2.0, ORG + CELL / 2.0, NC as u32, NC as u32, CELL);
    let mut cnt = vec![0u8; n * n];
    count_trees(&mut cnt, &terrain::trees(seed, ORG, ORG, -ORG, -ORG));
    nav_install(seed, h, cnt)
}

fn nav_cached(seed: u64) -> Option<Rc<NavStatic>> {
    NAV.with(|c| match &*c.borrow() { Some((s, n)) if *s == seed => Some(n.clone()), _ => None })
}

fn count_trees(cnt: &mut [u8], t: &[f32]) {
    let n = NC as usize;
    for k in (0..t.len()).step_by(5) {
        let (ci, cj) = (((t[k] - ORG) / CELL) as i32, ((t[k + 1] - ORG) / CELL) as i32);
        if ci >= 0 && cj >= 0 && ci < NC && cj < NC { let q = &mut cnt[cj as usize * n + ci as usize]; *q = q.saturating_add(1); }
    }
}

/// The cheap last part of the grid (slopes, forest density, tunnels) from the two expensive parts (heights and tree counts), cached for `seed`.
fn nav_install(seed: u64, h: Vec<f32>, cnt: Vec<u8>) -> Rc<NavStatic> {
    let n = NC as usize;
    let mut slope = vec![0.0f32; n * n];
    for j in 0..n { for i in 0..n {
        let c = h[j * n + i];
        let mut m = 0.0f32;
        for (di, dj) in [(1i32, 0i32), (-1, 0), (0, 1), (0, -1)] {
            let (a, b) = (i as i32 + di, j as i32 + dj);
            if a >= 0 && b >= 0 && (a as usize) < n && (b as usize) < n { m = m.max((h[b as usize * n + a as usize] - c).abs() / CELL); }
        }
        slope[j * n + i] = m;
    } }
    let mut dens = vec![0u8; n * n];
    for j in 0..n { for i in 0..n {
        let mut s = 0u32;
        for dj in -1i32..=1 { for di in -1i32..=1 { let (a, b) = (i as i32 + di, j as i32 + dj); if a >= 0 && b >= 0 && a < NC && b < NC { s += cnt[b as usize * n + a as usize] as u32; } } }
        dens[j * n + i] = s.min(9) as u8;
    } }
    // tunnels bored through mountains: a corridor that is always passable, whatever the ground above it does
    let mut tun = vec![false; n * n];
    for t in terrain::tunnels(seed) {
        let l = ((t[2] - t[0]).powi(2) + (t[3] - t[1]).powi(2)).sqrt(); let st = (l / 1.0).ceil() as i32;
        for k in 0..=st { let f = k as f32 / st as f32; stamp(&mut tun, t[0] + (t[2] - t[0]) * f, t[1] + (t[3] - t[1]) * f, 3.6); }
    }
    let ns = Rc::new(NavStatic { h, slope, dens, tun });
    NAV.with(|c| *c.borrow_mut() = Some((seed, ns.clone())));
    ns
}

/// A navigation grid being built a slice at a time (so the page stays responsive): heights row by row, then tree counts strip by strip.
struct NavBuild { seed: u64, h: Vec<f32>, cnt: Vec<u8>, rows: u32, strip: i32 }
thread_local! { static NAV_BUILD: RefCell<Option<NavBuild>> = const { RefCell::new(None) }; }

/// Do about `units` rows of the navigation grid of `seed`; returns how far it is (0..1, exactly 1 once the grid is ready). The result is the very grid
/// `nav_static` builds in one go: the slices only decide when the work happens, never what comes out.
pub fn nav_build_step(seed: u64, units: u32) -> f32 {
    if nav_cached(seed).is_some() { NAV_BUILD.with(|b| *b.borrow_mut() = None); return 1.0; }
    let n = NC as usize;
    let (c0, c1) = ((ORG / terrain::TREE_CELL).floor() as i32, (-ORG / terrain::TREE_CELL).ceil() as i32);
    let total = NC as u32 + (c1 - c0) as u32;
    let mut b = NAV_BUILD.with(|b| b.borrow_mut().take()).filter(|b| b.seed == seed)
        .unwrap_or(NavBuild { seed, h: Vec::with_capacity(n * n), cnt: vec![0u8; n * n], rows: 0, strip: c0 });
    let mut left = units.max(1);
    while left > 0 && b.rows < NC as u32 {
        let k = left.min(NC as u32 - b.rows);
        b.h.extend(terrain::grid_rows(seed, ORG + CELL / 2.0, ORG + CELL / 2.0, NC as u32, CELL, b.rows, b.rows + k));
        b.rows += k; left -= k;
    }
    while left > 0 && b.strip < c1 {
        let k = (left as i32).min(c1 - b.strip);
        count_trees(&mut b.cnt, &terrain::trees_cells(seed, c0, c1, b.strip, b.strip + k));
        b.strip += k; left -= k as u32;
    }
    if b.rows >= NC as u32 && b.strip >= c1 { nav_install(seed, b.h, b.cnt); return 1.0; }
    let done = b.rows + (b.strip - c0) as u32;
    NAV_BUILD.with(|x| *x.borrow_mut() = Some(b));
    (done as f32 / total as f32).min(0.999)
}

impl NavStatic {
    pub fn dens_at(&self, x: f32, y: f32) -> u8 { self.idx(x, y).map_or(0, |i| self.dens[i]) }
    pub fn idx(&self, x: f32, y: f32) -> Option<usize> {
        let (i, j) = (((x - ORG) / CELL).floor() as i32, ((y - ORG) / CELL).floor() as i32);
        if i < 0 || j < 0 || i >= NC || j >= NC { None } else { Some((j * NC + i) as usize) }
    }
    #[allow(dead_code)] pub fn height(&self, i: usize) -> f32 { self.h[i] }
    #[allow(dead_code)] pub fn dens(&self, i: usize) -> u8 { self.dens[i] }
}

fn cell_xy(i: usize) -> (f32, f32) { ((i as i32 % NC) as f32 * CELL + ORG + CELL / 2.0, (i as i32 / NC) as f32 * CELL + ORG + CELL / 2.0) }

/// Per-request overlays: buildings, felled trees and bridges rasterised onto the grid.
pub(crate) struct Ov { blocked: Vec<bool>, soft: Vec<bool>, cleared: Vec<bool>, bridge: Vec<bool>, moat: Vec<bool>, road: Vec<bool>, deck_up: Vec<bool> }

#[derive(Clone, Copy, PartialEq)]
enum Cl { Block, Free(f32), Water }

#[derive(Copy, Clone, PartialEq)]
struct Node { f: f32, i: u32 }
impl Eq for Node {}
impl Ord for Node { fn cmp(&self, o: &Self) -> Ordering { o.f.partial_cmp(&self.f).unwrap_or(Ordering::Equal).then_with(|| o.i.cmp(&self.i)) } }
impl PartialOrd for Node { fn partial_cmp(&self, o: &Self) -> Option<Ordering> { Some(self.cmp(o)) } }

fn stamp(grid: &mut [bool], x: f32, y: f32, r: f32) {
    let (i0, i1) = ((((x - r - ORG) / CELL).floor() as i32).max(0), (((x + r - ORG) / CELL).ceil() as i32).min(NC - 1));
    let (j0, j1) = ((((y - r - ORG) / CELL).floor() as i32).max(0), (((y + r - ORG) / CELL).ceil() as i32).min(NC - 1));
    for j in j0..=j1 { for i in i0..=i1 { let (cx, cy) = cell_xy((j * NC + i) as usize); if (cx - x).powi(2) + (cy - y).powi(2) <= r * r { grid[(j * NC + i) as usize] = true; } } }
}

impl World {
    /// The overlays of the world as it stands (rebuilt only when something that matters changed: they are the adjustments to the base grid that buildings, roads, walls, bridges and felled trees make).
    fn ov(&self) -> std::rc::Rc<Ov> {
        let mut h = self.net_stamp();
        let mut mix = |v: u64| { h ^= v; h = h.wrapping_mul(0x100000001b3); };
        for f in &self.felled { for v in f { mix(v.to_bits() as u64); } }
        for b in &self.bridges { for v in b { mix(v.to_bits() as u64); } }
        mix(self.road_sig);
        mix(self.roads.len() as u64); mix(self.battle.is_some() as u64);
        for b in self.buildings.iter().filter(|b| b.kind == DRAWBRIDGE) { mix((b.status as u64) << 1 | (b.progress > 0) as u64); }
        if let Some((st, o)) = &*self.ov_cache.borrow() { if *st == h { return o.clone(); } }
        let o = std::rc::Rc::new(self.overlays());
        *self.ov_cache.borrow_mut() = Some((h, o.clone()));
        o
    }

    fn overlays(&self) -> Ov {
        let n = (NC * NC) as usize;
        let mut ov = Ov { blocked: vec![false; n], soft: vec![false; n], cleared: vec![false; n], bridge: vec![false; n], moat: vec![false; n], road: vec![false; n], deck_up: vec![false; n] };
        for b in &self.buildings {
            match b.kind {
                GATE if self.gate_shut(b) => stamp(&mut ov.blocked, b.x, b.y, 3.4),   // a barred gate: no way through
                GATE | ROAD => {}                                             // an opening in the wall, or a road: nothing blocks it
                BRIDGE => { let (ux, uy, l) = Self::bridge_dir(b); let st = (l / 1.0).ceil() as i32; for k in 0..=st { let t = k as f32 - l / 2.0; stamp(&mut ov.bridge, b.x + ux * t, b.y + uy * t, 1.8); } }   // a way over the water
                MOAT | RIVER => {   // water to cross: every cell round the piece whose real ground is below the shore line (the discs alone leave gaps between pieces)
                    let reach = if b.kind == MOAT { MOAT_FLOOR * moat_scale(b) } else { RIVER_FLOOR } + CHANNEL_BANK + 1.0;
                    let (i0, i1) = ((((b.x - reach - ORG) / CELL).floor() as i32).max(0), (((b.x + reach - ORG) / CELL).ceil() as i32).min(NC - 1));
                    let (j0, j1) = ((((b.y - reach - ORG) / CELL).floor() as i32).max(0), (((b.y + reach - ORG) / CELL).ceil() as i32).min(NC - 1));
                    for j in j0..=j1 { for i in i0..=i1 { let (cx, cy) = cell_xy((j * NC + i) as usize); if (cx - b.x).hypot(cy - b.y) <= reach {
                        let hh = CELL / 2.0;   // a cell is water if any part of it is (its middle and its four corners are looked at): a thin ditch must not slip between the cells
                        if [(0.0, 0.0), (hh, hh), (-hh, hh), (hh, -hh), (-hh, -hh)].iter().any(|(ox, oy)| self.height_ground(cx + ox, cy + oy) < 0.2) { ov.moat[(j * NC + i) as usize] = true; }
                    } } }
                }
                RAISE | LOWER => {}
                DRAWBRIDGE if self.drawn_up(b) => {                           // drawn up: no way across, unless an army lowers it for itself
                    if self.db_lendable(b) { let a = b.rot as f32 * std::f32::consts::FRAC_PI_4; let (sx, sy) = (a.sin(), a.cos()); for k in -9..=9 { let t = k as f32 * 0.8; stamp(&mut ov.deck_up, b.x + sx * t, b.y + sy * t, 1.6); } }
                }
                DRAWBRIDGE => {                                               // a way across for your own armies
                    let a = b.rot as f32 * std::f32::consts::FRAC_PI_4; let (sx, sy) = (a.sin(), a.cos());
                    for k in -9..=9 { let t = k as f32 * 0.8; stamp(&mut ov.bridge, b.x + sx * t, b.y + sy * t, 1.6); }
                }
                _ => {
                    if matches!(b.kind, FARM | GARDEN | PARK | MARKET) {   // its fields, beds and stalls are blocked as the rectangles they are (nobody walks across a crop)
                        let (i0, i1) = ((((b.x - 18.0 - ORG) / CELL).floor() as i32).max(0), (((b.x + 18.0 - ORG) / CELL).ceil() as i32).min(NC - 1));
                        let (j0, j1) = ((((b.y - 18.0 - ORG) / CELL).floor() as i32).max(0), (((b.y + 18.0 - ORG) / CELL).ceil() as i32).min(NC - 1));
                        for j in j0..=j1 { for i in i0..=i1 { let (cx, cy) = cell_xy((j * NC + i) as usize); if crate::pathnet::in_fields(b, cx, cy, 0.9) { ov.blocked[(j * NC + i) as usize] = true; } } }
                    }
                    stamp(&mut ov.blocked, b.x, b.y, crate::solid_radius(b.kind, b.tier));   // the solid part: no way through
                    if !matches!(b.kind, WALL | FENCE) { stamp(&mut ov.soft, b.x, b.y, crate::footprint(b.kind, b.tier) + 0.7); }   // the margin round it: allowed, but avoided
                }
            }
        }
        let (segs, _) = self.wall_lines();
        for sg in &segs {   // the runs of wall and fence between the pieces (the pieces alone leave gaps)
            let l = (sg.bx - sg.ax).hypot(sg.by - sg.ay); let st = (l / 1.0).ceil().max(1.0) as i32;
            for k in 0..=st { let t = k as f32 / st as f32; stamp(&mut ov.blocked, sg.ax + (sg.bx - sg.ax) * t, sg.ay + (sg.by - sg.ay) * t, sg.r + 0.4); }
        }
        for r in &self.roads {   // the village's roads: soldiers keep to them
            let (dx, dy) = (r[3] - r[0], r[4] - r[1]); let l = dx.hypot(dy).max(0.1); let st = (l / 1.0).ceil() as i32;
            for k in 0..=st { let t = k as f32 / st as f32; stamp(&mut ov.road, r[0] + dx * t, r[1] + dy * t, 1.3); }
        }
        for f in &self.felled { stamp(&mut ov.cleared, f[0], f[1], f[2]); }
        for br in &self.bridges {
            let (dx, dy) = (br[2] - br[0], br[3] - br[1]); let l = (dx * dx + dy * dy).sqrt().max(0.1); let steps = (l / 1.0).ceil() as i32;
            for k in 0..=steps { let t = k as f32 / steps as f32; stamp(&mut ov.bridge, br[0] + dx * t, br[1] + dy * t, 1.6); }
        }
        ov
    }

    // Trees slow soldiers only a little (densest forest: 1.5x slower, was 3.7x), and the margin round a building (gardens, yards) is barely avoided, so soldiers cut through town.
    /// How a cell can be crossed. `lvl` is how much room the traveller needs: 0 a foot soldier; 1 a siege engine (gentler slopes, dense forest must be felled); 2 an engine that also keeps a cell
    /// clear of cliffs and open water; 3 one that also keeps clear of buildings, walls and fields. An engine is about three paces wide: it needs a road, not a path.
    fn classify(&self, ns: &NavStatic, ov: &Ov, i: usize, lvl: u8) -> Cl {
        let c = self.classify_cell(ns, ov, i, lvl > 0);
        if lvl < 2 || !matches!(c, Cl::Free(_)) || ov.bridge[i] || (ns.tun[i] && !ov.moat[i]) { return c; }
        let (ci, cj) = (i as i32 % NC, i as i32 / NC);
        for (di, dj) in [(1i32, 0i32), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)] {
            let (a, b) = (ci + di, cj + dj); if a < 0 || b < 0 || a >= NC || b >= NC { return Cl::Block; }
            let k = (b * NC + a) as usize;
            if ov.bridge[k] { continue; }
            if ns.h[k] < 0.2 || ov.moat[k] || ns.slope[k] > 0.85 { return Cl::Block; }
            if lvl >= 3 && ov.blocked[k] { return Cl::Block; }
        }
        c
    }

    fn classify_cell(&self, ns: &NavStatic, ov: &Ov, i: usize, siege: bool) -> Cl {
        let (x, y) = cell_xy(i);
        if x.abs() > 1192.0 || y.abs() > 1192.0 || ov.blocked[i] { return Cl::Block; }
        if ns.tun[i] && !ov.moat[i] { return Cl::Free(1.3); }
        if (ns.h[i] < 0.2 || ov.moat[i]) && !ov.bridge[i] { return Cl::Water; }
        if ns.slope[i] > if siege { 0.85 } else { 1.6 } { return Cl::Block; }
        let d = if ov.cleared[i] { 0.0 } else { ns.dens[i] as f32 };
        if siege && d >= 2.0 { return Cl::Free(8.0 + d); }               // dense forest: needs felling
        let c = 1.0 + 0.2 * d + ns.slope[i] * 1.2 + if ov.soft[i] { 0.3 } else { 0.0 };
        Cl::Free(if ov.road[i] { c * crate::pathnet::ROAD_COST } else { c })
    }

    fn near_free(&self, ns: &NavStatic, ov: &Ov, x: f32, y: f32, siege: u8) -> Option<usize> {
        let c = ns.idx(x, y)?;
        let (ci, cj) = (c as i32 % NC, c as i32 / NC);
        for r in 0..8i32 { for dj in -r..=r { for di in -r..=r {
            if di.abs().max(dj.abs()) != r { continue; }
            let (a, b) = (ci + di, cj + dj); if a < 0 || b < 0 || a >= NC || b >= NC { continue; }
            let k = (b * NC + a) as usize; if let Cl::Free(_) = self.classify(ns, ov, k, siege) { return Some(k); }
        } } }
        None
    }

    /// Find a route. Err codes: -2 unreachable, -3 siege engines need soldiers to clear the forest, -5 water too wide.
    /// One graph serves everybody: the base grid of the whole world (terrain, slopes, forest), adjusted by what is built (buildings, walls and fences block it; roads, bridges and open
    /// gates open lines through it), plus the village's path network (roads, rings round buildings, doorways, decks), which joins the grid wherever it touches it. The route is the
    /// cheapest way along those lines; roads cost little, so they are preferred.
    pub(crate) fn find_path(&self, units: &[u32; NK], sx: f32, sy: f32, tx: f32, ty: f32) -> Result<Vec<Wp>, i32> {
        self.route_on_graph(units, sx, sy, tx, ty, false)
    }

    /// The same for somebody on foot who will not wade (villagers): [1, x, y, x, y, ...] or empty when there is no dry way.
    pub(crate) fn walk_route_inner(&self, sx: f32, sy: f32, tx: f32, ty: f32) -> Vec<f32> {
        match self.route_on_graph(&[1, 0, 0, 0, 0, 0], sx, sy, tx, ty, true) {
            Ok(p) => { let mut v = vec![1.0]; for w in p.iter().skip(1) { v.extend_from_slice(&[w.x, w.y]); } v }
            Err(_) => vec![],
        }
    }

    pub(crate) fn route_on_graph(&self, units: &[u32; NK], sx: f32, sy: f32, tx: f32, ty: f32, no_water: bool) -> Result<Vec<Wp>, i32> {
        let margins: [f32; 3] = if no_water { [30.0, 90.0, 500.0] } else { [45.0, 180.0, 2500.0] };
        let mut last = Err(-2);
        // a siege engine looks for a road wide enough for it first, and only if there is none makes do with a narrower one
        let levels: &[u8] = if units[4] > 0 { &[3, 2, 1] } else { &[0] };
        'search: for &lvl in levels {
            for m in margins {
                last = self.route_in_window(units, sx, sy, tx, ty, m, no_water, lvl);
                if !matches!(last, Err(-2)) { break 'search; }
            }
        }
        last.map(|p| self.through_doors(p, !no_water))
    }

    fn route_in_window(&self, units: &[u32; NK], sx: f32, sy: f32, tx: f32, ty: f32, margin: f32, no_water: bool, siege: u8) -> Result<Vec<Wp>, i32> {
        let ns = nav_static(self.seed); let ov = self.ov(); let net = self.net();
        // how a cell can be crossed; for an army (which does not wade) the deck of a drawbridge that is drawn up counts as dry ground, because the army lowers it for itself (see `drawbridge_step`)
        let cl = |k: usize| -> Cl { match self.classify(&ns, &ov, k, siege) { Cl::Water if !no_water && ov.deck_up[k] => Cl::Free(1.5), c => c } };
        let workers = units[0] + units[2];
        let (Some(s), Some(g)) = (self.near_free(&ns, &ov, sx, sy, siege), self.near_free(&ns, &ov, tx, ty, siege)) else { return Err(-2) };
        let ((scx, scy), (gcx, gcy)) = (cell_xy(s), cell_xy(g));
        let i0 = (((scx.min(gcx) - margin - ORG) / CELL).floor() as i32).max(0); let i1 = (((scx.max(gcx) + margin - ORG) / CELL).ceil() as i32).min(NC - 1);
        let j0 = (((scy.min(gcy) - margin - ORG) / CELL).floor() as i32).max(0); let j1 = (((scy.max(gcy) + margin - ORG) / CELL).ceil() as i32).min(NC - 1);
        let (w, h) = (i1 - i0 + 1, j1 - j0 + 1); let ncell = (w * h) as usize; let nn = net.nodes.len();
        let local = |i: usize| -> Option<usize> { let (ci, cj) = (i as i32 % NC, i as i32 / NC); if ci < i0 || ci > i1 || cj < j0 || cj > j1 { None } else { Some(((cj - j0) * w + (ci - i0)) as usize) } };
        let global = |l: usize| -> usize { let (a, b) = (l as i32 % w + i0, l as i32 / w + j0); (b * NC + a) as usize };
        // where the village's path network touches the grid
        let mut at_cell: std::collections::HashMap<usize, Vec<u32>> = Default::default(); let mut node_cell: Vec<Option<usize>> = vec![None; nn];
        for (k, p) in net.nodes.iter().enumerate() { if let Some(l) = ns.idx(p.0, p.1).and_then(|gi| local(gi)) { at_cell.entry(l).or_default().push(k as u32); node_cell[k] = Some(l); } }
        let (Some(sl), Some(gl)) = (local(s), local(g)) else { return Err(-2) };
        let total = ncell + nn;
        let mut gc = vec![f32::MAX; total]; let mut from = vec![u32::MAX; total];
        let mut heap = BinaryHeap::new();
        let pos = |i: usize| -> (f32, f32) { if i < ncell { cell_xy(global(i)) } else { net.nodes[i - ncell] } };
        let hfn = |i: usize| { let p = pos(i); ((p.0 - gcx).hypot(p.1 - gcy)) / CELL * 0.7 };
        gc[sl] = 0.0; heap.push(Node { f: hfn(sl), i: sl as u32 });
        let mut found = false; let mut next: Vec<(usize, f32)> = vec![];
        while let Some(Node { i, .. }) = heap.pop() {
            let i = i as usize;
            if i == gl { found = true; break; }
            next.clear();
            if i < ncell {
                let gi = global(i); let (ci, cj) = (gi as i32 % NC, gi as i32 / NC);
                for (di, dj) in [(1i32, 0i32), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)] {
                    let (a, b) = (ci + di, cj + dj); if a < 0 || b < 0 || a >= NC || b >= NC { continue; }
                    let k = (b * NC + a) as usize; let Some(kl) = local(k) else { continue };
                    let step = match cl(k) { Cl::Block => continue, Cl::Free(c) => c, Cl::Water => if no_water { continue } else { 16.0 } };
                    if di != 0 && dj != 0 {   // no cutting corners through blocked cells
                        if cl((cj * NC + a) as usize) == Cl::Block || cl((b * NC + ci) as usize) == Cl::Block { continue; }
                    }
                    next.push((kl, step * if di != 0 && dj != 0 { 1.414 } else { 1.0 }));
                }
                if siege == 0 { if let Some(v) = at_cell.get(&i) { for &n in v { next.push((ncell + n as usize, 0.4)); } } }   // (the village's footpaths are for people: an engine keeps to open ground)
            } else {
                let n = i - ncell;
                for &(to, l, road) in &net.adj[n] { next.push((ncell + to as usize, l / CELL * if road { crate::pathnet::ROAD_COST } else { 1.0 })); }
                if let Some(l) = node_cell[n] { next.push((l, 0.4)); }
            }
            for &(k, c) in &next { let ng = gc[i] + c; if ng < gc[k] { gc[k] = ng; from[k] = i as u32; heap.push(Node { f: ng + hfn(k), i: k as u32 }); } }
        }
        if !found { return Err(-2); }
        let mut chain = vec![gl]; let mut c = gl; while from[c] != u32::MAX { c = from[c] as usize; chain.push(c); } chain.reverse();
        let mode_of = |gi: usize| -> u8 { match cl(gi) { Cl::Water => 2, Cl::Free(c) if c >= 8.0 => 1, _ => 0 } };
        // the lines the route runs along: grid cells (merged where a straight line stays on them) and the village network's own nodes (kept exactly)
        struct It { x: f32, y: f32, mode: u8, fixed: bool, cell: usize }
        let items: Vec<It> = chain.iter().map(|&l| if l < ncell { let gi = global(l); let p = cell_xy(gi); It { x: p.0, y: p.1, mode: mode_of(gi), fixed: false, cell: gi } } else { let p = net.nodes[l - ncell]; It { x: p.0, y: p.1, mode: 0, fixed: true, cell: usize::MAX } }).collect();
        let mut wps: Vec<Wp> = vec![Wp { x: sx, y: sy, mode: 0 }];
        let mut start = 0usize;
        while start < items.len() {
            if items[start].fixed { wps.push(Wp { x: items[start].x, y: items[start].y, mode: 0 }); start += 1; continue; }
            let m = items[start].mode; let mut end = start; while end + 1 < items.len() && !items[end + 1].fixed && items[end + 1].mode == m { end += 1; }
            let run: Vec<(f32, f32)> = items[start..=end].iter().map(|it| (it.x, it.y)).collect();
            let los = |a: (f32, f32), b: (f32, f32), between: &[(f32, f32)]| -> bool {
                let l = ((b.0 - a.0).powi(2) + (b.1 - a.1).powi(2)).sqrt(); let st = (l / (CELL * 0.5)).ceil().max(1.0) as i32;
                if !(0..=st).all(|q| { let t = q as f32 / st as f32; ns.idx(a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t).map_or(false, |k| mode_of(k) == m && cl(k) != Cl::Block) }) { return false; }
                // and it stays on the lines it replaces (never a long cut across open ground)
                let (dx, dy) = (b.0 - a.0, b.1 - a.1); let l2 = (dx * dx + dy * dy).max(1e-6);
                between.iter().all(|p| { let t = (((p.0 - a.0) * dx + (p.1 - a.1) * dy) / l2).clamp(0.0, 1.0); (p.0 - (a.0 + dx * t)).hypot(p.1 - (a.1 + dy * t)) <= 1.3 })
            };
            let mut a = 0usize; let mut pts: Vec<(f32, f32)> = vec![];
            while a < run.len() - 1 { let mut b = run.len() - 1; while b > a + 1 && !los(run[a], run[b], &run[a + 1..b]) { b -= 1; } pts.push(run[b]); a = b; }
            if run.len() == 1 { pts.push(run[0]); }
            for p in pts { wps.push(Wp { x: p.0, y: p.1, mode: m }); }
            start = end + 1;
        }
        // the very last point is the exact target when it is reachable on foot
        if let Some(l) = wps.last_mut() { if l.mode == 0 && ns.idx(tx, ty).map_or(false, |k| k == global(gl)) { l.x = tx; l.y = ty; } }
        let _ = items.iter().map(|i| i.cell).count();
        // checks: water too wide, felling without workers
        let mut prev = (sx, sy);
        for w in &wps {
            let len = ((w.x - prev.0).powi(2) + (w.y - prev.1).powi(2)).sqrt();
            if w.mode == 2 && len > MAX_FERRY { return Err(-5); }
            if w.mode == 1 && workers == 0 { return Err(-3); }
            prev = (w.x, w.y);
        }
        Ok(wps)
    }

    /// Wherever a route passes through an open gate or over a lowered drawbridge it is made to run along the middle of the doorway, straight in and straight out (the open-ground
    /// search only knows grid cells, which would have it hug one side).
    fn through_doors(&self, wps: Vec<Wp>, own: bool) -> Vec<Wp> {
        let (_, doors) = self.wall_lines();
        // (centre, direction one walks through it, half-width across, nodes along it)
        let mut lanes: Vec<(f32, f32, f32, f32, f32, &'static [f32])> = vec![];
        const GATE_T: &[f32] = &[-7.5, -3.8, 0.0, 3.8, 7.5];
        const DECK_T: &[f32] = &[-9.0, -6.0, -3.0, 0.0, 3.0, 6.0, 9.0];
        for d in &doors { if !self.gate_shut(&self.buildings[d.b]) { lanes.push((d.x, d.y, -d.uy, d.ux, crate::wallnet::GATE_HALF + 1.5, GATE_T)); } }
        for b in &self.buildings { if b.kind == DRAWBRIDGE && (!self.drawn_up(b) || (own && self.db_lendable(b))) { let a = b.rot as f32 * std::f32::consts::FRAC_PI_4; lanes.push((b.x, b.y, a.sin(), a.cos(), 3.0, DECK_T)); } }
        if lanes.is_empty() { return wps; }
        let mut out = wps;
        for &(cx, cy, nx, ny, half, ts) in &lanes {
            let mut i = 1;
            while i < out.len() {
                let (a, b) = (out[i - 1], out[i]);
                if b.mode != 0 { i += 1; continue; }
                let (ta, tb) = ((a.x - cx) * nx + (a.y - cy) * ny, (b.x - cx) * nx + (b.y - cy) * ny);
                if ta * tb > 0.0 || (ta - tb).abs() < 1e-3 { i += 1; continue; }
                let f = ta / (ta - tb); let (px, py) = (a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f);
                if ((px - cx) * -ny + (py - cy) * nx).abs() > half { i += 1; continue; }   // not through this doorway
                let dir = if tb > ta { 1.0f32 } else { -1.0 }; let far = if half > 3.5 { 3.8f32 } else { 6.0 };   // (a route that would step off the side halfway along is carried on to the far end of the doorway first)
                let mut mids: Vec<f32> = ts.iter().copied().filter(|&t| dir * t > dir * ta + 1.5 && dir * t <= (dir * tb - 1.5).max(far)).collect();
                if dir < 0.0 { mids.reverse(); }
                let ub = -(b.x - cx) * ny + (b.y - cy) * nx;
                if dir * tb < far && i + 1 < out.len() && ub.abs() <= half + 1.0 { out.remove(i); }   // (the waypoint where it stepped off the side is no longer wanted)
                let ins: Vec<Wp> = mids.iter().map(|&t| Wp { x: cx + nx * t, y: cy + ny * t, mode: 0 }).collect();
                let n = ins.len();
                for (k, w) in ins.into_iter().enumerate() { out.insert(i + k, w); }
                i += n + 1;
            }
        }
        out
    }

    fn march_speed(units: &[u32; NK]) -> f32 {
        let mut m = f32::MAX; for k in 0..NK { if units[k] > 0 { m = m.min(UNITS[k].speed); } }
        if m == f32::MAX { 3.0 } else { m * 1.1 }
    }

    /// Who marches as the army proper and who apart from it. With foot soldiers along, knights and siege engines each make a group of their own; an army of riders or engines alone is one body.
    pub(crate) fn split_groups(units: &[u32; NK]) -> ([u32; NK], Vec<[u32; NK]>) {
        if units[0] + units[1] + units[2] == 0 || units[3] + units[4] + units[5] == 0 { return (*units, vec![]); }
        let mut head = *units; head[3] = 0; head[4] = 0; head[5] = 0;
        let mut g = vec![];
        if units[3] > 0 { g.push([0, 0, 0, units[3], 0, 0]); }
        if units[4] + units[5] > 0 { g.push([0, 0, 0, 0, units[4], units[5]]); }
        (head, g)
    }

    fn det_index(&self, id: u32) -> Option<usize> { self.dets.iter().position(|d| d.id == id) }

    // ---------------------------------------------------------------- commands
    /// Take soldiers out of the barracks into a new field army. Returns its id, or 0 if impossible.
    pub(crate) fn det_form_inner(&mut self, units: [u32; NK]) -> u32 {
        if units.iter().all(|&u| u == 0) || (0..NK).any(|k| units[k] > self.army[k]) { return 0; }
        if !self.battle_release_army(units) { return 0; }   // (in a fight the soldiers must be ones still standing in it)
        for k in 0..NK { self.army[k] -= units[k]; }
        self.next_det += 1;
        let (hx, hy) = (self.buildings[0].x, self.buildings[0].y);
        let (bx, by) = self.buildings.iter().find(|b| b.kind == BARRACKS).map_or((hx + 10.0, hy + 10.0), |b| (b.x, b.y + 8.0));
        let ns = nav_static(self.seed); let ov = self.ov();
        let (x, y) = self.near_free(&ns, &ov, bx, by, if units[4] > 0 { 1 } else { 0 }).map_or((bx, by), cell_xy);
        self.dets.push(Det { id: self.next_det, units, x, y, path: vec![], wi: 0, state: S_IDLE, phase: 0, work: 0.0, work_total: 0.0, sx: x, sy: y, atk: None, home: false, heading: 0.0, speed: 0.0, since_fell: 0.0, defend: false, grp: vec![] });
        self.next_det
    }

    /// Order a field army to march. `attack` = the position of the village it is going to attack.
    pub(crate) fn det_march_inner(&mut self, id: u32, tx: f32, ty: f32, attack: Option<(f32, f32)>, home: bool) -> i32 {
        if self.det_index(id).is_none() { return -1; }
        self.det_disengage(id);   // an army in the fight breaks off to go where it is told
        let Some(i) = self.det_index(id) else { return -1 };
        let (u, x, y) = (self.dets[i].units, self.dets[i].x, self.dets[i].y);
        let (hu, gus) = Self::split_groups(&u);
        let route_units = if u[4] > 0 { u } else { hu };   // (with engines along, the army's route is one they can follow: felling where the forest needs it)
        match self.find_path(&route_units, x, y, tx, ty) {
            Ok(p) => {
                let old = std::mem::take(&mut self.dets[i].grp);
                let mut grps: Vec<Grp> = vec![];
                for gu in gus {
                    let (gx, gy) = old.iter().find(|g| (g.units[3] > 0) == (gu[3] > 0)).map_or((x, y), |g| (g.x, g.y));   // (a group left standing somewhere starts from there)
                    let (path, tied) = match self.find_path(&gu, gx, gy, tx, ty) {
                        Ok(q) if q.iter().all(|w| w.mode == 0) => (q, false),
                        _ => { let mut q = p.clone(); if let Some(f) = q.first_mut() { f.x = gx; f.y = gy; } (q, true) }
                    };
                    grps.push(Grp { units: gu, x: gx, y: gy, path, wi: 1, heading: 0.0, speed: 0.0, tied });
                }
                let d = &mut self.dets[i]; d.grp = grps; d.path = p; d.wi = 1; d.state = if home { S_HOME } else { S_MARCH }; d.phase = 0; d.atk = attack; d.home = home; d.defend = false; d.sx = x; d.sy = y; 0 }
            Err(e) => e,
        }
    }

    pub(crate) fn det_split_inner(&mut self, id: u32, take: [u32; NK]) -> u32 {
        let Some(i) = self.det_index(id) else { return 0 };
        let d = self.dets[i].clone();
        if d.state == S_FIGHT { return 0; }
        if take.iter().all(|&u| u == 0) || (0..NK).any(|k| take[k] > d.units[k]) || (0..NK).all(|k| take[k] == d.units[k]) { return 0; }
        for k in 0..NK { self.dets[i].units[k] -= take[k]; }
        self.next_det += 1;
        self.dets[i].grp.clear();
        let mut n = d; n.id = self.next_det; n.units = take; n.grp.clear(); self.dets.push(n);
        self.next_det
    }

    pub(crate) fn det_merge_inner(&mut self, a: u32, b: u32) -> bool {
        let (Some(i), Some(j)) = (self.det_index(a), self.det_index(b)) else { return false };
        if i == j || self.dets[i].state == S_FIGHT || self.dets[j].state == S_FIGHT || ((self.dets[i].x - self.dets[j].x).powi(2) + (self.dets[i].y - self.dets[j].y).powi(2)).sqrt() > 10.0 { return false; }
        let u = self.dets[j].units; for k in 0..NK { self.dets[i].units[k] += u[k]; }
        self.dets.remove(j); let i = self.det_index(a).unwrap(); self.dets[i].state = S_IDLE; self.dets[i].path.clear(); self.dets[i].grp.clear(); true
    }

    /// Hand an arrived army over to the attack on another village. Returns its soldiers.
    pub(crate) fn det_send_inner(&mut self, id: u32) -> Option<[u32; NK]> {
        let i = self.det_index(id)?; if self.dets[i].state == S_FIGHT { return None; } let u = self.dets[i].units; self.dets.remove(i);
        for k in 0..NK { self.away[k] += u[k]; } Some(u)
    }

    // ---------------------------------------------------------------- simulation (one tick = one game second)
    pub(crate) fn march_step(&mut self) {
        if self.dets.is_empty() { return; }   // no field armies: no need to build the navigation grid
        let ns = nav_static(self.seed);
        let mut i = 0;
        while i < self.dets.len() {
            let mut d = self.dets[i].clone();
            let mut remove = false;
            let travelling = matches!(d.state, S_MARCH | S_FELL | S_BRIDGE | S_FERRY | S_WAIT | S_HOME);
            if travelling && d.wi < d.path.len() {
                let wp = d.path[d.wi];
                let hu = Self::head_units(&d);
                let base = Self::march_speed(&hu);
                let workers = (hu[0] + hu[2]) as f32;
                let dens = ns.dens_at(d.x, d.y) as f32;
                match wp.mode {
                    0 => {
                        d.state = if d.home { S_HOME } else { S_MARCH };
                        // soldiers push through woods by cutting the trees that stand in their way: every tree within reach of the ground they are about to cover (and not already cut) is felled,
                        // which slows them a little, and the cleared strip stays open for the next army
                        let on_road = self.on_road(d.x, d.y);
                        let mut cut = false;
                        if !on_road && dens >= 1.0 && self.felled.len() < 4000 {
                            let base_speed = base / (1.0 + 0.06 * dens);
                            let (dx, dy) = (wp.x - d.x, wp.y - d.y); let dl = dx.hypot(dy).max(1e-3); let reach = base_speed.min(dl);
                            for f in [0.0f32, 0.5, 1.0] {
                                let (px, py) = (d.x + dx / dl * reach * f, d.y + dy / dl * reach * f);
                                let ts = terrain::trees(self.seed, px - 2.6, py - 2.6, px + 2.6, py + 2.6);
                                for k in (0..ts.len()).step_by(5) {
                                    let (tx, ty) = (ts[k], ts[k + 1]);
                                    if (tx - px).hypot(ty - py) <= 2.4 && !self.felled.iter().any(|q| (q[0] - tx).hypot(q[1] - ty) < q[2]) { self.felled.push([tx, ty, 1.6]); cut = true; }
                                }
                            }
                            if cut { self.map_ver += 1; }
                        }
                        d.speed = base / (1.0 + 0.06 * dens) * if on_road { crate::pathnet::ROAD_SPEED } else { 1.0 } * if cut { 0.8 } else { 1.0 };
                        let _ = wp; Self::advance_path(&mut d);
                    }
                    1 => {
                        d.state = S_FELL; d.speed = (0.35 * workers.max(1.0).powf(0.7)).clamp(0.45, base);
                        let (ox, oy) = (d.x, d.y);
                        Self::advance(&mut d, wp);
                        d.since_fell += ((d.x - ox).powi(2) + (d.y - oy).powi(2)).sqrt();
                        if d.since_fell >= 2.5 { d.since_fell = 0.0; if self.felled.len() < 600 { self.felled.push([d.x, d.y, 3.4]); self.map_ver += 1; } }
                    }
                    _ => {
                        if d.phase == 0 {
                            d.sx = d.x; d.sy = d.y;
                            let len = ((wp.x - d.x).powi(2) + (wp.y - d.y).powi(2)).sqrt();
                            let total: u32 = d.units.iter().sum();
                            let (res, cost) = if len <= BRIDGE_MAX { (PL as usize, (len * 1.5).ceil() as i32) } else { (W as usize, 10 + total as i32 / 3) };
                            if self.stock[res] < cost { if d.state != S_WAIT { d.state = S_WAIT; self.push_event(EV_NEEDMAT, res as i32, cost); } }
                            else {
                                self.stock[res] -= cost; d.phase = 1;
                                d.work = 0.0; d.work_total = if len <= BRIDGE_MAX { len * 2.5 / workers.max(1.0).powf(0.8) } else { 6.0 + len / 2.4 };
                                d.state = if len <= BRIDGE_MAX { S_BRIDGE } else { S_FERRY };
                            }
                        }
                        if d.phase == 1 {
                            d.work += 1.0;
                            if d.state == S_FERRY { let t = (d.work / d.work_total).min(1.0); d.x = d.sx + (wp.x - d.sx) * t; d.y = d.sy + (wp.y - d.sy) * t; d.heading = (wp.y - d.sy).atan2(wp.x - d.sx); }
                            if d.work >= d.work_total {
                                if d.state == S_BRIDGE && self.bridges.len() < 60 { self.bridges.push([d.sx, d.sy, wp.x, wp.y]); self.map_ver += 1; d.phase = 2; }
                                else { d.x = wp.x; d.y = wp.y; d.phase = 0; d.wi += 1; d.state = if d.home { S_HOME } else { S_MARCH }; }
                            }
                        } else if d.phase == 2 {
                            d.speed = base * 0.8; Self::advance(&mut d, wp);
                            if d.wi > 0 && d.path.get(d.wi).map_or(true, |w| (w.x - wp.x).abs() > 0.01 || (w.y - wp.y).abs() > 0.01) { d.phase = 0; d.state = if d.home { S_HOME } else { S_MARCH }; }
                        }
                    }
                }
                if d.wi >= d.path.len() { d.path.clear(); d.phase = 0; d.speed = 0.0; d.state = if d.home { S_HOME } else { S_MARCH }; }   // (it waits here for riders and engines still on their way)
            }
            if travelling && !d.grp.is_empty() {   // riders and engines go their own way, each at its own pace
                let head_wi = if d.path.is_empty() { usize::MAX } else { d.wi };
                for g in d.grp.iter_mut() { self.step_group(&ns, g, head_wi); }
            }
            if travelling && d.wi >= d.path.len() && d.grp.iter().all(|g| g.wi >= g.path.len()) {   // everybody is there
                d.path.clear(); d.phase = 0; d.grp.clear();
                if d.home { for k in 0..NK { self.army[k] += d.units[k]; } remove = true; }
                else if d.atk.is_some() { d.state = S_ARRIVED; } else { d.state = S_IDLE; }
            }
            if !remove { let (rx, ry) = (d.x, d.y); let scouts = d.units.iter().sum::<u32>() <= 4; self.reveal(rx, ry, if scouts { 120.0 } else { 70.0 }); }   // a small party travels light and sees further   // an army on the march lifts the fog round it
            if remove { self.dets.remove(i); } else { self.dets[i] = d; i += 1; }
        }
    }

    /// What is left of the army once its riders and engines are counted out: the foot soldiers, whose pace is the army's.
    fn head_units(d: &Det) -> [u32; NK] { let mut u = d.units; for g in &d.grp { for k in 0..NK { u[k] = u[k].saturating_sub(g.units[k]); } } u }

    /// One tick of a group's march: at its own speed (slowed by woods, quickened on a road), along its own route. A tied group does not pass a place that needs felling or a crossing until the
    /// army (whose waypoint index is `head_wi`) has got through it.
    fn step_group(&self, ns: &NavStatic, g: &mut Grp, head_wi: usize) {
        if g.wi >= g.path.len() { g.speed = 0.0; return; }
        let dens = ns.dens_at(g.x, g.y) as f32;
        g.speed = Self::march_speed(&g.units) / (1.0 + 0.06 * dens) * if self.on_road(g.x, g.y) { crate::pathnet::ROAD_SPEED } else { 1.0 };
        let mut left = g.speed; let mut moved = false;
        while left > 1e-4 && g.wi < g.path.len() {
            let wp = g.path[g.wi];
            if g.tied && wp.mode != 0 && head_wi != usize::MAX && head_wi <= g.wi { break; }   // the soldiers have not made the way yet
            let (dx, dy) = (wp.x - g.x, wp.y - g.y); let dist = (dx * dx + dy * dy).sqrt();
            if dist > 0.01 { g.heading = dy.atan2(dx); }
            moved = true;
            if dist <= left { g.x = wp.x; g.y = wp.y; g.wi += 1; left -= dist; } else { g.x += dx / dist * left; g.y += dy / dist * left; left = 0.0; }
        }
        if !moved { g.speed = 0.0; }
    }

    /// Walk along the route for one tick's worth of distance, carrying on round the corners (what is left of the step after reaching a waypoint is walked towards the next), so the pace is the
    /// same whatever the route does. Only over ordinary ground: felling, bridging and ferrying have their own pace.
    fn advance_path(d: &mut Det) {
        let mut left = d.speed;
        while left > 1e-4 && d.wi < d.path.len() && d.path[d.wi].mode == 0 {
            let wp = d.path[d.wi]; let (dx, dy) = (wp.x - d.x, wp.y - d.y); let dist = (dx * dx + dy * dy).sqrt();
            if dist > 0.01 { d.heading = dy.atan2(dx); }
            if dist <= left { d.x = wp.x; d.y = wp.y; d.wi += 1; left -= dist; } else { d.x += dx / dist * left; d.y += dy / dist * left; left = 0.0; }
        }
    }

    /// Move up to `speed` units towards the waypoint; step on to the next when reached.
    fn advance(d: &mut Det, wp: Wp) {
        let (dx, dy) = (wp.x - d.x, wp.y - d.y); let dist = (dx * dx + dy * dy).sqrt();
        if dist <= d.speed { d.x = wp.x; d.y = wp.y; d.wi += 1; } else { d.x += dx / dist * d.speed; d.y += dy / dist * d.speed; }
        if dist > 0.01 { d.heading = dy.atan2(dx); }
    }

    /// A planned route without giving any order: [ok, seconds, planks, wood, count, x, y, mode, ...].
    pub(crate) fn plan(&self, units: &[u32; NK], sx: f32, sy: f32, tx: f32, ty: f32) -> Vec<f32> {
        let (head, gus) = Self::split_groups(units); let units = if units[4] > 0 { units } else { &head };   // (the army's route, which engines need to be able to follow; riders go their own way)
        match self.find_path(units, sx, sy, tx, ty) {
            Err(e) => vec![e as f32, 0.0, 0.0, 0.0, 0.0],
            Ok(p) => {
                let base = Self::march_speed(&head); let workers = (units[0] + units[2]) as f32; let total: u32 = units.iter().sum();
                let (mut t, mut planks, mut wood, mut prev) = (0.0f32, 0i32, 0i32, (sx, sy));
                for w in &p {
                    let len = ((w.x - prev.0).powi(2) + (w.y - prev.1).powi(2)).sqrt();
                    match w.mode {
                        0 => t += len / base, 1 => t += len / (0.35 * workers.max(1.0).powf(0.7)).clamp(0.45, base),
                        _ => if len <= BRIDGE_MAX { planks += (len * 1.5).ceil() as i32; t += len * 2.5 / workers.max(1.0).powf(0.8) + len / (base * 0.8); } else { wood += 10 + total as i32 / 3; t += 6.0 + len / 2.4; },
                    }
                    prev = (w.x, w.y);
                }
                for gu in &gus { let gt = (tx - sx).hypot(ty - sy) * 1.3 / Self::march_speed(gu); if gt > t { t = gt; } }   // (a slow engine train sets the time of arrival)
                let mut v = vec![1.0, t, planks as f32, wood as f32, p.len() as f32];
                for w in &p { v.extend_from_slice(&[w.x, w.y, w.mode as f32]); }
                v
            }
        }
    }

    /// A walkable route between two buildings for the village's paths, found like an army route (same blocking rules) but only over a small window round them.
    /// Buildings and walls block, gates are open, lowered drawbridges carry you over water, open water stops you. None if there is no way.
    #[cfg(test)]   // the old small route finder: kept as the yardstick the road tests compare the network against
    pub(crate) fn route_local(&self, ia: usize, ib: usize) -> Option<Vec<(f32, f32)>> {
        let (a, b) = (&self.buildings[ia], &self.buildings[ib]);
        let m = 16.0;
        let (x0, y0) = (a.x.min(b.x) - m, a.y.min(b.y) - m);
        let (wx, wy) = (a.x.max(b.x) + m - x0, a.y.max(b.y) + m - y0);
        // a fine grid (so a road bends round a house, not in jumps of two) wherever the window is small enough, a coarse one for the long links
        #[allow(non_snake_case)]
        let RC: f32 = if (wx * wy) <= 24000.0 { 1.0 } else { 2.0 };
        let (nx, ny) = ((wx / RC).ceil() as i32 + 1, (wy / RC).ceil() as i32 + 1);
        if nx * ny > 24000 { return None; }
        let cxy = |i: i32, j: i32| (x0 + (i as f32 + 0.5) * RC, y0 + (j as f32 + 0.5) * RC);
        let n = (nx * ny) as usize;
        let mut h = vec![0.0f32; n];
        for j in 0..ny { for i in 0..nx { let (x, y) = cxy(i, j); h[(j * nx + i) as usize] = self.height_ground(x, y); } }
        let mut blocked = vec![false; n]; let mut deck = vec![false; n];
        let mark = |g: &mut [bool], x: f32, y: f32, r: f32| {
            let (i0, i1) = ((((x - r - x0) / RC).floor() as i32).max(0), (((x + r - x0) / RC).ceil() as i32).min(nx - 1));
            let (j0, j1) = ((((y - r - y0) / RC).floor() as i32).max(0), (((y + r - y0) / RC).ceil() as i32).min(ny - 1));
            for j in j0..=j1 { for i in i0..=i1 { let (cx, cy) = cxy(i, j); if (cx - x).powi(2) + (cy - y).powi(2) <= r * r { g[(j * nx + i) as usize] = true; } } }
        };
        for (k, q) in self.buildings.iter().enumerate() {
            if k == ia || k == ib { continue; }
            match q.kind {
                GATE | MOAT | RIVER | RAISE | LOWER | ROAD => {}
                BRIDGE => { let (ux, uy, l) = Self::bridge_dir(q); let st = (l / 0.8) as i32; for t in 0..=st { let t = t as f32 * 0.8 - l / 2.0; mark(&mut deck, q.x + ux * t, q.y + uy * t, 1.7); } }
                DRAWBRIDGE => {
                    if self.drawn_up(q) { continue; }
                    let an = q.rot as f32 * std::f32::consts::FRAC_PI_4; let (sx, sy) = (an.sin(), an.cos());
                    for t in -9..=9 { let t = t as f32 * 0.8; mark(&mut deck, q.x + sx * t, q.y + sy * t, 1.7); }
                }
                _ => { let r = crate::footprint(q.kind, q.tier) + if q.kind == WALL || q.kind == FENCE { 1.0 } else { 0.7 }; mark(&mut blocked, q.x, q.y, r); }
            }
        }
        let free = |i: i32, j: i32| -> Option<f32> {
            if i < 0 || j < 0 || i >= nx || j >= ny { return None; }
            let k = (j * nx + i) as usize;
            if blocked[k] && !deck[k] { return None; }
            if h[k] < 0.2 && !deck[k] { return None; }
            // on the fine grid a road needs a little room: no squeezing through a one-cell gap between water cells (a road is wider than that)
            if RC < 1.5 && !deck[k] && [(1, 0), (-1, 0), (0, 1), (0, -1)].iter().any(|&(di, dj)| { let (p, q) = (i + di, j + dj); p >= 0 && q >= 0 && p < nx && q < ny && h[(q * nx + p) as usize] < 0.2 && !deck[(q * nx + p) as usize] }) { return None; }
            let mut sl = 0.0f32;
            if !deck[k] { for (di, dj) in [(1, 0), (-1, 0), (0, 1), (0, -1)] { let (p, q) = (i + di, j + dj); if p >= 0 && q >= 0 && p < nx && q < ny { sl = sl.max((h[(q * nx + p) as usize] - h[k]).abs() / RC); } } }
            if sl > 1.6 { return None; }
            Some(if deck[k] { 0.8 } else { 1.0 + sl * 1.2 })
        };
        let near = |x: f32, y: f32| -> Option<(i32, i32)> {
            let (ci, cj) = (((x - x0) / RC).floor() as i32, ((y - y0) / RC).floor() as i32);
            for r in 0..(14.0 / RC) as i32 { for dj in -r..=r { for di in -r..=r { if di.abs().max(dj.abs()) != r { continue; } if free(ci + di, cj + dj).is_some() { return Some((ci + di, cj + dj)); } } } }
            None
        };
        let (s, g) = (near(a.x, a.y)?, near(b.x, b.y)?);
        let (si, gi) = ((s.1 * nx + s.0) as usize, (g.1 * nx + g.0) as usize);
        let mut gc = vec![f32::MAX; n]; let mut from = vec![u32::MAX; n];
        let mut heap = BinaryHeap::new();
        let hf = |i: usize| { let (ci, cj) = (i as i32 % nx, i as i32 / nx); let (dx, dy) = ((ci - g.0).abs() as f32, (cj - g.1).abs() as f32); dx.max(dy) + 0.414 * dx.min(dy) };
        gc[si] = 0.0; heap.push(Node { f: hf(si), i: si as u32 });
        let mut found = false;
        while let Some(Node { i, .. }) = heap.pop() {
            let i = i as usize; if i == gi { found = true; break; }
            let (ci, cj) = (i as i32 % nx, i as i32 / nx);
            for (di, dj) in [(1i32, 0i32), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)] {
                let (p, q) = (ci + di, cj + dj);
                let Some(step) = free(p, q) else { continue };
                if di != 0 && dj != 0 && (free(ci + di, cj).is_none() || free(ci, cj + dj).is_none()) { continue; }
                let k = (q * nx + p) as usize; let ng = gc[i] + step * if di != 0 && dj != 0 { 1.414 } else { 1.0 };
                if ng < gc[k] { gc[k] = ng; from[k] = i as u32; heap.push(Node { f: ng + hf(k), i: k as u32 }); }
            }
        }
        if !found { return None; }
        let mut cells = vec![gi]; let mut c = gi; while from[c] != u32::MAX { c = from[c] as usize; cells.push(c); } cells.reverse();
        let pts: Vec<(f32, f32)> = cells.iter().map(|&i| cxy(i as i32 % nx, i as i32 / nx)).collect();
        // simplify by line of sight, but never cut across a different kind of ground (deck vs land)
        let kind_at = |x: f32, y: f32| -> Option<bool> { let (i, j) = (((x - x0) / RC).floor() as i32, ((y - y0) / RC).floor() as i32); if free(i, j).is_none() { None } else { Some(deck[(j * nx + i) as usize]) } };
        let los = |p: (f32, f32), q: (f32, f32), dk: bool| -> bool {
            let l = (q.0 - p.0).hypot(q.1 - p.1); let st = (l / (RC * 0.5)).ceil().max(1.0) as i32;
            (0..=st).all(|t| { let f = t as f32 / st as f32; kind_at(p.0 + (q.0 - p.0) * f, p.1 + (q.1 - p.1) * f) == Some(dk) })
        };
        let dk = |p: (f32, f32)| kind_at(p.0, p.1).unwrap_or(false);
        let mut out = vec![(a.x, a.y)]; let mut i = 0usize;
        while i < pts.len() - 1 {
            let d0 = dk(pts[i]); let mut j = pts.len() - 1;
            while j > i + 1 && !(dk(pts[j]) == d0 && los(pts[i], pts[j], d0)) { j -= 1; }
            out.push(pts[j]); i = j;
        }
        if let Some(l) = out.last_mut() { *l = (b.x, b.y); }
        Some(out)
    }
}

#[cfg(test)]
mod nav_slices {
    use super::*;

    /// Building the grid a few rows at a time (so the page can breathe) must give exactly the grid built in one go, however it is cut.
    #[test]
    fn a_sliced_build_equals_the_blocking_build() {
        let seed = 4242u64;
        let mut calls = 0;
        while nav_build_step(seed, 211) < 1.0 { calls += 1; assert!(calls < 100); }
        assert!(calls >= 8, "it really was done in pieces ({calls})");
        let a = nav_static(seed);
        NAV.with(|c| *c.borrow_mut() = None);
        let b = nav_static(seed);
        assert!(!Rc::ptr_eq(&a, &b));
        assert!(a.h == b.h && a.slope == b.slope && a.dens == b.dens && a.tun == b.tun);
        // a different cut gives the same again
        NAV.with(|c| *c.borrow_mut() = None);
        while nav_build_step(seed, 977) < 1.0 {}
        let c = nav_static(seed);
        assert!(c.h == b.h && c.dens == b.dens);
    }

    /// The ground and the forest the page fetches a few rows at a time are exactly what the whole-map calls give.
    #[test]
    fn rows_of_the_ground_and_the_forest_join_up_exactly() {
        let seed = 99u64;
        let whole = terrain::grid(seed, -200.0, -200.0, 161, 161, 2.5);
        let mut parts = vec![]; let mut j = 0;
        while j < 161 { let k = (j + 7).min(161); parts.extend(terrain::grid_rows(seed, -200.0, -200.0, 161, 2.5, j, k)); j = k; }
        assert!(whole == parts);
        let all = terrain::trees(seed, -150.0, -150.0, 150.0, 150.0);
        let c = terrain::TREE_CELL; let (cy0, cy1) = ((-150.0 / c).floor() as i32, (150.0 / c).ceil() as i32);
        let (cx0, cx1) = ((-150.0 / c).floor() as i32, (150.0 / c).ceil() as i32);
        let mut cut = vec![]; let mut y = cy0;
        while y < cy1 { let k = (y + 5).min(cy1); cut.extend(terrain::trees_cells(seed, cx0, cx1, y, k)); y = k; }
        assert!(!all.is_empty() && all == cut);
    }
}
