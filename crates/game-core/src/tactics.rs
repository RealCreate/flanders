//! Battle orders, army equipment and blows in flight. The world is the authority for all three.
use super::*;
use crate::military::{Battle, Unit};

pub const PADDED_ARMOR: u16 = 1;
pub const MAIL_ARMOR: u16 = 2;
pub const SPEAR_DRILL: u16 = 4;
pub const FIRE_ARROWS: u16 = 8;
pub const TEMPERED_BLADES: u16 = 16;
pub const CAVALRY_TACK: u16 = 32;
pub const SIEGE_SLINGS: u16 = 64;
pub const RAM_SHOES: u16 = 128;
pub const TECH_MASK: u16 = 255;

const UPGRADES: [(&str, &str, u8, u16, &[Amount]); 8] = [
    ("Padded armor", "All trained troops and siege crews take less damage.", 0, 0, &[(W, 30), (GD, 15)]),
    ("Mail and iron plating", "Further protects all trained troops and siege crews.", 2, PADDED_ARMOR, &[(IR, 35), (GD, 40)]),
    ("Braced spears", "Spearmen deal more damage to mounted enemies.", 1, 0, &[(TL, 12), (W, 35)]),
    ("Fire arrows", "Archers can ignite buildings and deal more damage on a hit.", 1, 0, &[(PL, 30), (GD, 25)]),
    ("Tempered blades", "Swordsmen deal more damage in melee.", 2, 0, &[(IR, 25), (CH, 18)]),
    ("Cavalry tack", "Knights move faster in battle and deliver a stronger charge.", 2, 0, &[(IR, 14), (GD, 35)]),
    ("Reinforced catapult slings", "Catapults fire farther and recover faster between shots.", 3, 0, &[(PL, 45), (TL, 20)]),
    ("Iron ram shoes", "Battering rams deal more damage to buildings.", 2, 0, &[(IR, 25), (PL, 30)]),
];

#[wasm_bindgen]
pub fn military_upgrades() -> String {
    let items = UPGRADES.iter().enumerate().map(|(i, (name, desc, tier, prereq, cost))| {
        let cost = cost.iter().map(|(r, n)| format!("[{r},{n}]")).collect::<Vec<_>>().join(",");
        format!("{{\"id\":{i},\"name\":\"{name}\",\"desc\":\"{desc}\",\"tier\":{tier},\"prereq\":{prereq},\"cost\":[{cost}]}}")
    }).collect::<Vec<_>>().join(",");
    format!("[{items}]")
}

pub const HOLD: u8 = 1;
pub const FOCUS: u8 = 2;
pub const FALL_BACK: u8 = 3;
pub const GROUPS: usize = 4;

#[derive(Clone, Copy, Default, serde::Serialize, serde::Deserialize)]
pub(crate) struct Order { pub mode: u8, pub x: f32, pub y: f32 }

#[derive(Clone, Copy, serde::Serialize, serde::Deserialize)]
pub(crate) struct Strike {
    pub attacker: usize, pub target: usize, pub at: f32, pub dmg: f32,
    pub x: f32, pub y: f32, pub reach: f32, pub kind: u8, pub splash: f32,
}

#[derive(Clone, Default, serde::Serialize, serde::Deserialize)]
pub(crate) struct Tactics {
    pub tech: [u16; 2],
    pub orders: [[Order; GROUPS]; 2],
    pub strikes: Vec<Strike>,
}

impl Tactics {
    pub fn hash(&self, mix: &mut dyn FnMut(u64)) {
        for &tech in &self.tech { mix(tech as u64); }
        for o in self.orders.iter().flatten() { mix(o.mode as u64); mix(o.x.to_bits() as u64); mix(o.y.to_bits() as u64); }
        for s in &self.strikes {
            mix(s.attacker as u64); mix(s.target as u64); mix(s.kind as u64);
            for v in [s.at, s.dmg, s.x, s.y, s.reach, s.splash] { mix(v.to_bits() as u64); }
        }
    }

    pub fn tech_for(&self, u: &Unit) -> u16 {
        if u.boss != 0 || u.kind as usize >= NK { 0 } else { self.tech[u.side as usize] }
    }

    pub fn order_for(&self, u: &Unit, tower_guard: bool) -> Order {
        if tower_guard || (u.held && u.pelev > 0.0) || u.boss != 0 || (u.side == 0 && !u.from_army && u.det == 0) {
            return Order::default();
        }
        let group = match u.kind { 1 => 1, 3 => 2, 4 | 5 => 3, _ => 0 };
        self.orders[u.side as usize][group]
    }
}

/// Reward attacks from behind the defender's facing. Cavalry get the larger bonus.
pub(crate) fn rear_attack(u: &Unit, target: &Unit) -> f32 {
    let (x, y) = (u.x - target.x, u.y - target.y);
    let distance = x.hypot(y);
    if distance > 0.05 && x * target.face.cos() + y * target.face.sin() < -0.55 * distance {
        match u.kind { 3 => 1.45, 1 => 1.15, _ => 1.25 }
    } else { 1.0 }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn attacks_from_behind_and_armor_change_damage_when_a_blow_lands() {
        let mut w = World::new(1337, 0, 0);
        assert!(w.begin_battle([1, 0, 0, 0, 0, 0], 0.0, 42));
        let mut b = w.battle.take().unwrap();
        let target = Unit::new(0, 2, 20.0, 20.0, 0.0);
        let mut rider = Unit::new(1, 3, 22.0, 20.0, std::f32::consts::PI);
        assert_eq!(rear_attack(&rider, &target), 1.0);
        rider.x = 18.0;
        assert_eq!(rear_attack(&rider, &target), 1.45);
        b.units = vec![target, rider];
        b.tactics.tech[0] = PADDED_ARMOR | MAIL_ARMOR;
        let hp = b.units[0].hp;
        b.tactics.strikes.push(Strike { attacker: 1, target: 0, at: 1.0, dmg: 20.0, x: 20.0, y: 20.0, reach: 3.0, kind: 0, splash: 0.0 });
        b.units.insert(1, Unit::new(0, 0, 22.0, 20.0, 0.0));
        b.tactics.strikes[0].attacker = 2;
        b.tactics.strikes.push(Strike { attacker: 2, target: 1, ..b.tactics.strikes[0] });
        b.remove_unit(1);
        assert_eq!(b.tactics.strikes.len(), 1);
        assert_eq!(b.tactics.strikes[0].attacker, 1);
        World::battle_strikes(&mut b);
        assert_eq!(b.units[0].hp, hp);
        b.t = 1.0;
        World::battle_strikes(&mut b);
        assert!((b.units[0].hp - (hp - 9.2)).abs() < 0.01);
        assert!(b.tactics.strikes.is_empty());
    }

    #[test]
    fn barracks_research_and_side_specific_orders_survive_a_checkpoint() {
        let mut w = World::new(1337, 0, 0);
        w.stock = [30_000; N_RES];
        assert_eq!(w.military_research(0), -2);
        let barracks = w.place(BARRACKS, -20, 16, 0);
        assert!(barracks >= 0);
        w.buildings[barracks as usize].tier = 2;
        assert_eq!(w.military_research(1), -3);
        assert_eq!(w.military_research(0), 0);
        assert_eq!(w.military_research(1), 0);
        assert_eq!(w.military_research(3), 0);
        w.army_set_bridge_shortcuts(true);
        assert!(w.start_raid_equipped(0.0, &[2, 1, 0, 1, 0, 0], 23, CAVALRY_TACK));
        assert!(!w.battle_order(22, 4, HOLD, 15.0, 17.0));
        assert!(w.battle_order(23, 2, FOCUS, 24.0, 20.0));
        assert!(w.battle_order(0, 4, FALL_BACK, 10.0, 23.0));
        let restored = world_restore(&w.snapshot()).unwrap();
        assert_eq!(restored.state_hash(), w.state_hash());
        assert_eq!(restored.military_tech(), PADDED_ARMOR | MAIL_ARMOR | FIRE_ARROWS);
        assert!(restored.army_bridge_shortcuts());
        let tactics = restored.battle.unwrap().tactics;
        assert_eq!(tactics.tech[1], CAVALRY_TACK);
        assert_eq!(tactics.orders[1][2].mode, FOCUS);
        assert_eq!(tactics.orders[0][0].mode, FALL_BACK);
    }
}

#[wasm_bindgen]
impl World {
    pub fn military_tech(&self) -> u16 { self.military_tech }

    /// 0 success, -1 invalid or already unlocked, -2 barracks tier, -3 prerequisite, -6 resources.
    pub fn military_research(&mut self, id: u8) -> i32 {
        let Some(&(_, _, tier, prereq, cost)) = UPGRADES.get(id as usize) else { return -1 };
        let bit = 1 << id;
        if self.military_tech & bit != 0 { return -1; }
        if !self.buildings.iter().any(|b| b.kind == BARRACKS && b.hp > 0.0 && b.tier >= tier) { return -2; }
        if self.military_tech & prereq != prereq { return -3; }
        if !self.can_afford(cost) { return -6; }
        self.pay(cost);
        self.military_tech |= bit;
        if let Some(b) = &mut self.battle { b.tactics.tech[0] = self.military_tech; }
        0
    }

    pub fn army_bridge_shortcuts(&self) -> bool { self.auto_bridge }
    pub fn army_set_bridge_shortcuts(&mut self, on: bool) { self.auto_bridge = on; }

    /// Give a regiment of the local army an order. A nonzero tag controls the matching player attack.
    pub fn battle_order(&mut self, tag: i32, group: u8, mode: u8, x: f32, y: f32) -> bool {
        if mode > FALL_BACK || (group as usize) > GROUPS || (mode != 0 && !Self::infrastructure_in_bounds(x, y)) { return false; }
        let Some(b) = self.battle.as_mut() else { return false };
        if b.bought || (tag != 0 && (tag != b.tag || b.lair >= 0)) { return false; }
        let side = usize::from(tag != 0);
        let order = if mode == 0 { Order::default() } else { Order { mode, x: (x * 8.0).round() / 8.0, y: (y * 8.0).round() / 8.0 } };
        if group as usize == GROUPS { b.tactics.orders[side].fill(order); }
        else { b.tactics.orders[side][group as usize] = order; }
        true
    }
}

impl World {
    /// Apply committed hits at contact or after the visual arrow flight. A wind-up can be dodged or interrupted.
    pub(crate) fn battle_strikes(b: &mut Battle) {
        let mut strikes = std::mem::take(&mut b.tactics.strikes);
        strikes.retain(|s| {
            if s.at > b.t { return true; }
            let target = &b.units[s.target];
            let attacker = &b.units[s.attacker];
            if s.kind == 0 && (!attacker.alive || (attacker.x - target.x).hypot(attacker.y - target.y) > s.reach) { return false; }
            let (tx, ty, side) = (target.x, target.y, target.side);
            if target.alive && (s.kind == 0 || (tx - s.x).hypot(ty - s.y) <= s.reach) {
                Self::damage_from(b, s.target, s.dmg, s.kind == 2);
            }
            if s.splash > 0.0 {
                for j in 0..b.units.len() {
                    let u = &b.units[j];
                    if u.alive && u.side == side && j != s.target && (u.x - s.x).hypot(u.y - s.y) < s.reach {
                        Self::damage_from(b, j, s.splash, true);
                    }
                }
            }
            false
        });
        b.tactics.strikes = strikes;
    }
}
