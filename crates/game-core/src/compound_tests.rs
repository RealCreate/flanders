//! The walled compounds (the Castle and the Embassy): their walls stop people, the paths inside lead from the gate to the doors of the halls, and the Castle's gates close in a battle.
use super::*;

fn walkable(w: &World, a: (f32, f32), b: (f32, f32)) -> bool {
    let n = ((b.0 - a.0).hypot(b.1 - a.1) / 0.25).ceil().max(1.0) as i32;
    (0..=n).all(|k| { let t = k as f32 / n as f32; !w.member_blocked(a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t, 0) })
}

/// The network as the villagers have it: every edge of it near the compound must be walkable (no wall, tower or building in the way), and the listed spots must be joined to the way in.
fn network_joins(w: &World, mid: (f32, f32), from: (f32, f32), spots: &[((f32, f32), &str)]) {
    let f = w.net_flat(); let (n, e) = (f[0] as usize, f[1] as usize);
    let p = |i: usize| (f[2 + i * 2], f[3 + i * 2]);
    let others: Vec<(f32, f32)> = w.buildings.iter().filter(|b| (b.x - mid.0).hypot(b.y - mid.1) > 1.0).map(|b| (b.x, b.y)).collect();
    let near = |q: (f32, f32)| (q.0 - mid.0).hypot(q.1 - mid.1) < 30.0 && others.iter().all(|o| (q.0 - o.0).hypot(q.1 - o.1) > 14.0);   // (clear of the neighbours' own rings)
    let mut adj = vec![vec![]; n];
    for k in 0..e {
        let o = 2 + n * 2 + k * 3; let (a, b) = (f[o] as usize, f[o + 1] as usize); adj[a].push(b); adj[b].push(a);
        if near(p(a)) && near(p(b)) { assert!(walkable(w, p(a), p(b)), "the path from {:?} to {:?} runs through a wall or building", p(a), p(b)); }
    }
    let nearest = |q: (f32, f32)| (0..n).min_by(|&a, &b| ((p(a).0 - q.0).hypot(p(a).1 - q.1)).partial_cmp(&((p(b).0 - q.0).hypot(p(b).1 - q.1))).unwrap()).unwrap();
    let s = nearest(from);
    let mut seen = vec![false; n]; let mut st = vec![s]; seen[s] = true;
    while let Some(a) = st.pop() { for &b in &adj[a] { if !seen[b] { seen[b] = true; st.push(b); } } }
    for &(q, what) in spots { let i = nearest(q); assert!((p(i).0 - q.0).hypot(p(i).1 - q.1) < 0.5, "there is a path node at {what}"); assert!(seen[i], "{what} is joined to the way in"); }
}

fn castle() -> (World, f32, f32) {
    let mut w = World::new(1337, 0, 0); w.stock = [30000; N_RES];
    w.buildings[0].tier = 3;
    let (x, y) = (w.buildings[0].x, w.buildings[0].y);
    (w, x, y)
}

#[test]
fn the_castle_walls_and_towers_stop_people_but_its_gate_and_court_are_open() {
    let (w, x, y) = castle();
    let at = |lx: f32, lz: f32| (x + lx, y + lz);
    for (lx, lz, what) in [(0.0, -19.0, "back wall"), (22.0, 0.0, "side wall"), (-22.0, 19.0, "corner tower"), (15.0, 19.0, "front wall"), (0.0, -14.2, "donjon"), (0.0, -2.3, "fountain"), (-14.0, 7.6, "stables")] {
        let p = at(lx, lz); assert!(w.member_blocked(p.0, p.1, 0), "{what} at {lx},{lz} stops people");
    }
    for (lx, lz, what) in [(0.0, 26.0, "bridge"), (0.0, 22.6, "barbican"), (0.0, 19.2, "gatehouse"), (0.0, 10.0, "outer ward"), (0.0, 1.6, "inner gate"), (0.0, -6.2, "porch"), (3.0, -2.3, "court")] {
        let p = at(lx, lz); assert!(!w.member_blocked(p.0, p.1, 0), "{what} at {lx},{lz} is open ground");
    }
}

#[test]
fn villagers_can_walk_in_through_the_castle_gate_to_the_palace_and_the_wards_without_touching_a_wall() {
    let (w, x, y) = castle();
    let at = |lx: f32, lz: f32| (x + lx, y + lz);
    network_joins(&w, (x, y), at(0.0, 28.6), &[(at(0.0, 22.6), "the barbican"), (at(0.0, 1.6), "the inner gate"), (at(2.1, -4.4), "the court before the great hall"), (at(0.0, -6.2), "the door of the great hall"),
        (at(-17.4, 10.9), "the stables")]);
}

#[test]
fn the_castle_gates_shut_in_a_battle_and_open_again_after() {
    let (mut w, x, y) = castle();
    let door = (x, y + 24.1);
    assert!(!w.member_blocked(door.0, door.1, 0));
    assert!(w.cheat(4, 0, 300), "a battle begins");
    assert!(w.battle.is_some());
    assert!(w.member_blocked(door.0, door.1, 0), "the door is shut");
    assert!(w.member_blocked(x, y + 3.22, 0), "and the inner gate");
    let f = w.net_flat(); let n = f[0] as usize; let outside = (0..n).any(|i| (f[2 + i * 2] - x).abs() < 0.1 && (f[3 + i * 2] - y - 25.6).abs() < 0.1); let inside = (0..n).any(|i| (f[2 + i * 2] - x).abs() < 0.1 && (f[3 + i * 2] - y - 22.6).abs() < 0.1);
    assert!(outside && inside, "the nodes on either side of the door exist");
    let e = f[1] as usize; let id = |z: f32| (0..n).find(|&i| (f[2 + i * 2] - x).abs() < 0.1 && (f[3 + i * 2] - y - z).abs() < 0.1).unwrap();
    let (a, b) = (id(25.6), id(22.6)); assert!(!(0..e).any(|k| { let o = 2 + n * 2 + k * 3; let (p, q) = (f[o] as usize, f[o + 1] as usize); (p == a && q == b) || (p == b && q == a) }), "no path through the shut door");
}

#[test]
fn the_embassy_has_walls_and_a_way_from_its_gate_to_the_great_hall() {
    let mut w = World::new(1337, 0, 0); w.stock = [30000; N_RES]; w.flatten(90, 5.0);
    let e = w.place(EMBASSY, 0, -32, 0); assert!(e >= 0, "the embassy is built");
    let (x, y) = (w.buildings[e as usize].x, w.buildings[e as usize].y);
    let at = |lx: f32, lz: f32| (x + lx, y + lz);
    for (lx, lz, what) in [(0.0, -18.0, "back wall"), (16.0, 0.0, "side wall"), (10.0, 18.0, "front wall"), (-16.0, 18.0, "corner tower"), (-5.0, -13.2, "the keep"), (4.75, -3.0, "a garden")] {
        let p = at(lx, lz); assert!(w.member_blocked(p.0, p.1, 0), "{what} stops people");
    }
    for (lx, lz) in [(0.0, 18.0), (0.0, 10.0), (0.0, -8.4), (8.0, -8.4)] { let p = at(lx, lz); assert!(!w.member_blocked(p.0, p.1, 0), "{lx},{lz} is open ground"); }
    network_joins(&w, (x, y), at(0.0, 20.2), &[(at(0.0, 16.4), "the gate"), (at(0.0, -8.4), "the hall's door"), (at(12.0, -8.4), "the smithy"), (at(-12.0, -8.4), "the granary"), (at(4.2, 16.4), "a guard house")]);
}

#[test]
fn an_army_can_march_out_past_an_embassy_and_a_castle() {
    for (castle, embassy_at, rot) in [(false, (0, -32), 0u8), (true, (0, -32), 0), (true, (0, -32), 1), (true, (0, -32), 2), (true, (0, -32), 3), (false, (30, 0), 0)] {
        let mut w = World::new(1337, 0, 0); w.stock = [30000; N_RES]; w.flatten(90, 5.0);
        if castle { w.buildings[0].tier = 3; w.buildings[0].rot = rot; w.after_change(); }
        let e = w.place(EMBASSY, embassy_at.0, embassy_at.1, 0);
        assert!(w.cheat(3, 0, 0));
        for k in [0, 1, 2, 4, 5] { w.cheat(2, k, 10); }
        let id = w.det_form(&[10, 10, 10, 0, 10, 10]); assert!(id > 0);
        let f = w.det_flat(); let (x, y) = (f[1], f[2]); eprintln!("hall at ({:.0},{:.0}) rot {}", w.buildings[0].x, w.buildings[0].y, w.buildings[0].rot);
        for (tx, ty) in [(120.0f32, 0.0f32), (-120.0, 40.0), (0.0, 120.0), (0.0, -120.0)] {
            let plan = w.plan_march(&[10, 10, 10, 0, 10, 10], x, y, tx, ty);
            let code = w.det_march(id, tx, ty, true, tx, ty);
            eprintln!("castle {castle} rot {rot} embassy {e} at {embassy_at:?} from ({x:.0},{y:.0}) to ({tx},{ty}): plan {} order {code}", plan[0]);
            assert!(plan[0] != 1.0 || code == 0, "the preview finds a route but the order says {code}: castle {castle} embassy at {embassy_at:?} to ({tx},{ty})");
            let mut blocked_at = None; let mut moved = 0.0f32;
            for t in 0..2400 {
                w.step(); w.stock = [30000; N_RES];
                let f = w.det_flat(); if f.is_empty() { break; }
                moved = moved.max((f[1] - x).hypot(f[2] - y));
                if f[8] as u8 == march::S_BLOCKED && blocked_at.is_none() { blocked_at = Some((t, f[1], f[2])); break; }
                if f[8] as u8 == march::S_ARRIVED { break; }
            }
            eprintln!("   -> moved {moved:.0}, blocked {blocked_at:?}");
            assert!(blocked_at.is_none(), "the army got stuck on its way: castle {castle} embassy at {embassy_at:?} to ({tx},{ty}): {blocked_at:?}");
        }
    }
}

#[test]
fn an_army_mustered_in_a_castle_can_always_be_ordered_out_by_the_gate() {
    for rot in 0..4u8 { for (bx, by) in [(-16, -6), (-12, 12), (12, 10), (14, -10), (0, 14), (-18, 0), (18, 4)] {
        let mut w = World::new(1337, 0, 0); w.stock = [30000; N_RES]; w.flatten(90, 5.0);
        let r = w.place(BARRACKS, bx, by, 0);
        if r < 0 { eprintln!("place {bx},{by}: {r}"); continue; }
        w.buildings[0].tier = 3; w.buildings[0].rot = rot; w.after_change();
        w.army = [10; NK];
        let id = w.det_form(&[10, 10, 10, 0, 10, 10]);
        if id == 0 { eprintln!("rot {rot} {bx},{by}: no form"); continue; }
        let f = w.det_flat(); let (x, y) = (f[1], f[2]);
        let mut res = vec![];
        for (tx, ty) in [(120.0f32, 0.0f32), (-120.0, 40.0), (0.0, 120.0), (0.0, -120.0)] { res.push(w.det_march(id, tx, ty, true, tx, ty)); }
        assert!(res.iter().all(|&c| c == 0), "rot {rot} barracks {bx},{by} spawn ({x:.1},{y:.1}): orders {res:?}");
    } }
}
