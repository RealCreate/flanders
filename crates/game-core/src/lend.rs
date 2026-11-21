//! Armies and water: a drawbridge that is drawn up is lowered for an army that has to cross it and raised again once the army is over; soldiers in a fight walk to a bridge or deck instead of wading.
//!
//! The rule, in one place (every peer runs it identically: it depends only on the state of the world):
//! * An army (or one of its riders/engines groups) *needs* a drawbridge when its route ahead runs over the deck within `LOOKAHEAD` units of walking, or when it is on or within `NEAR_END`
//!   units of the deck and still travelling (the last soldiers are still crossing). Soldiers in the fight that have chosen a deck as their crossing ask for it through `World::db_want`.
//! * A drawn-up bridge that is needed is lowered at once (status `DB_LENT`, or `DB_LENT_FIGHT` if it was a lowered one that the battle counts as drawn up) unless the player raised it by hand
//!   within `VETO_SECS`: a manual order wins. A lent bridge that nobody needs any more is drawn up again after `LEND_HOLD` seconds (one second during a battle, so raiders get no time to use it).
//! * Raiders never get dry feet from it: a lent deck is not a bridge for the raiders' wading rule (`bridge_points`), they cross the water beneath it as they always did.
//! * Gates are left as they are: a shut stone gate has no automatic opening for armies.
use super::*;
use crate::march::*;

/// How far ahead (units of walking) an army's route is looked at for a drawn-up deck to lower.
const LOOKAHEAD: f32 = 20.0;
/// An army this near the end of a deck it is still travelling past keeps it lowered.
const NEAR_END: f32 = 8.0;
const DECK_HALF: f32 = 7.4;

/// A way over water for soldiers in a fight: where it starts, where it ends, whether it is down now, and the drawbridge it is (building index) if it can be lowered.
#[derive(Clone, Copy)]
pub(crate) struct Cross { pub ax: f32, pub ay: f32, pub bx: f32, pub by: f32, pub half: f32, pub down: bool, pub db: i32, pub lendable: bool }

impl Cross {
    /// Is the point on this deck (a little beyond its ends, so a soldier stepping on is on it)?
    pub fn on(&self, x: f32, y: f32) -> bool {
        let (dx, dy) = (self.bx - self.ax, self.by - self.ay); let l = dx.hypot(dy).max(0.1); let (ux, uy) = (dx / l, dy / l);
        let (px, py) = (x - self.ax, y - self.ay);
        let along = px * ux + py * uy; let across = (px * uy - py * ux).abs();
        along >= -0.6 && along <= l + 0.6 && across <= self.half
    }
}

impl World {
    /// Every way over water that soldiers in a fight can take.
    pub(crate) fn crossings(&self) -> Vec<Cross> {
        let mut v = vec![];
        for (k, b) in self.buildings.iter().enumerate() {
            match b.kind {
                DRAWBRIDGE => {
                    let a = b.rot as f32 * std::f32::consts::FRAC_PI_4; let (sx, sy) = (a.sin(), a.cos());
                    v.push(Cross { ax: b.x - sx * DECK_HALF, ay: b.y - sy * DECK_HALF, bx: b.x + sx * DECK_HALF, by: b.y + sy * DECK_HALF, half: 1.7, down: !self.drawn_up(b), db: k as i32, lendable: self.db_lendable(b) });
                }
                BRIDGE => { let (ux, uy, l) = Self::bridge_dir(b); v.push(Cross { ax: b.x - ux * l / 2.0, ay: b.y - uy * l / 2.0, bx: b.x + ux * l / 2.0, by: b.y + uy * l / 2.0, half: 1.7, down: true, db: -1, lendable: false }); }
                _ => {}
            }
        }
        for g in &self.bridges { v.push(Cross { ax: g[0], ay: g[1], bx: g[2], by: g[3], half: 1.5, down: true, db: -1, lendable: false }); }
        v
    }

    /// Does an army (position and the route still ahead of it) need this drawbridge lowered? See the rules at the top of this file.
    fn needs_deck(b: &Building, x: f32, y: f32, ahead: &[Wp], travelling: bool, lookahead: f32) -> bool {
        let a = b.rot as f32 * std::f32::consts::FRAC_PI_4; let (sx, sy) = (a.sin(), a.cos());
        let frame = |px: f32, py: f32| -> (f32, f32) { let (dx, dy) = (px - b.x, py - b.y); (dx * sx + dy * sy, (dx * sy - dy * sx).abs()) };
        let (al, ac) = frame(x, y);
        if travelling && al.abs() <= DECK_HALF + NEAR_END && ac <= 6.0 { return true; }
        let (mut px, mut py, mut walked) = (x, y, 0.0f32);
        for w in ahead {
            let (dx, dy) = (w.x - px, w.y - py); let l = dx.hypot(dy); let st = (l / 1.0).ceil().max(1.0) as i32;
            for q in 1..=st {
                let t = q as f32 / st as f32; let (qx, qy) = (px + dx * t, py + dy * t);
                if walked + l * t > lookahead { return false; }
                let (al, ac) = frame(qx, qy);
                if al.abs() <= DECK_HALF + 0.4 && ac <= 3.0 { return true; }
            }
            walked += l; px = w.x; py = w.y;
        }
        false
    }

    /// One tick of the drawbridges: lower the drawn-up ones that an army needs, raise the lent ones nobody needs any more, count down the hold of a manual raise.
    pub(crate) fn drawbridge_step(&mut self) {
        let want = std::mem::take(&mut self.db_want);
        if !self.buildings.iter().any(|b| b.kind == DRAWBRIDGE) { return; }
        let fight = self.battle.is_some();
        for i in 0..self.buildings.len() {
            if self.buildings[i].kind != DRAWBRIDGE { continue; }
            if self.buildings[i].status == DB_UP && self.buildings[i].progress > 0 { self.buildings[i].progress -= 1; }
            let b = self.buildings[i].clone();
            let lendable = self.db_lendable(&b);
            let travelling = |s: u8| matches!(s, S_MARCH | S_FELL | S_BRIDGE | S_FERRY | S_WAIT | S_HOME);
            let needed = want.contains(&(i as u32)) || self.dets.iter().any(|d| {
                if !travelling(d.state) && d.state != S_BLOCKED { return false; }
                let on = |x, y| Self::needs_deck(&b, x, y, &[], true, 0.0);
                if d.file.near_deck(&Self::head_units(d), on) || d.grp.iter().any(|g| g.file.near_deck(&g.units, on)) { return true; }
                (d.wi < d.path.len() && Self::needs_deck(&b, d.x, d.y, &d.path[d.wi..], true, LOOKAHEAD))
                    || d.grp.iter().any(|g| g.wi < g.path.len() && Self::needs_deck(&b, g.x, g.y, &g.path[g.wi..], true, LOOKAHEAD))
            });
            let b = &mut self.buildings[i];
            if Self::db_lent(b) {
                if needed { b.progress = 0; }
                else {
                    b.progress += 1;
                    if b.progress >= if fight { LEND_HOLD_FIGHT } else { LEND_HOLD } { b.status = if b.status == DB_LENT { DB_UP } else { 4 }; b.progress = 0; }
                }
            } else if needed && lendable {
                b.status = if b.status == DB_UP { DB_LENT } else { DB_LENT_FIGHT };
                b.progress = 0;
            }
        }
    }

    /// The player has raised a drawbridge by hand: every army whose route runs over it plans another way.
    pub(crate) fn replan_over_deck(&mut self, bi: usize) {
        let b = self.buildings[bi].clone();
        let hit: Vec<(u32, f32, f32, Option<(f32, f32)>, bool, bool)> = self.dets.iter()
            .filter(|d| matches!(d.state, S_MARCH | S_FELL | S_BRIDGE | S_FERRY | S_WAIT | S_HOME) && d.wi < d.path.len())
            .filter(|d| Self::needs_deck(&b, d.x, d.y, &d.path[d.wi..], true, f32::MAX))
            .filter_map(|d| d.path.last().map(|l| (d.id, l.x, l.y, d.atk, d.home, d.defend))).collect();
        for (id, tx, ty, atk, home, defend) in hit {
            let r = self.det_march_inner(id, tx, ty, atk, home);
            if let Some(i) = self.dets.iter().position(|d| d.id == id) { if r == 0 { self.dets[i].defend = defend; } else { self.dets[i].path.clear(); self.dets[i].state = S_IDLE; } }
        }
    }
}
