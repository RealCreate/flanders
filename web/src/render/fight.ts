/** Small pure helpers for drawing a fight (kept apart from three.js so they can be tested). */

/** How far a melee soldier steps forward during a swing: 0 at the start and end, a quick lunge (0.5 units) in the middle. `anim` is the core's swing timer counting down from `len`. */
export function lunge(anim: number, len = 0.35, reach = 0.5): number {
  if (anim <= 0) return 0;
  const p = Math.min(1, Math.max(0, 1 - anim / len));
  return Math.sin(p * Math.PI) * reach;
}

/** How far a fallen soldier has toppled (0 standing .. 1 lying), `since` seconds after the killing blow. Ease-out so the body drops fast and settles. */
export function fallen(since: number, dur = 0.55): number {
  const p = Math.min(1, Math.max(0, since / dur));
  return 1 - (1 - p) * (1 - p);
}

const rgb = (h: number) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const hex = (r: number, g: number, b: number) => (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);

/** Blend colour `a` towards `b` by `t` (0..1). */
export function mix(a: number, b: number, t: number): number {
  const [ar, ag, ab] = rgb(a), [br, bg, bb] = rgb(b);
  return hex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

export function colourDistance(a: number, b: number): number {
  const [ar, ag, ab] = rgb(a), [br, bg, bb] = rgb(b);
  return Math.hypot(ar - br, ag - bg, ab - bb);
}

/** The attackers' colour: the one wanted, unless it is too close to the defenders' colour to tell apart on the field. */
export function pickFoe(defenders: number, wanted: number): number {
  for (const c of [wanted, 0xb02a2a, 0xe0c030, 0x202020, 0xffffff]) if (colourDistance(c, defenders) > 90) return c;
  return wanted;
}

/** Index of the nearest enemy that is alive, or -1. `u` is World.battle_units_flat (stride 14: side, kind, x, y, hp, max, alive, swing, facing, elev, boss, phase, name, aura). */
export function nearestFoe(u: ArrayLike<number>, i: number, stride = 14): number {
  const n = u.length / stride; let best = -1, bd = Infinity;
  for (let j = 0; j < n; j++) {
    if (u[j * stride] === u[i * stride] || u[j * stride + 6] <= 0) continue;
    const d = (u[j * stride + 2] - u[i * stride + 2]) ** 2 + (u[j * stride + 3] - u[i * stride + 3]) ** 2;
    if (d < bd) { bd = d; best = j; }
  }
  return best;
}
