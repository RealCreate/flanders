//! Buying off raiders (see bribe.rs): the price, the window, the outcome and the greed that follows.
use super::*;
use crate::bribe::*;

fn village() -> World {
    let mut w = World::new(1337, 0, 0);
    w.stock = [3000; N_RES]; w.population = 40; w.tick = 20 * DAY;
    for (k, x, y) in [(HOUSE, 12, 4), (HOUSE, 17, 4), (HOUSE, 22, 4), (HOUSE, -12, 6), (HOUSE, -16, 10)] { w.place(k, x, y, 0); }
    w
}
fn gold(w: &World) -> i32 { w.stock[GD as usize] }
fn run(w: &mut World, ticks: u32) { for _ in 0..ticks { w.step(); w.stock[GR as usize] = 3000; } }

#[test]
fn the_price_follows_the_raiders_worth_and_a_boss_costs_more() {
    let price = |atk: [u32; NK]| { let mut w = village(); assert!(w.begin_battle(atk, 1.0, 0)); w.bribe_price() };
    let small = price([4, 0, 0, 0, 0, 0]);
    assert_eq!(small, ((4 * BRIBE_VALUE[0]) * BRIBE_MARKUP_PCT / 100).max(BRIBE_MIN));
    let big = price([10, 6, 3, 1, 0, 0]);
    assert!(big > small * 3, "a bigger raid costs a lot more ({small} vs {big})");
    assert!(price([0; NK]) == BRIBE_MIN, "never below the minimum");
    // a raid led by the Warlord: his escort at the boss markup plus his premium
    let mut w = village(); assert!(w.cheat(10, 150, 500));
    let boss_price = w.bribe_price();
    assert!(boss_price > BRIBE_BOSS_PREMIUM[0] / 2 && boss_price > big, "the warlord's raid is dearer ({boss_price})");
    // a stronger warlord asks more
    let mut weak = village(); assert!(weak.begin_boss_raid(RAID_BOSS, 1.0, 0.0, 0)); weak.tick = 0;
    let mut strong = village(); assert!(strong.begin_battle_boss([0; NK], 1.0, 0, RAID_BOSS, 0, 1.3));
    assert!(strong.bribe_price() > { let mut w = village(); w.begin_battle_boss([0; NK], 1.0, 0, RAID_BOSS, 0, 0.8); w.bribe_price() });
    // the ogre refuses any price
    let mut w = village(); assert!(w.begin_battle_boss([2, 0, 0, 0, 0, 0], 1.0, 0, OGRE, 0, 1.0));
    assert_eq!(w.bribe_price(), -1); assert_eq!(w.bribe(), -1);
}

#[test]
fn paid_raiders_leave_nothing_is_hurt_and_the_lord_gains_no_glory() {
    let mut w = village(); w.hero = Some((0, 10));
    let before_hp: Vec<f32> = w.buildings.iter().map(|b| b.hp).collect();
    assert!(w.begin_battle([6, 3, 1, 0, 0, 0], 2.0, 0));
    run(&mut w, 2);
    let (price, g0) = (w.bribe_price(), gold(&w));
    assert!(price > 0 && g0 >= price);
    w.take_events();
    assert_eq!(w.bribe(), 0);
    assert_eq!(gold(&w), g0 - price, "the gold is paid");
    let ev = w.take_events(); assert!(ev.chunks(4).any(|e| e[0] == EV_BRIBED && e[1] == price), "an event names the price");
    assert_eq!(w.bribe_price(), -1, "only once"); assert_eq!(w.bribe(), -1);
    let mut n = 0; while w.battle_active() && n < 120 { run(&mut w, 1); n += 1; }
    assert!(!w.battle_active(), "the raid ends");
    assert!(n as f32 + 1.0 >= BRIBE_LEAVE_SECS && n < 40, "after they have walked away ({n} ticks)");
    assert!(w.last_report_bought());
    let r = w.last_report(); assert_eq!(r[4], 0, "no defender fell"); assert_eq!(r[5], 0, "no building lost");
    assert!(r[12..24].iter().all(|&l| l == 0), "nothing was looted");
    assert_eq!(w.buildings.iter().map(|b| b.hp).collect::<Vec<_>>(), before_hp, "nothing was damaged");
    assert_eq!(w.hero, Some((0, 10)), "no experience from a purchase");
    assert!(gold(&w) >= g0 - price, "and no more gold was lost");
    assert_eq!(w.bribe_greed(), BRIBE_GREED_STEP);
}

#[test]
fn a_bought_off_warlord_gets_no_prize_and_does_not_fall() {
    let mut w = village(); w.hero = Some((0, 0)); assert!(w.cheat(10, 150, 500));
    let g0 = gold(&w); let p = w.bribe_price(); assert_eq!(w.bribe(), 0);
    run(&mut w, 40);
    assert!(!w.battle_active());
    let l = w.last_report().len(); let rep = w.last_report();
    assert_eq!(rep[l - 6], 1, "the warlord led"); assert_eq!(rep[l - 4], 0, "and did not fall");
    assert_eq!(gold(&w), g0 - p, "no prize gold");
    assert_eq!(w.hero, Some((0, 0)));
}

#[test]
fn refused_when_poor_when_not_a_bandit_raid_and_when_too_late() {
    // too poor: the raid goes on
    let mut w = village(); assert!(w.begin_battle([6, 3, 1, 0, 0, 0], 2.0, 0));
    let price = w.bribe_price(); w.stock[GD as usize] = price - 1;
    assert_eq!(w.bribe(), -6); assert_eq!(gold(&w), price - 1); assert_eq!(w.bribe_greed(), 0);
    assert!(w.battle_active() && !w.battle.as_ref().unwrap().bought);
    // a player's army cannot be bought off
    let mut w = village(); assert!(w.begin_battle([6, 3, 1, 0, 0, 0], 2.0, 7));
    assert_eq!(w.bribe_price(), -1); assert_eq!(w.bribe(), -1);
    // no fight at all
    let mut w = village(); assert_eq!(w.bribe_price(), -1); assert_eq!(w.bribe(), -1);
    // after the window
    let mut w = village(); assert!(w.begin_battle([6, 3, 1, 0, 0, 0], 2.0, 0));
    w.battle.as_mut().unwrap().t = BRIBE_SECS + 0.1; assert_eq!(w.bribe_price(), -1);
    // after the first blow (a raider is hurt)
    let mut w = village(); assert!(w.begin_battle([6, 3, 1, 0, 0, 0], 2.0, 0));
    w.battle.as_mut().unwrap().units.iter_mut().find(|u| u.side == 1).unwrap().hp -= 1.0; assert_eq!(w.bribe(), -1);
    // in a real fight that has begun, the window closes by itself
    let mut w = village(); assert!(w.begin_battle([6, 3, 1, 0, 0, 0], 2.0, 0));
    let mut open = true; for _ in 0..200 { run(&mut w, 1); if !w.battle_active() { break; } if w.bribe_price() < 0 { open = false; break; } }
    assert!(!open || !w.battle_active(), "the window closes before the raid is over");
    // not in a lair
    let mut w = village(); w.battle = None; assert_eq!(w.bribe(), -1);
}

#[test]
fn greed_makes_raids_sooner_and_stronger_and_fades() {
    let mut w = village();
    let calm = (w.raid_one_in(), w.bandit_force(0.5), w.tick);
    assert_eq!(calm.0, RAID_ONE_IN);
    assert!(w.begin_battle([6, 3, 1, 0, 0, 0], 2.0, 0)); let p0 = w.bribe_price(); assert_eq!(w.bribe(), 0);
    run(&mut w, 40);
    assert!(w.raid_one_in() < calm.0 * 3 / 4, "raids come sooner ({} vs {})", w.raid_one_in(), calm.0);
    let after = w.bandit_force(0.5);
    assert!(after.iter().sum::<u32>() >= calm.1.iter().sum::<u32>(), "and not weaker");
    // the next price is higher for the same raid
    w.stock = [3000; N_RES];
    assert!(w.begin_battle([6, 3, 1, 0, 0, 0], 2.0, 0)); assert!(w.bribe_price() > p0, "a repeat customer pays more ({} vs {p0})", w.bribe_price());
    w.battle = None;
    // it fades day by day
    let g = w.bribe_greed(); assert!(g > 0);
    let mut last = g;
    for d in 1..=30 { let t = (w.tick / DAY + 1) * DAY; w.tick = t - 1; w.greed_step(); let before = w.bribe_greed(); w.tick = t; w.greed_step(); assert!(w.bribe_greed() <= before, "day {d}"); assert!(w.bribe_greed() <= last); last = w.bribe_greed(); }
    assert_eq!(last, 0, "gone within a month");
    assert_eq!(w.raid_one_in(), RAID_ONE_IN);
    // paying again and again is capped
    for _ in 0..20 { w.battle = None; w.begin_battle([2, 0, 0, 0, 0, 0], 1.0, 0); w.bribe(); }
    assert!(w.bribe_greed() <= BRIBE_GREED_MAX);
}

#[test]
fn a_bought_off_raid_is_deterministic() {
    let play = |seed: u64| -> Vec<u64> {
        let mut w = village(); w.rng = Rng(seed);
        assert!(w.begin_battle([6, 3, 1, 0, 0, 0], 2.0, 0));
        let mut h = vec![];
        for t in 0..60 { if t == 3 { assert_eq!(w.bribe(), 0); } w.step(); w.stock[GR as usize] = 3000; h.push(w.state_hash()); }
        h
    };
    assert_eq!(play(5), play(5));
}
