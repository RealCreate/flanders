/** A point on a core march track packed as [x, z, mode, distance] per waypoint. */
export function marchPoint(points: ArrayLike<number>, distance: number) {
  const last = points.length - 4;
  if (last < 0) return null;
  let low = 0, high = last / 4;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (points[mid * 4 + 3] < distance) low = mid + 1;
    else high = mid;
  }
  const b = low * 4, a = Math.max(0, b - 4);
  const dx = points[b] - points[a], dz = points[b + 1] - points[a + 1];
  const length = points[b + 3] - points[a + 3];
  const t = length > 0 ? Math.min(1, Math.max(0, (distance - points[a + 3]) / length)) : 0;
  return { x: points[a] + dx * t, z: points[a + 1] + dz * t, mode: points[b + 2], yaw: length > 0 ? Math.atan2(dx, dz) : undefined };
}

/** Only soldiers released from the muster point and still travelling occupy a slot behind the leader. */
export function marchSlot(points: ArrayLike<number>, dispatch: number, rank: number, gap: number) {
  const distance = dispatch - rank * gap;
  if (rank > 0 && (distance <= 0 || distance >= points[points.length - 1])) return null;
  return marchPoint(points, distance);
}

/** A final slot follows an individual approach in reverse, after the head of the march has stopped. */
export function arrivalSlot(points: ArrayLike<number>, dispatch: number, rank: number, troops: number, heading: number, settled: boolean) {
  const distance = dispatch - rank * Math.min(0.45, 4 / Math.max(1, troops));
  if (!settled && distance < 0) return null;
  const at = marchPoint(points, settled ? -Infinity : -distance);
  return at && { ...at, yaw: at.yaw === undefined ? heading : at.yaw + Math.PI };
}
