// Everything that arrives from another player is hostile until proven otherwise. A signature only proves WHO sent a command, not that it is sane:
// a player can sign any garbage with their own key. So every incoming command is rebuilt here field by field, with fixed types and ranges, before the game sees it.
// This file has no imports so it can be tested under plain node (tests/validate.test.mjs).

/** Commands a peer may send. `cheat`, `flatten` and `demo` are testing tools: they exist in your own game on localhost but are never accepted from the network. */
export const PEER_OPS = ['place', 'upgrade', 'demolish', 'train', 'attack', 'raid', 'refuse', 'return', 'form', 'march', 'recall', 'split', 'merge', 'halt', 'sendatk', 'repair', 'rebuild', 'garrison', 'bridge', 'option', 'treaty', 'caravan', 'choose', 'visit', 'batch', 'goods', 'accept', 'settle', 'hero', 'style', 'gate', 'field', 'envoy', 'marriage', 'war', 'clear', 'link', 'journey', 'arrive', 'defend', 'retreat', 'reinforce'] as const;
export type PeerOp = typeof PEER_OPS[number];

export interface WireCmd {
  op: PeerOp; tick: number; n: number;
  kind?: number; x?: number; y?: number; rot?: number; idx?: number; tag?: number; angle?: number; ax?: number; ay?: number;
  to?: string; from?: string; units?: number[]; loot?: number[];
}

export const LIMITS = {
  /** A single signed message: a batch of 400 pieces is about 20 kB of JSON. */
  maxCmdChars: 65536,
  maxSigChars: 200,
  /** Most commands in a log a peer sends us (a long game is a few thousand). */
  maxLogEntries: 40000,
  /** The farthest tick a command may carry (about 7 days of play at 0.5 ticks a second). */
  maxTick: 300_000,
  /** How far ahead of what we have already seen from that player a live command may be. Stops "run the simulation 2 billion ticks" messages. */
  maxLiveJump: 6000,
  maxNumbers: 1600,
};

const OPS = new Set<string>(PEER_OPS);
const TESTING = new Set<string>(['cheat', 'flatten', 'demo']);
const KEY = /^[A-Za-z0-9+/_=-]{20,100}$/;
// x and y are whole numbers for buildings but real positions for armies and distances for caravans, so they only have to be finite and sane
const INT_FIELDS = ['kind', 'rot', 'idx', 'tag'] as const;
const FLOAT_FIELDS = ['x', 'y', 'angle', 'ax', 'ay'] as const;
const BIG = 1e7;

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && Math.abs(v) <= 2 ** 31 - 1;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= BIG;

/** The public key of a player as it appears on the wire. */
export const isKey = (v: unknown): v is string => typeof v === 'string' && KEY.test(v);

function numbers(v: unknown): number[] | null {
  if (!Array.isArray(v) || v.length > LIMITS.maxNumbers) return null;
  for (const e of v) if (!isInt(e)) return null;
  return v as number[];
}

/** Check one decoded command. Returns a clean copy with only the known fields, or null if anything is off. */
export function sanitizeCmd(raw: unknown, allowTesting = false): WireCmd | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.op !== 'string' || !(OPS.has(r.op) || (allowTesting && TESTING.has(r.op)))) return null;
  if (!isInt(r.tick) || r.tick < 0 || r.tick > LIMITS.maxTick) return null;
  if (!isInt(r.n) || r.n < 0) return null;
  const out: WireCmd = { op: r.op as PeerOp, tick: r.tick, n: r.n };   // (a testing op is only let through for your own saved history)
  for (const f of INT_FIELDS) if (r[f] !== undefined) { if (!isInt(r[f])) return null; out[f] = r[f] as number; }
  for (const f of FLOAT_FIELDS) if (r[f] !== undefined) { if (!isNum(r[f])) return null; out[f] = r[f] as number; }
  for (const f of ['to', 'from'] as const) if (r[f] !== undefined) { if (!isKey(r[f])) return null; out[f] = r[f] as string; }
  for (const f of ['units', 'loot'] as const) if (r[f] !== undefined) { const a = numbers(r[f]); if (!a) return null; out[f] = a; }
  return out;
}

/** True for a (correctly signed) command that is one of the testing tools. Those are skipped, not punished: a developer testing on localhost signs them legitimately. */
export function isTestingOp(text: string): boolean {
  if (text.length > LIMITS.maxCmdChars) return false;
  try { const o = JSON.parse(text) as { op?: unknown }; return o?.op === 'cheat' || o?.op === 'flatten' || o?.op === 'demo'; } catch { return false; }
}

/** Decode and check a signed message body (the JSON string that was signed). */
export function parseCmd(text: unknown, allowTesting = false): WireCmd | null {
  if (typeof text !== 'string' || text.length > LIMITS.maxCmdChars) return null;
  try { return sanitizeCmd(JSON.parse(text), allowTesting); } catch { return null; }
}

/** A signed message as it travels: the command text and its signature. */
export function isSigned(v: unknown): v is { cmd: string; sig: string } {
  return typeof v === 'object' && v !== null && typeof (v as { cmd?: unknown }).cmd === 'string' && typeof (v as { sig?: unknown }).sig === 'string'
    && (v as { cmd: string }).cmd.length <= LIMITS.maxCmdChars && (v as { sig: string }).sig.length <= LIMITS.maxSigChars;
}

/** The state hash a player broadcasts every tick: the clock, the hash of the whole state, how many commands their history holds so far, the hashes of its sections, and whether
 *  they have used testing tools (which change their village without leaving a command that others could replay). */
export interface WireHash { tick: number; hash: string; c: number; p: string[]; tools: boolean }
const DIGITS = /^[0-9]{1,20}$/;
/** Check a hash message. An older build sends only `tick` and `hash`: those come back with `c` of -1, which means "cannot be compared". */
export function sanitizeHash(raw: unknown): WireHash | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!isInt(r.tick) || r.tick < 0 || r.tick > LIMITS.maxTick || typeof r.hash !== 'string' || !DIGITS.test(r.hash)) return null;
  let c = -1;
  if (r.c !== undefined) { if (!isInt(r.c) || r.c < 0 || r.c > 1_000_000) return null; c = r.c; }
  let p: string[] = [];
  if (r.p !== undefined) { if (!Array.isArray(r.p) || r.p.length > 16 || !r.p.every(x => typeof x === 'string' && DIGITS.test(x))) return null; p = r.p as string[]; }
  return { tick: r.tick, hash: r.hash, c, p, tools: r.tools === true };
}

/** The build a peer says it runs: the message protocol and the fingerprint of its simulation rules. Missing (an older build) gives protocol 0 and no fingerprint. */
export function sanitizeBuild(raw: unknown): { v: number; rules: string } | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const v = r.v === undefined ? 0 : r.v, rules = r.rules === undefined ? '' : r.rules;
  if (!isInt(v) || v < 0 || v > 1_000_000 || typeof rules !== 'string' || !/^[0-9a-f]{0,32}$/.test(rules)) return null;
  return { v, rules };
}

/** What we remember about each player's stream of commands, to refuse replays and absurd jumps. */
export class Sequence {
  lastN = -1; lastTick = 0;
  /** A live command must be newer than the last one and not jump absurdly far ahead. */
  acceptLive(c: { n: number; tick: number }): boolean {
    if (c.n <= this.lastN || c.tick < this.lastTick || c.tick > this.lastTick + LIMITS.maxLiveJump) return false;
    this.lastN = c.n; this.lastTick = c.tick; return true;
  }
  /** `dup` is a command we already have (a history and the live copy of its last command can both arrive): it is dropped quietly, not punished. */
  classify(c: { n: number; tick: number }): 'ok' | 'dup' | 'bad' {
    if (c.n <= this.lastN) return 'dup';
    return this.acceptLive(c) ? 'ok' : 'bad';
  }
  /** A whole log replaces what we knew: it must itself be in order. Returns the entries to keep (up to the first one out of order). */
  static checkLog<T extends { n: number; tick: number }>(cmds: T[]): T[] {
    const out: T[] = []; let n = -1, t = 0;
    for (const c of cmds) { if (c.n <= n || c.tick < t) break; n = c.n; t = c.tick; out.push(c); }
    return out;
  }
  resetTo(cmds: { n: number; tick: number }[]) { const l = cmds[cmds.length - 1]; this.lastN = l ? l.n : -1; this.lastTick = l ? l.tick : 0; }
}

/** A token bucket: `rate` messages a second on average, bursts up to `burst`. */
export class Bucket {
  private tokens: number; private at: number; private rate: number; private burst: number;
  constructor(rate: number, burst: number, now = Date.now()) { this.rate = rate; this.burst = burst; this.tokens = burst; this.at = now; }
  take(now = Date.now()): boolean {
    this.tokens = Math.min(this.burst, this.tokens + (now - this.at) / 1000 * this.rate); this.at = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1; return true;
  }
}

/** A name another player chose, made safe to show: no markup characters, no control characters, at most 20 characters. */
export function cleanName(n: unknown): string {
  return String(n ?? '').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩<>&"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20) || 'Traveller';
}
