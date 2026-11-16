/** Buildings that stand over water: the selection ring must lie at their deck / floor (`pad_h`), not on the bed of the moat or river under them. */
export const OVER_WATER_KINDS = new Set([23, 29, 41]);   // drawbridge, waterwheel, fishing hut
/** Lift of the ring above the surface it lies on. */
export const RING_LIFT = 0.3;
/** Height of one point of the selection ring: the ground there, but never below the building's own floor if it hangs over water. */
export function ringHeight(ground: number, kind: number | null, padH: number): number {
  const floor = kind !== null && OVER_WATER_KINDS.has(kind) ? padH : -Infinity;
  return Math.max(ground, floor) + RING_LIFT;
}

/** Height of a drawbridge's deck, as the core sets it (`pad_h` in place): the nearest gate within 30 units sets it, otherwise the higher of the two banks (at least 0.8). */
export function drawbridgeDeckHeight(gates: { d: number; h: number }[], bankA: number, bankB: number): number {
  let best: { d: number; h: number } | null = null;
  for (const g of gates) if (g.d < 30 && (!best || g.d < best.d)) best = g;
  return best ? best.h : Math.max(bankA, bankB, 0.8);
}
