//! A snapshot of a world must be the world: restored, it plays on exactly like the original (same state hash, same roads, same bytes when written again).
use super::*;
use crate::roadcheck::busy_village;

/// Play both worlds the same way for a while: some ticks, a few commands, a raid, an army sent out.
fn play_on(w: &mut World) {
    for round in 0..6 {
        for _ in 0..140 { w.step(); }
        w.cheat(3, 0, 0);
        let _ = w.place(HOUSE, 40 + round * 7, -45, 0);
        if round == 2 { w.cheat(2, 1, 12); let _ = w.send_army(&[0, 1, 2, 3]); }
        if round == 3 { let _ = w.upgrade(3); let _ = w.demolish(5); }
    }
}

fn same_world(a: &World, b: &World, what: &str) {
    assert_eq!(a.state_hash(), b.state_hash(), "{what}: state hash");
    assert_eq!(a.roads_flat(), b.roads_flat(), "{what}: roads");
    assert_eq!(a.road_paths_flat(), b.road_paths_flat(), "{what}: road paths");
    assert!(a.snapshot() == b.snapshot(), "{what}: written out again, the bytes differ");
}

#[test]
fn a_restored_world_is_the_same_world_and_plays_on_the_same() {
    for with_moat in [false, true] {
        let mut a = busy_village(with_moat);
        for _ in 0..500 { a.step(); }
        let bytes = a.snapshot();
        let mut b = world_restore(&bytes).expect("it restores");
        same_world(&a, &b, "just restored");
        play_on(&mut a); play_on(&mut b);
        same_world(&a, &b, "after playing on");
    }
}

#[test]
fn a_snapshot_in_the_middle_of_a_battle_restores_too() {
    let mut a = busy_village(true);
    assert!(a.start_raid(0.7, &[12, 6, 6, 2, 0, 0], 1), "a raid begins");
    for _ in 0..40 { a.step(); }
    let mut b = world_restore(&a.snapshot()).expect("it restores");
    same_world(&a, &b, "mid battle");
    for _ in 0..400 { a.step(); b.step(); }
    same_world(&a, &b, "after the battle");
}

#[test]
fn bad_bytes_are_refused() {
    let a = busy_village(false);
    let mut bytes = a.snapshot();
    assert!(world_restore(&[]).is_none());
    assert!(world_restore(b"nonsense, not a world").is_none());
    let mut other = bytes.clone(); other[7] = b'9'; assert!(world_restore(&other).is_none(), "another layout version");
    bytes.truncate(bytes.len() / 2); assert!(world_restore(&bytes).is_none(), "cut short");
}
