// Villagers' walking routes, planned off the page's main thread. A route search can take tens of milliseconds in a big village (the road network first, then a search over
// the ground), and the page used to wait for each one, so a village stuttered whenever people set out. Villagers' routes only change how they look on screen, never the
// game, so they are planned here on copies of the villages, which the page refreshes when their layout changes.
// One worker serves every village on screen (yours and the other players'): one copy of the game's code and one map navigation grid, however many villages there are.
import init, { world_restore, type World } from './wasm/game_core.js';

export type WalkRouteRequest =
  | { kind: 'world'; village: number; revision: number; snapshot: Uint8Array }   // (the first copy also builds the map's static navigation, here, off the page)
  | { kind: 'route'; village: number; id: number; revision: number; sx: number; sz: number; gx: number; gz: number }
  | { kind: 'drop'; village: number };                                            // the village left the screen: forget its copy
export interface WalkRouteReply { village: number; id: number; revision: number; route: Float32Array<ArrayBufferLike> }

const scope = self as unknown as {
  onmessage: (event: MessageEvent<WalkRouteRequest>) => void;
  postMessage: (reply: WalkRouteReply, transfer?: Transferable[]) => void;
};
const ready = init().then(() => true, () => false);   // (if the game's code will not load here, every request is told so and the page plans routes itself)
const copies = new Map<number, { world: World; revision: number }>();
let warmed = false;

scope.onmessage = async ({ data }) => {
  if (!await ready) { if (data.kind === 'route') scope.postMessage({ village: data.village, id: data.id, revision: -2, route: new Float32Array(0) }); return; }
  if (data.kind === 'drop') { copies.get(data.village)?.world.free(); copies.delete(data.village); return; }
  if (data.kind === 'world') {
    let next: World | undefined;
    try { next = world_restore(data.snapshot); } catch { /* keep the copy there is (or none) */ }
    if (!next) return;
    copies.get(data.village)?.world.free();
    copies.set(data.village, { world: next, revision: data.revision });
    if (!warmed) {   // the first route builds the map's navigation grid (seconds in a big map): do it now, while the page is still loading, not when the first villager asks
      warmed = true;
      try { const x = next.origin_x(), z = next.origin_y(); next.walk_route(x, z, x + 4, z + 4); } catch { /* no route: the grid is built all the same */ }
    }
    return;
  }
  const copy = copies.get(data.village);
  // no copy of the village at all (it could not be restored here): revision -2 tells the page to plan routes itself
  if (!copy) { scope.postMessage({ village: data.village, id: data.id, revision: -2, route: new Float32Array(0) }); return; }
  // a request made against an older copy is answered at once, unplanned (the page asks again on the new copy): searching for it would only hold up the fresh ones
  if (data.revision !== copy.revision) { scope.postMessage({ village: data.village, id: data.id, revision: -1, route: new Float32Array(0) }); return; }
  let route: Float32Array<ArrayBufferLike> = new Float32Array(0);
  try { route = copy.world.walk_route(data.sx, data.sz, data.gx, data.gz); } catch { /* no route */ }
  scope.postMessage({ village: data.village, id: data.id, revision: copy.revision, route }, [route.buffer]);
};
