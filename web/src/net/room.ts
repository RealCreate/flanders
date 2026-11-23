// A room of players, independent of how the bytes travel (a `Transport`): introductions, signed commands, histories, heartbeats, reconnection.
// No imports from the game or from Trystero, so the whole thing runs under plain node against a simulated network (tests/net.test.mjs).
//
// Trust model: nothing from the network is believed until it has passed three gates, in this order.
//   1. identity: a peer is introduced by a signed hello addressed to us; commands from a peer that has not been introduced wait (a few of them) until it is, and are never applied before.
//   2. signature: every command and every entry of a history is signed by the introduced key.
//   3. sanity (validate.ts): fixed fields, ranges and sizes; a strictly increasing command number; no huge jumps in time; per-peer rate limits.
// A peer that keeps sending bad data is shut out for a while (strikes fade: a hiccup is forgiven).
//
// Delivery (link.ts): a player's commands reach every other player complete and in order. Each side tells the other how far it has got; whatever is missing is sent again.
// What we know about a player is kept by their key, not by their connection, so a connection that drops and returns costs a few commands, not their whole history.
import { LIMITS, Bucket, isKey, isSigned, isTestingOp, parseCmd, cleanName, Sequence, sanitizeHash, sanitizeBuild, sanitizeHb, sanitizeEcho, sanitizeWant, sanitizeMore, type WireHash } from './validate.ts';
import { Inbox, Retx, Tail, LinkMonitor, Backoff, Strikes, rangeFrom, chunks, headOf } from './link.ts';
import { verifyText, b64, enc, helloText, type Cmd, type Signed, type Hello, type RoomHandlers, type Identity, type PeerLinkInfo } from './wire.ts';

export interface Channel<T> {
  /** Send to one peer (`target`) or to everybody in the room. Rejects when the peer is gone. */
  send(data: T, target?: string): Promise<unknown>;
  onMessage(cb: (data: T, peerId: string) => void): void;
}
/** What the room needs from the network: peers coming and going, and named channels that are ordered per peer. */
export interface Transport {
  selfId(): Promise<string>;
  onPeerJoin(cb: (peerId: string) => void): void;
  onPeerLeave(cb: (peerId: string) => void): void;
  channel<T>(name: string): Channel<T>;
  leave(): Promise<void>;
}

/** Time and the state of the device, so that a test can run an hour of play in a moment. */
export interface Env {
  now(): number;
  every(fn: () => void, ms: number): () => void;
  after(fn: () => void, ms: number): () => void;
  online(): boolean;
  hidden(): boolean;
  /** The device woke up, came back online, or the page became visible again. */
  onWake(cb: () => void): void;
}

export const browserEnv: Env = {
  now: () => Date.now(),
  every: (fn, ms) => { const t = setInterval(fn, ms); return () => clearInterval(t); },
  after: (fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); },
  online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
  hidden: () => typeof document !== 'undefined' && document.hidden,
  onWake: cb => {
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (!document.hidden) cb(); });
    if (typeof window !== 'undefined') window.addEventListener('online', cb);
  },
};

/** What we keep about a player between connections (by their key). */
interface Memory { inbox: Inbox<Cmd>; lastSeen: number; nackAt: number; fullAt: number }
type Pre = { a: 'cmd' | 'log' | 'more'; d: unknown };
interface Conn {
  id: string; pub: string | null;
  chain: Promise<void>;
  cmds: Bucket; logs: Bucket; hashes: Bucket; wants: Bucket; mores: Bucket;
  strikes: Strikes;
  pre: Pre[];
  mon: LinkMonitor; retx: Retx;
  ack: { e: number; n: number } | null;
  hbAt: number; lastState: 'good' | 'weak' | 'lost';
  /** When our hello last went to them, and whether they have answered it (a heartbeat from them proves they accepted it). */
  helloAt: number; hbSeen: boolean;
}
type Chans = Record<'hello' | 'cmd' | 'log' | 'more' | 'hash' | 'want' | 'hb' | 'hbr', Channel<unknown>>;
type Checked = Cmd | { skip: true; n: number; e: number } | null;

const HELLO_AGAIN = 3000, HB_EVERY = 2000, PRE_MAX = 400, FULL_ABOVE = 1500, FORGET_AFTER = 600_000;
/** How long after the connections went quiet (or after nobody came) the room is opened again, and the ceiling that pause grows to with every try. */
const LOST_REJOIN = [3000, 60_000], ALONE_REJOIN = [20_000, 120_000];

export class RoomCore {
  peers = new Set<string>();
  private open: () => Transport; private identity: Identity; private hello: () => Hello; private log: () => Signed[]; private h: RoomHandlers; private env: Env;
  private t: Transport | null = null;
  private gen = 0;
  private ch!: Chans;
  private conns = new Map<string, Conn>();
  private pubs = new Map<string, string>();
  private mem = new Map<string, Memory>();
  private tail = new Tail();
  private selfId = '';
  private ready: Promise<void> = Promise.resolve();
  private stopTimers: (() => void)[] = [];
  private stopLonely: () => void = () => {};
  private backoffs = { lost: new Backoff(LOST_REJOIN[0], LOST_REJOIN[1]), alone: new Backoff(ALONE_REJOIN[0], ALONE_REJOIN[1]) };
  private waitKind: 'lost' | 'alone' | null = null; private wait = 0;
  /** Since when no connection has been working (or since the room was last opened). */
  private emptySince: number;
  private rejoining = false; private left = false;
  private lastStatus = ''; private lastLinks = ''; private linksAt = 0;
  /** How many times the room was opened again after the connection went wrong (for the performance panel and for tests). */
  rejoins = 0;

  constructor(open: () => Transport, identity: Identity, hello: () => Hello, log: () => Signed[], h: RoomHandlers, env: Env = browserEnv) {
    this.open = open; this.identity = identity; this.hello = hello; this.log = log; this.h = h; this.env = env;
    this.emptySince = env.now();
    this.start();
    this.stopTimers.push(env.every(() => this.service(), 1000));
    env.onWake(() => this.woke());
  }

  // ---------- opening and closing ----------
  private start() {
    const gen = ++this.gen;
    const t = this.open();
    this.t = t;
    this.ch = { hello: t.channel('hello'), cmd: t.channel('cmd'), log: t.channel('log'), more: t.channel('more'), hash: t.channel('hash'), want: t.channel('want'), hb: t.channel('hb'), hbr: t.channel('hbr') };
    this.ready = t.selfId().then(id => { if (gen === this.gen) this.selfId = id; }).catch(() => { /* without our own id no hello can be checked, so nobody gets introduced */ });
    this.status('Looking for other players in this world…');
    this.stopLonely();
    // nobody after a while: either nobody else is here, or a strict network is blocking the direct connection. Say so, with the way out.
    this.stopLonely = this.env.after(() => { if (!this.peers.size) this.status('Nobody yet. If a friend is online in this world and you cannot see them, your network may block direct connections: set a TURN relay under Display settings → Network.'); }, 25_000);
    t.onPeerJoin(id => { if (gen === this.gen) this.joined(id); });
    t.onPeerLeave(id => { if (gen === this.gen) this.gone(id); });
    const c = this.ch;
    c.hello.onMessage((d, id) => this.on(gen, id, conn => this.queue(conn, async () => { await this.ready; await this.acceptHello(conn, d); })));
    c.cmd.onMessage((d, id) => this.on(gen, id, conn => this.queue(conn, () => this.inbound(conn, 'cmd', d))));
    c.log.onMessage((d, id) => this.on(gen, id, conn => this.queue(conn, () => this.inbound(conn, 'log', d))));
    c.more.onMessage((d, id) => this.on(gen, id, conn => this.queue(conn, () => this.inbound(conn, 'more', d))));
    // a hash is only meaningful after every command sent before it, so it goes through the same queue: a command still being checked would otherwise be overtaken by the hash that follows it,
    // and the copy would run on past the tick the command belongs to
    c.hash.onMessage((d, id) => this.on(gen, id, conn => this.queue(conn, async () => {
      if (!conn.pub || !conn.hashes.take()) return;
      const x = sanitizeHash(d); if (x) this.h.onHash(conn.id, x as WireHash);
    })));
    // a player whose copy of our village went wrong asks for our history again: we are the authority, so we only ever answer, and not more than once in a while
    c.want.onMessage((d, id) => this.on(gen, id, conn => {
      if (!conn.pub || !conn.wants.take()) return;
      const w = sanitizeWant(d); if (!w) return;
      if (w.t === 1) this.sendFull(conn); else this.sendRange(conn, w.e, w.from);
    }));
    c.hb.onMessage((d, id) => this.on(gen, id, conn => {
      const x = sanitizeHb(d); if (!x) return;
      this.send('hbr', { ts: x.ts }, conn.id);
      conn.hbSeen = true;
      if (conn.pub) { conn.ack = { e: x.e, n: x.n }; this.serve(conn); }
    }));
    c.hbr.onMessage((d, id) => this.on(gen, id, conn => { const ts = sanitizeEcho(d); if (ts !== null) conn.mon.pong(this.env.now() - ts); }));
  }

  /** A message came from a peer we know: note that the link is alive, then handle it. */
  private on(gen: number, id: string, f: (conn: Conn) => void) {
    if (gen !== this.gen) return;
    const conn = this.conns.get(id); if (!conn) return;
    const now = this.env.now();
    conn.mon.heard(now);
    if (conn.strikes.banned(now)) return;
    f(conn);
  }

  private joined(id: string) {
    if (this.conns.has(id)) return;
    const now = this.env.now();
    const conn: Conn = { id, pub: null, chain: Promise.resolve(), cmds: new Bucket(100, 600, now), logs: new Bucket(0.5, 4, now), hashes: new Bucket(8, 60, now), wants: new Bucket(0.5, 4, now), mores: new Bucket(5, 40, now),
      strikes: new Strikes(now), pre: [], mon: new LinkMonitor(now), retx: new Retx(), ack: null, hbAt: -Infinity, lastState: 'good', helloAt: now, hbSeen: false };
    this.conns.set(id, conn); this.peers.add(id);
    this.stopLonely(); this.emptySince = now; this.resetWaits();
    this.status();
    void this.helloTo(conn);
  }

  private gone(id: string) {
    const conn = this.conns.get(id); if (!conn) return;
    this.conns.delete(id); this.peers.delete(id); this.pubs.delete(id);
    if (conn.pub) { const m = this.mem.get(conn.pub); if (m) m.lastSeen = this.env.now(); }
    this.h.onLeave(id);
    if (!this.peers.size) { this.emptySince = this.env.now(); this.status('Alone in the world — share the link to invite others'); } else this.status();
  }

  /** Run a job for a peer after the ones before it: signatures are checked asynchronously, and commands must be applied in the order they arrived. */
  private queue(conn: Conn, job: () => Promise<void>) {
    conn.chain = conn.chain.then(() => (this.conns.get(conn.id) === conn ? job() : undefined)).catch(() => { /* a bad message must not stall the queue */ });
  }

  private status(s?: string) {
    if (s === undefined) {
      const n = this.peers.size;
      const rtts = [...this.conns.values()].filter(c => c.pub && c.mon.rtt !== null).map(c => c.mon.rtt as number);
      const worst = [...this.conns.values()].some(c => c.pub && c.lastState !== 'good');
      s = `${n} other player${n === 1 ? '' : 's'} nearby` + (rtts.length ? ` · ${Math.round(Math.max(...rtts))} ms` : '') + (worst ? ' · connection unstable' : '');
    }
    if (s !== this.lastStatus) { this.lastStatus = s; this.h.onStatus(s); }
  }

  // ---------- introductions ----------
  private async helloTo(conn: Conn) {
    conn.helloAt = this.env.now();
    const h = this.hello();
    try {
      const sig = b64(await crypto.subtle.sign('Ed25519', this.identity.key, enc.encode(helloText(h, conn.id))));
      this.send('hello', { ...h, sig }, conn.id);
    } catch { /* the identity could not sign: nobody gets introduced */ }
  }

  private async acceptHello(conn: Conn, d: unknown) {
    const x = d as Partial<Hello> | null;
    const build = sanitizeBuild(d);
    const ok = !!x && !!build && isKey(x.pub) && typeof x.sig === 'string' && x.sig.length <= LIMITS.maxSigChars && Number.isInteger(x.site) && (x.site as number) >= 0 && (x.site as number) < 4096
      && typeof x.world === 'string' && x.world.length <= 64 && typeof x.name === 'string' && x.name.length <= 80 && typeof x.tick === 'number';
    if (!ok || !this.selfId) return this.strike(conn, 'an invalid hello');
    const h = x as Hello;
    if (!(await verifyText(h.pub, helloText(h, this.selfId), h.sig!))) return this.strike(conn, 'a hello with a bad signature', 3);
    const first = conn.pub === null;
    conn.pub = h.pub; this.pubs.set(conn.id, h.pub);
    let m = this.mem.get(h.pub);
    if (!m) { m = { inbox: new Inbox<Cmd>(), lastSeen: this.env.now(), nackAt: -Infinity, fullAt: -Infinity }; this.mem.set(h.pub, m); }
    m.lastSeen = this.env.now();
    this.h.onHello(conn.id, { pub: h.pub, site: h.site, name: cleanName(h.name), tick: h.tick, world: h.world, v: build!.v, rules: build!.rules, b: build!.b });
    if (first) {
      // what arrived before the introduction is looked at now, in the order it came
      const pre = conn.pre; conn.pre = [];
      for (const p of pre) await this.inbound(conn, p.a, p.d);
      this.sendHb(conn);
    }
  }

  /** Count a misbehaving message; a peer that keeps doing it is ignored for a while (strikes fade, so a hiccup is forgiven). */
  private strike(conn: Conn, why: string, weight = 1) {
    const first = conn.strikes.value === 0 && !conn.strikes.banned(this.env.now());
    if (first) this.h.onStatus(`Ignored ${why} from another player.`);
    if (conn.strikes.add(this.env.now(), weight)) this.h.onStatus('A player was cut off for a while for sending bad data.');
  }

  // ---------- what comes in ----------
  private async inbound(conn: Conn, a: Pre['a'], d: unknown) {
    if (!conn.pub) { if (conn.pre.length < PRE_MAX) conn.pre.push({ a, d }); return; }   // before the introduction: wait, do not apply
    const m = this.mem.get(conn.pub); if (!m) return;
    m.lastSeen = this.env.now();
    if (a === 'cmd') {
      if (!conn.cmds.take()) return this.strike(conn, 'too many commands', 0.2);
      const c = await this.check(conn, d); if (!c) return;
      this.deliver(conn, m, 'skip' in c ? m.inbox.push({ op: 'cheat', n: c.n, tick: 0, e: c.e } as Cmd, true) : m.inbox.push(c));
    } else if (a === 'more') {
      if (!conn.mores.take()) return;
      const x = sanitizeMore(d); if (!x) return this.strike(conn, 'a malformed piece of history');
      let after = x.after;
      for (const s of x.cmds) {
        const c = await this.check(conn, s); if (!c) break;
        this.deliver(conn, m, 'skip' in c ? m.inbox.push({ op: 'cheat', n: c.n, tick: 0, e: c.e } as Cmd, true, after) : m.inbox.push(c, false, after));
        after = c.n;
      }
    } else await this.acceptLog(conn, m, d);
  }

  private deliver(conn: Conn, m: Memory, res: ReturnType<Inbox<Cmd>['push']>) {
    for (const c of res.out) this.h.onCmd(conn.id, c);
    if (res.bad) this.strike(conn, 'a command out of order');
    const now = this.env.now();
    if (res.askFull || (res.askFrom !== undefined && m.inbox.ack.n < 0)) {
      // we know nothing of their history (or of this life of it): the whole of it is what helps, and it is cheaper to replay in one go than command by command
      if (now - m.fullAt > 3000) { m.fullAt = now; this.requestLog(conn.id); }
    } else if (res.askFrom !== undefined && now - m.nackAt > 500) {
      m.nackAt = now; this.send('want', { t: 2, e: m.inbox.ack.e, from: res.askFrom }, conn.id);
    }
  }

  private async acceptLog(conn: Conn, m: Memory, d: unknown) {
    if (!conn.logs.take()) return this.strike(conn, 'too many histories', 0.5);
    if (!Array.isArray(d) || d.length > LIMITS.maxLogEntries) return this.strike(conn, 'an oversized history');
    const out: Cmd[] = []; let skipped = -1;
    for (const s of d) {
      const c = await this.check(conn, s);
      if (c && 'skip' in c) { skipped = Math.max(skipped, c.n); continue; }
      if (c) out.push(c); else break;   // the first bad entry ends the history: what follows it cannot be trusted
    }
    const kept = Sequence.checkLog(out);
    if (kept.length !== out.length) this.strike(conn, 'a history out of order');
    const epoch = kept.length ? kept[0].e ?? 0 : 0;
    if (kept.length && epoch < m.inbox.seq.epoch) return;   // the history of a life they have restarted away from: replaying it must not bring that village back
    const res = m.inbox.loadLog(kept, skipped);
    this.h.onLog(conn.id, kept);
    this.deliver(conn, m, res);
    this.sendHb(conn);   // our ack changed: say so at once, it is what stops them sending it again
  }

  /** A signed message from an introduced peer, checked and decoded; null when anything is wrong (and the peer gets a strike). A testing-tool command is not an attack, only not something the network accepts: it counts for the numbering. */
  private async check(conn: Conn, s: unknown): Promise<Checked> {
    const pub = conn.pub; if (!pub) return null;
    if (!isSigned(s)) { this.strike(conn, 'a malformed command'); return null; }
    if (!(await verifyText(pub, s.cmd, s.sig))) { this.strike(conn, 'a command with a bad signature', 3); return null; }
    if (isTestingOp(s.cmd)) {
      const head = headOf(s.cmd);
      if (!head) { this.strike(conn, 'a command that makes no sense'); return null; }
      return { skip: true, n: head.n, e: head.e };
    }
    const c = parseCmd(s.cmd); if (!c) { this.strike(conn, 'a command that makes no sense', 2); return null; }
    return c as Cmd;
  }

  // ---------- what goes out ----------
  private send(name: keyof Chans, data: unknown, target?: string) {
    const ch = this.t ? this.ch[name] : null; if (!ch) return;
    try { ch.send(data, target).catch(() => { /* the peer left: whatever it missed is sent again when it is back */ }); } catch { /* same */ }
  }

  private sendFull(conn: Conn) { this.send('log', this.log(), conn.id); conn.retx.sent(this.env.now()); }

  /** Send the commands from number `from` on (or the whole history when that is cheaper or when the other side is in another epoch). */
  private sendRange(conn: Conn, e: number, from: number) {
    const log = this.log();
    const r = rangeFrom(log, e, from);
    if (r.full || r.items.length > FULL_ABOVE || from <= 0) return this.sendFull(conn);
    for (const c of chunks(r.items, r.after)) this.send('more', c, conn.id);
    conn.retx.sent(this.env.now());
  }

  /** Send what the peer is missing, if its last ack says it is missing something and has been for a while. */
  private serve(conn: Conn) {
    const plan = conn.retx.plan(this.env.now(), conn.ack, this.tail.of(this.log()));
    if (plan.kind === 'full') this.sendFull(conn);
    else if (plan.kind === 'more' && conn.ack) this.sendRange(conn, conn.ack.e, plan.from);
  }

  private sendHb(conn: Conn) {
    if (!conn.pub) return;
    const m = this.mem.get(conn.pub); if (!m) return;
    conn.hbAt = this.env.now();
    this.send('hb', { ts: conn.hbAt, ...m.inbox.ack }, conn.id);
  }

  announce() { for (const c of this.conns.values()) void this.helloTo(c); }
  broadcastCmd(s: Signed) { if (this.peers.size) this.send('cmd', s); }
  /** Send our whole history to everybody (after the history was replaced: a restart that was undone). */
  pushLog() { if (this.peers.size) { this.send('log', this.log()); const now = this.env.now(); for (const c of this.conns.values()) c.retx.sent(now); } }
  broadcastHash(msg: WireHash) { if (this.peers.size) this.send('hash', msg); }
  /** Ask a player for their whole history again (our copy of their village went wrong). */
  requestLog(peerId: string) { this.send('want', { t: 1 }, peerId); }
  pubOf(peerId: string) { return this.pubs.get(peerId); }
  /** What we have kept of a player's history is out of date (their copy was dropped): the next thing they send must be all of it. */
  forget(pub: string) { this.mem.delete(pub); for (const c of this.conns.values()) if (c.pub === pub) { c.ack = null; this.requestLog(c.id); } }
  /** Our own id in this room (empty until the room has told us). */
  get self() { return this.selfId; }
  /** How every connection is doing. */
  links(): PeerLinkInfo[] { const now = this.env.now(); return [...this.conns.values()].map(c => ({ peerId: c.id, pub: c.pub, rtt: c.mon.rtt, state: c.mon.state(now), heardAgo: c.mon.age(now) })); }

  leave() {
    this.left = true; this.stopLonely(); for (const s of this.stopTimers) s(); this.stopTimers = [];
    const t = this.t; this.t = null; this.gen++;
    if (t) void t.leave().catch(() => { /* already gone */ });
  }

  // ---------- keeping the connection up ----------
  /** Once a second: heartbeats, resending what is missing, link quality, and opening the room again when nothing works. */
  private service() {
    if (this.left) return;
    const now = this.env.now();
    for (const [pub, m] of this.mem) if (now - m.lastSeen > FORGET_AFTER && ![...this.conns.values()].some(c => c.pub === pub)) this.mem.delete(pub);
    let changed = false;
    for (const c of this.conns.values()) {
      if (!c.hbSeen && now - c.helloAt >= HELLO_AGAIN) void this.helloTo(c);   // our hello may have been lost: say it again until they answer
      if (c.pub && now - c.hbAt >= HB_EVERY) this.sendHb(c);
      if (c.pub) this.serve(c);
      const st = c.mon.state(now);
      if (st !== c.lastState) { c.lastState = st; changed = true; }
    }
    if (changed) this.status();
    const links = this.links();
    const sig = links.map(l => `${l.peerId}:${l.state}:${l.rtt === null ? '' : Math.round(l.rtt / 10)}`).join(',');
    if (this.h.onLinks && (sig !== this.lastLinks || now - this.linksAt > 5000)) { this.lastLinks = sig; this.linksAt = now; this.h.onLinks(links); }
    this.supervise(now);
  }

  private resetWaits() { this.backoffs.lost.reset(); this.backoffs.alone.reset(); this.waitKind = null; }

  /** Nobody is reachable (nobody came, or everybody has gone quiet): open the room again, after a pause that grows each time. */
  private supervise(now: number) {
    if (this.rejoining) return;
    if (!this.env.online()) { this.status('Offline — waiting for the network to come back…'); return; }
    const healthy = this.t !== null && [...this.conns.values()].some(c => c.pub && c.mon.state(now) !== 'lost');
    if (healthy) { this.emptySince = now; this.resetWaits(); return; }
    // (a hidden page's timers cannot be trusted: wait until it is looked at)
    if (this.env.hidden()) { this.emptySince = now; return; }
    const kind = this.conns.size ? 'lost' : 'alone';
    if (this.waitKind !== kind) { this.waitKind = kind; this.wait = this.backoffs[kind].peek(); if (kind === 'lost') this.emptySince = now; }
    if (now - this.emptySince >= this.wait) void this.rejoin(kind);
  }

  private async rejoin(kind: 'lost' | 'alone') {
    if (this.rejoining || this.left) return;
    this.rejoining = true; this.rejoins++;
    this.backoffs[kind].next(); this.wait = this.backoffs[kind].peek(); this.emptySince = this.env.now();
    const old = this.t; this.gen++; this.t = null;
    try {
      for (const id of [...this.conns.keys()]) this.gone(id);   // everybody on the old connections is gone with it
      this.status('Reconnecting…');
      if (old) await old.leave().catch(() => { /* already gone */ });
      if (!this.left) this.start();
    } catch { this.t = null; /* the next round tries again */ }
    this.rejoining = false;
  }

  /** The device woke up, the network came back or the page was shown: whatever the connections did meanwhile, ask them now. */
  private woke() {
    if (this.left) return;
    const now = this.env.now();
    for (const c of this.conns.values()) { c.mon.heard(now); c.lastState = 'good'; this.sendHb(c); }
    if (!this.conns.size || this.t === null) this.emptySince = Math.min(this.emptySince, now - this.wait + 2000);
  }
}
