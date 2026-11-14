/** A polyline [x, z, x, z, ...] with its corners cut: each bend becomes a short curve (at most `cut` units back along either side), the ends stay put. */
export function rounded(p: number[], cut: number): number[] {
  if (p.length < 6) return p.slice();
  const out = [p[0], p[1]];
  for (let k = 2; k + 2 < p.length; k += 2) {
    const ax = p[k - 2], az = p[k - 1], bx = p[k], bz = p[k + 1], cx = p[k + 2], cz = p[k + 3];
    const l1 = Math.hypot(ax - bx, az - bz), l2 = Math.hypot(cx - bx, cz - bz);
    if (l1 < 1e-6 || l2 < 1e-6) continue;
    const d = Math.min(cut, l1 * 0.45, l2 * 0.45), sx = bx + (ax - bx) / l1 * d, sz = bz + (az - bz) / l1 * d, ex = bx + (cx - bx) / l2 * d, ez = bz + (cz - bz) / l2 * d;
    const n = 6;
    for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; out.push(u * u * sx + 2 * u * t * bx + t * t * ex, u * u * sz + 2 * u * t * bz + t * t * ez); }
  }
  out.push(p[p.length - 2], p[p.length - 1]);
  return out;
}
