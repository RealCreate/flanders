// Rebuilding a copy of another player's village from their history, off the main thread. A long history takes many seconds to replay; on the main thread
// that work ran a few milliseconds per frame, so the village showed up only after a long while and every frame was slower meanwhile.
// The worker runs the same core and the same `applyCmd` as the page, so the world it hands back (as snapshot bytes) is the one the page would have built, to the bit.
import init, { World, world_restore } from './wasm/game_core.js';
import { applyCmd, stepTo } from './commands';
import type { Cmd } from './net/p2p';

export interface ReplicaReplayRequest {
  seed: bigint; ox: number; oz: number;
  /** A world to start from (a cached copy that already holds the first commands of `cmds`'s history); absent: a fresh village. */
  snapshot?: Uint8Array;
  /** The commands to play onto it, in order. */
  cmds: Cmd[];
}
export type ReplicaReplayReply = { ok: true; bytes: Uint8Array } | { ok: false; error: string };

const scope = self as unknown as { onmessage: (e: MessageEvent<ReplicaReplayRequest>) => void; postMessage: (m: ReplicaReplayReply, transfer?: Transferable[]) => void };
const ready = init();

scope.onmessage = async ({ data }) => {
  let w: World | undefined;
  try {
    await ready;
    w = data.snapshot ? world_restore(data.snapshot) : World.new_legacy(data.seed, data.ox, data.oz);
    if (!w) { scope.postMessage({ ok: false, error: 'the cached copy did not restore' }); return; }
    for (const c of data.cmds) { stepTo(w, c.tick); applyCmd(w, c); }
    const bytes = w.snapshot();
    scope.postMessage({ ok: true, bytes }, [bytes.buffer]);
  } catch (e) {
    scope.postMessage({ ok: false, error: String(e) });
  } finally { w?.free(); }
};
