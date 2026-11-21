//! Planted trees: the player's own forests. A tree is planted by hand (the planting brush) or by a forester over time; it grows for `GROW_TICKS` and then counts as forest
//! for woodcutters and hunters (see `World::forest_here`). A woodcutter fells a grown planted tree before it touches the natural forest, so a forester keeps a woodcutter supplied.
use super::*;

/// A planted tree: where it stands and the tick it was planted.
pub type Planted = (f32, f32, u64);

/// A planted tree is full grown after a day and a half.
pub const GROW_TICKS: u64 = DAY * 3 / 2;
/// The most trees the village can have planted at once.
pub const MAX_PLANTED: usize = 1500;
/// Trees stand at least this far apart.
const SPACING: f32 = 1.7;
/// A brush stroke and a forester's planting zone: the most it covers.
pub const BRUSH_MAX: i32 = 8;
pub const ZONE_RADIUS: f32 = 10.0;
/// How far from the forester its zone may be put (in whole units each way).
pub const ZONE_REACH: i32 = 60;
/// Trees a forester plants each cycle.
pub const FORESTER_BATCH: u32 = 2;

impl World {
    /// Can a tree be planted here: in the village's land, on dry ground clear of buildings, deposits and other trees.
    pub(crate) fn can_plant(&self, x: f32, y: f32) -> bool {
        if !x.is_finite() || !y.is_finite() || self.planted.len() >= MAX_PLANTED || !self.in_territory(x, y) { return false; }
        let h = self.height_at(x, y);
        if h < 0.6 || self.natural_water_covers(x, y, h, 0.3) { return false; }
        if self.buildings.iter().any(|b| !matches!(b.kind, ROAD | BRIDGE | WALL | FENCE) && (b.x - x).hypot(b.y - y) < footprint(b.kind, b.tier) + 0.6) { return false; }
        if self.deposits.iter().any(|d| d.max > 0 && (d.x - x).hypot(d.y - y) < 2.6) { return false; }
        !self.planted.iter().any(|p| (p.0 - x).hypot(p.1 - y) < SPACING)
    }

    /// Plant at most one tree at a random spot of the disc: a few tries. True when one was planted.
    pub(crate) fn plant_random(&mut self, cx: f32, cy: f32, r: f32) -> bool {
        for _ in 0..8 {
            let a = self.rng.range(628) as f32 * 0.01; let d = (self.rng.range(1000) as f32 * 0.001).sqrt() * r;
            let (x, y) = (cx + a.cos() * d, cy + a.sin() * d);
            if self.can_plant(x, y) { self.planted.push((x, y, self.tick)); self.map_ver += 1; return true; }
        }
        false
    }

    /// Grown trees within `r` of a point.
    pub(crate) fn grown_near(&self, x: f32, y: f32, r: f32) -> usize {
        self.planted.iter().filter(|p| self.tick.saturating_sub(p.2) >= GROW_TICKS && (p.0 - x).hypot(p.1 - y) < r).count()
    }

    /// Forest density the grown planted trees make round a point (same scale as the land's own forest: 0.12 is enough to work).
    pub(crate) fn planted_density(&self, x: f32, y: f32, r: f32) -> f32 {
        if self.planted.is_empty() { return 0.0; }
        (self.grown_near(x, y, r) as f32 * 8.0 / (r * r).max(1.0)).min(1.0)
    }

    /// A woodcutter fells a grown planted tree near its hut (the nearest). True when it did.
    pub(crate) fn fell_planted(&mut self, bx: f32, by: f32) -> bool {
        let tick = self.tick;
        let best = self.planted.iter().enumerate().filter(|(_, p)| tick.saturating_sub(p.2) >= GROW_TICKS)
            .map(|(i, p)| (i, (p.0 - bx).hypot(p.1 - by))).filter(|&(_, d)| d < 16.0).min_by(|a, b| a.1.total_cmp(&b.1));
        let Some((i, _)) = best else { return false };
        self.planted.remove(i); self.map_ver += 1; true
    }

    /// Where a forester plants: its zone's middle (the building itself unless the player moved it).
    pub(crate) fn forester_zone(&self, b: &Building) -> (f32, f32) {
        if b.aux < 0 { return (b.x, b.y); }
        (b.x + ((b.aux >> 8) - 128) as f32, b.y + ((b.aux & 255) - 128) as f32)
    }

    /// One forester cycle: plant its batch in its zone. False when nothing could be planted (no room).
    pub(crate) fn forester_works(&mut self, i: usize) -> bool {
        let (cx, cy) = self.forester_zone(&self.buildings[i]);
        let mut any = false;
        for _ in 0..FORESTER_BATCH { any |= self.plant_random(cx, cy, ZONE_RADIUS); }
        any
    }
}

#[wasm_bindgen]
impl World {
    /// The planting brush: plant trees on a scatter over the disc of radius `r` (1..=8) at (`dx`, `dy`) from the town hall, each for one wood. Returns how many were planted
    /// (fewer when there is no room or wood), -1 for bad arguments.
    pub fn plant_trees(&mut self, dx: i32, dy: i32, r: i32) -> i32 {
        if !(1..=BRUSH_MAX).contains(&r) || dx.abs() > 2000 || dy.abs() > 2000 { return -1; }
        let (cx, cy) = (self.ox as f32 + dx as f32, self.oy as f32 + dy as f32);
        let mut n = 0;
        let want = ((r * r) as f32 * 0.9).ceil() as i32;
        for _ in 0..want * 2 {
            if n >= want || self.stock[W as usize] < 1 { break; }
            if self.plant_random(cx, cy, r as f32) { self.stock[W as usize] -= 1; n += 1; }
        }
        n
    }

    /// Put the planting zone of the forester `idx` at (`dx`, `dy`) from the forester itself (each within ±60); `i32::MIN` for either resets it to the forester's own spot. 0 ok.
    pub fn set_plant_zone(&mut self, idx: u32, dx: i32, dy: i32) -> i32 {
        let Some(b) = self.buildings.get_mut(idx as usize) else { return -1 };
        if b.kind != FORESTER { return -1; }
        if dx == i32::MIN || dy == i32::MIN { b.aux = -1; return 0; }
        if dx.abs() > ZONE_REACH || dy.abs() > ZONE_REACH { return -2; }
        b.aux = (dx + 128) * 256 + (dy + 128);
        0
    }

    /// Planted trees: [x, y, tick planted] each (the client works out how grown each is from the clock).
    pub fn planted_flat(&self) -> Vec<f32> { self.planted.iter().flat_map(|p| [p.0, p.1, p.2 as f32]).collect() }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Some dry ground in the village's land.
    fn village() -> World { let mut w = World::new(7, 0, 0); w.stock[W as usize] = 400; w.stock[PL as usize] = 40; w }

    #[test]
    fn the_brush_plants_trees_for_wood_and_they_grow_into_forest() {
        let mut w = village();
        let wood = w.stock[W as usize];
        let n = w.plant_trees(14, 10, 4);
        assert!(n > 5, "a brush plants a handful of trees ({n})");
        assert_eq!(w.stock[W as usize], wood - n, "one wood each");
        assert_eq!(w.planted_flat().len(), n as usize * 3);
        let (x, y) = (w.ox as f32 + 14.0, w.oy as f32 + 10.0);
        assert_eq!(w.planted_density(x, y, 6.0), 0.0, "young trees are not forest yet");
        for _ in 0..GROW_TICKS { w.step(); }
        assert!(w.planted_density(x, y, 6.0) >= 0.12, "grown trees are forest: {}", w.planted_density(x, y, 6.0));
        assert_eq!(w.plant_trees(0, 0, 0), -1);
        assert_eq!(w.plant_trees(0, 0, BRUSH_MAX + 1), -1);
    }

    #[test]
    fn nothing_is_planted_without_wood_on_buildings_or_on_other_trees() {
        let mut w = village();
        w.stock[W as usize] = 0;
        assert_eq!(w.plant_trees(14, 10, 4), 0, "no wood, no trees");
        w.stock[W as usize] = 400;
        let n = w.plant_trees(14, 10, 3);
        assert!(n > 0);
        assert!(w.planted.iter().enumerate().all(|(i, a)| w.planted.iter().skip(i + 1).all(|b| (a.0 - b.0).hypot(a.1 - b.1) >= SPACING - 1e-3)), "trees keep their distance");
        assert!(w.plant_trees(0, 0, 2) >= 0 && w.planted.iter().all(|p| p.0.hypot(p.1) > footprint(TOWN_HALL, 0)), "none on the town hall");
    }

    #[test]
    fn a_forester_plants_in_its_zone_and_a_woodcutter_fells_the_grown_trees() {
        let mut w = village();
        let code = w.place(FORESTER, 22, 0, 0);
        assert!(code >= 0, "placed: {code}");
        let f = w.buildings.len() - 1;
        assert_eq!(w.set_plant_zone(f as u32, 8, 8), 0);
        assert_eq!(w.set_plant_zone(f as u32, 999, 0), -2);
        assert_eq!(w.set_plant_zone(0, 1, 1), -1, "only a forester has a zone");
        for _ in 0..DAY * 4 { w.step(); }
        let (zx, zy) = (w.buildings[f].x + 8.0, w.buildings[f].y + 8.0);
        assert!(w.planted.len() >= 6, "the forester planted {}", w.planted.len());
        assert!(w.planted.iter().all(|p| (p.0 - zx).hypot(p.1 - zy) <= ZONE_RADIUS + 0.01), "all inside the zone");
        let before = w.planted.len();
        assert!(w.fell_planted(zx, zy), "a grown tree is felled");
        assert_eq!(w.planted.len(), before - 1);
        let fresh = w.tick;
        w.planted.push((zx, zy + 3.0, fresh));
        w.planted.retain(|p| fresh.saturating_sub(p.2) == 0);
        assert!(!w.fell_planted(zx, zy), "a young tree is left alone");
    }

    #[test]
    fn planted_trees_are_in_the_hash_and_the_snapshot() {
        let mut a = village();
        let h = a.state_hash();
        a.plant_trees(14, 10, 3);
        assert_ne!(a.state_hash(), h, "the trees are part of the state");
        for _ in 0..30 { a.step(); }
        let b = world_restore(&a.snapshot()).expect("restores");
        assert_eq!(a.planted, b.planted);
        assert_eq!(a.state_hash(), b.state_hash());
        let mut c = b; let mut d = a;
        for _ in 0..200 { c.step(); d.step(); }
        assert_eq!(c.state_hash(), d.state_hash(), "and plays on the same");
        let mut e = d; e.restart();
        assert!(e.planted.is_empty(), "a restart clears them");
    }

    #[test]
    fn a_cleared_land_grows_forest_again_for_the_woodcutter() {
        let mut w = village();
        w.demo(0, 150, 0, 0);   // everything within 150 is cleared of trees
        let (x, y) = (w.ox as f32 + 18.0, w.oy as f32 + 12.0);
        assert_eq!(w.forest_here(x, y, 12.0), 0.0, "bare land");
        assert!(w.place(4, 18, 12, 0) < 0, "a woodcutter cannot be built in bare land");
        w.plant_trees(18, 12, 6);
        for _ in 0..GROW_TICKS { w.step(); }
        assert!(w.forest_here(x, y, 12.0) >= 0.12, "the planted wood is forest");
        assert!(w.place(4, 18, 12, 0) >= 0, "so a woodcutter can stand beside it");
    }
}
