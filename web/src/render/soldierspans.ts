// Bridges the soldiers build are drawn as the player's bridges are: the same deck, rails and supports (spans.ts / spanplan.ts), laid from bank to bank at deck height.
// Pure maths, no drawing (so it can be tested under plain node).

export interface SpanRec { cx: number; cz: number; ang: number; length: number; hA: number; hB: number }

/** Where a bridge goes that was ordered along the line (ax, az) to (bx, bz): it runs from the first dry ground before the water to the first dry ground after it, in the direction of
 *  the line. `ground` is the height of the land (the bed under water), water lies where it is below `shore`. With `frac` < 1 the bridge is part built, growing from the near bank. */
export function spanAcross(ax: number, az: number, bx: number, bz: number, ground: (x: number, z: number) => number, frac = 1, shore = 0.2): SpanRec | null {
  const l0 = Math.hypot(bx - ax, bz - az); if (l0 < 0.5) return null;
  const ux = (bx - ax) / l0, uz = (bz - az) / l0, at = (s: number) => [ax + ux * s, az + uz * s] as const;
  const wet = (s: number) => { const [x, z] = at(s); return ground(x, z) < shore; };
  let sIn = Infinity, sOut = -Infinity;
  for (let s = -8; s <= l0 + 8; s += 0.5) if (wet(s)) { sIn = Math.min(sIn, s); sOut = Math.max(sOut, s); }
  let s0 = 0, s1 = l0;
  if (sIn <= sOut) { s0 = sIn - 0.8; s1 = sOut + 0.8; }   // a little onto each bank
  const full = s1 - s0, L = Math.max(1.5, full * Math.max(0.05, Math.min(1, frac))), sc = s0 + L / 2;
  const [x0, z0] = at(s0), [x1, z1] = at(s1), hA = ground(x0, z0), hFar = ground(x1, z1);
  const [cx, cz] = at(sc);
  return { cx, cz, ang: Math.atan2(uz, ux), length: L, hA, hB: hA + (hFar - hA) * Math.max(0.05, Math.min(1, frac)) };
}

/** Records in the stride of World.bridge_spans_flat() ([index, x, z, angle, length, tier, options, ground at one end, at the other end, deck level]), index negative: not a building. */
export function soldierSpansFlat(bridges: ArrayLike<number>, partial: number[][], ground: (x: number, z: number) => number): Float32Array {
  const out: number[] = []; let n = 0;
  const add = (ax: number, az: number, bx: number, bz: number, frac: number) => {
    const s = spanAcross(ax, az, bx, bz, ground, frac); if (!s) return;
    out.push(-1 - n++, s.cx, s.cz, s.ang, s.length, 0, 0, s.hA, s.hB, 0);
  };
  for (let i = 0; i + 3 < bridges.length; i += 4) add(bridges[i], bridges[i + 1], bridges[i + 2], bridges[i + 3], 1);
  for (const p of partial) add(p[0], p[1], p[2], p[3], p[4]);
  return Float32Array.from(out);
}
