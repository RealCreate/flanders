//! How far buildings reach: the one place the numbers live. The fire and shooting code read these constants and the interface reads them back through
//! `effect_radii` (see lib.rs), so what the player sees drawn on the ground is what the rules use.
use crate::catalog::*;

/// A well this close to a burning building supplies the bucket line at full strength.
pub const WELL_FULL_RANGE: f32 = 18.0;
/// ... this close, at half strength.
pub const WELL_HALF_RANGE: f32 = 36.0;
/// Each well this close to a building halves the chance a spark takes (two count).
pub const WELL_SPARK_RANGE: f32 = 16.0;
/// A staffed builders' yard this close sends carpenters to a fire.
pub const YARD_FIRE_RANGE: f32 = 45.0;
/// How far an archer shoots (a tower's garrison stands in the tower, so this is the tower's reach too).
pub const ARCHER_RANGE: f32 = 22.0;
/// Archers on a wall walkway shoot this many times as far.
pub const WALL_HEIGHT_RANGE: f32 = 1.25;

/// Effect codes of `effect_radii`.
pub const FX_FIRE_FULL: u8 = 0;
pub const FX_FIRE_HALF: u8 = 1;
pub const FX_SPARK_GUARD: u8 = 2;
pub const FX_YARD_HELP: u8 = 3;
pub const FX_SHOOT: u8 = 4;
/// Archers cannot shoot closer than this (the code has no such limit yet; the effect code is kept for the interface).
pub const FX_SHOOT_MIN: u8 = 5;

/// (radius, effect code, strength in percent) for a building of this kind and tier.
pub fn effect_radii(kind: u8, tier: u8) -> Vec<(f32, u8, u32)> {
    match kind {
        WELL => vec![(WELL_FULL_RANGE, FX_FIRE_FULL, 100), (WELL_HALF_RANGE, FX_FIRE_HALF, 50), (WELL_SPARK_RANGE, FX_SPARK_GUARD, 50)],
        BUILDERS => vec![(YARD_FIRE_RANGE, FX_YARD_HELP, 100)],
        TOWER | KEEP => vec![(ARCHER_RANGE, FX_SHOOT, 100)],
        WALL | GATE if tier >= 1 => vec![(ARCHER_RANGE * WALL_HEIGHT_RANGE, FX_SHOOT, 100)],
        _ => vec![],
    }
}

pub fn effect_radii_json(kind: u8, tier: u8) -> String {
    let items: Vec<String> = effect_radii(kind, tier).iter().map(|(r, fx, pct)| format!("{{\"r\":{},\"fx\":{},\"pct\":{}}}", r, fx, pct)).collect();
    format!("[{}]", items.join(","))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{battle, military, Building, World, FERT_MAX};

    fn put_t(w: &mut World, kind: u8, x: f32, y: f32) {
        let pad_h = w.base(x, y);
        w.buildings.push(Building { kind, tier: 0, x, y, rot: 0, pad_h, progress: 0, status: 4, aux: -1, staff: 0, residents: 0, hp: battle::max_hp(kind, 0), burning: 0.0, garrison: 0, born: 0, opts: 0, fert: FERT_MAX, mode: 0, target: -1, beff: 100 });
    }
    /// Hit points a burning house loses in one fire step with `kind` standing `dist` away from it.
    fn loss(kind: u8, dist: f32, staff: u32) -> f32 {
        let mut w = World::new(1337, 0, 0); w.population = 40;
        put_t(&mut w, HOUSE, 200.0, 200.0);
        put_t(&mut w, kind, 200.0 + dist, 200.0);
        let n = w.buildings.len() - 1; w.buildings[n].staff = staff;
        let h = n - 1; w.buildings[h].burning = 30.0; let hp0 = w.buildings[h].hp;
        w.fire_substep();
        hp0 - w.buildings[h].hp
    }

    #[test]
    fn the_radii_the_interface_gets_are_the_ones_fire_fighting_uses() {
        let find = |kind, fx| effect_radii(kind, 0).iter().find(|e| e.1 == fx).map(|e| e.0).unwrap();
        let (full, half, yard) = (find(WELL, FX_FIRE_FULL), find(WELL, FX_FIRE_HALF), find(BUILDERS, FX_YARD_HELP));
        let e = 0.5;
        assert!(loss(WELL, full - e, 0) < loss(WELL, full + e, 0), "inside the full range helps more than just outside it");
        assert!(loss(WELL, half - e, 0) < loss(WELL, half + e, 0), "inside the half range helps, outside it does not");
        assert_eq!(loss(WELL, half + e, 0), loss(WELL, 300.0, 0), "beyond the half range nothing helps");
        assert!(loss(BUILDERS, yard - e, 3) < loss(BUILDERS, yard + e, 3), "a staffed yard helps inside its range only");
    }

    #[test]
    fn archers_and_towers_share_one_range() {
        assert_eq!(military::UNITS[1].range, ARCHER_RANGE);
        assert_eq!(effect_radii(TOWER, 0)[0].0, military::UNITS[1].range);
        assert_eq!(effect_radii(KEEP, 2)[0].0, military::UNITS[1].range);
        assert_eq!(effect_radii(WALL, 2)[0].0, military::UNITS[1].range * WALL_HEIGHT_RANGE);
        assert!(effect_radii(WALL, 0).is_empty() && effect_radii(HOUSE, 0).is_empty());
        assert!(effect_radii_json(WELL, 0).starts_with("[{\"r\":18,\"fx\":0,\"pct\":100}"));
    }
}
