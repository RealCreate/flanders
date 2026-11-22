//! The second tier of design options (bits 4-7, unlocked by the building's tier) and the village's roof palette (bits 25-27 of the style).
use super::*;
use crate::catalog::{options, OPT_BITS, TIER2_BIT};

fn village() -> World { let mut w = World::new(1337, 0, 0); w.stock = [30000; N_RES]; w.cheat(3, 0, 0); w }
fn built(w: &mut World, kind: u8, x: i32, y: i32, tier: u8) -> usize {
    assert!(w.place(kind, x, y, 0) >= 0, "placing {kind}");
    let i = w.buildings.iter().rposition(|b| b.kind == kind).unwrap(); w.buildings[i].tier = tier; i
}

#[test]
fn the_most_used_buildings_have_four_more_options_that_need_a_better_tier() {
    for kind in [HOUSE, FARM, MARKET, CHAPEL, BARRACKS] {
        let o = options(kind);
        assert_eq!(o.len(), OPT_BITS, "kind {kind}");
        assert!(o[..TIER2_BIT as usize].iter().all(|x| x.2 <= 1), "kind {kind}: the first four stay open early");
        assert!(o[TIER2_BIT as usize..].iter().all(|x| x.2 >= 2), "kind {kind}: the second tier needs tier 2 or more");
        let mut names: Vec<&str> = o.iter().map(|x| x.0).collect(); names.sort(); names.dedup(); assert_eq!(names.len(), OPT_BITS, "kind {kind}: names are distinct");
    }
    assert_eq!(options(WELL).len(), 2, "the other buildings are untouched");
}

#[test]
fn a_second_tier_option_is_refused_until_the_building_is_upgraded() {
    let mut w = village(); let i = built(&mut w, HOUSE, 12, 4, 1);
    assert_eq!(w.set_option(i as u32, 4, true), -10, "a tier 1 house cannot take a tier 2 option");
    w.buildings[i].tier = 2;
    let before = w.stock;
    assert_eq!(w.set_option(i as u32, 4, true), 0);
    assert_ne!(w.stock, before, "it is paid for"); assert_eq!(w.buildings[i].opts, 1 << 4);
    let c = built(&mut w, CHAPEL, 30, 10, 2);
    assert_eq!(w.set_option(c as u32, 7, true), -10, "the relic shrine needs tier 3");
    assert_eq!(w.set_option(i as u32, 4, false), 0); assert_eq!(w.buildings[i].opts, 0);
    assert_eq!(w.set_option(i as u32, 8, true), -1, "there are only eight options");
}

#[test]
fn second_tier_options_do_their_small_jobs() {
    let mut w = village(); let (h, c, b) = (built(&mut w, HOUSE, 12, 4, 2), built(&mut w, CHAPEL, 30, 10, 2), built(&mut w, BARRACKS, -24, 6, 2));
    let (cap, happy) = (w.capacity(), w.happiness());
    w.buildings[h].opts = 1 << 4; assert_eq!(w.capacity(), cap + 1, "loft room");
    w.buildings[h].opts = (1 << 5) | (1 << 7); let p = w.perks(); assert_eq!((p.doves, p.woodsheds), (1, 1), "kitchen garden and cellar");
    w.buildings[h].opts = 1 << 6; assert_eq!(w.happiness(), happy + 1, "carved gable");
    w.buildings[h].opts = 0;
    w.buildings[c].opts = 1 << 6; assert_eq!(w.capacity(), cap + 2, "almshouse");
    w.buildings[c].opts = (1 << 4) | (1 << 5) | (1 << 7); assert_eq!(w.happiness(), happy + 4, "rose window, cloister and relic shrine");
    w.buildings[c].opts = 0;
    w.buildings[b].opts = 1 << 4; assert_eq!(w.perks().train_pct, 15);
    w.buildings[b].opts = (1 << 4) | (1 << 7); assert_eq!(w.perks().train_pct, 40);
    w.buildings[b].opts = (1 << 5) | (1 << 6); let p = w.perks(); assert_eq!((p.banner_pct, p.militia), (2, 2), "forge shed and watch post");
    assert_eq!(tier2_speed(FARM, 0xf0), 20); assert_eq!(tier2_speed(MARKET, 0xf0), 15); assert_eq!(tier2_speed(HOUSE, 0xf0), 0);
    let m = built(&mut w, MARKET, 40, -8, 2); let happy = w.happiness(); w.buildings[m].opts = 1 << 5; assert_eq!(w.happiness(), happy + 1, "striped canopies");
}

#[test]
fn a_windmill_makes_a_field_work_faster() {
    let make = |opts: u16| { let mut w = village(); for (k, x, y) in [(HOUSE, 12, 4), (HOUSE, 18, 8)] { w.place(k, x, y, 0); } let f = built(&mut w, FARM, -14, 6, 2); w.buildings[f].opts = opts; w.buildings[f].staff = 1; w.buildings[f].status = 1; (w, f) };
    let (mut a, fa) = make(0); let (mut b, fb) = make(1 << 4);
    for _ in 0..120 { a.step(); b.step(); }
    let (pa, pb) = (a.buildings[fa].progress, b.buildings[fb].progress);
    let cycles = |w: &World| w.stock[GR as usize];
    assert!(pb as i64 + cycles(&b) as i64 * 1000 >= pa as i64 + cycles(&a) as i64 * 1000, "the windmill never slows the field ({pb} vs {pa})");
}

#[test]
fn the_roof_palette_rides_in_the_style_and_is_part_of_the_state() {
    let flag = (1 << 24) | 2 | (6 << 4) | (9 << 8) | (2 << 12) | (2 << 16);
    let mut w = village(); assert_eq!(w.roof(), 0);
    for r in 0..8u32 { assert!(w.set_style(flag | (r << 25)) && w.roof() == r as u8 && w.style() & 0xff_ffff == flag & 0xff_ffff); }
    assert!(!w.set_style(1 << 28) && !w.set_style((1 << 25) | 5), "a roof alone is not a flag, and nothing above bit 27 is accepted"); assert_eq!(w.roof(), 7);
    let (mut a, mut b) = (village(), village()); a.set_style(flag); b.set_style(flag | (3 << 25));
    assert_ne!(a.state_hash(), b.state_hash(), "every peer must agree on the roof");
    let mut c = village(); c.set_style(flag | (3 << 25)); assert_eq!(b.state_hash(), c.state_hash(), "same style, same hash");
}

#[test]
fn second_tier_options_are_in_the_state_hash_and_replay_the_same() {
    let run = |opts: u16| { let mut w = village(); let i = built(&mut w, FARM, -14, 6, 2); w.buildings[i].opts = opts; for _ in 0..50 { w.step(); } w.state_hash() };
    assert_eq!(run(1 << 6), run(1 << 6)); assert_ne!(run(1 << 6), run(1 << 7));
}
