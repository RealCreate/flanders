//! The resource ledger: where every unit of every resource came from and went to, over the last day.
//! Derived display data only: it is never read by the rules and never enters the state hash, so replicas agree whether or not they look at it.
//! A replica that is rebuilt (or joins late) fills its ledger as it runs, so its numbers cover only the ticks it has seen (`covered`).
//! Completeness is built in: whatever the explicit notes do not explain goes to `C_OTHER` (inside a tick) or `C_ORDERS` (between ticks: the player's commands), so for every resource sources minus sinks equals the change of the stock.
use crate::catalog::N_RES;

/// A bucket covers `BUCKET` ticks and the ledger keeps `WIN` of them: a window of 240 ticks, one day.
pub const BUCKET: u64 = 10;
pub const WIN: usize = 24;
/// The categories that are not building kinds follow the kinds: category `nk + EX_*`.
pub const EXTRAS: [&str; 13] = ["villagers", "soldiers", "winter", "backup", "doves", "tax", "tithe", "toll", "port", "harvest", "merchants", "orders", "other"];
pub const EX_VILLAGERS: usize = 0; pub const EX_SOLDIERS: usize = 1; pub const EX_WINTER: usize = 2; pub const EX_BACKUP: usize = 3; pub const EX_DOVES: usize = 4;
pub const EX_TAX: usize = 5; pub const EX_TITHE: usize = 6; pub const EX_TOLL: usize = 7; pub const EX_PORT: usize = 8; pub const EX_HARVEST: usize = 9;
pub const EX_MERCHANTS: usize = 10; pub const EX_ORDERS: usize = 11; pub const EX_OTHER: usize = 12;

#[derive(Clone)]
pub struct Ledger {
    nk: usize,                         // number of building kinds: categories 0..nk are the kinds
    ncat: usize,
    gain: Vec<i32>,                    // [bucket][cat][res]
    loss: Vec<i32>,
    stamp: [u64; WIN],                 // which bucket (tick / BUCKET) each slot holds, + 1 (0 = empty)
    ticks: [u32; WIN],                 // ticks seen in each slot
    last: Option<[i32; N_RES]>,        // the stock at the end of the previous tick
    start: [i32; N_RES],
    noted: [i32; N_RES],
    slot: usize,
}

impl Ledger {
    pub fn new(nk: usize) -> Ledger {
        let ncat = nk + EXTRAS.len();
        Ledger { nk, ncat, gain: vec![0; WIN * ncat * N_RES], loss: vec![0; WIN * ncat * N_RES], stamp: [0; WIN], ticks: [0; WIN], last: None, start: [0; N_RES], noted: [0; N_RES], slot: 0 }
    }
    pub fn extra(&self, e: usize) -> usize { self.nk + e }
    fn at(&self, slot: usize, cat: usize, r: usize) -> usize { (slot * self.ncat + cat) * N_RES + r }

    /// Start of a tick (`tick` is the new tick number): anything the stock changed by since the last tick ended was done by the player's orders.
    pub fn begin(&mut self, tick: u64, stock: &[i32; N_RES]) {
        let b = tick / BUCKET + 1; self.slot = (tick / BUCKET) as usize % WIN;
        if self.stamp[self.slot] != b {
            self.stamp[self.slot] = b; self.ticks[self.slot] = 0;
            let (lo, hi) = (self.at(self.slot, 0, 0), self.at(self.slot + 1, 0, 0));
            self.gain[lo..hi].fill(0); self.loss[lo..hi].fill(0);
        }
        if let Some(last) = self.last { for r in 0..N_RES { let d = stock[r] - last[r]; if d != 0 { let c = self.extra(EX_ORDERS); self.put(c, r, d); } } }
        self.start = *stock; self.noted = [0; N_RES];
    }
    fn put(&mut self, cat: usize, r: usize, amount: i32) {
        let i = self.at(self.slot, cat, r);
        if amount > 0 { self.gain[i] += amount; } else { self.loss[i] -= amount; }
    }
    /// Record a change of `amount` (positive: a source, negative: a sink) of resource `r` by category `cat`.
    pub fn note(&mut self, cat: usize, r: usize, amount: i32) { if amount == 0 { return; } self.put(cat, r, amount); self.noted[r] += amount; }
    /// End of a tick: what nothing explained goes to "other".
    pub fn end(&mut self, stock: &[i32; N_RES]) {
        for r in 0..N_RES { let d = (stock[r] - self.start[r]) - self.noted[r]; if d != 0 { let c = self.extra(EX_OTHER); self.put(c, r, d); } }
        self.ticks[self.slot] += 1; self.last = Some(*stock);
    }
    /// The last day, flattened: `[ticks covered, number of building kinds, number of extra categories]` then `[category, resource, gained, lost]` for each non-zero entry.
    pub fn flat(&self, tick: u64) -> Vec<i32> {
        let cur = tick / BUCKET + 1;
        let live: Vec<usize> = (0..WIN).filter(|&s| self.stamp[s] != 0 && self.stamp[s] + WIN as u64 > cur && self.stamp[s] <= cur).collect();
        let covered: u32 = live.iter().map(|&s| self.ticks[s]).sum();
        let mut out = vec![covered as i32, self.nk as i32, EXTRAS.len() as i32];
        for c in 0..self.ncat { for r in 0..N_RES {
            let (g, l) = live.iter().fold((0, 0), |(g, l), &s| { let i = self.at(s, c, r); (g + self.gain[i], l + self.loss[i]) });
            if g != 0 || l != 0 { out.extend_from_slice(&[c as i32, r as i32, g, l]); }
        } }
        out
    }
}
