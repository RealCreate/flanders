/** A polyline [x, z, x, z, ...] with its corners cut: each bend becomes a short curve (at most `cut` units back along either side), the ends stay put.
 * `room[k]` is how far the line may move off the point k of the polyline (the free ground round it): a corner is cut only so far that the curve stays within that of the corner (0: it stays sharp). */
export function rounded(p: number[], cut: number, room?: ArrayLike<number>): number[] {
  if (p.length < 6) return p.slice();
  const out = [p[0], p[1]];
  for (let k = 2; k + 2 < p.length; k += 2) {
    const ax = p[k - 2], az = p[k - 1], bx = p[k], bz = p[k + 1], cx = p[k + 2], cz = p[k + 3];
    const l1 = Math.hypot(ax - bx, az - bz), l2 = Math.hypot(cx - bx, cz - bz);
    if (l1 < 1e-6 || l2 < 1e-6) continue;
    let d = Math.min(cut, l1 * 0.45, l2 * 0.45);
    if (room) {   // the middle of the curve lies d * cos(half the corner's angle) / 2 from the corner: keep that within the room there is
      const cosA = ((ax - bx) * (cx - bx) + (az - bz) * (cz - bz)) / (l1 * l2), half = Math.sqrt(Math.max(0, (1 + cosA) / 2));
      const r = Math.max(0, room[k / 2] ?? Infinity); if (half > 1e-6) d = Math.min(d, (2 * r) / half);
      if (d < 0.05) { out.push(bx, bz); continue; }
    }
    const sx = bx + (ax - bx) / l1 * d, sz = bz + (az - bz) / l1 * d, ex = bx + (cx - bx) / l2 * d, ez = bz + (cz - bz) / l2 * d;
    const n = 6;
    for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; out.push(u * u * sx + 2 * u * t * bx + t * t * ex, u * u * sz + 2 * u * t * bz + t * t * ez); }
  }
  out.push(p[p.length - 2], p[p.length - 1]);
  return out;
}
