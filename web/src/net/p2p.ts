// Serverless multiplayer: every player runs a copy of the game and joins one shared "world" room.
// Rooms rendezvous through public Nostr relays (via Trystero) and then talk directly over WebRTC.
// Commands are signed with an ed25519 key that lives only in this browser.
//
// Trust model: nothing from the network is believed until it has passed three gates, in this order.
//   1. identity: a peer is introduced by a signed hello addressed to us; commands from a peer that has not been introduced are dropped.
//   2. signature: every command and every entry of a history is signed by the introduced key.
//   3. sanity (validate.ts): fixed fields, ranges and sizes; a strictly increasing command number; no huge jumps in time; per-peer rate limits.
// A peer that keeps sending bad data is cut off for the session.
import { joinRoom } from 'trystero';
import { LIMITS, Sequence, Bucket, isKey, isSigned, isTestingOp, parseCmd, cleanName, type PeerOp } from './validate';

export interface Cmd {
  /** `cheat` and `flatten` are testing tools: they can be signed into your own history but other players never accept them. */
  op: PeerOp | 'cheat' | 'flatten' | 'demo';
  tick: number; n: number;
  kind?: number; x?: number; y?: number; rot?: number; idx?: number;
  to?: string;            // attack/refuse: pub key of the village concerned
  from?: string;          // raid/return: pub key of the attacking village
  units?: number[]; loot?: number[]; angle?: number; tag?: number;
  ax?: number; ay?: number;   // march: position of the village being attacked
}
export interface Signed { cmd: string; sig: string }

const b64 = (b: ArrayBuffer | Uint8Array) => { const a = b instanceof Uint8Array ? b : new Uint8Array(b); let s = ''; for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const enc = new TextEncoder();

export class Identity {
  private constructor(private priv: CryptoKey, public pub: string) {}
  /** The signing key, for the few places that sign something other than a command. */
  get key() { return this.priv; }
  /** Load the key saved in this browser, or make a new one. */
  static async load(slot = '') {
    const store = 'flanders:identity' + (slot ? ':' + slot : '');
    try {
      const saved = localStorage.getItem(store);
      if (saved) {
        const { priv, pub } = JSON.parse(saved);
        return new Identity(await crypto.subtle.importKey('jwk', priv, 'Ed25519', true, ['sign']), pub);
      }
    } catch { /* fall through to a fresh identity */ }
    const kp = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair;
    const pub = b64(await crypto.subtle.exportKey('raw', kp.publicKey));
    try { localStorage.setItem(store, JSON.stringify({ priv: await crypto.subtle.exportKey('jwk', kp.privateKey), pub })); } catch { /* private mode */ }
    return new Identity(kp.privateKey, pub);
  }
  async sign(cmd: Cmd): Promise<Signed> {
    const s = JSON.stringify(cmd);
    return { cmd: s, sig: b64(await crypto.subtle.sign('Ed25519', this.priv, enc.encode(s))) };
  }
}

/** True if `sig` is `pub`'s signature of `text`. */
export async function verifyText(pub: string, text: string, sig: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey('raw', unb64(pub), 'Ed25519', false, ['verify']);
    return await crypto.subtle.verify('Ed25519', key, unb64(sig), enc.encode(text));
  } catch { return false; }
}

/** Short stable number for a public key, used to tag attackers inside the simulation. */
export function tagOf(pub: string): number { let h = 7; for (let i = 0; i < pub.length; i++) h = (h * 31 + pub.charCodeAt(i)) % 2147483000; return h + 1; }

/** Who a peer says it is. `sig` proves it: it signs the other fields plus the id of the peer the hello is addressed to, so a hello cannot be replayed to somebody else or relayed by a third party. */
export interface Hello { pub: string; site: number; name: string; tick: number; world: string; sig?: string }

export interface RoomHandlers {
  onHello(peerId: string, h: Hello): void;
  onCmd(peerId: string, c: Cmd): void;
  onLog(peerId: string, cmds: Cmd[]): void;
  onHash(peerId: string, tick: number, hash: string): void;
  onLeave(peerId: string): void;
  onStatus(s: string): void;
}

/** The text a hello signature covers. */
const helloText = (h: Hello, to: string) => JSON.stringify({ t: 'hello', pub: h.pub, site: h.site, name: h.name, world: h.world, to });

interface PeerState { seq: Sequence; cmds: Bucket; logs: Bucket; hashes: Bucket; strikes: number; banned: boolean; pendingLog?: unknown }

export class Room {
  private room: ReturnType<typeof joinRoom>;
  private sendHello: (d: Hello, o?: { target?: string }) => Promise<unknown>;
  private sendCmd: (d: Signed, o?: { target?: string }) => Promise<unknown>;
  private sendLog: (d: Signed[], o?: { target?: string }) => Promise<unknown>;
  private sendHash: (d: { tick: number; hash: string }, o?: { target?: string }) => Promise<unknown>;
  private pubs = new Map<string, string>();
  private state = new Map<string, PeerState>();
  private chains = new Map<string, Promise<void>>();
  private selfId = '';
  private ready: Promise<void>;
  peers = new Set<string>();

  constructor(world: string, private identity: Identity, private hello: () => Hello, private log: () => Signed[], private h: RoomHandlers) {
    // players behind strict networks (some phones, offices) can only connect through a TURN relay; one can be set in Display settings -> Network and is kept in this browser
    let turn: { urls: string; username?: string; credential?: string }[] | undefined;
    try { const t = JSON.parse(localStorage.getItem('flanders:turn') ?? 'null'); if (t && typeof t.urls === 'string' && /^turns?:/.test(t.urls)) turn = [{ urls: t.urls, username: t.username, credential: t.credential }]; } catch { /* none */ }
    this.room = joinRoom({ appId: 'flanders-medieval-p2p-v7', ...(turn ? { turnConfig: turn as never } : {}) }, world);
    const hello_ = this.room.makeAction('hello'), cmd_ = this.room.makeAction('cmd'), log_ = this.room.makeAction('log'), hash_ = this.room.makeAction('hash');
    this.sendHello = (d, o) => hello_.send(d as never, o); this.sendCmd = (d, o) => cmd_.send(d as never, o);
    this.sendLog = (d, o) => log_.send(d as never, o); this.sendHash = (d, o) => hash_.send(d as never, o);
    this.ready = this.room.getSelf().then(s => { this.selfId = s.peerId; }).catch(() => { /* without our own id no hello can be checked, so nobody gets introduced */ });
    h.onStatus('Looking for other players in this world…');
    const count = () => `${this.peers.size} other player${this.peers.size === 1 ? '' : 's'} nearby`;
    this.room.onPeerJoin(({ peerId }) => {
      this.peers.add(peerId); h.onStatus(count());
      this.state.set(peerId, { seq: new Sequence(), cmds: new Bucket(100, 600), logs: new Bucket(0.2, 3), hashes: new Bucket(5, 30), strikes: 0, banned: false });
      void this.helloTo(peerId); this.sendLog(this.log(), { target: peerId }).catch(() => { /* peer left */ });
    });
    this.room.onPeerLeave(({ peerId }) => {
      this.peers.delete(peerId); this.pubs.delete(peerId); this.state.delete(peerId); this.chains.delete(peerId);
      h.onLeave(peerId); h.onStatus(this.peers.size ? count() : 'Alone in the world — share the link to invite others');
    });
    // signatures are checked asynchronously: run each peer's messages through one queue so commands are applied in the order they arrived
    const queue = (peerId: string, job: (st: PeerState) => Promise<void>) => {
      const st = this.state.get(peerId); if (!st || st.banned) return;
      const next = (this.chains.get(peerId) ?? Promise.resolve()).then(() => job(st)).catch(() => { /* a bad message must not stall the queue */ });
      this.chains.set(peerId, next);
    };
    hello_.onMessage((d, { peerId }) => queue(peerId, async st => { await this.ready; await this.acceptHello(peerId, st, d); }));
    cmd_.onMessage((d, { peerId }) => queue(peerId, async st => {
      if (!st.cmds.take()) return this.strike(peerId, st, 'too many commands');
      const c = await this.check(peerId, st, d); if (!c || c === 'skip') return;
      if (!st.seq.acceptLive(c)) return this.strike(peerId, st, 'a command out of order');
      h.onCmd(peerId, c);
    }));
    log_.onMessage((d, { peerId }) => queue(peerId, async st => {
      if (!this.pubs.has(peerId)) { st.pendingLog = d; return; }   // the history beat the hello: keep it until the peer has been introduced
      await this.acceptLog(peerId, st, d);
    }));
    hash_.onMessage((d, { peerId }) => {
      const st = this.state.get(peerId); if (!st || st.banned || !this.pubs.has(peerId) || !st.hashes.take()) return;
      const x = d as { tick?: unknown; hash?: unknown } | null;
      if (x && typeof x.tick === 'number' && Number.isInteger(x.tick) && x.tick >= 0 && x.tick <= LIMITS.maxTick && typeof x.hash === 'string' && x.hash.length <= 30) h.onHash(peerId, x.tick, x.hash);
    });
  }

  /** Count a misbehaving message; a peer that keeps doing it is ignored for the rest of the session. */
  private strike(peerId: string, st: PeerState, why: string) {
    if (++st.strikes === 1) this.h.onStatus(`Ignored ${why} from another player.`);
    if (st.strikes >= 25 && !st.banned) { st.banned = true; this.pubs.delete(peerId); this.h.onStatus('A player was cut off for sending bad data.'); }
  }

  private async helloTo(peerId: string) {
    const h = this.hello();
    const sig = b64(await crypto.subtle.sign('Ed25519', this.identity.key, enc.encode(helloText(h, peerId))));
    this.sendHello({ ...h, sig }, { target: peerId }).catch(() => { /* peer left */ });
  }

  private async acceptHello(peerId: string, st: PeerState, d: unknown) {
    const x = d as Partial<Hello> | null;
    const ok = !!x && isKey(x.pub) && typeof x.sig === 'string' && x.sig.length <= LIMITS.maxSigChars && Number.isInteger(x.site) && (x.site as number) >= 0 && (x.site as number) < 4096
      && typeof x.world === 'string' && x.world.length <= 64 && typeof x.name === 'string' && x.name.length <= 80 && typeof x.tick === 'number';
    if (!ok || !this.selfId) return this.strike(peerId, st, 'an invalid hello');
    const h = x as Hello;
    if (!(await verifyText(h.pub, helloText(h, this.selfId), h.sig!))) return this.strike(peerId, st, 'a hello with a bad signature');
    this.pubs.set(peerId, h.pub);
    this.h.onHello(peerId, { pub: h.pub, site: h.site, name: cleanName(h.name), tick: h.tick, world: h.world });
    if (st.pendingLog !== undefined) { const d = st.pendingLog; st.pendingLog = undefined; await this.acceptLog(peerId, st, d); }
  }

  private async acceptLog(peerId: string, st: PeerState, d: unknown) {
    if (!st.logs.take()) return this.strike(peerId, st, 'too many histories');
    if (!Array.isArray(d) || d.length > LIMITS.maxLogEntries) return this.strike(peerId, st, 'an oversized history');
    const out: Cmd[] = [];
    for (const s of d) { const c = await this.check(peerId, st, s); if (c === 'skip') continue; if (c) out.push(c); else break; }   // the first bad entry ends the history: what follows it cannot be trusted
    const kept = Sequence.checkLog(out); if (kept.length !== out.length) this.strike(peerId, st, 'a history out of order');
    st.seq.resetTo(kept); this.h.onLog(peerId, kept);
  }

  /** A signed message from an introduced peer, checked and decoded; null when anything is wrong (and the peer gets a strike). */
  private async check(peerId: string, st: PeerState, s: unknown): Promise<Cmd | null | 'skip'> {
    const pub = this.pubs.get(peerId); if (!pub) return null;
    if (!isSigned(s)) { this.strike(peerId, st, 'a malformed command'); return null; }
    if (!(await verifyText(pub, s.cmd, s.sig))) { this.strike(peerId, st, 'a command with a bad signature'); return null; }
    if (isTestingOp(s.cmd)) return 'skip';   // a correctly signed testing-tool command: not an attack, just not something the network accepts
    const c = parseCmd(s.cmd); if (!c) { this.strike(peerId, st, 'a command that makes no sense'); return null; }
    return c as Cmd;
  }

  announce() { for (const p of this.peers) void this.helloTo(p); }
  broadcastCmd(s: Signed) { if (this.peers.size) this.sendCmd(s).catch(() => { /* peers left */ }); }
  broadcastHash(tick: number, hash: string) { if (this.peers.size) this.sendHash({ tick, hash }).catch(() => { /* peers left */ }); }
  pubOf(peerId: string) { return this.pubs.get(peerId); }
  leave() { this.room.leave(); }
}
