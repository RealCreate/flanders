//! Workers the player assigns by hand: set numbers are filled first, scaled down together when the hands run short, and the rest share what is left by the usual rule.
use super::*;

fn put(w: &mut World, kind: u8, x: f32) -> usize {
    let pad_h = w.base(x, 0.0);
    w.buildings.push(Building { kind, tier: 0, x, y: 0.0, rot: 0, pad_h, progress: 0, status: 1, aux: -1, staff: 0, residents: 0, hp: battle::max_hp(kind, 0), burning: 0.0, garrison: 0, born: 0, opts: 0, fert: FERT_MAX, mode: 0, target: -1, beff: 100 });
    w.buildings.len() - 1
}
/// A village with just the town hall and these workplaces, and exactly `hands` workers.
fn village(kinds: &[u8], hands: u32) -> (World, Vec<usize>) {
    let mut w = World::new(1337, 0, 0); w.stock = [3000; N_RES]; w.cheat(3, 0, 0);
    let ids: Vec<usize> = kinds.iter().enumerate().map(|(i, &k)| put(&mut w, k, 40.0 + 10.0 * i as f32)).collect();
    w.children = 0; w.elders = 0; w.sick = 0; w.population = (hands * 10 + 9) / 7; w.staffing();
    assert_eq!((w.adults() * 7 / 10), hands, "setup: {hands} workers");
    (w, ids)
}
fn max(w: &World, i: usize) -> u32 { DEFS[w.buildings[i].kind as usize].jobs * (w.buildings[i].tier as u32 + 1) }

#[test]
fn a_set_number_is_honoured_when_the_hands_suffice() {
    let (mut w, ids) = village(&[FARM, 4, BARRACKS], 40);
    assert!(max(&w, ids[0]) >= 2);
    assert_eq!(w.set_workers(ids[0] as u32, 1), 0);
    assert_eq!(w.buildings[ids[0]].staff, 1);
    assert_eq!(w.buildings[ids[0]].beff, 100 / max(&w, ids[0]), "one of {} hands", max(&w, ids[0]));
    assert_eq!(w.set_workers(ids[0] as u32, -1), 0, "back to auto");
    assert_eq!(w.buildings[ids[0]].staff, max(&w, ids[0]));
}

#[test]
fn too_few_hands_scale_set_numbers_down_together() {
    let (mut w, ids) = village(&[FARM, 4], 3);
    let (a, b) = (max(&w, ids[0]), max(&w, ids[1]));
    w.set_workers(ids[0] as u32, a as i32); w.set_workers(ids[1] as u32, b as i32);
    let hands = w.staffing_totals()[1];
    assert!(a + b > hands, "short of hands: {a}+{b} > {hands}");
    let (sa, sb) = (w.buildings[ids[0]].staff, w.buildings[ids[1]].staff);
    assert_eq!(sa + sb, hands, "all the hands are placed");
    assert!(sa <= a && sb <= b);
    let flat = w.staffing_flat();
    assert_eq!(flat[ids[0] * 5 + 4] + flat[ids[1] * 5 + 4], (sa < a) as i32 + (sb < b) as i32, "scaled buildings are flagged");
    assert!(flat[ids[0] * 5 + 4] == 1 || flat[ids[1] * 5 + 4] == 1);
}

#[test]
fn auto_buildings_get_what_is_left_food_and_wood_first() {
    let (mut w, ids) = village(&[BARRACKS, FARM, TOWER], 6);
    let fm = max(&w, ids[1]);
    w.set_workers(ids[0] as u32, 2);
    assert_eq!(w.buildings[ids[0]].staff, 2);
    assert_eq!(w.buildings[ids[1]].staff, fm.min(4), "the farm is staffed before the tower with what is left: {} of {}", w.buildings[ids[1]].staff, fm);
    assert!(w.buildings[ids[1]].beff >= w.buildings[ids[2]].beff);
    assert!(w.staffing_totals()[6] <= w.staffing_totals()[1]);
}

#[test]
fn a_paused_building_makes_nothing_and_frees_its_hands() {
    let (mut w, ids) = village(&[FARM], 40);
    w.set_workers(ids[0] as u32, 0);
    assert_eq!((w.buildings[ids[0]].staff, w.buildings[ids[0]].beff), (0, 0));
    let before = w.buildings[ids[0]].progress;
    w.stock[GR as usize] = 0;
    for _ in 0..(DAY as usize * 2) { w.step(); w.stock[W as usize] = 3000; }
    assert_eq!(w.buildings[ids[0]].progress, before, "no work done");
    assert!(w.staffing_totals()[7] > 0, "the workers stand idle");
}

#[test]
fn the_setting_is_in_the_hash_and_bad_values_are_refused() {
    let (mut w, ids) = village(&[FARM], 40);
    let h = w.state_hash();
    assert_eq!(w.set_workers(ids[0] as u32, 1), 0);
    assert_ne!(w.state_hash(), h, "the target is hashed");
    let m = max(&w, ids[0]) as i32;
    assert_eq!(w.set_workers(ids[0] as u32, m + 1), -2);
    assert_eq!(w.set_workers(ids[0] as u32, -2), -2);
    assert_eq!(w.set_workers(9999, 1), -1);
    assert_eq!(w.set_workers(ids[0] as u32, i32::MIN), -2);
    assert_eq!(w.set_workers(0, 1), -1, "the town hall employs nobody");
    assert_eq!(w.buildings[ids[0]].target, 1, "refused values change nothing");
}

#[test]
fn the_totals_add_up() {
    let (mut w, ids) = village(&[FARM, BARRACKS], 6);
    w.children = 3; w.elders = 2; w.sick = 1; w.population = 20; w.staffing();
    w.set_workers(ids[1] as u32, 1);
    let t = w.staffing_totals();
    assert_eq!(t[0], 15); assert_eq!(t[1], (15 - 1) * 7 / 10); assert_eq!((t[2], t[3], t[4]), (3, 2, 1));
    assert_eq!(t[5], w.jobs()); assert_eq!(t[6] + t[7], t[1].max(t[6]));
    assert_eq!(t[8], w.efficiency());
}
