//! What the roads are *for*: which buildings a road joins to the castle, the stretch of road that is upgraded and styled as one, and the surface and design of a road.
//!
//! Everything here is derived from, or applied to, the pieces the player laid (kind `ROAD`) and their joins (`road_conn`, see roadline.rs); nothing is cached, so a restored world and a
//! live one always agree. A road piece's `tier` is its surface (0 dirt, 1 gravel, 2 cobbles, 3 flagstones) and its `opts` the design along it (trees, hedges, benches, lanterns).
use super::*;
use std::collections::BTreeMap;

/// How fast a workplace that has no road to the castle works, in per cent of its normal pace (farms, mills, mines... every building that makes something).
pub const UNROADED_PACE: u32 = 50;
/// The castle's yard: a workplace this close to the edge of the town hall's plot is in the heart of the village and needs no road (the opening of a game is played inside it).
pub const CASTLE_YARD: f32 = 14.0;

fn find(parent: &mut [usize], mut i: usize) -> usize { while parent[i] != i { parent[i] = parent[parent[i]]; i = parent[i]; } i }

#[wasm_bindgen]
impl World {
    /// Which buildings are joined to the town hall by a road: the road pieces the player laid join the nodes of the buildings they run between, so a chain of roads and buildings
    /// (a plaza, a gate and a bridge are links in it too) that reaches the hall's own node makes every building on it reach the castle. The hall itself always does.
    pub(crate) fn road_reach(&self) -> Vec<bool> {
        let n = self.buildings.len();
        let mut parent: Vec<usize> = (0..n).collect();
        let by_pos: BTreeMap<(u32, u32), usize> = self.buildings.iter().enumerate().map(|(i, b)| ((b.x.to_bits(), b.y.to_bits()), i)).collect();
        for c in &self.road_conn {
            let Some(&i) = by_pos.get(&(c.x.to_bits(), c.y.to_bits())) else { continue };
            if self.buildings[i].kind != ROAD { continue; }
            for t in c.to.iter().filter(|t| t.k != 0) {
                let Some(&j) = by_pos.get(&(t.x.to_bits(), t.y.to_bits())) else { continue };
                let (a, b) = (find(&mut parent, i), find(&mut parent, j));
                if a != b { parent[a.max(b)] = a.min(b); }
            }
        }
        let halls: Vec<usize> = (0..n).filter(|&i| self.buildings[i].kind == TOWN_HALL).collect();
        let hall_roots: Vec<usize> = halls.iter().map(|&h| find(&mut parent, h)).collect();
        (0..n).map(|i| { let r = find(&mut parent, i); self.buildings[i].kind == TOWN_HALL || hall_roots.contains(&r) }).collect()
    }

    /// Does building `i` (given `reach` from `road_reach`) have what it needs from the roads: a road to the castle, or a place in the castle's own yard? Only buildings that make something need one.
    pub(crate) fn road_served(&self, i: usize, reach: &[bool]) -> bool {
        let b = &self.buildings[i];
        if DEFS[b.kind as usize].cycle == 0 || reach.get(i).copied().unwrap_or(true) { return true; }
        self.buildings.iter().any(|h| h.kind == TOWN_HALL && (h.x - b.x).hypot(h.y - b.y) <= footprint(h.kind, h.tier) + CASTLE_YARD + footprint(b.kind, b.tier) * 0.5)
    }

    /// Per building: 1 if it is served by the roads (joined to the castle by a road, in the castle's yard, or needs none), 0 if it works slowly for want of a road. For the client's badge.
    pub fn road_access_flat(&self) -> Vec<u8> {
        let reach = self.road_reach();
        (0..self.buildings.len()).map(|i| self.road_served(i, &reach) as u8).collect()
    }

    /// Per building: 1 if it is joined to the castle over the roads the player laid (a road piece, a plaza, a bridge: anything that is part of the network), for colouring the roads.
    pub fn road_joined_flat(&self) -> Vec<u8> { self.road_reach().into_iter().map(|r| r as u8).collect() }

    /// The pieces of the stretch of road that building `idx` (a road piece) belongs to: the piece, everything joined to it piece by piece, up to and including a junction (a piece with three or
    /// more neighbours on the road), but never through one. Sorted by building index. Empty if `idx` is not a road piece.
    pub fn road_stretch(&self, idx: u32) -> Vec<u32> {
        let i0 = idx as usize;
        if self.buildings.get(i0).map_or(true, |b| b.kind != ROAD) { return vec![]; }
        let by_pos: BTreeMap<(u32, u32), usize> = self.buildings.iter().enumerate().filter(|(_, b)| b.kind == ROAD).map(|(i, b)| ((b.x.to_bits(), b.y.to_bits()), i)).collect();
        let mut nb: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
        for c in &self.road_conn {
            let Some(&i) = by_pos.get(&(c.x.to_bits(), c.y.to_bits())) else { continue };
            for t in c.to.iter().filter(|t| t.k == 1) {
                let Some(&j) = by_pos.get(&(t.x.to_bits(), t.y.to_bits())) else { continue };
                if i == j { continue; }
                let l = nb.entry(i).or_default(); if !l.contains(&j) { l.push(j); }
                let l = nb.entry(j).or_default(); if !l.contains(&i) { l.push(i); }
            }
        }
        let mut seen = std::collections::BTreeSet::from([i0]); let mut queue = vec![i0];
        while let Some(i) = queue.pop() {
            if i != i0 && nb.get(&i).map_or(0, |v| v.len()) >= 3 { continue; }   // a junction ends the stretch (it is part of it, and the arms beyond it are other stretches)
            for &j in nb.get(&i).into_iter().flatten() { if seen.insert(j) { queue.push(j); } }
        }
        seen.into_iter().map(|i| i as u32).collect()
    }

    /// Resurface the whole stretch of road `idx` belongs to: every piece below the next surface after the one the piece `idx` has is brought up to it (the same for each: a stretch has one surface).
    /// Costs the sum of the pieces' own costs. 0 ok, -1 not a road piece, -6 cannot afford, -10 already flagstones.
    pub fn upgrade_road(&mut self, idx: u32) -> i32 {
        let stretch = self.road_stretch(idx);
        if stretch.is_empty() { return -1; }
        let target = self.buildings[idx as usize].tier + 1;
        if target > max_tier(ROAD) { return -10; }
        let pieces: Vec<usize> = stretch.iter().map(|&i| i as usize).filter(|&i| self.buildings[i].tier < target).collect();
        self.resurface(&pieces, target)
    }

    /// Resurface every road of the kingdom (every piece below `target` is brought up to it). 0 ok, -1 no such surface or no road, -6 cannot afford, -10 nothing to do (every road is as good already).
    pub fn upgrade_all_roads(&mut self, target: u8) -> i32 {
        if target == 0 || target > max_tier(ROAD) { return -1; }
        let pieces: Vec<usize> = (0..self.buildings.len()).filter(|&i| self.buildings[i].kind == ROAD && self.buildings[i].tier < target).collect();
        if pieces.is_empty() { return if self.buildings.iter().any(|b| b.kind == ROAD) { -10 } else { -1 }; }
        self.resurface(&pieces, target)
    }

    /// Bring these road pieces up to `target`, paying for every step each of them climbs, all or nothing.
    fn resurface(&mut self, pieces: &[usize], target: u8) -> i32 {
        let mut cost: BTreeMap<u8, i32> = BTreeMap::new();
        for &i in pieces { for (r, n) in road_resurface_cost(self.buildings[i].tier, target) { *cost.entry(r).or_insert(0) += n; } }
        if cost.iter().any(|(&r, &n)| self.stock[r as usize] < n) { return -6; }
        for (&r, &n) in &cost { self.stock[r as usize] -= n; }
        for &i in pieces { let hp = battle::max_hp(ROAD, target); let b = &mut self.buildings[i]; b.tier = target; b.hp = hp; b.burning = 0.0; }
        self.rebuild_roads();   // (the surface is the speed of the road: the segments carry it)
        0
    }

    /// Switch a design option on or off on every road of the kingdom that is good enough for it. 0 ok, -1 invalid or no road, -6 cannot afford, -10 no road is good enough (or nothing to change).
    pub fn set_all_road_options(&mut self, bit: u8, on: bool) -> i32 {
        let Some(o) = options(ROAD).get(bit as usize) else { return -1 };
        if !self.buildings.iter().any(|b| b.kind == ROAD) { return -1; }
        let pieces: Vec<usize> = (0..self.buildings.len()).filter(|&i| { let b = &self.buildings[i]; b.kind == ROAD && (b.opts & (1 << bit) != 0) != on && (!on || b.tier >= o.2) }).collect();
        if pieces.is_empty() { return -10; }
        if on {
            let mut cost: BTreeMap<u8, i32> = BTreeMap::new();
            for _ in &pieces { for (r, n) in road_option_cost() { *cost.entry(r).or_insert(0) += n; } }
            if cost.iter().any(|(&r, &n)| self.stock[r as usize] < n) { return -6; }
            for (&r, &n) in &cost { self.stock[r as usize] -= n; }
            for &i in &pieces { self.buildings[i].opts |= 1 << bit; }
        } else { for &i in &pieces { self.buildings[i].opts &= !(1 << bit); } }
        0
    }

    /// The roads of the kingdom in numbers: [pieces of dirt, gravel, cobbles, flagstones, pieces with trees, hedges, benches, lanterns, pieces joined to the castle, all pieces].
    pub fn road_summary_flat(&self) -> Vec<u32> {
        let reach = self.road_reach(); let mut v = vec![0u32; 10];
        for (i, b) in self.buildings.iter().enumerate() {
            if b.kind != ROAD { continue; }
            v[b.tier.min(3) as usize] += 1; for k in 0..4 { if b.opts & (1 << k) != 0 { v[4 + k] += 1; } }
            if reach[i] { v[8] += 1; } v[9] += 1;
        }
        v
    }

    /// Switch a design option of the road (bit 0 trees, 1 hedges, 2 benches, 3 lanterns) on or off along the whole stretch `idx` belongs to. 0 ok, -1 invalid, -6 cannot afford, -10 the surface
    /// is not good enough yet (benches need gravel, lanterns cobbles: judged on the piece `idx`; pieces of the stretch below it are brought up first).
    pub fn set_road_option(&mut self, idx: u32, bit: u8, on: bool) -> i32 {
        let stretch = self.road_stretch(idx);
        let Some(o) = options(ROAD).get(bit as usize) else { return -1 };
        if stretch.is_empty() { return -1; }
        let pieces: Vec<usize> = stretch.iter().map(|&i| i as usize).filter(|&i| (self.buildings[i].opts & (1 << bit) != 0) != on).collect();
        if pieces.is_empty() { return 0; }
        if on {
            if stretch.iter().any(|&i| self.buildings[i as usize].tier < o.2) { return -10; }
            let mut cost: BTreeMap<u8, i32> = BTreeMap::new();
            for _ in &pieces { for (r, n) in road_option_cost() { *cost.entry(r).or_insert(0) += n; } }
            if cost.iter().any(|(&r, &n)| self.stock[r as usize] < n) { return -6; }
            for (&r, &n) in &cost { self.stock[r as usize] -= n; }
            for &i in &pieces { self.buildings[i].opts |= 1 << bit; }
        } else { for &i in &pieces { self.buildings[i].opts &= !(1 << bit); } }
        0
    }

    /// The surface and design of one stretch of road between two joined things: the lower surface of the two pieces, the design only where both have it (a stretch has one design all along, so this
    /// only matters where two stretches meet).
    pub(crate) fn edge_style(&self, a: usize, b: usize) -> (u8, u8) {
        let (pa, pb) = (&self.buildings[a], &self.buildings[b]);
        if pb.kind == ROAD && pa.kind == ROAD { (pa.tier.min(pb.tier), pa.opts as u8 & pb.opts as u8) }
        else if pa.kind == ROAD { (pa.tier, pa.opts as u8) } else { (pb.tier, pb.opts as u8) }
    }
}
