// Serverless multiplayer: every player runs a copy of the game and joins one shared "world" room.
// Rooms rendezvous through public Nostr relays (via Trystero) and then talk directly over WebRTC.
// Commands are signed with an ed25519 key that lives only in this browser.
//
// This file is the Trystero side (the `Transport`); everything else is in wire.ts (messages, key), link.ts (reliable delivery) and room.ts (the room itself).
import { joinRoom } from 'trystero';
import { RoomCore, type Transport, type Channel, type Env } from './room';
import type { Identity, Hello, Signed, RoomHandlers } from './wire';

export * from './wire';
export { RoomCore } from './room';

/** The relay for players behind strict networks: one set in Display settings -> Network wins over the one this build was made with. */
function turnConfig(): { urls: string; username?: string; credential?: string }[] | undefined {
  // players behind strict networks (some phones, offices) can only connect through a TURN relay; one can be set in Display settings -> Network and is kept in this browser
  try { const t = JSON.parse(localStorage.getItem('flanders:turn') ?? 'null'); if (t && typeof t.urls === 'string' && /^turns?:/.test(t.urls)) return [{ urls: t.urls, username: t.username, credential: t.credential }]; } catch { /* none */ }
  // a relay the host of this build chose for everybody (VITE_TURN_URLS, VITE_TURN_USERNAME, VITE_TURN_CREDENTIAL at build time)
  const env = import.meta.env; const urls = String(env.VITE_TURN_URLS ?? '').split(',').map((u: string) => u.trim()).filter((u: string) => /^turns?:/.test(u));
  return urls.length ? [{ urls: urls[0], username: env.VITE_TURN_USERNAME || undefined, credential: env.VITE_TURN_CREDENTIAL || undefined }] : undefined;
}

/** The network the game uses: WebRTC data channels found through Nostr relays. */
export function trysteroTransport(world: string): Transport {
  const turn = turnConfig();
  const room = joinRoom({ appId: 'flanders-medieval-p2p-v7', ...(turn ? { turnConfig: turn as never } : {}) }, world);
  return {
    selfId: () => room.getSelf().then(s => s.peerId),
    onPeerJoin: cb => { room.onPeerJoin(({ peerId }) => cb(peerId)); },
    onPeerLeave: cb => { room.onPeerLeave(({ peerId }) => cb(peerId)); },
    channel<T>(name: string): Channel<T> {
      const a = room.makeAction(name);
      return { send: (d, target) => a.send(d as never, target ? { target } : undefined), onMessage: cb => { a.onMessage((d, { peerId }) => cb(d as T, peerId)); } };
    },
    leave: () => room.leave(),
  };
}

/** The room of the game: a `RoomCore` on Trystero. */
export class Room extends RoomCore {
  constructor(world: string, identity: Identity, hello: () => Hello, log: () => Signed[], handlers: RoomHandlers, env?: Env) {
    super(() => trysteroTransport(world), identity, hello, log, handlers, env);
  }
}
