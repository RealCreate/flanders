// Everything about a message between players that has nothing to do with how it travels: the commands, the signing key, the hello, what the game wants to hear from the room.
// No imports from the game or from the transport, so it runs under plain node (tests/net.test.mjs).
import type { PeerOp, WireHash } from './validate.ts';

export interface Cmd {
  /** `cheat` and `flatten` are testing tools: they can be signed into your own history but other players never accept them. */
  op: PeerOp | 'cheat' | 'flatten' | 'demo';
  tick: number; n: number;
  e?: number;             // epoch of the history (absent = 0): see restart.ts
  kind?: number; x?: number; y?: number; rot?: number; idx?: number;
  to?: string;            // attack/refuse: pub key of the village concerned
  from?: string;          // raid/return: pub key of the attacking village
  units?: number[]; loot?: number[]; angle?: number; tag?: number; tech?: number;
  h?: number;   // level: the height to level to (absent: Auto)
  ax?: number; ay?: number;   // march: position of the village being attacked
}
export interface Signed { cmd: string; sig: string }

export const b64 = (b: ArrayBuffer | Uint8Array) => { const a = b instanceof Uint8Array ? b : new Uint8Array(b); let s = ''; for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); };
export const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export const enc = new TextEncoder();

export class Identity {
  private priv: CryptoKey; pub: string;
  private constructor(priv: CryptoKey, pub: string) { this.priv = priv; this.pub = pub; }
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
export interface Hello { pub: string; site: number; name: string; tick: number; world: string; sig?: string;
  /** The build of the sender: `v` is the version of the sync protocol, `rules` the fingerprint of the simulation rules (see sync.ts). Builds that differ cannot replay each other's histories faithfully. */
  v?: number; rules?: string;
  /** When the sender's build was made (seconds since 1970): between two builds that differ, the later one is the newer. */
  b?: number }

export interface PeerLinkInfo { peerId: string; pub: string | null; rtt: number | null; state: 'good' | 'weak' | 'lost'; heardAgo: number }

export interface RoomHandlers {
  onHello(peerId: string, h: Hello): void;
  onCmd(peerId: string, c: Cmd): void;
  onLog(peerId: string, cmds: Cmd[]): void;
  onHash(peerId: string, msg: WireHash): void;
  onLeave(peerId: string): void;
  onStatus(s: string): void;
  /** The quality of every connection, about every two seconds and whenever one changes state. */
  onLinks?(links: PeerLinkInfo[]): void;
}

/** The text a hello signature covers. */
export const helloText = (h: Hello, to: string) => JSON.stringify({ t: 'hello', pub: h.pub, site: h.site, name: h.name, world: h.world, to });

