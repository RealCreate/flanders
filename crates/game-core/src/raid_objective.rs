//! Optional objectives for announced bandit raids. The raid can still be fought to its usual
//! conclusion if the objective is lost. Player sieges and boss encounters use their own rules.
use super::*;
use crate::military::Battle;

const GATE_SECS: f32 = 55.0;
const CARAVAN_SECS: f32 = 42.0;
const CAPTURE_SECS: f32 = 7.0;
const WAGON_REACH: f32 = 8.0;
const DEFEND_REACH: f32 = 11.0;
const RESCUE_GRAIN: i32 = 45;

#[derive(Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub(crate) enum Kind { Gate = 1, Caravan = 2 }

#[derive(Clone, Copy, serde::Serialize, serde::Deserialize)]
pub(crate) struct RaidObjective {
    pub kind: Kind,
    pub x: f32,
    pub y: f32,
    pub pressure: f32,
    pub lost: bool,
}

impl RaidObjective {
    fn limit(self) -> f32 { match self.kind { Kind::Gate => GATE_SECS, Kind::Caravan => CARAVAN_SECS } }

    pub(crate) fn flat(self, combat_time: f32) -> Vec<f32> {
        let limit = self.limit();
        vec![self.kind as u8 as f32, self.x, self.y, (limit - combat_time).max(0.0), self.pressure / CAPTURE_SECS, self.lost as u8 as f32]
    }

    pub(crate) fn held(self, battle_time: f32) -> bool {
        !self.lost && battle_time >= battle::DEPLOY_SECS + self.limit()
            && (self.kind == Kind::Gate || self.pressure == 0.0)
    }

    pub(crate) fn valid(self) -> bool {
        self.x.is_finite() && self.y.is_finite() && self.x.abs() <= MAP_LIMIT && self.y.abs() <= MAP_LIMIT
            && (0.0..=CAPTURE_SECS).contains(&self.pressure)
    }

    pub(crate) fn hash(self, mix: &mut dyn FnMut(u64)) {
        mix(self.kind as u8 as u64);
        for v in [self.x, self.y, self.pressure] { mix(v.to_bits() as u64); }
        mix(self.lost as u64);
    }
}

impl World {
    pub(crate) fn warned_raid_objective(&self) -> Option<RaidObjective> {
        if self.raid_warning_boss { return None; }
        let angle = self.raid_warning_angle;
        let (x, y) = (self.ox as f32, self.oy as f32);
        let (dy, dx) = angle.sin_cos();
        let approach = |bx: f32, by: f32| (bx - x) * dx + (by - y) * dy;
        let objective = |kind, x, y| Some(RaidObjective { kind, x, y, pressure: 0.0, lost: false });
        if self.raid_warning_rf < 0.55 {
            let gate = self.buildings.iter().filter(|b| b.kind == GATE && b.hp > 0.0 && approach(b.x, b.y) >= 0.0)
                .max_by(|a, b| approach(a.x, a.y).total_cmp(&approach(b.x, b.y)));
            if let Some(g) = gate { return objective(Kind::Gate, g.x, g.y); }
        }
        if self.raid_warning_rf >= 0.82 { return None; }
        // Look for a dry staging area within the town approaches even if the road network is new.
        for radius in [26.0, 34.0, 19.0] {
            for offset in [0.0, 0.55, -0.55, 1.1, -1.1] {
                let (dy, dx) = (angle + offset).sin_cos();
                let (px, py) = (x + radius * dx, y + radius * dy);
                if !Self::infrastructure_in_bounds(px, py) || self.buildings.iter().any(|b| {
                    !is_edit(b.kind) && b.kind != ROAD && (b.x - px).hypot(b.y - py) < footprint(b.kind, b.tier) + 4.0
                }) { continue; }
                if [(0.0, 0.0), (2.0, 0.0), (-2.0, 0.0), (0.0, 2.0), (0.0, -2.0)].into_iter().all(|(ox, oy)| {
                    let (ax, ay) = (px + ox, py + oy);
                    !self.ground_is_wet(ax, ay, self.height_at(ax, ay))
                        && (self.height_at(ax, ay) - self.height_at(px, py)).abs() < 1.3
                }) { return objective(Kind::Caravan, px, py); }
            }
        }
        None
    }

    pub(crate) fn gate_objective_index(&self, o: RaidObjective) -> Option<usize> {
        self.buildings.iter().position(|g| g.kind == GATE && g.x == o.x && g.y == o.y && g.hp > 0.0)
    }

    pub(crate) fn raid_objective_step(&mut self, b: &mut Battle, dt: f32) {
        let Some(mut o) = b.objective.filter(|o| !o.lost && !b.bought) else { return };
        if o.kind == Kind::Gate {
            o.lost = self.gate_objective_index(o).is_none();
        } else if b.t > battle::DEPLOY_SECS {
            let near = |side, radius| b.units.iter().enumerate().any(|(i, u)| {
                u.alive && !u.escaped && !u.wading && u.side == side && b.rout.get(i).copied().unwrap_or(0.0) <= 0.0
                    && (u.x - o.x).powi(2) + (u.y - o.y).powi(2) < radius * radius
            });
            if near(1, WAGON_REACH) && !near(0, DEFEND_REACH) { o.pressure = (o.pressure + dt).min(CAPTURE_SECS); }
            else { o.pressure = (o.pressure - dt * 0.5).max(0.0); }
            o.lost = o.pressure >= CAPTURE_SECS;
        }
        if o.lost { self.push_event(EV_RAID_OBJECTIVE, o.kind as i32, 0); }
        b.objective = Some(o);
    }

    pub(crate) fn reward_raid_objective(&mut self, o: RaidObjective) {
        let grain = if o.kind == Kind::Caravan {
            let before = self.stock[GR as usize];
            self.gain(ledger::EX_OTHER, GR, RESCUE_GRAIN, self.storage_cap());
            self.stock[GR as usize] - before
        } else { 0 };
        self.push_event(EV_RAID_OBJECTIVE, o.kind as i32, grain + 1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::military::Unit;

    fn village() -> World {
        let mut w = World::new(1337, 0, 0);
        w.stock = [2000; N_RES];
        assert_eq!(w.flatten(64, 6.0), 0);
        w.raid_warning_angle = 0.0;
        w.raid_warning_ticks = 1;
        w
    }

    #[test]
    fn the_announced_gate_can_be_held_or_lost_without_ending_the_fight() {
        let mut w = village();
        w.raid_warning_rf = 0.2;
        assert!(w.place(WALL, 24, 0, 0) >= 0);
        let gate = w.place(GATE, 30, 0, 0);
        assert!(gate >= 0, "gate placement returned {gate}");
        let warning = w.raid_objective();
        assert_eq!(&warning[..3], &[1.0, 30.0, 0.0]);
        w.step();
        assert_eq!(&w.raid_objective()[..3], &warning[..3]);

        let mut breached = world_restore(&w.snapshot()).unwrap();
        assert_eq!(breached.state_hash(), w.state_hash());
        breached.buildings[gate as usize].hp = 0.0;
        breached.battle_substep();
        assert!(breached.battle_active());
        assert_eq!(breached.raid_objective()[5], 1.0);

        w.battle.as_mut().unwrap().t = battle::DEPLOY_SECS + GATE_SECS - 0.25;
        w.battle_substep();
        assert!(!w.battle_active());
        assert_eq!(w.last_report()[1], 1);
        assert!(w.take_events().chunks_exact(4).any(|e| e[..3] == [EV_RAID_OBJECTIVE, 1, 1]));
    }

    #[test]
    fn soldiers_recover_a_contested_wagon_and_a_successful_escort_brings_grain() {
        let mut w = village();
        w.raid_warning_rf = 0.65;
        let [kind, x, y, ..] = w.raid_objective()[..] else { panic!("no wagon in the warning") };
        assert_eq!(kind, 2.0);
        w.step();
        let mut b = w.battle.take().unwrap();
        b.t = battle::DEPLOY_SECS + 1.0;
        b.units = vec![Unit::new(1, 0, x, y, 0.0), Unit::new(0, 0, x - 20.0, y, 0.0)];
        for _ in 0..16 { w.raid_objective_step(&mut b, 0.25); }
        assert!(b.objective.unwrap().pressure > 0.0);
        assert!(!b.objective.unwrap().held(battle::DEPLOY_SECS + CARAVAN_SECS));
        b.units[1].x = x - 7.0;
        for _ in 0..32 { w.raid_objective_step(&mut b, 0.25); }
        assert_eq!(b.objective.unwrap().pressure, 0.0);

        let mut seized = b.clone();
        seized.units[1].x = x - 20.0;
        for _ in 0..28 { w.raid_objective_step(&mut seized, 0.25); }
        assert!(seized.objective.unwrap().lost);

        w.stock[GR as usize] = 1;
        b.t = battle::DEPLOY_SECS + CARAVAN_SECS - 0.25;
        w.battle = Some(b);
        w.battle_substep();
        assert!(!w.battle_active());
        assert_eq!(w.stock[GR as usize], 1 + RESCUE_GRAIN);
    }
}
