// Multi-selection helpers: pure functions (no three.js, no wasm) so tests can run them directly.
import { linkWalls } from './render/wallgraph.ts';

export const WALL = 2, FENCE = 21, GATE = 22;
const STRIDE = 10;   // buildings_flat(): kind, tier, x, z, rot, ...

/** Every wall piece, fence post and gate joined to the one at `start` (by the same links the wall renderer draws), including `start`. Sorted. */
export function connectedWalls(flat: ArrayLike<number>, start: number): number[] {
  const idx: number[] = [], nodes: { x: number; z: number; kind: number }[] = [];
  for (let i = 0; i < flat.length; i += STRIDE) { const k = flat[i]; if (k === WALL || k === FENCE || k === GATE) { idx.push(i / STRIDE); nodes.push({ x: flat[i + 2], z: flat[i + 3], kind: k }); } }
  const s = idx.indexOf(start); if (s < 0) return [];
  const { adj } = linkWalls(nodes), seen = new Set<number>([s]), todo = [s];
  while (todo.length) { const n = todo.pop()!; for (const m of adj[n]) if (!seen.has(m)) { seen.add(m); todo.push(m); } }
  return [...seen].map(n => idx[n]).sort((a, b) => a - b);
}

export interface UpgradePlan {
  /** Buildings that will be upgraded, in order. */
  go: number[];
  /** Buildings already at their top tier. */
  full: number[];
  /** Buildings left out because the stock runs out before them. */
  poor: number[];
  /** Combined cost of `go`: [resource, amount] pairs. */
  total: [number, number][];
}

/** Work out which of `ids` can be upgraded with `stocks`, paying one after another (lowest index first), and what that costs altogether. */
export function planUpgrade(ids: number[], flat: ArrayLike<number>, maxTier: (kind: number) => number, costFlat: (kind: number, newTier: number) => ArrayLike<number>, stocks: ArrayLike<number>): UpgradePlan {
  const left = Array.from(stocks), sum = new Map<number, number>(), plan: UpgradePlan = { go: [], full: [], poor: [], total: [] };
  for (const i of [...new Set(ids)].sort((a, b) => a - b)) {
    const kind = flat[i * STRIDE], tier = flat[i * STRIDE + 1];
    if (tier >= maxTier(kind)) { plan.full.push(i); continue; }
    const c = costFlat(kind, tier + 1); let ok = true;
    for (let k = 0; k < c.length; k += 2) if ((left[c[k]] ?? 0) < c[k + 1]) ok = false;
    if (!ok) { plan.poor.push(i); continue; }
    for (let k = 0; k < c.length; k += 2) { left[c[k]] -= c[k + 1]; sum.set(c[k], (sum.get(c[k]) ?? 0) + c[k + 1]); }
    plan.go.push(i);
  }
  plan.total = [...sum.entries()].sort((a, b) => a[0] - b[0]);
  return plan;
}
