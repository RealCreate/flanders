import init, { warm_navigation, world_restore, type World } from './wasm/game_core.js';

export interface MarchPreviewRequest {
  seed: bigint;
  units: Uint32Array;
  from: [number, number];
  to: [number, number];
  snapshot?: Uint8Array;
}

export interface ArmyRouteRequest {
  seed: bigint;
  id: number;
  x: number;
  z: number;
  mode: 0 | 1 | 2 | 3;
  snapshot: Uint8Array;
}

const scope = self as unknown as {
  onmessage: (event: MessageEvent<MarchPreviewRequest | ArmyRouteRequest | { warm: bigint }>) => void;
  postMessage: (plan: Float32Array | Uint8Array | null, transfer?: Transferable[]) => void;
};
const ready = init();
let world: World | undefined;
let seed: bigint | undefined;

scope.onmessage = async ({ data }) => {
  try {
    await ready;
    if ('warm' in data) { warm_navigation(data.warm); seed = data.warm; return; }
    if (seed !== data.seed) { warm_navigation(data.seed); seed = data.seed; }
    if ('id' in data) {
      const copy = world_restore(data.snapshot);
      if (!copy) { scope.postMessage(null); return; }
      try {
        const routes = copy.prepare_army_order(data.id, data.x, data.z, data.mode);
        scope.postMessage(routes, [routes.buffer]);
      } finally { copy.free(); }
      return;
    }
    if (data.snapshot) { world?.free(); world = world_restore(data.snapshot); }
    if (!world) { scope.postMessage(null); return; }
    const plan = world.plan_march(data.units, ...data.from, ...data.to);
    scope.postMessage(plan, [plan.buffer]);
  } catch {
    if (!('warm' in data)) scope.postMessage(null);
  }
};
