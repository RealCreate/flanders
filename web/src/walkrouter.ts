// The page's side of the villagers' route planner (see walk-route.worker.ts): asks for routes, keeps the answers, and refreshes the worker's copy of the village when the
// village's layout changes. Without workers (a locked-down browser) it asks the village directly, as before.
import type { World } from './wasm/game_core.js';
import type { WalkRouteReply, WalkRouteRequest } from './walk-route.worker';

/** How long the worker's copy may lag behind the village (a new building) before it is refreshed, in ms: a fresh copy costs a snapshot. */
const REFRESH_MS = 1500;
const MAX_KEPT = 2048;
/** How long a villager waits for a planned route before walking the quick way this time, in ms (the planned route is kept for the next walk). */
const PATIENCE_MS = 300;

/** The one worker every village's planner shares (one copy of the game's code, one map navigation grid), and who gets each answer. */
let shared: Worker | null = null, sharedBroken = false, nextVillage = 1;
const routers = new Map<number, WalkRouter>();
function worker(): Worker | null {
  if (sharedBroken) return null;
  if (!shared) {
    try {
      shared = new Worker(new URL('./walk-route.worker.ts', import.meta.url), { type: 'module' });
      shared.onmessage = ({ data }: MessageEvent<WalkRouteReply>) => routers.get(data.village)?.answer(data);
      shared.onerror = () => { sharedBroken = true; shared?.terminate(); shared = null; for (const r of routers.values()) r.stop(); };
    } catch { sharedBroken = true; return null; }
  }
  return shared;
}

export class WalkRouter {
  private village = nextVillage++;
  private broken = false;
  private revision = 0;                  // the copy of the village the worker has
  private layout: bigint | null = null;  // the village's march_revision that copy was made at
  private sentAt = -Infinity;
  private next = 1;
  private done = new Map<string, Float32Array<ArrayBufferLike>>();
  private waiting = new Map<number, string>();
  private asked = new Map<string, number>();   // key -> when it was asked

  /** `eager`: send the village to the worker now (your own village, while the page loads), so the worker's start-up and the map grid are done before anyone walks. */
  constructor(private world: () => World, eager = false) {
    routers.set(this.village, this);
    if (eager) this.refresh();
  }

  /** The route [1, x, z, x, z, ...] (empty when there is no dry way), null while it is being planned (ask again later), or 'late' once it has been planned for longer
   *  than a villager waits. */
  get(sx: number, sz: number, gx: number, gz: number): ArrayLike<number> | null | 'late' {
    if (this.broken) return this.world().walk_route(sx, sz, gx, gz);
    this.refresh();
    if (this.broken) return this.world().walk_route(sx, sz, gx, gz);
    const key = `${sx.toFixed(2)},${sz.toFixed(2)},${gx.toFixed(2)},${gz.toFixed(2)}`;
    const found = this.done.get(key); if (found) return found;
    const since = this.asked.get(key);
    if (since === undefined) {
      const id = this.next++; this.asked.set(key, performance.now()); this.waiting.set(id, key);
      this.post({ kind: 'route', village: this.village, id, revision: this.revision, sx, sz, gx, gz });
      return null;
    }
    return performance.now() - since > PATIENCE_MS ? 'late' : null;
  }

  /** A new copy for the worker when the village's layout changed (at most every REFRESH_MS); the answers about the old one are forgotten. */
  private refresh() {
    const world = this.world(), layout = world.march_revision(), now = performance.now();
    if (layout === this.layout || (this.layout !== null && now - this.sentAt < REFRESH_MS)) return;
    let snapshot: Uint8Array;
    try { snapshot = world.snapshot(); } catch { this.stop(); return; }
    this.layout = layout; this.sentAt = now; this.revision++;
    this.done.clear(); this.asked.clear(); this.waiting.clear();
    this.post({ kind: 'world', village: this.village, revision: this.revision, snapshot }, [snapshot.buffer]);
  }

  private post(message: WalkRouteRequest, transfer: Transferable[] = []) {
    const w = worker();
    if (!w) { this.stop(); return; }
    try { w.postMessage(message, transfer); } catch { this.stop(); }
  }

  /** (called by the shared worker's message handler) */
  answer({ id, revision, route }: WalkRouteReply) {
    if (revision === -2) { this.stop(); return; }   // the worker could not load the village: plan on the page, as before
    const key = this.waiting.get(id); if (key === undefined) return;
    this.waiting.delete(id);
    if (revision !== this.revision) { this.asked.delete(key); return; }   // planned on an older copy: asked again next time
    if (this.done.size >= MAX_KEPT) this.done.delete(this.done.keys().next().value!);
    this.done.set(key, route);
  }

  /** The village was given another World (a save loaded, a re-sync): send a fresh copy at the next request, whatever its layout number. */
  reset() { this.layout = null; this.sentAt = -Infinity; }

  /** Plan this village's routes on the page from now on. */
  stop() { this.broken = true; this.done.clear(); this.asked.clear(); this.waiting.clear(); }
  dispose() {
    routers.delete(this.village);
    if (shared && !this.broken) try { shared.postMessage({ kind: 'drop', village: this.village } satisfies WalkRouteRequest); } catch { /* gone */ }
  }
}
