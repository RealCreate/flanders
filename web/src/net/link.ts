// The reliable part of multiplayer: what makes a stream of commands arrive complete and in order over a link that drops, repeats, reorders and disconnects.
// No imports from the game or the transport, so it runs under plain node (tests/link.test.mjs, tests/net.test.mjs).
//
// The model: every player has ONE history (their own signed commands, numbered 0, 1, 2, … inside an epoch) and everybody else keeps a copy of it.
//   * The receiver delivers commands strictly in order. A command that is ahead of a gap is held, not applied and not thrown away, and the missing range is asked for at once.
//   * The receiver tells the sender how far it has got (an `ack`: epoch and last number). That is the only thing the sender needs: whatever lies after it is resent when
//     the ack stops moving, so a lost command, a lost request or a lost answer all heal by themselves. After a reconnect the first ack says what to send, so a blip of two
//     seconds costs a few commands and not the whole history.
//   * Only when the receiver knows nothing of the sender (or is in another epoch) is the whole history sent.
import { Sequence } from './validate.ts';

export interface Ordered { n: number; tick: number; e?: number; op?: string }

export interface PushResult<T> {
  /** Commands to apply now, in order. */
  out: T[];
  /** A command that is in order by number but not by its clock: the sender is faulty or hostile. */
  bad: boolean;
  /** A gap: the number from which we need the sender's commands. */
  askFrom?: number;
  /** A command of an epoch we have not seen the start of: only their whole history helps. */
  askFull: boolean;
}

/** The commands of one player as they reach us: put in order, deduplicated, with gaps noticed. */
export class Inbox<T extends Ordered> {
  readonly seq = new Sequence();
  private held = new Map<string, { c: T; skip: boolean }>();
  /** Most commands held while waiting for a gap to be filled; beyond that they are dropped (the ack brings them again). */
  static readonly MAX_HELD = 4000;

  /** What we tell the sender: the epoch we are in and the last number we have, in order, without gaps. -1: nothing yet. */
  get ack() { return { e: this.seq.epoch, n: this.seq.lastN }; }
  get heldCount() { return this.held.size; }

  /** One command arrived. `skip` marks one that counts for the numbering but is never applied (a testing tool). `after` (from a range the sender chose) is the number of the
   *  sender's command just before this one: when it is a number we already have, nothing lies in between and the gap is not a gap. */
  push(c: T, skip = false, after?: number): PushResult<T> {
    const res: PushResult<T> = { out: [], bad: false, askFull: false };
    this.accept(c, skip, after, res);
    this.drain(res);
    return res;
  }

  /** A whole checked history replaced what we knew (`lastSkippedN`: the highest number among the testing-tool entries that were left out of it). Commands held behind it are released. */
  loadLog(kept: T[], lastSkippedN = -1): PushResult<T> {
    const res: PushResult<T> = { out: [], bad: false, askFull: false };
    const old = this.seq.epoch;
    this.seq.resetTo(kept);
    if (lastSkippedN > this.seq.lastN && (kept.length === 0 || (kept[kept.length - 1].e ?? 0) === this.seq.epoch)) this.seq.lastN = lastSkippedN;
    if (this.seq.epoch !== old) this.forgetOtherEpochs();
    this.drain(res);
    return res;
  }

  private key(e: number, n: number) { return e + ':' + n; }
  private hold(c: T, skip: boolean) {
    if (this.held.size >= Inbox.MAX_HELD) return;
    this.held.set(this.key(c.e ?? 0, c.n), { c, skip });
  }
  private forgetOtherEpochs() { for (const [k, v] of this.held) if ((v.c.e ?? 0) < this.seq.epoch) this.held.delete(k); }

  private accept(c: T, skip: boolean, after: number | undefined, res: PushResult<T>) {
    const s = this.seq, e = c.e ?? 0;
    if (c.op === 'restart' && !skip) {
      if (s.classify(c) === 'ok') { this.forgetOtherEpochs(); res.out.push(c); }
      return;
    }
    if (e < s.epoch) return;                                   // a life they have left behind
    if (e > s.epoch) { this.hold(c, skip); res.askFull = true; return; }   // we have not seen the restart that begins it
    if (c.n <= s.lastN) return;                                // we have it already
    if (c.n > s.lastN + 1) {
      if (after !== undefined && after <= s.lastN) s.lastN = c.n - 1;   // the sender says nothing lies between: take it from here
      else { this.hold(c, skip); res.askFrom = s.lastN + 1; return; }
    }
    this.take(c, skip, res);
  }

  private take(c: T, skip: boolean, res: PushResult<T>) {
    if (skip) { this.seq.lastN = c.n; return; }
    const k = this.seq.classify(c);
    if (k === 'ok') res.out.push(c); else if (k === 'bad') res.bad = true;
  }

  /** Release what the last command made contiguous. */
  private drain(res: PushResult<T>) {
    const s = this.seq;
    for (;;) {
      const next = this.held.get(this.key(s.epoch, s.lastN + 1));
      if (!next) break;
      this.held.delete(this.key(s.epoch, s.lastN + 1));
      const before = s.lastN;
      this.take(next.c, next.skip, res);
      if (s.lastN === before) break;   // refused (a bad clock): do not spin on it
    }
    if (this.held.size) for (const [k, v] of this.held) if ((v.c.e ?? 0) < s.epoch || ((v.c.e ?? 0) === s.epoch && v.c.n <= s.lastN)) this.held.delete(k);
  }
}

/** The epoch and number of a signed command's text, or null when it does not say. */
export function headOf(text: string): { e: number; n: number } | null {
  try { const o = JSON.parse(text) as { n?: unknown; e?: unknown }; if (typeof o.n === 'number' && Number.isInteger(o.n)) return { e: typeof o.e === 'number' ? o.e : 0, n: o.n }; } catch { /* not a command */ }
  return null;
}

export interface Entry { cmd: string; sig: string }

/** The last command of a history (cached: it is asked for every second). */
export class Tail {
  private seen: Entry | undefined; private len = -1; private head: { e: number; n: number } | null = null;
  of(log: readonly Entry[]): { e: number; n: number } | null {
    if (!log.length) return null;
    const last = log[log.length - 1];
    if (last !== this.seen || log.length !== this.len) { this.seen = last; this.len = log.length; this.head = headOf(last.cmd); }
    return this.head;
  }
}

/** What follows `from` in a history: `full` when the history is of another epoch than the one asked about (only a whole history helps then). `after` is the number of the entry
 *  just before the first one returned (-1 when the range begins at the start), which lets the receiver tell a gap from a number that was never used. */
export function rangeFrom(log: readonly Entry[], e: number, from: number): { full: boolean; items: Entry[]; after: number } {
  if (!log.length) return { full: false, items: [], after: -1 };
  const first = headOf(log[0].cmd);
  if (!first || first.e !== e) return { full: true, items: [], after: -1 };
  let lo = 0, hi = log.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; const h = headOf(log[mid].cmd); if (h && h.n >= from) hi = mid; else lo = mid + 1; }
  const prev = lo > 0 ? headOf(log[lo - 1].cmd) : null;
  return { full: false, items: log.slice(lo), after: prev ? prev.n : -1 };
}

/** Cut a range into messages of at most `size` entries, each with the number that came before it. */
export function chunks(items: readonly Entry[], after: number, size = 300): { after: number; cmds: Entry[] }[] {
  const out: { after: number; cmds: Entry[] }[] = [];
  let prev = after;
  for (let i = 0; i < items.length; i += size) {
    const part = items.slice(i, i + size);
    out.push({ after: prev, cmds: part });
    const h = headOf(part[part.length - 1].cmd); prev = h ? h.n : prev;
  }
  return out;
}

export type Retransmit = { kind: 'none' } | { kind: 'full' } | { kind: 'more'; from: number };

/** Decides, for one peer, when to send them what they are missing. It looks only at their last ack and ours: if the ack does not move for a while, something was lost, and the answer
 *  is to send again from it. The wait doubles while nothing moves, so a peer that has gone away is not flooded. */
export class Retx {
  static readonly BASE = 1500; static readonly MAX = 12_000;
  private rto = Retx.BASE; private seenN = -2; private seenE = -1; private at = -Infinity; private fulls = 0;
  /** `ack`: what the peer last told us. `tail`: the last command of our history. */
  plan(now: number, ack: { e: number; n: number } | null, tail: { e: number; n: number } | null): Retransmit {
    if (!ack || !tail) return { kind: 'none' };
    if (ack.e !== tail.e) {
      // another epoch (they never saw our history, we restarted, or we took a restart back): only the whole history helps, and it is large, so ask less often
      if (now - this.at < Math.max(this.rto, 5000) * (1 + Math.min(this.fulls, 4))) return { kind: 'none' };
      this.at = now; this.fulls++; this.rto = Math.min(this.rto * 2, Retx.MAX); this.seenE = ack.e; this.seenN = ack.n;
      return { kind: 'full' };
    }
    this.fulls = 0;
    if (ack.n >= tail.n) { this.rto = Retx.BASE; this.seenN = ack.n; this.seenE = ack.e; return { kind: 'none' }; }
    const first = this.seenN === -2 || this.seenE !== ack.e;
    const moved = ack.n > this.seenN && !first;
    this.seenN = ack.n; this.seenE = ack.e;
    if (moved) { this.rto = Retx.BASE; this.at = now; return { kind: 'none' }; }   // it is getting there: give it time
    if (!first && now - this.at < this.rto) return { kind: 'none' };
    this.at = now; if (!first) this.rto = Math.min(this.rto * 2, Retx.MAX);
    return { kind: 'more', from: ack.n + 1 };
  }
  /** We just sent them something because they asked: do not send the same again at once. */
  sent(now: number) { this.at = now; }
  /** Their link is new: forget what we knew about it. */
  reset() { this.rto = Retx.BASE; this.seenN = -2; this.seenE = -1; this.at = -Infinity; this.fulls = 0; }
}

export type LinkState = 'good' | 'weak' | 'lost';

/** How well one connection is doing: time since we last heard anything, and the round trip of the heartbeat. */
export class LinkMonitor {
  static readonly WEAK = 6000; static readonly LOST = 12_000;
  rtt: number | null = null; since: number;
  constructor(now: number) { this.since = now; }
  heard(now: number) { this.since = now; }
  pong(rttMs: number) { if (rttMs >= 0 && rttMs < 120_000) this.rtt = this.rtt === null ? rttMs : this.rtt * 0.7 + rttMs * 0.3; }
  state(now: number): LinkState { const age = now - this.since; return age >= LinkMonitor.LOST ? 'lost' : age >= LinkMonitor.WEAK ? 'weak' : 'good'; }
  age(now: number) { return Math.max(0, now - this.since); }
}

/** Waiting times that grow after each failure and start over after a success. */
export class Backoff {
  private tries = 0; private base: number; private max: number;
  constructor(base: number, max: number) { this.base = base; this.max = max; }
  next(): number { const t = Math.min(this.max, this.base * 2 ** this.tries); this.tries++; return t; }
  /** The pause the next failure will be given, without using it up. */
  peek(): number { return Math.min(this.max, this.base * 2 ** this.tries); }
  reset() { this.tries = 0; }
  get attempts() { return this.tries; }
}

/** Strikes that fade: a hiccup is forgiven, a stream of garbage is not. */
export class Strikes {
  private score = 0; private at: number; bannedUntil = 0; private fade: number; private limit: number; private ban: number;
  constructor(now: number, fade = 10_000, limit = 25, ban = 300_000) { this.at = now; this.fade = fade; this.limit = limit; this.ban = ban; }
  /** Count `weight` more; returns true when this one crossed the line (the peer is shut out for a while). */
  add(now: number, weight = 1): boolean {
    this.score = Math.max(0, this.score - (now - this.at) / this.fade); this.at = now;
    this.score += weight;
    if (this.score >= this.limit && now >= this.bannedUntil) { this.bannedUntil = now + this.ban; this.score = 0; return true; }
    return false;
  }
  banned(now: number) { return now < this.bannedUntil; }
  get value() { return this.score; }
}
