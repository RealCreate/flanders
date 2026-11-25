/** The maths behind the camera controls, with no drawing code, so it can be tested. Positions are on the ground plane: x east, z south. */
export interface P2 { x: number; z: number }

/** Zoom by `ratio` (below 1 is closer) so the point under the pointer stays under the pointer: the camera's target slides towards that point as you zoom in and away from it as you zoom out. */
export function zoomAbout(target: P2, point: P2, ratio: number): P2 {
  return { x: point.x + (target.x - point.x) * ratio, z: point.z + (target.z - point.z) * ratio };
}

/** Where a ray from `origin` along `dir` meets the horizontal plane at height `y`, or null if it never does (looking up) or only far beyond the map. */
export function rayOnPlane(origin: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, y: number, far = 20000): P2 | null {
  if (dir.y >= -1e-6) return null; const t = (y - origin.y) / dir.y; if (t < 0 || t > far) return null;
  return { x: origin.x + dir.x * t, z: origin.z + dir.z * t };
}

/** Dragging the ground: the point that was under the pointer when the drag began (`grabbed`) must be under it now (`now`), so the target moves by the difference. */
export function grabShift(grabbed: P2, now: P2): P2 { return { x: grabbed.x - now.x, z: grabbed.z - now.z }; }

/** A drag is a drag, and not a click, once the pointer has travelled this far in pixels in total (not just since the last event). */
export const DRAG_PIXELS = 5;
export class DragCounter {
  private total = 0;
  add(dx: number, dy: number) { this.total += Math.hypot(dx, dy); }
  reset() { this.total = 0; }
  get dragged() { return this.total > DRAG_PIXELS; }
}

export const TOUCH_DRAG_PIXELS = 9;
export interface TouchPoint { clientX: number; clientY: number }

export function touchFrame(points: TouchPoint[]) {
  const [a, b] = points;
  if (!b) return { center: a, distance: 0, angle: 0 };
  const x = b.clientX - a.clientX, y = b.clientY - a.clientY;
  return { center: { clientX: a.clientX + x / 2, clientY: a.clientY + y / 2 }, distance: Math.max(4, Math.hypot(x, y)), angle: Math.atan2(y, x) };
}

/** The nearest of some screen positions to the pointer, within `max` pixels (a forgiving click target for small things such as an army's banner). */
export function nearestWithin<T extends { sx: number; sy: number }>(items: T[], x: number, y: number, max: number): T | null {
  let best: T | null = null, bd = max * max;
  for (const it of items) { const d = (it.sx - x) ** 2 + (it.sy - y) ** 2; if (d <= bd) { bd = d; best = it; } }
  return best;
}

/** Two fingers on the map either work the map (pan, pinch, twist) or tilt the camera, and which one is settled once they have moved this far (CSS pixels, both
 *  fingers together) and then kept until they lift. */
export const TWO_FINGER_DECIDE_PIXELS = 12;
/** What two fingers are doing, from how far each has moved since the second one came down: `tilt` when both slide up or down together (mostly vertically, the same
 *  way), as in Apple Maps and Google Maps; `map` for anything else; null while they have hardly moved. */
export function twoFingerMode(a: { dx: number; dy: number }, b: { dx: number; dy: number }): 'tilt' | 'map' | null {
  if (Math.hypot(a.dx, a.dy) + Math.hypot(b.dx, b.dy) < TWO_FINGER_DECIDE_PIXELS) return null;
  const vertical = (m: { dx: number; dy: number }) => Math.abs(m.dy) > 2 * Math.abs(m.dx) && Math.abs(m.dy) > 3;
  return vertical(a) && vertical(b) && Math.sign(a.dy) === Math.sign(b.dy) ? 'tilt' : 'map';
}

/** Turning with two fingers only starts after a deliberate twist: every pinch also changes the angle between the fingers a little, which turned the camera while
 *  zooming. Below `threshold` (radians, about 10°) the twist is held back; past it the camera turns by what goes beyond the threshold (no jump), and then freely,
 *  until the fingers lift. */
export class TwistGate {
  private sum = 0; private open = false; private threshold: number;
  constructor(threshold = 0.17) { this.threshold = threshold; }
  reset() { this.sum = 0; this.open = false; }
  /** The part of this step's twist to apply. */
  step(twist: number): number {
    if (this.open) return twist;
    this.sum += twist;
    if (Math.abs(this.sum) < this.threshold) return 0;
    this.open = true; return this.sum - Math.sign(this.sum) * this.threshold;
  }
}

/** The ground keeps sliding for a moment after a quick swipe (and stops dead after a slow one or a pause before lifting). Velocity in world units per second. */
export class Glide {
  vx = 0; vz = 0; private at = 0;
  /** A pan of (dx, dz) world units at time `t` (ms). */
  sample(dx: number, dz: number, t: number) {
    const dt = Math.max(1, t - this.at) / 1000; this.at = t;
    if (dt > 0.1) { this.vx = this.vz = 0; return; }   // a pause in the drag: start measuring afresh
    const k = Math.min(1, dt / 0.05);                  // smoothed over the last ~50 ms of the drag
    this.vx += (dx / dt - this.vx) * k; this.vz += (dz / dt - this.vz) * k;
  }
  /** The fingers lifted at time `t` (ms): keep the speed only if they were still moving. Returns whether the ground glides. */
  release(t: number): boolean { if (t - this.at > 80) this.stop(); return this.moving; }
  stop() { this.vx = this.vz = 0; }
  get moving() { return Math.hypot(this.vx, this.vz) > 1; }
  /** Advance by `dt` seconds: the distance to move now. The speed falls off with a time constant of `tau` seconds. */
  advance(dt: number, tau = 0.3): P2 {
    const out = { x: this.vx * dt, z: this.vz * dt }, f = Math.exp(-dt / tau);
    this.vx *= f; this.vz *= f; if (!this.moving) this.stop();
    return out;
  }
}

/** The page position of an element, read once and again only after the window changes size: reading it in every pointer move forced the browser to lay the page out
 *  between frames. (The game canvas fills the window and never moves otherwise.) */
const rects = new WeakMap<Element, DOMRect>();
let rectsWatched = false, rectsCleared = 0;
export function cachedRect(el: Element): DOMRect {
  if (!rectsWatched && typeof addEventListener === 'function') { rectsWatched = true; addEventListener('resize', () => { rectsCleared++; }); }
  const hit = rects.get(el);
  if (hit && (hit as DOMRect & { gen?: number }).gen === rectsCleared) return hit;
  const r = el.getBoundingClientRect() as DOMRect & { gen?: number }; r.gen = rectsCleared; rects.set(el, r); return r;
}
