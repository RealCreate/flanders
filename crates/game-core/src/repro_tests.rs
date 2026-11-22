//! A saved village where an army marched out of a castle and then showed "Route blocked" for good: its siege engines' recorded trail ran through the castle's walls and halls, so the
//! march's check of that trail failed every time and nothing ever re-planned. The army now forgets such a trail and gathers on its head (see `march_step`).
use super::*;

#[test]
fn an_army_stuck_behind_a_castle_in_a_saved_village_gets_going_again() {
    let mut w = world_restore(include_bytes!("testdata/army_stuck_at_castle.snap")).expect("the saved village restores");
    let f = w.det_flat();
    assert_eq!(f[8] as u8, march::S_BLOCKED, "it was stuck when it was saved");
    let start = (f[1], f[2]);
    for _ in 0..400 { w.step(); }
    let f = w.det_flat();
    assert_ne!(f[8] as u8, march::S_BLOCKED, "it is still stuck");
    assert!((f[1] - start.0).hypot(f[2] - start.1) > 20.0, "it moved on: ({:.1},{:.1})", f[1], f[2]);
}
