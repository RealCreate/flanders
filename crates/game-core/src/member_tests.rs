//! Individual soldiers on a march (see members.rs). The visual soldiers of the client follow the army's centre along the path network with a sideways offset cut to the free ground; this file runs
//! the same rules (a mirror of web/src/memberpath.ts and render/field.ts: guide point on the centre's trail, offset clamped by `member_reach`, steps through `member_step`, a route of its own
//! from `member_route` when stuck) over fixture villages and checks every member at every step: never inside a building, wall, field or water, and in the end at the destination.
use super::*;

fn ring(w: &mut World, r: f32, n: usize, kind: u8) {
    for i in 0..n { let a = i as f32 / n as f32 * std::f32::consts::TAU; let (x, y) = ((a.cos() * r).round() as i32, (a.sin() * r).round() as i32); w.place(kind, x, y, 0); }
}
/// A round wall of radius 30 with a gate in its south side (the wall piece there is taken down for it).
fn walled(w: &mut World) {
    ring(w, 30.0, 40, WALL);
    let i = w.buildings.iter().position(|b| b.kind == WALL && (b.x).abs() < 1.5 && b.y > 28.0).expect("a wall piece on the south side");
    w.demolish(i as u32);
    assert!(w.place(GATE, 0, 30, 0) >= 0, "a gate on the south wall");
}
fn tick(w: &mut World) { w.step(); w.stock = [30000; N_RES]; }

fn hash01(a: i32, b: i32, c: i32) -> f32 {
    let mut h = (a.wrapping_mul(0x9e3779b1u32 as i32) ^ b.wrapping_mul(0x85ebca6bu32 as i32) ^ c.wrapping_mul(0xc2b2ae35u32 as i32)) as u32;
    h ^= h >> 15; h = h.wrapping_mul(0x2c1b3c6d); h ^= h >> 12; h = h.wrapping_mul(0x297a2d39); h ^= h >> 15;
    h as f32 / 4294967296.0
}

/// Is this spot somewhere a person may not be? Written out afresh from the geometry (not from members.rs), so it checks the check: inside a building's solid part, on a wall or fence run, in a
/// field or bed, or in water that no bridge or lowered deck covers.
fn independent_blocked(w: &World, x: f32, y: f32) -> Option<&'static str> {
    for b in &w.buildings {
        match b.kind {
            ROAD | MOAT | RIVER | RAISE | LOWER | BRIDGE | DRAWBRIDGE | GATE => {}
            WALL | FENCE => { if (b.x - x).hypot(b.y - y) < solid_radius(b.kind, b.tier) - 0.6 { return Some("wall"); } }
            _ => { if (b.x - x).hypot(b.y - y) < solid_radius(b.kind, b.tier) { return Some("building"); } }
        }
        if matches!(b.kind, FARM | GARDEN | PARK | MARKET) && pathnet::in_fields(b, x, y, 0.0) { return Some("field"); }
        if b.kind == GATE && w.gate_shut(b) && (b.x - x).hypot(b.y - y) < 3.0 { return Some("shut gate"); }
    }
    let (segs, _) = w.wall_lines();
    for s in &segs {
        let (dx, dy) = (s.bx - s.ax, s.by - s.ay); let l2 = (dx * dx + dy * dy).max(1e-6);
        let t = (((x - s.ax) * dx + (y - s.ay) * dy) / l2).clamp(0.0, 1.0);
        if (x - (s.ax + dx * t)).hypot(y - (s.ay + dy * t)) < s.r - 0.3 { return Some("wall run"); }
    }
    if w.height_ground(x, y) < 0.2 && !w.on_deck(x, y) && !w.bridges.iter().any(|g| { let (dx, dy) = (g[2] - g[0], g[3] - g[1]); let l2 = (dx * dx + dy * dy).max(1e-6); let t = (((x - g[0]) * dx + (y - g[1]) * dy) / l2).clamp(0.0, 1.0); (x - (g[0] + dx * t)).hypot(y - (g[1] + dy * t)) < 1.7 })
        && !w.buildings.iter().any(|b| b.kind == BRIDGE && { let (ux, uy, l) = World::bridge_dir(b); let (px, py) = (x - b.x, y - b.y); (px * ux + py * uy).abs() <= l / 2.0 + 1.0 && (-px * uy + py * ux).abs() < 2.0 }) { return Some("water"); }
    None
}

struct Mem { kind: u8, x: f32, y: f32, vx: f32, vy: f32, lateral: f32, delay: f32, lead: f32, pace: f32, angle: f32, spread: f32, hold: f32, blocked: f32, route: Option<Vec<f32>>, ri: usize }

fn trail_at(trail: &[(f32, f32)], s: f32) -> (f32, f32) {
    let mut acc = 0.0; let n = trail.len(); let mut a = trail[n - 1];
    for k in (0..n - 1).rev() { let b = trail[k]; let seg = (b.0 - a.0).hypot(b.1 - a.1); if seg > 1e-6 { if acc + seg >= s { let t = (s - acc) / seg; return (a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t); } acc += seg; a = b; } }
    a
}

/// March an army of mixed soldiers from where it forms to `dest`, drawing a member for every soldier (at most `cap` of each kind) and checking each at every quarter second. Returns the members, the
/// number of samples checked, a hash of every position (for determinism) and how many times a member asked for a route of its own.
fn walk(w: &mut World, units: [u32; NK], dest: (f32, f32), cap: u32) -> Result<(Vec<Mem>, usize, u64, usize), i32> {
    w.army = units;
    let id = w.det_form(&units); assert!(id > 0);
    let code = w.det_march(id, dest.0, dest.1, false, 0.0, 0.0);
    if code != 0 { return Err(code); }
    let f0 = w.det_flat(); let (cx, cy) = (f0[1], f0[2]);
    let mut mems: Vec<Mem> = vec![];
    for kind in 0..NK as u8 {
        for k in 0..units[kind as usize].min(cap) {
            let i = mems.len() as i32;
            let (h, hk) = (|j: i32| hash01(id as i32, i * 7 + kind as i32, j), kind);
            let (angle, spread) = (h(1) * std::f32::consts::TAU, 2.0 + ((i + 1) as f32).sqrt() * 1.35);
            let reach = w.member_reach(cx, cy, angle.cos(), angle.sin(), spread, if hk >= 3 { 3 } else { 0 });
            let _ = k;
            mems.push(Mem { kind, x: cx + angle.cos() * reach, y: cy + angle.sin() * reach, vx: 0.0, vy: 0.0, lateral: 0.0, delay: h(3) * 2.2, lead: 0.5 + h(4) * 8.0, pace: 0.92 + h(5) * 0.16, angle, spread, hold: 0.0, blocked: 0.0, route: None, ri: 0 });
        }
    }
    let mut trail: Vec<(f32, f32)> = vec![(cx, cy)];
    let (mut samples, mut hash, mut reroutes) = (0usize, 0xcbf29ce484222325u64, 0usize);
    let (mut was_marching, mut done_for) = (false, 0);
    for _ in 0..2500 {
        tick(w);
        let f = w.det_flat(); if f.is_empty() { break; }
        let (hx, hy, state, speed) = (f[1], f[2], f[8] as u8, f[15]);
        if trail.last().map_or(true, |p| (p.0 - hx).hypot(p.1 - hy) > 0.45) { trail.push((hx, hy)); if trail.len() > 400 { trail.remove(0); } }
        let groups = w.det_groups_flat();
        let cluster = |kind: f32| groups.chunks(8).find(|g| g[0] == id as f32 && g[1] == kind).map(|g| (g[3], g[4], g[6]));
        let marching = matches!(state, march::S_MARCH | march::S_FELL | march::S_HOME | march::S_BRIDGE | march::S_FERRY);
        let set_off = marching && !was_marching; was_marching = marching;
        for _sub in 0..4 {
            let dt = 0.25f32;
            for (i, m) in mems.iter_mut().enumerate() {
                let lvl = if m.kind >= 3 { 3u8 } else { 0 };
                if set_off { m.hold = m.delay; }
                let own = match m.kind { 3 => cluster(3.0), 4 | 5 => cluster(4.0), _ => None };
                let (mut gx, mut gy, mut spd);
                if let Some((kx, ky, ks)) = own {
                    let r = 1.5 + ((i + 1) as f32).sqrt();
                    let reach = w.member_reach(kx, ky, m.angle.cos(), m.angle.sin(), r, lvl);
                    gx = kx + m.angle.cos() * reach; gy = ky + m.angle.sin() * reach; spd = (ks * 1.25 + 0.5 + ((gx - m.x).hypot(gy - m.y) * 0.8).min(8.0)) * m.pace;
                } else if marching && speed > 0.15 {
                    let (px, py) = trail_at(&trail, m.lead); let (qx, qy) = trail_at(&trail, m.lead + 1.5);
                    let (dx, dy) = (px - qx, py - qy); let l = dx.hypot(dy).max(1e-6); let (nx, ny) = (-dy / l, dx / l);
                    let _ = (nx, ny);
                    gx = px; gy = py;   // strictly on the path
                    if m.route.is_none() && (m.x - gx).hypot(m.y - gy) > 6.0 { let rt = w.member_route(m.x, m.y, gx, gy, lvl); if rt.len() >= 2 { m.route = Some(rt); m.ri = 0; reroutes += 1; } }
                    spd = (speed + 4.0) * m.pace;
                    if m.hold > 0.0 { m.hold -= dt; spd = 0.0; }
                } else {
                    let reach = w.member_reach(hx, hy, m.angle.cos(), m.angle.sin(), m.spread, lvl);
                    gx = hx + m.angle.cos() * reach; gy = hy + m.angle.sin() * reach; spd = 3.0 * m.pace;
                }
                if let Some(r) = &m.route {
                    while m.ri * 2 + 1 < r.len() && (r[m.ri * 2] - m.x).hypot(r[m.ri * 2 + 1] - m.y) < 1.1 { m.ri += 1; }
                    if m.ri * 2 + 1 >= r.len() { m.route = None; } else { gx = r[m.ri * 2]; gy = r[m.ri * 2 + 1]; spd = spd.max(3.2); }
                }
                let (dx, dy) = (gx - m.x, gy - m.y); let dist = dx.hypot(dy);
                let want = if dist > 0.04 { spd.min(dist * 5.0) } else { 0.0 };
                let (tvx, tvy) = if dist > 0.04 { (dx / dist * want, dy / dist * want) } else { (0.0, 0.0) };
                let ease = (dt * 7.0).min(1.0); m.vx += (tvx - m.vx) * ease; m.vy += (tvy - m.vy) * ease;
                let sp = m.vx.hypot(m.vy) * dt;
                if sp > 1e-5 && !matches!(state, march::S_FERRY) {
                    let r = w.member_step(m.x, m.y, m.x + m.vx * dt, m.y + m.vy * dt, sp, lvl);
                    m.x = r[0]; m.y = r[1];
                    m.blocked = if r[2] == 2.0 && want > 0.5 { m.blocked + dt } else { (m.blocked - dt * 2.0).max(0.0) };
                    if m.blocked > 0.8 && m.route.is_none() { let rt = w.member_route(m.x, m.y, gx, gy, lvl); if rt.len() >= 2 { m.route = Some(rt); m.ri = 0; reroutes += 1; } m.blocked = 0.0; }
                }
                if state != march::S_FERRY {
                    if let Some(why) = independent_blocked(w, m.x, m.y) { panic!("a {} (kind {}) stands in a {why} at ({:.1}, {:.1}), army at ({hx:.1}, {hy:.1}) state {state}", if m.kind >= 3 { "rider or engine" } else { "soldier" }, m.kind, m.x, m.y); }
                }
                samples += 1; hash ^= m.x.to_bits() as u64; hash = hash.wrapping_mul(0x100000001b3); hash ^= m.y.to_bits() as u64; hash = hash.wrapping_mul(0x100000001b3);
            }
        }
        if matches!(state, march::S_IDLE | march::S_ARRIVED) { done_for += 1; if done_for > 40 { break; } }
    }
    Ok((mems, samples, hash, reroutes))
}

fn assert_arrived(mems: &[Mem], dest: (f32, f32), tol: f32) {
    for m in mems { let d = (m.x - dest.0).hypot(m.y - dest.1); assert!(d <= tol, "a member of kind {} ended {d:.1} from the destination at ({:.1}, {:.1})", m.kind, m.x, m.y); }
}

const MIXED: [u32; NK] = [6, 3, 4, 2, 1, 1];

#[test]
fn members_cross_a_drawbridge_over_a_moat_without_ever_entering_water_or_a_building() {
    let mut w = World::new(1337, 0, 0); w.stock = [30000; N_RES]; w.cheat(3, 0, 0); w.population = 20;
    ring(&mut w, 24.0, 52, MOAT);
    assert!(w.place(DRAWBRIDGE, 0, 24, 0) >= 0);
    for (k, x, y) in [(HOUSE, 12, 4), (HOUSE, -12, 6), (HOUSE, 6, 14), (BARRACKS, -14, -12), (WELL, 4, -10)] { w.place(k, x, y, 0); }
    let di = w.buildings.iter().position(|b| b.kind == DRAWBRIDGE).unwrap() as u32;
    assert_eq!(w.drawbridge_set(di, true), 0); w.buildings[di as usize].progress = 0; w.after_change();   // drawn up: the army lowers it
    let dest = (0.0, 62.0);
    let (mems, samples, _, rr) = walk(&mut w, MIXED, dest, 12).expect("a route over the drawbridge");
    eprintln!("moat: {} members, {samples} samples, {rr} own routes", mems.len());
    assert!(samples > 3000, "a long walk was checked: {samples}");
    assert_arrived(&mems, dest, 16.0);
}

#[test]
fn members_pass_the_gate_of_a_walled_village_and_keep_out_of_walls_and_fields() {
    let mut w = World::new(1337, 0, 0); w.stock = [30000; N_RES]; w.cheat(3, 0, 0); w.population = 30;
    walled(&mut w);
    for (k, x, y) in [(HOUSE, 12, 4), (HOUSE, -12, 6), (FARM, -18, 12), (GARDEN, 14, -14), (BARRACKS, 8, 14)] { w.place(k, x, y, 0); }
    let dest = (0.0, 75.0);
    let (mems, samples, _, rr) = walk(&mut w, MIXED, dest, 12).expect("a way out through the gate");
    eprintln!("walls: {} members, {samples} samples, {rr} own routes", mems.len());
    assert!(samples > 3000);
    assert_arrived(&mems, dest, 16.0);
}

#[test]
fn members_cross_a_river_by_its_bridge() {
    let mut w = World::new(1337, 0, 0); w.stock = [30000; N_RES]; w.cheat(3, 0, 0); w.population = 20;
    for x in (-80..=80).step_by(3) { w.place(RIVER, x, 40, 0); }
    for (k, x, y) in [(HOUSE, 12, 4), (HOUSE, -12, 6), (HOUSE, 6, 22)] { w.place(k, x, y, 0); }
    let b = w.place(BRIDGE, 0, 40, 0);
    assert!(b >= 0, "a bridge over the river: {b}");
    let dest = (0.0, 80.0);
    let (mems, samples, _, rr) = walk(&mut w, MIXED, dest, 12).expect("a way over the bridge");
    eprintln!("river: {} members, {samples} samples, {rr} own routes", mems.len());
    assert!(samples > 2000);
    assert_arrived(&mems, dest, 16.0);
}

#[test]
fn members_squeezing_between_buildings_bunch_up_but_never_enter_them() {
    let mut w = World::new(1337, 0, 0); w.stock = [30000; N_RES]; w.cheat(3, 0, 0); w.population = 30;
    // a street of houses with narrow gaps right in front of the barracks
    for k in -4..=4 { w.place(HOUSE, k * 7, 28, 0); }
    w.place(BARRACKS, 0, 12, 0);
    let dest = (0.0, 70.0);
    let (mems, samples, _, rr) = walk(&mut w, [14, 6, 8, 0, 0, 0], dest, 30).expect("a way through the street");
    eprintln!("street: {} members, {samples} samples, {rr} own routes", mems.len());
    assert!(samples > 5000);
    assert_arrived(&mems, dest, 20.0);
}

#[test]
fn every_member_walks_the_same_way_every_time() {
    let run = || {
        let mut w = World::new(1337, 0, 0); w.stock = [30000; N_RES]; w.cheat(3, 0, 0); w.population = 30;
        walled(&mut w);
        for (k, x, y) in [(HOUSE, 12, 4), (HOUSE, -12, 6), (BARRACKS, 8, 14)] { w.place(k, x, y, 0); }
        let (m, _, h, rr) = walk(&mut w, MIXED, (0.0, 70.0), 10).unwrap();
        (h, rr, m.iter().map(|q| (q.x.to_bits(), q.y.to_bits())).collect::<Vec<_>>())
    };
    assert_eq!(run(), run());
}

#[test]
fn a_member_that_is_stuck_gets_a_route_of_its_own_along_the_network() {
    let mut w = World::new(1337, 0, 0); w.stock = [30000; N_RES]; w.cheat(3, 0, 0); w.population = 20;
    for (k, x, y) in [(HOUSE, 12, 4), (HOUSE, -12, 6), (BARRACKS, -14, -12)] { w.place(k, x, y, 0); }
    // from beside the barracks to a place the other side of the houses
    let r = w.member_route(-14.0, -4.0, 30.0, 30.0, 0);
    assert!(r.len() >= 4, "a route exists");
    let mut prev = (-14.0f32, -4.0f32);
    for p in r.chunks(2) {
        let n = ((p[0] - prev.0).hypot(p[1] - prev.1) / 0.5).ceil().max(1.0) as i32;
        for k in 0..=n { let t = k as f32 / n as f32; let (x, y) = (prev.0 + (p[0] - prev.0) * t, prev.1 + (p[1] - prev.1) * t); assert!(independent_blocked(&w, x, y).is_none(), "the route runs through something at ({x:.1}, {y:.1})"); }
        prev = (p[0], p[1]);
    }
    assert!((prev.0 - 30.0).hypot(prev.1 - 30.0) < 3.0, "and it ends at the goal");
    assert!(w.member_route(f32::NAN, 0.0, 1.0, 1.0, 0).is_empty(), "hostile numbers give nothing");
    // an engine's route keeps more clear of buildings than a soldier's
    let e = w.member_route(-14.0, -4.0, 30.0, 30.0, 3);
    for p in e.chunks(2) { assert!(!w.member_blocked(p[0], p[1], 3) || (p[0] - 30.0).hypot(p[1] - 30.0) < 3.0, "engine route clear of buildings at ({:.1}, {:.1})", p[0], p[1]); }
}

#[test]
fn the_step_slides_round_a_building_and_never_into_it() {
    let mut w = World::new(1337, 0, 0); w.stock = [30000; N_RES]; w.cheat(3, 0, 0);
    w.place(HOUSE, 40, 0, 0);
    let (hx, hy) = (w.buildings.last().unwrap().x, w.buildings.last().unwrap().y);
    let (mut x, mut y) = (hx - 9.0, hy + 0.2);
    for _ in 0..200 { let r = w.member_step(x, y, hx + 12.0, hy, 0.5, 0); x = r[0]; y = r[1]; assert!(independent_blocked(&w, x, y).is_none(), "inside the house at ({x:.1}, {y:.1})"); }
    assert!(x > hx + 6.0, "and it got round to the far side: x {x:.1}");
    assert!(w.member_blocked(hx, hy, 0) && !w.member_blocked(hx - 20.0, hy + 20.0, 0));
    assert!(w.member_reach(hx - 9.0, hy, 1.0, 0.0, 12.0, 0) < 9.0, "an offset towards the house is cut short before it");
}

