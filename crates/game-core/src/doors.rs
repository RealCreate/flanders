//! Where every building's front door is, and the short road that runs from it out of the building's plot to the village's network.
//!
//! The door positions are read off the models that the client draws (web/src/render/buildings.ts: the boxes of the door material), in the model's own frame (x right, z forward, the
//! building's middle at the origin). A building turned by `rot` quarter-eighths has the whole model turned about the vertical, so a model point (x, z) lands at
//! (x cos + z sin, -x sin + z cos) from its middle (the same frame as `pathnet::in_fields`). web/tests/doors.test.mjs checks this table against the models, so it cannot drift.
use super::*;

/// The door of a building of this kind and tier in its own frame, as (x, z), and the way it faces (a unit vector; the road leaves the door along it). Kinds that have no door in the
/// model (the open places: park, garden, market, the mines and so on) get a doorstep on the edge of what they are, facing forward.
pub fn door_local(kind: u8, tier: u8) -> ((f32, f32), (f32, f32)) {
    let t = (tier as usize).min(3);
    let fwd = (0.0f32, 1.0f32);
    match kind {
        HOUSE => ([(0.8, 1.6), (-0.9, 1.7), (0.0, 1.8), (0.0, 2.0)][t], fwd),
        FARM => ((-1.2, -5.95), (0.0, -1.0)),                             // the door is in the back wall of the barn, away from the fields: the road leaves behind the farm
        TOWER => ([(0.0, 1.0), (0.0, 2.0), (0.0, 2.1), (0.0, 2.5)][t], fwd),
        48 => ((-0.3, 0.8), fwd),                                         // forester (its hut door is off the middle)
        4 => ((0.0, 1.0), fwd),                                           // woodcutter
        11 => (if t == 0 { (2.0, 0.7) } else { (2.0, 0.65) }, fwd),       // charcoal burner (its hut door stands to one side)
        14 => ((0.0, 1.8), fwd),                                          // mint
        TOWN_HALL => ([(0.0, 2.8), (0.0, 2.9), (0.0, 3.2), (1.6, 23.3)][t], fwd),
        CHAPEL => (([2.9, 3.6, 4.5, 5.3][t], 0.0), (1.0, 0.0)),           // the door is in the end wall
        LODGE => ([(0.0, 1.9), (0.0, 2.0), (0.0, 2.1), (0.0, 2.3)][t], fwd),
        BARRACKS => ((0.0, -0.9), (0.0, -1.0)),
        STOREHOUSE => ([(0.0, 2.2), (0.0, 2.4), (0.0, 2.5), (0.0, 2.7)][t], fwd),
        KEEP => ([(0.0, 2.4), (0.0, 3.6), (0.0, 4.3), (0.0, 4.8)][t], fwd),
        COURTHOUSE => ((0.0, 2.5), fwd),
        WATERWHEEL => ((0.0, 1.8), fwd),
        PORT => ((-1.5, 1.0), fwd),
        TOLL => ((1.5, -0.2), (-1.0, 0.0)),                               // the keeper's door looks onto the road that runs through the gate
        FISHING_HUT => ((-0.6, 1.3), fwd),
        SMOKEHOUSE => (([0.6, 0.8, 0.9, 1.0][t], 1.5), fwd),
        BAKERY => (([-0.8, -0.9, -1.1, -1.2][t], 1.4), fwd),
        GARDEN => ((0.0, 4.4), fwd),                                      // the gap in the fence
        PASTURE | PIGSTY => ((0.0, 4.4), fwd),
        STABLE => ((0.0, 2.65), fwd),
        EMBASSY => ((0.0, -9.07), fwd),
        PARK => ((0.0, 1.3), fwd),                                        // along the gravel cross
        MARKET => ((0.0, 5.0), fwd),
        _ => ((0.0, solid_radius(kind, tier) * 0.9), fwd),
    }
}

/// The turn of a building as (cos, sin): a model point (x, z) lands at (x cos + z sin, -x sin + z cos) from its middle.
fn turn(rot: u8) -> (f32, f32) { let th = (rot & 7) as f32 * std::f32::consts::FRAC_PI_4; (th.cos(), th.sin()) }
pub(crate) fn to_world(rot: u8, p: (f32, f32)) -> (f32, f32) { let (c, s) = turn(rot); (p.0 * c + p.1 * s, -p.0 * s + p.1 * c) }

/// Where the door's road leaves the plot: the point on the circle of the building's ring (`pathnet::ring_radius`, beyond its footprint and all its fields) that the road reaches by
/// running straight from the door along the way the door faces, in the model's frame. A door that faces away from the circle's inside (never happens for the table) falls back to the
/// point of the circle in the door's own direction.
pub fn exit_local(kind: u8, tier: u8) -> (f32, f32) {
    let (d, f) = door_local(kind, tier);
    let r = pathnet::ring_radius(kind, tier);
    // |d + t f| = r, t > 0
    let (b, c) = (d.0 * f.0 + d.1 * f.1, d.0 * d.0 + d.1 * d.1 - r * r);
    let disc = b * b - c;
    if disc >= 0.0 { let t = -b + disc.sqrt(); if t >= 0.0 { return (d.0 + f.0 * t, d.1 + f.1 * t); } }
    let l = d.0.hypot(d.1).max(1e-3); (d.0 / l * r, d.1 / l * r)
}

/// The door of a building in the world, and the point where its road leaves the plot (both absolute).
pub(crate) fn door_world(b: &Building) -> ((f32, f32), (f32, f32)) {
    let (d, e) = (to_world(b.rot, door_local(b.kind, b.tier).0), to_world(b.rot, exit_local(b.kind, b.tier)));
    ((b.x + d.0, b.y + d.1), (b.x + e.0, b.y + e.1))
}

/// The angle (from the building's middle) at which the ring of path round it starts: the node of the ring at the door's exit point, so that every road of the building leaves from there.
pub(crate) fn exit_angle(b: &Building) -> f32 { let e = to_world(b.rot, exit_local(b.kind, b.tier)); e.1.atan2(e.0) }

#[wasm_bindgen]
/// A building's door for the client's models: [door x, door z, facing x, facing z, exit x, exit z] in the model's own frame.
pub fn door_info(kind: u8, tier: u8) -> Vec<f32> {
    let (d, f) = door_local(kind, tier); let e = exit_local(kind, tier);
    vec![d.0, d.1, f.0, f.1, e.0, e.1]
}
