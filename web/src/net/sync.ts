// Keeping a copy of another player's village in step with theirs, and noticing when it is not.
//
// Every player holds a copy (a "replica") of every other village and replays that player's signed commands into it. The owner broadcasts a hash of their state every tick,
// together with how many commands their history holds. A replica compares the hash only when it has applied exactly that many commands and stands at exactly that tick;
// anything else is "cannot tell yet", never "out of sync". That rule is what keeps a command that is still being checked (or still on its way) from looking like a desync,
// and what stops the copy from running past the tick a missing command belongs to.
//
// This file has no imports from the game, so it runs under plain node (tests/sync.test.mjs).

/** Version of the sync protocol: the shape of the hash message and of the hello. Bump it when either changes. Builds with another version cannot judge each other. */
export const SYNC_PROTOCOL = 4;

/** What a copy needs from the world it keeps (the wasm `World` has all of this). */
export interface SimWorld { tick(): bigint; state_hash(): bigint; state_hash_parts(): BigUint64Array | bigint[] }

/** A hash message as `sanitizeHash` hands it over. */
export interface HashMsg { tick: number; hash: string; c: number; p: string[]; tools: boolean; e?: number }

/** What a mismatch tells: where it was noticed, which sections differ, and which commands could be to blame. */
export interface Diagnosis {
  tick: number;
  /** Names of the sections of the state whose hashes differ (e.g. "buildings", "soldiers"). Empty when the owner sent no sections. */
  parts: string[];
  ours: string; theirs: string;
  /** The last comparison that matched, and how many commands had been applied then (null if none since the history was loaded). */
  goodTick: number | null; goodCount: number | null;
  /** How many commands we have applied, and the ops of those applied since the last match: the first divergence is among them. */
  count: number; ops: string[];
}

export type Verdict =
  | { kind: 'match' }
  | { kind: 'mismatch'; diag: Diagnosis }
  /** The owner has issued commands we have not seen yet: wait for them (the copy is not advanced meanwhile). */
  | { kind: 'wait'; missing: number }
  /** ...and they did not arrive in time: they were lost. */
  | { kind: 'lost'; missing: number }
  /** Nothing to compare: the copy is already past that tick, or the message comes from a build that sends no sections. */
  | { kind: 'stale' }
  /** The copy could not be brought up to that tick. */
  | { kind: 'behind' }
  /** The owner uses testing tools: their village holds changes that no history can reproduce. */
  | { kind: 'tools' };

/** How long a hash may name commands we do not have before they count as lost (ms). */
export const WAIT_MS = 5000;

/** The bookkeeping for one replica. */
export class ReplicaTrack {
  /** Commands applied so far, counted the way the owner counts them (one for each command of their history that others replay). */
  count = 0;
  /** The epoch of the owner's history the copy stands in (how many times they have restarted). */
  epoch = 0;
  lastGood: { tick: number; count: number } | null = null;
  pending: HashMsg | null = null;
  private waitSince = -1;
  private ops: string[] = []; private opsBase = 0;

  /** The history was (re)loaded: `ops` is every command of it, in order. */
  reset(ops: string[], epoch = 0) { this.epoch = epoch; this.count = ops.length; this.ops = ops.slice(-400); this.opsBase = this.count - this.ops.length; this.lastGood = null; this.pending = null; this.waitSince = -1; }
  /** One more command was applied. */
  applied(op: string) { this.count++; this.ops.push(op); if (this.ops.length > 400) { this.ops.shift(); this.opsBase++; } }
  /** The owner restarted: the copy is a new village now, and their history begins again with that one command. */
  restarted(epoch: number) { this.reset(['restart'], epoch); }
  /** The ops applied after the first `count0` commands. */
  opsSince(count0: number): string[] { return this.ops.slice(Math.max(0, count0 - this.opsBase)); }

  /** Judge a hash message against the copy. `advance` brings the copy to a tick and says whether it got there. Never changes the copy except by advancing it. */
  judge(msg: HashMsg, w: SimWorld, names: string[], advance: (tick: number) => boolean, now: number): Verdict {
    if (msg.tools) return { kind: 'tools' };
    if (msg.c < 0 || !msg.p.length) return { kind: 'stale' };
    const e = msg.e ?? 0;
    if (e < this.epoch) return { kind: 'stale' };   // a hash of the life before their restart, still on its way
    if (e > this.epoch) {   // they have restarted and we have not seen it yet: that is a command we are missing
      this.pending = msg; if (this.waitSince < 0) this.waitSince = now;
      return now - this.waitSince > WAIT_MS ? { kind: 'lost', missing: 1 } : { kind: 'wait', missing: 1 };
    }
    if (msg.c > this.count) {
      this.pending = msg; if (this.waitSince < 0) this.waitSince = now;
      const missing = msg.c - this.count;
      return now - this.waitSince > WAIT_MS ? { kind: 'lost', missing } : { kind: 'wait', missing };
    }
    this.pending = null; this.waitSince = -1;
    if (msg.c < this.count) return { kind: 'stale' };
    if (Number(w.tick()) > msg.tick) return { kind: 'stale' };
    if (Number(w.tick()) < msg.tick && !advance(msg.tick)) return { kind: 'behind' };
    if (Number(w.tick()) !== msg.tick) return { kind: 'behind' };
    const mine = w.state_hash().toString();
    if (mine === msg.hash) { this.lastGood = { tick: msg.tick, count: this.count }; return { kind: 'match' }; }
    const ours = Array.from(w.state_hash_parts(), x => x.toString());
    const parts: string[] = [];
    if (ours.length !== msg.p.length) parts.push('sections (a different build?)');
    else for (let i = 0; i < ours.length; i++) if (ours[i] !== msg.p[i]) parts.push(names[i] ?? `part ${i}`);
    return { kind: 'mismatch', diag: { tick: msg.tick, parts, ours: mine, theirs: msg.hash, goodTick: this.lastGood?.tick ?? null, goodCount: this.lastGood?.count ?? null, count: this.count, ops: this.opsSince(this.lastGood?.count ?? 0) } };
  }

  /** Called after a command was applied: a hash that was waiting for it can be judged now. */
  recheck(w: SimWorld, names: string[], advance: (tick: number) => boolean, now: number): Verdict | null {
    return this.pending ? this.judge(this.pending, w, names, advance, now) : null;
  }
}

/** One line for the log and the performance panel. */
export function describe(d: Diagnosis): string {
  const where = d.parts.length ? d.parts.join(', ') : 'unknown section';
  const since = d.goodTick === null ? 'no earlier match' : `matched at tick ${d.goodTick} after ${d.goodCount} commands`;
  const ops = d.ops.length ? ` — commands since: ${d.ops.slice(0, 8).join(', ')}${d.ops.length > 8 ? '…' : ''}` : ' — no commands since';
  return `differs at tick ${d.tick} in ${where} (${since}; ${d.count} commands applied)${ops}`;
}

/** Decides when a copy that went wrong may ask for the owner's history again. It must never loop, and it must never give up for good: the pause between requests doubles each
 *  time (6 s, 12 s, 24 s … at most two minutes), and starts over once the copy is back in step. */
export class ResyncPolicy {
  static readonly GAP = 6000; static readonly MAX_GAP = 120_000;
  private asked = 0; private last = -Infinity;
  /** 'go': ask now. 'later': too soon after the last request. ('stop' is no longer returned: it stays in the type for callers written for the old rule.) */
  ask(now: number): 'go' | 'later' | 'stop' {
    const gap = Math.min(ResyncPolicy.MAX_GAP, ResyncPolicy.GAP * 2 ** Math.max(0, this.asked - 1));
    if (this.asked > 0 && now - this.last < gap) return 'later';
    this.asked++; this.last = now; return 'go';
  }
  get requests() { return this.asked; }
  reset() { this.asked = 0; this.last = -Infinity; }
}

/** Do two builds play the same rules? (`v` is the protocol, `rules` the fingerprint of the simulation.) */
export function sameBuild(a: { v?: number; rules?: string }, b: { v?: number; rules?: string }): boolean {
  return (a.v ?? 0) === (b.v ?? 0) && (a.rules ?? '') === (b.rules ?? '');
}

/** Is `theirs` a newer build than `ours`? A higher protocol is newer; with the same protocol, different rules and a later build time. (Builds that cannot be told apart are not newer.) */
export function isNewerBuild(theirs: { v?: number; rules?: string; b?: number }, ours: { v?: number; rules?: string; b?: number }): boolean {
  const tv = theirs.v ?? 0, ov = ours.v ?? 0;
  if (tv !== ov) return tv > ov;
  if ((theirs.rules ?? '') === (ours.rules ?? '')) return false;
  return (theirs.b ?? 0) > (ours.b ?? 0);
}
