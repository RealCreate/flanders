//! Siege towers and sapping (see siege.rs): a stone wall that infantry cannot hurt falls to a tower's stair or a shaft, and water or defenders answer them.
use super::*;
use crate::combat_tests::{east_wall, put_t, wall_hp};
use crate::siege::*;

fn stone_walls(w: &World) -> usize { w.buildings.iter().filter(|b| b.kind == WALL && b.hp > 0.0).count() }
/// Attackers east of the wall line (inside, from the attackers' side).
fn inside(w: &World) -> usize { let (hx, hy) = (w.buildings[0].x, w.buildings[0].y); w.battle.as_ref().map_or(0, |b| b.units.iter().filter(|u| u.side == 1 && u.alive && u.x < hx + 21.0 && (u.y - hy).abs() < 30.0).count()) }
/// A defender that stays far from the wall, so the battle does not end for want of one (it holds its place).
fn far_keeper(w: &mut World) {
    let (hx, hy) = (w.buildings[0].x, w.buildings[0].y);
    let b = w.battle.as_mut().unwrap();
    let mut u = Unit::new(0, 0, hx - 30.0, hy, 0.0); u.held = true; u.charge = false; u.hp = 1.0e6; u.maxhp = 1.0e6;
    b.units.push(u); b.start_side[0] += 1;
}
fn go(w: &mut World, steps: u32) { for _ in 0..steps { w.step(); w.stock[GR as usize] = 3000; if !w.battle_active() { break; } } }

#[test]
fn big_raids_bring_towers_and_saps_only_against_stone() {
    let w = east_wall(2);
    let s = w.siege_train(&[10, 0, 10, 0, 0, 0], 0.0, 0.0, 1.0, 0.0, 60.0);
    assert_eq!(s.towers.len(), 1, "twenty foot soldiers bring a tower"); assert_eq!(s.sap_allowed, 2, "and may dig two shafts");
    let s = w.siege_train(&[40, 0, 20, 0, 0, 0], 0.0, 0.0, 1.0, 0.0, 60.0);
    assert_eq!(s.towers.len() as u32, TOWER_MAX); assert_eq!(s.sap_allowed, SAP_MAX);
    let s = w.siege_train(&[6, 4, 2, 0, 0, 0], 0.0, 0.0, 1.0, 0.0, 60.0);
    assert!(s.towers.is_empty() && s.sap_allowed == 0, "a small raid has no engines");
    let timber = east_wall(0);
    let s = timber.siege_train(&[40, 0, 20, 0, 0, 0], 0.0, 0.0, 1.0, 0.0, 60.0);
    assert!(s.towers.is_empty() && s.sap_allowed == 0, "nothing to bring against timber");
}

#[test]
fn a_siege_tower_carries_soldiers_over_a_stone_wall() {
    let mut w = east_wall(2);
    assert!(w.begin_battle([10, 0, 10, 0, 0, 0], 0.0, 0));
    { let b = w.battle.as_mut().unwrap(); b.ladders = 0; b.siege.sap_allowed = 0; assert_eq!(b.siege.towers.len(), 1); }
    far_keeper(&mut w);
    let full = wall_hp(&w);
    let mut docked = false;
    for _ in 0..160 { w.step(); w.stock[GR as usize] = 3000; if let Some(b) = &w.battle { docked |= b.siege.towers.iter().any(|t| t.state == T_DOCKED); } if !w.battle_active() { break; } }
    let carried = w.battle.as_ref().map_or(0, |b| b.siege.towers[0].carried);
    eprintln!("docked {docked}, carried {carried}, inside {}", inside(&w));
    assert!(docked, "the tower reached the wall");
    assert!(inside(&w) > 0 || carried > 0, "soldiers crossed with no ladder at all");
    assert_eq!(wall_hp(&w), full, "and the wall was never hurt");
}

#[test]
fn a_moat_stops_a_siege_tower() {
    let mut w = east_wall(2);
    let (hx, hy) = (w.buildings[0].x, w.buildings[0].y);
    for k in -9..=9 { put_t(&mut w, MOAT, 0, hx + 31.0, hy + k as f32 * 3.0); }
    assert!(w.begin_battle([10, 0, 10, 0, 0, 0], 0.0, 0));
    { let b = w.battle.as_mut().unwrap(); b.ladders = 0; b.siege.sap_allowed = 0; }
    far_keeper(&mut w);
    go(&mut w, 120);
    let t = w.battle.as_ref().map(|b| b.siege.towers[0]).expect("the fight goes on");
    eprintln!("tower state {} at {:.1},{:.1} wall at {:.1}", t.state, t.x, t.y, hx + 24.0);
    assert_eq!(t.state, T_STUCK, "water holds it up");
    assert_eq!(t.carried, 0, "nobody crossed by it");
}

#[test]
fn defenders_at_its_foot_wreck_a_tower() {
    let mut w = east_wall(2);
    assert!(w.begin_battle([10, 0, 10, 0, 0, 0], 0.0, 0));
    let (tx, ty) = { let b = w.battle.as_mut().unwrap(); b.siege.sap_allowed = 0; let t = b.siege.towers[0]; (t.x, t.y) };
    far_keeper(&mut w);
    { let b = w.battle.as_mut().unwrap(); for k in 0..10 { let mut u = Unit::new(0, 2, tx - 1.5, ty + k as f32 * 0.3 - 1.5, 0.0); u.held = true; u.hx = u.x; u.hy = u.y; b.units.push(u); b.start_side[0] += 1; } }
    go(&mut w, 4 * 40);
    let b = w.battle.as_ref().expect("still fighting");
    eprintln!("tower hp {:.0} state {}", b.siege.towers[0].hp, b.siege.towers[0].state);
    assert!(b.siege.towers[0].hp < TOWER_HP, "swords hurt the timber");
}

#[test]
fn infantry_sap_a_stone_wall_until_it_falls() {
    let mut w = east_wall(2);
    assert!(w.begin_battle([10, 0, 0, 0, 0, 0], 0.0, 0));
    { let b = w.battle.as_mut().unwrap(); b.ladders = 0; b.siege.towers.clear(); assert_eq!(b.siege.sap_allowed, 1); }
    far_keeper(&mut w);
    let before = stone_walls(&w);
    let mut fell = false;
    for _ in 0..170 { w.step(); w.stock[GR as usize] = 3000; if let Some(b) = &w.battle { fell |= b.siege.saps.iter().any(|s| s.state == S_FALLEN); } if !w.battle_active() { break; } }
    eprintln!("walls {} -> {}, fell {fell}", before, stone_walls(&w));
    assert!(fell, "the shaft was finished");
    assert!(stone_walls(&w) < before, "and the section came down");
}

#[test]
fn defenders_sallying_fill_a_shaft_in_and_a_moat_floods_it() {
    let mut w = east_wall(2);
    assert!(w.begin_battle([10, 0, 0, 0, 0, 0], 0.0, 0));
    { let b = w.battle.as_mut().unwrap(); b.ladders = 0; b.siege.towers.clear(); }
    far_keeper(&mut w);
    let (hx, hy) = (w.buildings[0].x, w.buildings[0].y);
    let before = stone_walls(&w);
    // put a sap under the middle of the wall by hand, and a few defenders on the ground by it
    { let b = w.battle.as_mut().unwrap(); b.siege.saps.push(Sap { x: hx + 24.0, y: hy, face: 0.0, secs: SAP_BASE, done: 10.0, state: S_DIG }); for k in 0..4 { let mut u = Unit::new(0, 0, hx + 22.0, hy + k as f32, 0.0); u.held = true; u.hx = u.x; u.hy = u.y; u.hp = 1.0e5; u.maxhp = 1.0e5; b.units.push(u); b.start_side[0] += 1; } }
    let mut filled = false;
    for _ in 0..4 * 20 { w.step(); w.stock[GR as usize] = 3000; if let Some(b) = &w.battle { filled |= b.siege.saps.iter().any(|s| s.state == S_FILLED); } assert!(!w.battle.as_ref().map_or(false, |b| b.siege.saps.iter().any(|s| s.state == S_FALLEN)), "the wall must not fall"); if !w.battle_active() { break; } }
    assert!(filled, "the shaft was filled in");
    assert!(stone_walls(&w) == before, "the wall still stands");
    // a moat beside the wall: no shaft is begun
    let mut w = east_wall(2);
    let (hx, hy) = (w.buildings[0].x, w.buildings[0].y);
    for k in -9..=9 { put_t(&mut w, MOAT, 0, hx + 29.0, hy + k as f32 * 3.0); }
    assert!(w.begin_battle([10, 0, 0, 0, 0, 0], 0.0, 0));
    let k = w.buildings.iter().position(|b| b.kind == WALL).unwrap();
    let mut b = w.battle.take().unwrap();
    assert!(!w.try_sap(&mut b, k, 0.0), "water floods the shaft");
    assert!(b.siege.saps.is_empty());
}

#[test]
fn siege_works_are_part_of_the_state_hash_and_the_snapshot() {
    let mut a = east_wall(2);
    assert!(a.begin_battle([10, 0, 10, 0, 0, 0], 0.0, 0));
    a.battle.as_mut().unwrap().ladders = 0;
    far_keeper(&mut a);
    go(&mut a, 4 * 30);
    assert!(a.battle_active());
    let mut b = world_restore(&a.snapshot()).expect("restores mid siege");
    assert_eq!(a.state_hash(), b.state_hash());
    assert_eq!(a.battle_siege_flat(), b.battle_siege_flat());
    assert!(a.battle_siege_flat().len() >= 7, "there is a tower to draw");
    for _ in 0..4 * 40 { a.step(); b.step(); a.stock[GR as usize] = 3000; b.stock[GR as usize] = 3000; }
    assert_eq!(a.state_hash(), b.state_hash(), "played on, they agree");
    let h = a.state_hash();
    if let Some(bt) = a.battle.as_mut() { bt.siege.towers[0].hp -= 1.0; assert_ne!(h, a.state_hash(), "a tower's hull is in the hash"); }
}
