// The road tool's own geometry (no three.js, so it runs under node: tests/roadtool.test.mjs): the corners the player clicks are made into pieces no farther apart than the core allows,
// and the curve through them is previewed the way the core will draw it (a Catmull-Rom spline: straight at the two ends, smooth through every corner).

export interface Pt { x: number; z: number }

/** The longest stretch between two pieces the core accepts (roadline.rs REACH), less a margin. */
export const MAX_GAP = 9;

/** Put points between corners that are more than `gap` apart, evenly, so every stretch is short enough. */
export function subdivide(pts: Pt[], gap = MAX_GAP): Pt[] {
  const out: Pt[] = pts.length ? [pts[0]] : [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / gap));
    for (let k = 1; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  }
  return out;
}

/** The curve through the points, sampled about every `step` units: the same cubic Hermite the core uses (tangent half the distance between the neighbours; an end starts straight). */
export function curve(pts: Pt[], step = 1.5): Pt[] {
  if (pts.length < 2) return pts.slice();
  const out: Pt[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i], q = pts[i + 1], prev = pts[i - 1], next = pts[i + 2];
    const m0 = prev ? { x: (q.x - prev.x) * 0.5, z: (q.z - prev.z) * 0.5 } : { x: q.x - p.x, z: q.z - p.z };
    const m1 = next ? { x: (next.x - p.x) * 0.5, z: (next.z - p.z) * 0.5 } : { x: q.x - p.x, z: q.z - p.z };
    const n = Math.min(48, Math.max(2, Math.ceil(Math.hypot(q.x - p.x, q.z - p.z) / step)));
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      if (k === n) { out.push({ x: q.x, z: q.z }); continue; }
      const t = k / n, t2 = t * t, t3 = t2 * t, h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
      out.push({ x: h00 * p.x + h10 * m0.x + h01 * q.x + h11 * m1.x, z: h00 * p.z + h10 * m0.z + h01 * q.z + h11 * m1.z });
    }
  }
  return out;
}

/** Length of a polyline. */
export const length = (pts: Pt[]) => pts.reduce((s, p, i) => s + (i ? Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z) : 0), 0);
