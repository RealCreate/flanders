// The path an army's centre has taken, and where soldiers marching in single file stand along it. Pure maths, no drawing.

/** Soldiers on the march follow one another this far apart, in a single file. */
export const GAP = 1.3;

export /** The point `s` units behind the head of a trail (head = the army's centre, then the trail from newest to oldest). Past the oldest point the line carries straight on, away from the way it came. */
function trailAt(trail: number[], hx: number, hz: number, s: number, fx: number, fz: number): [number, number] {
  let ax = hx, az = hz, acc = 0;
  for (let k = trail.length - 2; k >= 0; k -= 2) {
    const bx = trail[k], bz = trail[k + 1], seg = Math.hypot(bx - ax, bz - az);
    if (seg > 1e-6) {
      if (acc + seg >= s) { const t = (s - acc) / seg; return [ax + (bx - ax) * t, az + (bz - az) * t]; }
      acc += seg; ax = bx; az = bz;
    }
  }
  // past the oldest point: carry on in the direction the trail was heading when it ended (or straight back from the facing at the very start)
  let dx = -fx, dz = -fz;
  if (trail.length >= 4) { const k = 0, ex = trail[k] - trail[k + 2], ez = trail[k + 1] - trail[k + 3], l = Math.hypot(ex, ez); if (l > 1e-6) { dx = ex / l; dz = ez / l; } }
  return [ax + dx * (s - acc), az + dz * (s - acc)];
}

/** Points spaced `spacing` apart along a polyline [x, z, x, z, ...], starting `phase` (0..spacing) in, at most `max` of them: the dots of a dotted line. */
export function dotsAlong(pts: number[], spacing: number, phase: number, max: number): number[] {
  const out: number[] = []; let next = ((phase % spacing) + spacing) % spacing, acc = 0;
  for (let k = 2; k < pts.length && out.length < max * 2; k += 2) {
    const ax = pts[k - 2], az = pts[k - 1], len = Math.hypot(pts[k] - ax, pts[k + 1] - az);
    if (len < 1e-9) continue;
    while (next <= acc + len + 1e-9 && out.length < max * 2) { const f = (next - acc) / len; out.push(ax + (pts[k] - ax) * f, az + (pts[k + 1] - az) * f); next += spacing; }
    acc += len;
  }
  return out;
}
