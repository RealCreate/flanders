//! Tests of the roads the player lays (see roadline.rs).
use super::*;

impl World {
    /// Is some node of building `i`'s ring in the same piece of the path network as the hall's?
    pub(crate) fn linked_to_hall(&self, i: usize) -> bool {
        let net = self.net();
        let (Some(h), Some(r)) = (net.ring.first(), net.ring.get(i)) else { return false };
        if i == 0 || r.is_empty() { return true; }
        let comp = |v: &Vec<u32>| v.iter().filter(|&&n| n != u32::MAX).map(|&n| net.comp[n as usize]).collect::<Vec<_>>();
        let hc = comp(h); comp(r).iter().any(|c| hc.contains(c))
    }
}

#[test]
fn scratch_nodes() {
    let mut w = World::new(1337, 0, 0); w.stock = [3000; N_RES];
    w.place(HOUSE, 16, 0, 0); w.place(HOUSE, 28, 4, 0);
    eprintln!("origin {} {} nodes {:?}", w.ox, w.oy, w.road_nodes_flat());
}
