// Journeys between villages: who is on the road, how far along, and who walks in the procession. Pure maths and data, no drawing (see travellers.ts, tests/journey.test.mjs).
// The core keeps the list (World.journeys_flat, the same on every copy of a village); this file turns it into places on a polyline and a cast of figures.

/** The kinds of journey, as the core numbers them (0..2 are treaty kinds). */
export const JK = { TRADE: 0, PEACE: 1, ALLIANCE: 2, ENVOY: 3, MARRIAGE: 4, WAR: 5, CARAVAN: 6 } as const;
export const JOURNEY_STRIDE = 7;

export interface Journey { kind: number; to: number; a: number; b: number; escort: number; start: number; arrive: number }

/** Read World.journeys_flat(): [kind, to, a, b, escort, start, arrive] each. */
export function parseJourneys(flat: ArrayLike<number>): Journey[] {
  const out: Journey[] = [];
  for (let o = 0; o + JOURNEY_STRIDE <= flat.length; o += JOURNEY_STRIDE) out.push({ kind: flat[o], to: flat[o + 1], a: flat[o + 2], b: flat[o + 3], escort: flat[o + 4], start: flat[o + 5], arrive: flat[o + 6] });
  return out;
}

/** How far along the road at tick `t` (fractional ticks are fine): 0 when it sets out, 1 when it arrives, which is the tick the core applies its effect. */
export const progress = (j: Journey, t: number) => j.arrive <= j.start ? 1 : Math.min(1, Math.max(0, (t - j.start) / (j.arrive - j.start)));

/** Whatever a village's tick counter does, the tick a procession is drawn at only ever moves forward, smoothly, and never gets ahead of the next tick the core will make. */
export class TickClock {
  /** The tick drawn now (fractional). */
  shown = 0; private tick = -1; private at = 0; rate = 1;
  /** `tick` is the world's tick, `now` the real time in seconds. Call once a frame; returns the tick to draw. */
  update(tick: number, now: number, dt: number): number {
    if (this.tick < 0) { this.tick = tick; this.at = now; this.shown = tick; return this.shown; }
    if (tick !== this.tick) {
      const dts = now - this.at;
      if (tick > this.tick && dts > 1e-3) { const r = Math.min(40, (tick - this.tick) / dts); this.rate = this.rate * 0.7 + r * 0.3; }
      if (tick < this.tick || tick - this.tick > 50) this.shown = tick;   // the copy was rebuilt or jumped: no gliding across the gap
      this.tick = tick; this.at = now;
    }
    this.shown += this.rate * dt;
    if (this.shown > tick + 0.999) this.shown = tick + 0.999;                                    // never past the next tick: a paused game does not creep on
    if (this.shown < tick) this.shown += (tick - this.shown) * Math.min(1, dt * 6) + 1e-9;      // behind: catch up quickly, never go back
    if (this.shown < tick - 0.001 && tick - this.shown < 0.02) this.shown = tick;
    return this.shown;
  }
}

// ---------- the road ----------
export interface Road { pts: number[]; cum: number[]; len: number }

/** A polyline [x, z, x, z, ...] with its running lengths. */
export function makeRoad(pts: number[]): Road {
  const cum = [0];
  for (let k = 2; k < pts.length; k += 2) cum.push(cum[cum.length - 1] + Math.hypot(pts[k] - pts[k - 2], pts[k + 1] - pts[k - 1]));
  return { pts, cum, len: cum[cum.length - 1] ?? 0 };
}

/** The point `s` units along the road (clamped to its ends) and the way it is heading there. */
export function pointAt(r: Road, s: number): { x: number; z: number; yaw: number } {
  const n = r.cum.length;
  if (n === 0) return { x: 0, z: 0, yaw: 0 };
  if (n === 1) return { x: r.pts[0], z: r.pts[1], yaw: 0 };
  const c = Math.min(r.len, Math.max(0, s));
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (r.cum[m] <= c) lo = m; else hi = m; }
  while (lo < n - 2 && r.cum[lo + 1] - r.cum[lo] < 1e-9) lo++;   // skip a zero-length piece
  const seg = r.cum[lo + 1] - r.cum[lo], t = seg > 1e-9 ? (c - r.cum[lo]) / seg : 0;
  const ax = r.pts[lo * 2], az = r.pts[lo * 2 + 1], bx = r.pts[lo * 2 + 2], bz = r.pts[lo * 2 + 3];
  return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, yaw: Math.atan2(bx - ax, bz - az) };
}

/** The heading at `s`, averaged over a few units either side so a figure turns round a corner instead of snapping. */
export function headingAt(r: Road, s: number, reach = 3): number {
  const a = pointAt(r, s - reach), b = pointAt(r, s + reach);
  return Math.hypot(b.x - a.x, b.z - a.z) > 1e-6 ? Math.atan2(b.x - a.x, b.z - a.z) : pointAt(r, s).yaw;
}

/** The part of a polyline between `from` units in and `to` units short of its end. Never empties: a short road is kept whole. */
export function trim(pts: number[], from: number, to: number): number[] {
  const r = makeRoad(pts);
  if (pts.length < 4 || r.len < 8 || from + to > r.len * 0.6) return pts.slice();
  const out: number[] = []; const a = pointAt(r, from), b = pointAt(r, r.len - to);
  out.push(a.x, a.z);
  for (let k = 1; k < r.cum.length - 1; k++) if (r.cum[k] > from + 1e-6 && r.cum[k] < r.len - to - 1e-6) out.push(r.pts[k * 2], r.pts[k * 2 + 1]);
  out.push(b.x, b.z);
  return out;
}

/** How a figure appears and vanishes: 0 at the ends of the road growing to 1 over `ramp` units. */
export function fade(s: number, len: number, ramp = 3): number {
  const e = Math.min(s, len - s);
  if (e <= 0) return 0;
  if (e >= ramp) return 1;
  const u = e / ramp; return u * u * (3 - 2 * u);
}

// ---------- the cast ----------
/** One figure or group in the procession: where in the line it walks (`back` units behind the head, `side` to one side) and what it is. */
export interface Unit { role: string; back: number; side: number; n?: number; flag?: number }

export const MAX_CARTS = 6;
/** Carts in a caravan: one for a small load, more for a bigger one, up to six (a caravan holds 500). */
export const cartsFor = (amount: number) => Math.min(MAX_CARTS, Math.max(1, 1 + Math.floor((Math.max(1, amount) - 1) / 90)));

/** Who walks in a journey of this kind. Every kind has its own cast so it is known at a glance: carts and horses for goods, a rider with a scroll for a pact, white flags for peace, two banners and a guard for an alliance,
 *  a herald with a laden pack horse for an envoy, a garlanded carriage for a wedding, a lone rider with a red banner for war. */
export function party(j: Journey): Unit[] {
  switch (j.kind) {
    case JK.CARAVAN: {
      const n = cartsFor(j.b), u: Unit[] = [];
      let at = 0;
      if (j.escort > 0) { u.push({ role: 'guard-rider', back: 0, side: -1.2 }); at = 4; if (j.escort > 2) { u.push({ role: 'guard-rider', back: 0, side: 1.2 }); } }
      else u.push({ role: 'drover', back: 0, side: 0 }), at = 4;
      for (let k = 0; k < n; k++) u.push({ role: 'cart', back: at + 4 + k * 8.5, side: 0, n: k });
      const tail = at + 4 + n * 8.5 + 1.5;
      u.push({ role: j.escort > 0 ? 'guard-rider' : 'walker-staff', back: tail, side: 0 });
      if (j.escort > 5) u.push({ role: 'guard-rider', back: tail + 3, side: 1.2 });
      return u;
    }
    case JK.TRADE: return [{ role: 'courier', back: 0, side: 0 }, { role: 'attendant', back: 5.5, side: 0 }];
    case JK.PEACE: return [{ role: 'white-flag', back: 0, side: 0 }, { role: 'olive', back: 3.4, side: 0.9 }, { role: 'white', back: 5.6, side: -0.9 }];
    case JK.ALLIANCE: return [{ role: 'standard', back: 0, side: -1.7, flag: 0 }, { role: 'standard', back: 0, side: 1.7, flag: 1 }, { role: 'guard', back: 5, side: -1.2 }, { role: 'guard', back: 5, side: 1.2 }, { role: 'guard', back: 7.6, side: -1.2 }, { role: 'guard', back: 7.6, side: 1.2 }];
    case JK.ENVOY: return [{ role: 'herald', back: 0, side: 0 }, { role: 'gift-horse', back: 5, side: 0 }, { role: 'walker-staff', back: 9, side: 0.9 }];
    case JK.MARRIAGE: return [{ role: 'outrider', back: 0, side: -1.1 }, { role: 'outrider', back: 0, side: 1.1 }, { role: 'carriage', back: 9, side: 0 }, { role: 'outrider', back: 19, side: -1.1 }, { role: 'outrider', back: 19, side: 1.1 }];
    default: return [{ role: 'war-rider', back: 0, side: 0 }];
  }
}

/** How long the line is (the distance from its head to its tail), which the journey needs to walk in and out of view. */
export const spanOf = (units: Unit[]) => units.reduce((m, u) => Math.max(m, u.back + (u.role === 'cart' ? 5 : u.role === 'carriage' ? 7 : 0)), 0);

/** The name of a journey as a short line for its label. `from` and `to` are the villages' names ("you" for your own). */
export function describe(j: Journey, from: string, to: string, resName = 'goods'): string {
  switch (j.kind) {
    case JK.CARAVAN: return `Caravan from ${from} to ${to}: ${j.b} ${resName}`;
    case JK.TRADE: return `Trade pact offered by ${from} to ${to}`;
    case JK.PEACE: return `Peace offered by ${from} to ${to}`;
    case JK.ALLIANCE: return `Alliance offered by ${from} to ${to}`;
    case JK.ENVOY: return `Envoy with gifts from ${from} to ${to}`;
    case JK.MARRIAGE: return `Wedding party from ${from} to ${to}`;
    default: return `Herald of war from ${from} to ${to}`;
  }
}
/** The same as it is told on arrival (for a toast). `mine` says who is reading: they sent it, or it came to them. */
export function arrivedText(kind: number, from: string, to: string, sent: boolean): string {
  const who = sent ? to : from;
  switch (kind) {
    case JK.TRADE: return sent ? `Your trade pact reached ${who}.` : `${who} offers a trade pact.`;
    case JK.PEACE: return sent ? `Your offer of peace reached ${who}.` : `${who} offers peace.`;
    case JK.ALLIANCE: return sent ? `Your offer of an alliance reached ${who}.` : `${who} offers an alliance.`;
    case JK.ENVOY: return sent ? `Your envoy and his gifts reached ${who}.` : `An envoy from ${who} brings gifts.`;
    case JK.MARRIAGE: return sent ? `The wedding party reached ${who}: your houses are joined.` : `A royal marriage joins your house to ${who}'s.`;
    default: return sent ? `Your herald reached ${who}: war is declared.` : `${who} has declared war on you!`;
  }
}
