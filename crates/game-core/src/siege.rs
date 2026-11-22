//! Siege towers and sapping: two ways for attackers to beat a stone wall that spears cannot hurt (a ladder is the third, see battle.rs).
//!
//! * A **siege tower** is a battle-level engine like a ladder (it is not a trainable kind): a big raid brings one or two. It rolls at the nearest wall or gate, docks against it and carries
//!   soldiers over it at `TOWER_RATE` a second. Defenders next to it, catapults and boiling oil wreck it; water stops it, so a moat is its answer.
//! * A **sap** is begun by infantry who are stopped by a stone wall with no ladder to spare. The crew dig under the wall; when the shaft is done the section falls. Defenders who sally
//!   out to the dig (stand within `SAP_SALLY_REACH` of it on the ground) fill the shaft in; a moat beside the wall floods it before it starts.
//!
//! Everything is deterministic (no random draws) and part of the state hash. Every number is below.
use super::*;
use crate::military::*;
use crate::battle::{is_stone, max_hp};

/// A raid brings a tower for every `TOWER_PER` infantry (spearmen and swordsmen), at most `TOWER_MAX`, when stone walls stand and at least `TOWER_FROM` infantry came.
pub const TOWER_FROM: u32 = 16;
pub const TOWER_PER: u32 = 16;
pub const TOWER_MAX: u32 = 2;
pub const TOWER_HP: f32 = 420.0;
pub const TOWER_SPEED: f32 = 1.5;
/// The tower sits this far from a wall's middle beyond the wall's radius once docked.
pub const TOWER_DOCK: f32 = 1.0;
/// Soldiers within this of the tower's foot may board; one boards every `TOWER_RATE` seconds and spends `TOWER_CLIMB` seconds on the stair.
pub const TOWER_GATHER: f32 = 10.0;
pub const TOWER_RATE: f32 = 0.75;
pub const TOWER_CLIMB: f32 = 2.0;
/// What hurts a tower (damage a second): a defender in melee within `TOWER_MELEE`, an archer within `TOWER_SHOOT` (arrows barely mark timber), a catapult in range (full blow over its cooldown), oil from a hoarding at the wall.
pub const TOWER_MELEE: f32 = 3.6;
pub const TOWER_SHOOT: f32 = 22.0;
pub const TOWER_SOFT: f32 = 0.35;
pub const TOWER_ARROW: f32 = 0.12;
pub const TOWER_OIL: f32 = 0.5;

/// Infantry (spearmen and swordsmen) in a raid let it sap: one sap at `SAP_FROM`, two at twice that, three at three times (`SAP_MAX`).
pub const SAP_FROM: u32 = 10;
pub const SAP_MAX: u32 = 3;
/// Seconds of digging a stone wall takes with one man: `SAP_BASE` + `SAP_TIER` for each tier above 2. More diggers within `SAP_CREW_REACH` (at most `SAP_CREW_MAX` count) go faster.
pub const SAP_BASE: f32 = 26.0;
pub const SAP_TIER: f32 = 8.0;
pub const SAP_CREW_REACH: f32 = 5.0;
pub const SAP_CREW_MAX: u32 = 6;
/// A moat or river within this of the wall floods a shaft before it is begun.
pub const SAP_WET_REACH: f32 = 8.0;
/// Defenders on the ground within this of the shaft fill it in: each takes `SAP_SALLY_RATE` seconds of digging back every second; at nothing left the sap is lost.
pub const SAP_SALLY_REACH: f32 = 5.5;
pub const SAP_SALLY_RATE: f32 = 1.6;
/// The fallen section also hurts a stone wall this close beside it by this share of its hit points.
pub const SAP_SPLASH_REACH: f32 = 4.5;
pub const SAP_SPLASH: f32 = 0.4;

pub const T_ROLL: u8 = 0;    // tower: rolling up to a wall
pub const T_DOCKED: u8 = 1;  // tower: against a wall, carrying soldiers over
pub const T_STUCK: u8 = 2;   // tower: held up by water or another wall
pub const T_WRECK: u8 = 3;   // tower: destroyed
pub const S_DIG: u8 = 0;     // sap: digging
pub const S_FALLEN: u8 = 1;  // sap: the wall came down
pub const S_FILLED: u8 = 2;  // sap: defenders filled the shaft in

#[derive(Clone, Copy, serde::Serialize, serde::Deserialize)]
pub struct Tower { pub x: f32, pub y: f32, pub face: f32, pub hp: f32, pub state: u8, pub load: f32, pub carried: u32 }

/// `wall` is the section being undermined, by position (indices move when buildings fall).
#[derive(Clone, Copy, serde::Serialize, serde::Deserialize)]
pub struct Sap { pub x: f32, pub y: f32, pub face: f32, pub secs: f32, pub done: f32, pub state: u8 }

#[derive(Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct Siege { pub towers: Vec<Tower>, pub saps: Vec<Sap>, pub sap_allowed: u32 }

impl Siege {
    pub fn hash(&self, mix: &mut dyn FnMut(u64)) {
        mix(self.sap_allowed as u64);
        for t in &self.towers { mix(t.x.to_bits() as u64); mix(t.y.to_bits() as u64); mix(t.hp.to_bits() as u64); mix(t.state as u64); mix(t.load.to_bits() as u64); mix(t.carried as u64); }
        for s in &self.saps { mix(s.x.to_bits() as u64); mix(s.y.to_bits() as u64); mix(s.done.to_bits() as u64); mix(s.state as u64); }
    }
}

impl World {
    /// The siege train a raid of this make brings (towers placed at the front, `dist` out, and how many saps it may dig). Needs a stone wall to be worth it.
    pub(crate) fn siege_train(&self, atk: &[u32; NK], cx: f32, cy: f32, dx: f32, dy: f32, dist: f32) -> Siege {
        let inf = atk[0] + atk[2];
        let stone = self.buildings.iter().any(|b| b.kind == WALL && b.tier >= 2 && b.hp > 0.0);
        let mut s = Siege::default();
        if !stone { return s; }
        let n = if inf >= TOWER_FROM { (inf / TOWER_PER).clamp(1, TOWER_MAX) } else { 0 };
        for k in 0..n {
            let col = (k as f32 - (n as f32 - 1.0) * 0.5) * 12.0;
            s.towers.push(Tower { x: cx + dx * (dist - 5.0) - dy * col, y: cy + dy * (dist - 5.0) + dx * col, face: dy.atan2(dx) + std::f32::consts::PI, hp: TOWER_HP, state: T_ROLL, load: 0.0, carried: 0 });
        }
        s.sap_allowed = (inf / SAP_FROM).min(SAP_MAX);
        s
    }

    /// Do water and a wall's neighbourhood allow a shaft here?
    fn sap_flooded(&self, x: f32, y: f32) -> bool {
        self.buildings.iter().any(|m| matches!(m.kind, MOAT | RIVER) && (m.x - x).hypot(m.y - y) < SAP_WET_REACH + DEFS[m.kind as usize].r)
    }

    /// Infantry stopped by the stone wall `k` with no ladder to spare dig under it, if the raid may and the water allows. Returns whether a sap is now under way there.
    pub(crate) fn try_sap(&self, b: &mut Battle, k: usize, face: f32) -> bool {
        let w = &self.buildings[k];
        if w.kind != WALL || w.tier < 2 { return false; }
        if b.siege.saps.iter().any(|s| s.state == S_DIG && (s.x - w.x).hypot(s.y - w.y) < 3.0) { return true; }
        let used = b.siege.saps.iter().filter(|s| s.state == S_DIG).count() as u32;
        if used >= b.siege.sap_allowed || self.sap_flooded(w.x, w.y) { return false; }
        b.siege.saps.push(Sap { x: w.x, y: w.y, face, secs: SAP_BASE + SAP_TIER * (w.tier - 2) as f32, done: 0.0, state: S_DIG });
        true
    }

    /// One 0.25 s step of towers and saps. Returns nothing; buildings that fall are collected by the caller.
    pub(crate) fn siege_step(&mut self, b: &mut Battle, dt: f32, deploying: bool, wet: &[(f32, f32, f32)], shots: &mut Vec<[f32; 7]>) {
        let bars: Vec<(f32, f32, f32)> = self.buildings.iter().filter(|x| x.hp > 0.0 && matches!(x.kind, WALL | GATE | FENCE)).map(|x| (x.x, x.y, if x.kind == FENCE { 1.9 } else { 2.6 })).collect();
        // ---- towers
        for ti in 0..b.siege.towers.len() {
            let mut t = b.siege.towers[ti];
            if t.state == T_WRECK { continue; }
            // what wears it down
            let mut dps = 0.0f32;
            for u in b.units.iter().filter(|u| u.side == 0 && u.alive && !u.wading) {
                let d = (u.x - t.x).hypot(u.y - t.y);
                let st = unit_stat(u);
                dps += match u.kind { 4 if d < st.range => st.dmg / st.cd, 1 if d < TOWER_SHOOT => st.dmg / st.cd * TOWER_ARROW, 0 | 2 | 3 | MILITIA if d < TOWER_MELEE => st.dmg / st.cd * TOWER_SOFT, _ => 0.0 };
            }
            if t.state == T_DOCKED && self.buildings.iter().any(|w| w.hp > 0.0 && Self::has_oil(w) && (w.x - t.x).hypot(w.y - t.y) < DEFS[w.kind as usize].r + 3.5) { dps += crate::battle::OIL_DPS * TOWER_OIL; }
            t.hp -= dps * dt;
            if t.hp <= 0.0 { t.state = T_WRECK; b.siege.towers[ti] = t; shots.push([4.0, t.x, t.y, t.x, t.y, 0.0, 0.0]); continue; }
            if deploying { b.siege.towers[ti] = t; continue; }
            // roll up to the nearest wall or gate
            let target = bars.iter().filter(|q| q.2 > 2.0).min_by(|p, q| ((p.0 - t.x).hypot(p.1 - t.y)).total_cmp(&((q.0 - t.x).hypot(q.1 - t.y)))).copied();
            if t.state == T_ROLL || t.state == T_STUCK {
                if let Some((bx, by, r)) = target {
                    let d = (bx - t.x).hypot(by - t.y);
                    if d <= r + TOWER_DOCK + 0.1 { t.state = T_DOCKED; }
                    else {
                        let (ux, uy) = ((bx - t.x) / d, (by - t.y) / d);
                        let step = (TOWER_SPEED * dt).min(d - r - TOWER_DOCK);
                        let (nx, ny) = (t.x + ux * step, t.y + uy * step);
                        let in_water = wet.iter().any(|&(wx, wy, wr)| (nx - wx).hypot(ny - wy) < wr + 1.5) && !Self::battle_bridge(b, nx, ny);
                        let other = bars.iter().any(|q| (q.0, q.1) != (bx, by) && (nx - q.0).hypot(ny - q.1) < q.2 + 1.2 && (nx - q.0).hypot(ny - q.1) < (t.x - q.0).hypot(t.y - q.1));
                        if in_water { t.state = T_STUCK; }
                        else if other { t.state = T_STUCK; }   // a fence or another wall in the way: it waits for it to go
                        else { t.x = nx; t.y = ny; t.face = uy.atan2(ux); t.state = T_ROLL; }
                    }
                }
            }
            // a docked tower whose wall has gone rolls on
            if t.state == T_DOCKED && !bars.iter().any(|q| (q.0 - t.x).hypot(q.1 - t.y) <= q.2 + TOWER_DOCK + 0.6) { t.state = T_ROLL; }
            // carry soldiers over
            if t.state == T_DOCKED {
                t.load = (t.load - dt).max(0.0);
                if t.load <= 0.0 {
                    let mut pick: Option<(usize, f32)> = None;
                    for (i, u) in b.units.iter().enumerate() {
                        if u.side != 1 || !u.alive || u.wading || u.climb > 0.0 || u.boss > 0 || !matches!(u.kind, 0 | 2) { continue; }
                        if b.rout.get(i).copied().unwrap_or(0.0) != 0.0 { continue; }
                        let d = (u.x - t.x).hypot(u.y - t.y);
                        if d <= TOWER_GATHER && pick.map_or(true, |p| d < p.1) { pick = Some((i, d)); }
                    }
                    if let Some((i, _)) = pick {
                        b.units[i].x = t.x; b.units[i].y = t.y; b.units[i].climb = TOWER_CLIMB; b.units[i].spot = -1; b.units[i].face = t.face;
                        t.load = TOWER_RATE; t.carried += 1;
                    }
                }
            }
            b.siege.towers[ti] = t;
        }
        // ---- saps
        for si in 0..b.siege.saps.len() {
            let mut s = b.siege.saps[si];
            if s.state != S_DIG { continue; }
            let Some(wi) = self.buildings.iter().position(|w| w.kind == WALL && w.hp > 0.0 && (w.x - s.x).hypot(w.y - s.y) < 0.5) else { s.state = S_FILLED; b.siege.saps[si] = s; continue; };   // the wall is gone already
            let crew = b.units.iter().filter(|u| u.side == 1 && u.alive && !u.wading && u.boss == 0 && matches!(u.kind, 0 | 2) && u.climb <= 0.0 && (u.x - s.x).hypot(u.y - s.y) <= SAP_CREW_REACH + 2.6).count() as u32;
            let sally = b.units.iter().filter(|u| u.side == 0 && u.alive && !u.wading && u.elev <= 0.0 && u.climb <= 0.0 && u.kind != 4 && (u.x - s.x).hypot(u.y - s.y) <= SAP_SALLY_REACH + 2.6).count() as f32;
            if !deploying && crew > 0 { s.done += dt * (0.5 + 0.25 * crew.min(SAP_CREW_MAX) as f32) * 0.8; }
            s.done -= dt * SAP_SALLY_RATE * sally;
            if s.done < 0.0 && sally > 0.0 { s.state = S_FILLED; b.siege.saps[si] = s; continue; }
            s.done = s.done.max(0.0);
            if s.done >= s.secs {
                s.state = S_FALLEN;
                let (x, y) = (self.buildings[wi].x, self.buildings[wi].y);
                self.buildings[wi].hp = 0.0;
                for k in 0..self.buildings.len() {
                    let o = &self.buildings[k];
                    if k != wi && o.kind == WALL && o.hp > 0.0 && is_stone(o.kind, o.tier) && (o.x - x).hypot(o.y - y) < SAP_SPLASH_REACH { let m = max_hp(o.kind, o.tier); self.buildings[k].hp -= m * SAP_SPLASH; }
                }
                shots.push([4.0, x, y, x, y, 0.0, 0.0]);
            }
            b.siege.saps[si] = s;
        }
    }

    /// For the client: towers `[0, x, y, face, hp share, state, carried]`, then saps `[1, x, y, face, dug share, state, 0]`.
    pub(crate) fn siege_flat(&self) -> Vec<f32> {
        let Some(b) = self.battle.as_ref() else { return vec![] };
        let mut v: Vec<f32> = vec![];
        for t in &b.siege.towers { v.extend([0.0, t.x, t.y, t.face, (t.hp / TOWER_HP).clamp(0.0, 1.0), t.state as f32, t.carried as f32]); }
        for s in &b.siege.saps { v.extend([1.0, s.x, s.y, s.face, (s.done / s.secs).clamp(0.0, 1.0), s.state as f32, 0.0]); }
        v
    }
}
