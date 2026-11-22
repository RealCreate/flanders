// A simulated network for the room (net/room.ts): virtual time, and links that drop, repeat, delay, reorder, go quiet without saying so, and come back under a new id.
// Nothing here is the game; the commands are real signed commands, so signatures, the gates and the delivery rules all run for real.
import { RoomCore } from '../src/net/room.ts';
import { Identity } from '../src/net/wire.ts';

/** A seeded random stream, so a failing run can be repeated. */
export function rng(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

/** Virtual time: timers run when the test advances the clock, after every step the pending signature checks are let finish. */
export class Clock {
  t = 1_000_000; timers = []; seq = 0;
  now = () => this.t;
  after = (fn, ms) => { const x = { at: this.t + ms, fn, seq: this.seq++, dead: false }; this.timers.push(x); return () => { x.dead = true; }; };
  every = (fn, ms) => { const x = { at: this.t + ms, fn, seq: this.seq++, dead: false, every: ms }; this.timers.push(x); return () => { x.dead = true; }; };
  async settle() { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); }
  /** Run `ms` of virtual time in steps of 25 ms. */
  async advance(ms) {
    const end = this.t + ms;
    while (this.t < end) {
      this.t = Math.min(end, this.t + 25);
      for (;;) {
        this.timers = this.timers.filter(x => !x.dead);
        const due = this.timers.filter(x => x.at <= this.t).sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
        if (!due) break;
        if (due.every) due.at += due.every; else due.dead = true;
        due.fn();
      }
      await this.settle();
    }
  }
}

export class Net {
  constructor(clock, seed = 1) { this.clock = clock; this.rand = rng(seed); this.nodes = new Map(); this.down = new Set(); this.cfg = { loss: 0, dup: 0, latency: [20, 60], reorder: false, discover: 2000 }; this.nextId = 1; this.sent = 0; this.dropped = 0; }
  key(a, b) { return [a, b].sort().join('|'); }
  /** A new transport for a player; it finds the others `discover` ms later, as the signalling relays would. */
  open(name) {
    const id = `${name}#${this.nextId++}`;
    const node = { id, name, peers: new Set(), joinCb: [], leaveCb: [], chans: new Map(), alive: true, lastArrive: new Map() };
    this.nodes.set(id, node);
    const net = this;
    const tr = {
      id,
      selfId: async () => id,
      onPeerJoin: cb => { node.joinCb.push(cb); },
      onPeerLeave: cb => { node.leaveCb.push(cb); },
      channel: name => {
        const ch = { handlers: [] }; node.chans.set(name, ch);
        return {
          send: async (d, target) => {
            if (!node.alive) throw new Error('left');
            const targets = target ? [target] : [...node.peers];
            if (target && !node.peers.has(target)) throw new Error('peer not connected');
            const text = JSON.stringify(d);
            for (const to of targets) net.deliver(node, to, name, text);
          },
          onMessage: cb => { ch.handlers.push(cb); },
        };
      },
      leave: async () => { node.alive = false; for (const p of [...node.peers]) net.unlink(id, p); net.nodes.delete(id); },
    };
    this.clock.after(() => this.discover(), this.cfg.discover);
    return tr;
  }
  /** Connect every pair of open nodes that are not yet connected (and not cut off from each other). */
  discover() {
    const ids = [...this.nodes.keys()];
    for (const a of ids) for (const b of ids) {
      if (a >= b) continue;
      const A = this.nodes.get(a), B = this.nodes.get(b);
      if (!A.alive || !B.alive || A.peers.has(b) || this.down.has(this.key(A.name, B.name)) || this.cut?.has(this.key(A.name, B.name))) continue;
      if (A.name === B.name) continue;
      this.link(a, b);
    }
  }
  link(a, b) {
    const A = this.nodes.get(a), B = this.nodes.get(b);
    A.peers.add(b); B.peers.add(a);
    for (const cb of A.joinCb) cb(b);
    for (const cb of B.joinCb) cb(a);
  }
  unlink(a, b) {
    const A = this.nodes.get(a), B = this.nodes.get(b);
    if (A?.peers.delete(b)) for (const cb of A.leaveCb) cb(b);
    if (B?.peers.delete(a)) for (const cb of B.leaveCb) cb(a);
  }
  /** A connection that dies and is noticed: both sides are told. They find each other again by themselves (under new ids only if they reopen). */
  drop(nameA, nameB) {
    for (const A of [...this.nodes.values()]) for (const p of [...A.peers]) { const B = this.nodes.get(p); if (A.name === nameA && B?.name === nameB) this.unlink(A.id, p); }
  }
  /** Messages between two players vanish without anybody being told (a link that went quiet). */
  silence(nameA, nameB) { (this.down ??= new Set()).add(this.key(nameA, nameB)); }
  restore(nameA, nameB) { this.down.delete(this.key(nameA, nameB)); }
  deliver(from, to, name, text) {
    const to_ = this.nodes.get(to); this.sent++;
    if (!to_ || !to_.alive) return;
    const pair = this.key(from.name, to_.name);
    if (this.down.has(pair)) { this.dropped++; return; }
    if (this.rand() < this.cfg.loss) { this.dropped++; return; }
    const copies = this.rand() < this.cfg.dup ? 2 : 1;
    for (let i = 0; i < copies; i++) {
      const [lo, hi] = this.cfg.latency;
      let at = this.clock.t + lo + this.rand() * (hi - lo);
      if (!this.cfg.reorder) { const last = to_.lastArrive.get(from.id) ?? 0; at = Math.max(at, last + 1); to_.lastArrive.set(from.id, at); }   // an ordered link: nothing overtakes
      this.clock.after(() => {
        const n = this.nodes.get(to); if (!n || !n.alive || !n.peers.has(from.id)) return;
        if (this.down.has(pair)) return;
        for (const h of n.chans.get(name)?.handlers ?? []) h(JSON.parse(text), from.id);
      }, Math.max(0, at - this.clock.t));
    }
  }
}

/** A player: a key, a history, a room, and what it believes of everybody else's history. */
export class Player {
  static async make(name, net, clock, opts = {}) {
    const p = new Player(); p.name = name; p.net = net; p.clock = clock;
    p.id = await Identity.load('sim-' + name + Math.random());
    p.log = []; p.n = 0; p.toolsUsed = 0; p.view = new Map(); p.byPeer = new Map(); p.logsLoaded = new Map(); p.status = []; p.hellos = []; p.leaves = 0; p.outOfOrder = 0; p.hashes = 0; p.links = [];
    p.build = opts.build ?? { v: 4, rules: 'aa', b: 1 };
    p.room = new RoomCore(() => net.open(name), p.id, () => ({ pub: p.id.pub, site: opts.site ?? 1, name, tick: 0, world: 'w', ...p.build }), () => p.log, {
      onStatus: s => p.status.push(s),
      onHello: (peer, h) => { p.byPeer.set(peer, h.pub); p.hellos.push(h); if (!p.view.has(h.pub)) p.view.set(h.pub, []); },
      onCmd: (peer, c) => {
        const v = p.view.get(p.byPeer.get(peer)); if (!v) return;
        if (c.op === 'restart') { v.length = 0; v.push(c); return; }
        const last = v[v.length - 1]; if (last && c.n <= last.n && (c.e ?? 0) === (last.e ?? 0)) p.outOfOrder++;
        v.push(c);
      },
      onLog: (peer, cmds) => { const k = p.byPeer.get(peer); p.view.set(k, cmds.slice()); p.logsLoaded.set(k, (p.logsLoaded.get(k) ?? 0) + 1); },
      onHash: () => { p.hashes++; },
      onLeave: () => { p.leaves++; },
      onLinks: l => { p.links = l; },
    }, { now: clock.now, every: clock.every, after: clock.after, online: () => p.online ?? true, hidden: () => false, onWake: cb => { p.wake = cb; } });
    return p;
  }
  /** Issue a command: signed, put in our history, sent to everybody (as the game does). */
  async say(extra = {}, tool = false) {
    const cmd = { op: tool ? 'cheat' : 'place', kind: 0, x: this.n % 50, y: 1, rot: 0, tick: Math.floor(this.clock.t / 1000) % 100000, n: this.n++, ...extra };
    const s = await this.id.sign(cmd);
    this.log.push(s); if (tool) this.toolsUsed++;
    this.room.broadcastCmd(s);
    return cmd;
  }
  /** What we should hold of this player's history: everything except the testing tools. */
  get shareable() { return this.log.map(s => JSON.parse(s.cmd)).filter(c => c.op !== 'cheat' && c.op !== 'flatten'); }
  ns(of) { return (this.view.get(of.id.pub) ?? []).map(c => c.n); }
  /** True when this player's copy of `of` is exactly `of`'s shareable history, in order, with no repeats. */
  has(of) { const mine = this.ns(of), want = of.shareable.map(c => c.n); return mine.length === want.length && mine.every((n, i) => n === want[i]); }
}

export async function everyoneHasEveryone(players) { return players.every(a => players.every(b => a === b || a.has(b))); }
