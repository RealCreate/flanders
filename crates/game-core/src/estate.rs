use super::*;

pub const RESERVE_MAX: i32 = 30_000;
pub(crate) const WINTER_PASTURE_FEED: &[(u8, i32)] = &[(GR, 2)];
pub(crate) const STATUS_RESERVE: u8 = 8;

/// Stored separately from the earlier snapshot layout.
#[derive(Clone, Copy, Default, serde::Deserialize, serde::Serialize)]
pub(crate) struct Estate {
    pub(crate) active: bool,
    pub(crate) grain: i32,
    pub(crate) wood: i32,
}

impl Estate {
    pub(crate) fn valid(self) -> bool {
        (0..=RESERVE_MAX).contains(&self.grain) && (0..=RESERVE_MAX).contains(&self.wood)
            && (self.active || (self.grain == 0 && self.wood == 0))
    }
}

impl World {
    pub(crate) fn reserve_for(&self, resource: u8) -> i32 {
        match resource {
            GR => self.estate.grain,
            W => self.estate.wood,
            _ => 0,
        }
    }

    pub(crate) fn can_spend_surplus(&self, resource: u8, amount: i32) -> bool {
        self.stock[resource as usize].saturating_sub(amount) >= self.reserve_for(resource)
    }
}

#[wasm_bindgen]
impl World {
    /// Earlier signed histories run on the previous ration rules up to the first reserve command.
    pub fn new_legacy(seed: u64, ox: i32, oy: i32) -> World {
        let mut world = Self::new(seed, ox, oy);
        world.estate = Estate::default();
        world
    }

    pub fn estate_active(&self) -> bool { self.estate.active }

    /// Minimum grain and wood to retain when automatic workplaces spend stock. Zero disables a limit.
    pub fn reserves(&self) -> Vec<i32> { vec![self.estate.grain, self.estate.wood] }

    /// Set both limits together. The first command also moves a legacy history to the current ration rules.
    pub fn set_reserves(&mut self, grain: i32, wood: i32) -> bool {
        let next = Estate { active: true, grain, wood };
        if !next.valid() { return false; }
        if !self.estate.active { self.meal_credit = self.meal_credit.saturating_mul(5); }
        self.estate = next;
        true
    }

    pub fn reserve_max() -> i32 { RESERVE_MAX }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_new_mouth_adds_one_tenth_of_a_meal_per_tick() {
        let mut w = World::new(1337, 0, 0);
        for heads in [2, 10, 13, 14, 15, 18, 24, 25] {
            w.population = heads;
            assert_eq!(w.appetite().1, 2 * heads as i32);
        }
        w.population = 12;
        w.away[0] = 3;
        assert_eq!(w.appetite(), (3, 30));
    }

    #[test]
    fn an_old_checkpoint_keeps_its_rations_until_the_recorded_change() {
        let mut old = World::new_legacy(1337, 0, 0);
        old.ledger = ledger::Ledger::new(PASTURE as usize);
        old.population = 15;
        old.meal_credit = 2;
        let mut bytes = OBJECTIVE_SNAP_MAGIC.to_vec();
        let tactical = (&old, Vec::<march::SavedMarch>::new(), 0u16, false, None::<tactics::Tactics>);
        bytes.extend(bincode::serialize(&(tactical, None::<raid_objective::RaidObjective>)).unwrap());
        let mut resumed = world_restore(&bytes).unwrap();
        assert_eq!(resumed.state_hash(), old.state_hash());
        assert_eq!(resumed.appetite().1, 8);
        assert!(!resumed.estate_active());
        assert!(!resumed.set_reserves(-1, 0));
        assert!(resumed.set_reserves(25, 30));
        assert_eq!(resumed.appetite().1, 30);
        assert_eq!(resumed.meal_credit, 10);
        let restored = world_restore(&resumed.snapshot()).unwrap();
        assert_eq!(restored.state_hash(), resumed.state_hash());
        assert_eq!(restored.reserves(), [25, 30]);
    }

    #[test]
    fn workshops_save_grain_and_wood_for_meals_and_the_hearth() {
        let mut w = World::new(1337, 0, 0);
        w.stock = [500; N_RES];
        w.flatten(40, 5.0);
        let bakery = w.place(BAKERY, 14, 6, 0) as usize;
        let mill = w.place(5, -14, 6, 0) as usize;
        assert!(bakery < w.buildings.len() && mill < w.buildings.len());
        w.stock = [0; N_RES];
        w.stock[GR as usize] = 500;
        w.stock[W as usize] = 80;
        w.set_reserves(500, 80);
        for _ in 0..12 { w.step(); }
        assert!(w.stock[GR as usize] < 500);
        assert_eq!(w.stock[W as usize], 80);
        assert_eq!(w.stock[BD as usize], 0);
        assert_eq!(w.stock[PL as usize], 0);
        assert_eq!(w.buildings[bakery].status, STATUS_RESERVE);
        assert_eq!(w.buildings[mill].status, STATUS_RESERVE);
        w.tick = DAY * 30;
        w.household_step();
        assert!(w.stock[W as usize] < 80 && w.warm);
    }

    #[test]
    fn a_staffed_pasture_grazes_and_needs_surplus_feed_in_winter() {
        let mut w = World::new_legacy(1337, 0, 0);
        w.stock = [500; N_RES];
        w.flatten(40, 5.0);
        assert_eq!(w.can_place(PASTURE, 15, 0), -1);
        w.set_reserves(100, 0);
        let pasture = w.place(PASTURE, 15, 0, 0) as usize;
        assert!(pasture < w.buildings.len());
        w.stock[ME as usize] = 0;
        for _ in 0..15 { w.step(); }
        assert!(w.stock[ME as usize] > 0);
        assert!(w.buildings[pasture].staff > 0);
        w.stock[GR as usize] = 100;
        w.tick = DAY * 30;
        for _ in 0..15 { w.step(); }
        assert_eq!(w.buildings[pasture].status, STATUS_RESERVE);
        w.set_reserves(0, 0);
        w.step();
        assert_eq!(w.buildings[pasture].status, 0);
        assert!(w.stock[GR as usize] < 100);
    }
}
