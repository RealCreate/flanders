//! The market: limited stock for gold, refilled daily (see market.rs).
use super::*;

fn village() -> World { let mut w = World::new(1337, 0, 0); w.cheat(3, 0, 0); w.stock[GD as usize] = 5000; w }
fn with_market(w: &mut World, x: i32, y: i32) -> usize { assert!(w.place(MARKET, x, y, 0) >= 0); w.buildings.iter().rposition(|b| b.kind == MARKET).unwrap() }
fn left(w: &World, res: u8) -> i32 { let g = w.market_goods(); (0..g.len() / 6).find(|&i| g[i * 6] == res as i32).map(|i| g[i * 6 + 1]).unwrap() }
fn next_day(w: &mut World) { let d = w.tick() / DAY; while w.tick() / DAY == d { w.step(); w.stock[GD as usize] = 5000; } }

#[test]
fn without_a_market_nothing_is_for_sale() {
    let mut w = village();
    assert!(w.market_goods().is_empty());
    assert_eq!(w.buy(W, 10), -1);
}

#[test]
fn emergency_tools_are_limited_expensive_persistent_and_slow_to_restock() {
    let mut w = village(); let a = with_market(&mut w, 0, 14);
    let mut old_bytes = w.snapshot();
    old_bytes[..8].copy_from_slice(ESTATE_SNAP_MAGIC);
    old_bytes.truncate(old_bytes.len() - 16);
    let restored = world_restore(&old_bytes).unwrap();
    assert_eq!(restored.state_hash(), w.state_hash());
    assert_eq!(left(&restored, TL), 2);
    w.stock[TL as usize] = 0;
    assert_eq!(left(&w, TL), 2);
    assert_eq!(w.buy(TL, 3), -2);
    let gold = w.stock[GD as usize];
    assert_eq!(w.buy(TL, 2), 0);
    assert_eq!(w.stock[GD as usize], gold - 30);
    assert_eq!(w.stock[TL as usize], 2);
    let hash = w.state_hash();
    w = world_restore(&w.snapshot()).unwrap();
    assert_eq!(w.state_hash(), hash);
    assert_eq!(left(&w, TL), 0);
    w.buildings[a].tier = 3;
    with_market(&mut w, 18, 8);
    assert_eq!(left(&w, TL), 0);
    w.tick = DAY * 2; w.market_refill(); assert_eq!(left(&w, TL), 0);
    w.tick = DAY * 3 - 1; w.step(); assert_eq!(left(&w, TL), 1);
    w.tick = DAY * 6; w.market_refill(); assert_eq!(left(&w, TL), 2);
    let old = World::new_legacy(1337, 0, 0);
    assert_eq!(old.emergency_tools, [0; 2]);
}

#[test]
fn the_stock_is_capped_the_player_may_buy_it_all_and_it_is_back_after_four_days() {
    let mut w = village(); with_market(&mut w, 0, 14);
    w.stock[W as usize] = 0;
    assert_eq!(left(&w, W), 200);
    assert_eq!(w.buy(W, 201), -2, "more than the stock");
    assert_eq!(w.buy(W, 0), -1); assert_eq!(w.buy(W, -5), -1);
    assert_eq!(w.buy(IR, 1), -1, "iron is not on sale");
    let gold = w.stock[GD as usize]; let cost = w.market_cost(W, 200);
    assert!(cost > w.price(W as usize) * 200, "the markup is paid: {cost}");
    assert_eq!(w.buy(W, 200), 0);
    assert_eq!(w.stock[W as usize], 200); assert_eq!(w.stock[GD as usize], gold - cost); assert_eq!(left(&w, W), 0);
    assert_eq!(w.buy(W, 1), -2, "sold out");
    // +50 a day: 50, 100, 150, 200 and no more
    for d in 1..=5 { w.market_refill(); assert_eq!(left(&w, W), (50 * d).min(200), "day {d}"); }
}

#[test]
fn a_partial_buy_refills_to_the_cap_and_never_over_it() {
    let mut w = village(); with_market(&mut w, 0, 14); w.stock[W as usize] = 0;
    assert_eq!(w.buy(W, 20), 0); assert_eq!(left(&w, W), 180);
    next_day(&mut w);
    assert_eq!(left(&w, W), 200, "20 sold is made good by one day's 50");
}

#[test]
fn the_goods_the_gold_and_the_room_must_be_there() {
    let mut w = village(); with_market(&mut w, 0, 14);
    w.stock[GD as usize] = 3; w.stock[GR as usize] = 0;
    assert_eq!(w.buy(GR, 100), -6, "poor");
    w.stock[GD as usize] = 5000; let cap = w.storage_cap(); w.stock[ST as usize] = cap - 5;
    assert_eq!(w.buy(ST, 10), -7, "no room");
    assert_eq!(left(&w, ST), 200, "nothing was taken");
    assert_eq!(w.buy(ST, 5), 0);
}

#[test]
fn higher_tiers_and_more_markets_stock_more_but_each_extra_one_counts_half() {
    let mut w = village(); let a = with_market(&mut w, 0, 14);
    assert_eq!(left(&w, W), 200);
    w.buildings[a].tier = 2; assert_eq!(left(&w, W), 400);
    let _b = with_market(&mut w, 18, 8);   // a second stall (tier 0): +50% of 200
    assert_eq!(left(&w, W), 500);
    assert_eq!(left(&w, PL), 250);
}

#[test]
fn demolishing_every_market_forgets_what_was_sold() {
    let mut w = village(); let a = with_market(&mut w, 0, 14); w.stock[W as usize] = 0;
    assert_eq!(w.buy(W, 150), 0);
    w.buildings.remove(a); w.after_change();
    next_day(&mut w);
    let _ = with_market(&mut w, 0, 14);
    assert_eq!(left(&w, W), 200);
}
