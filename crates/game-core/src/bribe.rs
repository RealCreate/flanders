//! Buying off raiders: while a raid of bandits (or the Warlord's great raid) is still forming up or marching on the village and has not struck a blow, the lord may pay them to turn back.
//!
//! The rules, in one place (every peer runs them identically: they depend only on the state of the world and the tick of the `bribe` command):
//! * Only a raid of bandits (tag 0) at the village, never a lair and never another player's army, and only until the first blow (`BRIBE_SECS` after the line formed up, and while no raider is hurt, nobody has died and nothing is pillaged).
//! * The price is what the raiders on the field are worth (`BRIBE_VALUE` each) times a markup, plus for a boss its premium (scaled to how strong this one is); a boss with no premium (the Ogre) cannot be bought.
//!   It rises with the greed the last payments fed (`greed`) and is never below `BRIBE_MIN`.
//! * Paid, the raiders turn and walk off the way they came; nobody fights, nothing is looted, the battle ends with the report's "bought off" flag, and the lord gains no glory (no experience, no boss prize).
//! * Greed: every payment adds `BRIBE_GREED_STEP`. Raids come sooner (`raid_one_in`) and stronger (`bandit_force`) the greedier they are, and the price goes up with it. It fades by an eighth every day.
use super::*;

/// Seconds after the raiders form up during which they can still be bought off.
pub const BRIBE_SECS: f32 = 40.0;
/// What one raider of each kind (spearman, archer, swordsman, knight, catapult, ram) is worth to the bandits, in coins.
pub const BRIBE_VALUE: [i32; NK] = [14, 16, 40, 80, 120, 90];
/// Percent of the raiders' worth the bandits ask for a raid, and for a raid led by a boss.
pub const BRIBE_MARKUP_PCT: i32 = 80;
pub const BRIBE_BOSS_MARKUP_PCT: i32 = 120;
/// What a boss asks on top (at full strength: scaled to this one's hit points); 0 refuses any price. Warlord, Ogre.
pub const BRIBE_BOSS_PREMIUM: [i32; N_BOSSES] = [300, 0, 0, 400];
/// The least that is ever asked.
pub const BRIBE_MIN: i32 = 40;
/// Greed a payment adds, and the most it can reach. It shows in the price (+1% per 2 points), in the raiders' strength (+1% per 4 points) and in the raids' chance (`raid_one_in` shrinks by 100 / (100 + greed)).
pub const BRIBE_GREED_STEP: u32 = 60;
pub const BRIBE_GREED_MAX: u32 = 300;
/// Seconds the raiders take to walk off the field.
pub const BRIBE_LEAVE_SECS: f32 = 9.0;

#[wasm_bindgen]
impl World {
    /// What the raiders ask to turn back right now, or -1 when they cannot be bought off (no raid, a lair, another player's army, a boss that refuses, a blow already struck, too late).
    pub fn bribe_price(&self) -> i32 {
        let Some(b) = &self.battle else { return -1 };
        if b.tag != 0 || b.lair >= 0 || b.bought || b.t >= BRIBE_SECS || b.atk_dead + b.def_dead + b.militia_dead + b.bld_lost > 0 || b.pillage > 0.0 { return -1; }
        if b.units.iter().any(|u| u.side == 1 && u.alive && u.hp < u.maxhp - 0.001) { return -1; }
        let mut value = 0i32;
        for u in b.units.iter().filter(|u| u.side == 1 && u.alive && u.boss == 0 && (u.kind as usize) < NK) { value += BRIBE_VALUE[u.kind as usize]; }
        let (mut pct, mut premium) = (BRIBE_MARKUP_PCT, 0);
        if b.boss > 0 {
            let Some(base) = BRIBE_BOSS_PREMIUM.get((b.boss - 1) as usize).copied().filter(|&p| p > 0) else { return -1 };
            let ratio = b.units.iter().find(|u| u.boss > 0).map_or(1.0, |u| u.maxhp / BOSSES[(b.boss - 1) as usize].hp);
            premium = (base as f32 * ratio).round() as i32; pct = BRIBE_BOSS_MARKUP_PCT;
        }
        let ask = value.saturating_mul(pct) / 100 + premium;
        (ask.saturating_mul(100 + (self.greed / 2) as i32) / 100).max(BRIBE_MIN)
    }

    /// Pay the raiders to go. 0 ok, -1 they cannot be bought off, -6 the stores hold too little gold.
    pub fn bribe(&mut self) -> i32 {
        let price = self.bribe_price();
        if price < 0 { return -1; }
        if self.stock[GD as usize] < price { return -6; }
        self.stock[GD as usize] -= price;
        self.greed = (self.greed + BRIBE_GREED_STEP).min(BRIBE_GREED_MAX);
        let boss = if let Some(b) = self.battle.as_mut() { b.bought = true; b.bought_t = 0.0; b.boss } else { 0 };
        self.push_event(EV_BRIBED, price, boss as i32);
        0
    }

    /// How greedy the bandits have become (0 none): the price, the next raids' chance and strength rise with it.
    pub fn bribe_greed(&self) -> u32 { self.greed }

}

impl World {
    /// The chance of a raid on a tick is one in this: it shrinks as the bandits get greedy.
    pub(crate) fn raid_one_in(&self) -> u32 { ((RAID_ONE_IN as u64 * 100 / (100 + self.greed as u64)) as u32).max(2) }

    /// The greed fades: an eighth of it, rounded up, every day.
    pub(crate) fn greed_step(&mut self) { if self.greed > 0 && self.tick % DAY == 0 { self.greed -= (self.greed + 7) / 8; } }

    /// One sub-step of paid-off raiders: they turn and walk away from the village, the defenders hold. Gone from the field after `BRIBE_LEAVE_SECS`.
    pub(crate) fn bribed_substep(b: &mut Battle, dt: f32) {
        b.bought_t += dt;
        let leave = b.bought_t >= BRIBE_LEAVE_SECS;
        let (dx, dy) = (b.angle.cos(), b.angle.sin());
        let (mut gone, mut gone_kinds) = (0u32, [0u32; NK]);
        for u in b.units.iter_mut().filter(|u| u.side == 1 && u.alive) {
            let sp = unit_stat(u).speed.max(1.0) * 1.3 * dt;
            u.x += dx * sp; u.y += dy * sp; u.face = b.angle; u.climb = 0.0; u.spot = -1;
            if leave { u.alive = false; u.escaped = true; gone += 1; if (u.kind as usize) < NK && u.boss == 0 { gone_kinds[u.kind as usize] += 1; } }
        }
        b.fled[1] += gone; for k in 0..NK { b.fled_kinds[k] += gone_kinds[k]; }
    }
}
