//! The level-ground tool: the player marks a round patch of ground and it is levelled to the height of the land just outside it, so pits are filled and bumps cut away.
//!
//! Why the raise tool could not mend a pit: a raising adds 2.2 to the ground and only one fits on a spot, while a moat or river piece digs the ground to a fixed bed *after* the raisings
//! are added (so no raising lifts a ditch bed), a lowering goes as deep as it likes, and a crater from a battle is never taken away. A pit made of those could not be filled again.
//!
//! A level patch `[x, y, radius, height]` is applied after all of those (see `height_from`): inside the radius the ground is exactly the height, and it eases into the land over `FLAT_SHOULDER`.
//! Earthworks and ditch pieces whose middle lies in the patch are taken away (their water goes with them) and the craters in it are filled. Arithmetic is plain `f32`; the height is rounded to
//! 1/16 so every replica agrees on the number that is stored.
use super::*;

pub const FLAT_MIN_R: i32 = 3;
pub const FLAT_MAX_R: i32 = 14;
/// The lowest and highest height a patch may be levelled to by hand (below `FLAT_MIN_H` the ground would be the shore, not dry land). A negative height means Auto: the land round it.
pub const FLAT_MIN_H: f32 = 1.0;
pub const FLAT_MAX_H: f32 = 24.0;
/// How far past the marked circle the levelled ground eases back into the land.
pub(crate) const FLAT_SHOULDER: f32 = 4.0;
/// A building standing well inside the patch must already sit within this much of the new ground, or the patch is refused (its pad is never moved).
const FLAT_TOLERANCE: f32 = 0.7;
const RING_POINTS: usize = 24;

/// Cost of levelling a patch of radius `r`: wood for the barrows and planks, stone for the footing.
pub fn level_cost(r: i32) -> [(u8, i32); 2] { [(W, 2 * r), (ST, r * r / 2 + 2)] }

#[wasm_bindgen]
impl World {
    /// Flat [resource, amount, ...] cost of levelling a patch of radius `r`.
    pub fn level_cost_flat(r: i32) -> Vec<i32> { level_cost(r.clamp(FLAT_MIN_R, FLAT_MAX_R)).into_iter().flat_map(|(a, n)| [a as i32, n]).collect() }

    /// 0 if a patch of radius `r` could be levelled at (dx, dy) to the height `h` (negative: Auto, the land round it), otherwise: -1 a battle is on, -2 outside the village's land,
    /// -6 cannot afford it, -24 the radius is out of range, -25 no dry ground round it to level to (Auto only), -26 a building stands in it (its footing would be left up or down in the air),
    /// -28 the height is not a number or is out of range.
    pub fn level_check(&self, dx: i32, dy: i32, r: i32, h: f32) -> i32 { self.level_plan(dx, dy, r, h).map_or_else(|c| c, |_| 0) }

    /// The height a patch at (dx, dy) of radius `r` would be levelled to (the chosen height `h`, or the land round it when `h` is negative); -1000 if it cannot be worked out.
    pub fn level_target(&self, dx: i32, dy: i32, r: i32, h: f32) -> f32 { self.level_plan(dx, dy, r, h).map_or(-1000.0, |t| t.2) }

    /// Level the ground in a round patch to the height `h` (negative: the land round it). Returns what `level_check` returns; the patch is made only when that is 0.
    pub fn level_ground(&mut self, dx: i32, dy: i32, r: i32, h: f32) -> i32 {
        let (x, y, h) = match self.level_plan(dx, dy, r, h) { Ok(t) => t, Err(c) => return c };
        let rr = r as f32;
        for (res, n) in level_cost(r) { self.stock[res as usize] -= n; }
        // whatever dug or heaped the ground here is taken away: ditches and earthworks whose middle is in the patch, and the scars of battle
        self.buildings.retain(|b| !(is_edit(b.kind) && (b.x - x).hypot(b.y - y) < rr));
        self.craters.retain(|c| (c[0] - x).hypot(c[1] - y) >= rr + c[2]);
        self.flats.push([x, y, rr, h]);
        self.terrain_ver += 1; self.map_ver += 1;
        self.after_change();
        0
    }
}

impl World {
    /// Is this spot in the reach of a moat or river piece (the ditch and its steep bank)?
    fn in_channel(&self, x: f32, y: f32) -> bool {
        self.buildings.iter().any(|b| matches!(b.kind, MOAT | RIVER) && {
            let reach = if b.kind == MOAT { MOAT_FLOOR * moat_scale(b) } else { RIVER_FLOOR } + CHANNEL_BANK + 0.5;
            (b.x - x).hypot(b.y - y) < reach
        })
    }

    /// The height of the dry land in a ring just outside the patch: the median of the samples, leaving out water and ditches. None if too little of the ring is dry.
    fn ring_height(&self, x: f32, y: f32, r: f32) -> Option<f32> {
        let mut v: Vec<f32> = vec![];
        for ring in [r + 1.5, r + 3.0] {
            for k in 0..RING_POINTS {
                let a = (k as f32 + if ring > r + 2.0 { 0.5 } else { 0.0 }) * std::f32::consts::TAU / RING_POINTS as f32;
                let (px, py) = (x + a.cos() * ring, y + a.sin() * ring);
                let h = self.height_ground(px, py);
                if h < 0.4 || self.in_channel(px, py) { continue; }
                v.push(h);
            }
        }
        if v.len() < RING_POINTS { return None; }   // (less than half of the ring is dry)
        v.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let n = v.len();
        let m = if n % 2 == 1 { v[n / 2] } else { (v[n / 2 - 1] + v[n / 2]) * 0.5 };
        Some((m * 16.0).round() / 16.0)
    }

    /// Everything `level_ground` needs: the patch's middle and the height, or the code that refuses it.
    fn level_plan(&self, dx: i32, dy: i32, r: i32, want: f32) -> Result<(f32, f32, f32), i32> {
        if self.battle.is_some() { return Err(-1); }
        if want.is_nan() || (want >= 0.0 && !(FLAT_MIN_H..=FLAT_MAX_H).contains(&want)) { return Err(-28); }
        if !(FLAT_MIN_R..=FLAT_MAX_R).contains(&r) { return Err(-24); }
        let (x, y) = (self.ox.wrapping_add(dx) as f32, self.oy.wrapping_add(dy) as f32);
        if !self.in_territory(x, y) { return Err(-2); }
        let rr = r as f32;
        let h = if want < 0.0 { match self.ring_height(x, y, rr) { Some(h) => h, None => return Err(-25) } } else { (want * 16.0).round() / 16.0 };
        for b in self.buildings.iter().filter(|b| !is_edit(b.kind) && b.kind != ROAD) {
            let d = (b.x - x).hypot(b.y - y);
            if d >= rr + FLAT_SHOULDER { continue; }
            let w = 1.0 - smoothstep(rr, rr + FLAT_SHOULDER, d);
            if w > 0.5 && DEFS[b.kind as usize].pad && (b.pad_h - h).abs() > FLAT_TOLERANCE { return Err(-26); }
        }
        for (res, n) in level_cost(r) { if self.stock[res as usize] < n { return Err(-6); } }
        Ok((x, y, h))
    }
}
