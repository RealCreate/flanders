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

#[test]
fn an_army_standing_where_a_castle_is_raised_over_it_is_set_down_and_marches_out() {
    for rot in 0..4u8 {
        let mut w = World::new(1337, 0, 0); w.stock = [30000; N_RES]; w.flatten(90, 5.0);
        w.place(BARRACKS, 14, 14, 0);
        assert!(w.cheat(3, 0, 0));
        for k in [0, 1, 2, 4, 5] { w.cheat(2, k, 10); }
        let id = w.det_form(&[10, 10, 10, 0, 10, 10]); assert!(id > 0);
        w.buildings[0].tier = 3; w.buildings[0].rot = rot; w.after_change();
        assert_eq!(w.det_march(id, 120.0, 0.0, true, 120.0, 0.0), 0);
        for _ in 0..1500 { w.step(); w.stock = [30000; N_RES]; }
        let f = w.det_flat();
        assert_eq!(f[8] as u8, march::S_ARRIVED, "rot {rot}: the army never got out ({:.1},{:.1}) state {}", f[1], f[2], f[8]);
    }
}

#[test]
fn the_rally_point_defaults_outside_and_the_player_can_move_it() {
    let mut w = World::new(1337, 0, 0); w.stock = [30000; N_RES]; w.flatten(90, 5.0);
    assert_eq!(w.set_rally(0, 50.0, 0.0, false), -1, "no barracks yet");
    w.place(BARRACKS, 40, 0, 0);
    assert!(w.cheat(3, 0, 0));
    for k in [0, 1, 2, 4, 5] { w.cheat(2, k, 10); }
    let def = w.rally_flat(0); assert_eq!(def[2], 0.0);
    assert!(!w.member_blocked(def[0], def[1], 0), "the default rally point is open ground");
    assert_eq!(w.set_rally(0, 60.0, 30.0, false), 0);
    assert_eq!(w.rally_flat(0), vec![60.0, 30.0, 1.0]);
    let id = w.det_form(&[10, 0, 0, 0, 0, 0]); assert!(id > 0);
    let f = w.det_flat(); assert!((f[1] - 60.0).hypot(f[2] - 30.0) < 6.0, "the army stands at the rally point: ({:.1},{:.1})", f[1], f[2]);
    let snap = world_restore(&w.snapshot()).expect("restores");
    assert_eq!(snap.rally_flat(0), vec![60.0, 30.0, 1.0]);
    assert_eq!(snap.state_hash(), w.state_hash());
    let h = w.state_hash(); assert_eq!(w.set_rally(0, 0.0, 0.0, true), 0);
    assert_eq!(w.rally_flat(0)[2], 0.0); assert_ne!(w.state_hash(), h, "the rally point is part of the state hash");
    assert_eq!(w.set_rally(0, 5000.0, 0.0, false), -2, "too far from the village");
    assert_eq!(w.set_rally(0, f32::NAN, 0.0, false), -2);
    assert_eq!(w.set_rally(1, 0.0, 40.0, false), -1, "no castle yet");
}

#[test]
fn a_castle_has_a_rally_point_of_its_own_in_front_of_the_gate() {
    let mut w = World::new(1337, 0, 0); w.stock = [30000; N_RES]; w.flatten(90, 5.0);
    w.buildings[0].tier = 3; w.after_change();
    w.place(BARRACKS, 4, 4, 0);   // (inside the walls)
    assert!(w.cheat(3, 0, 0));
    for k in [0, 1, 2, 4, 5] { w.cheat(2, k, 10); }
    let def = w.rally_flat(1); assert_eq!(def[2], 0.0);
    assert_eq!(w.set_rally(1, def[0] + 10.0, def[1] + 6.0, false), 0);
    let id = w.det_form(&[10, 0, 0, 0, 0, 0]); assert!(id > 0);
    let f = w.det_flat(); let c = w.rally_flat(1);
    assert!((f[1] - c[0]).hypot(f[2] - c[1]) < 6.0, "the army stands at the castle's rally point: ({:.1},{:.1}) vs {:?}", f[1], f[2], c);
}
