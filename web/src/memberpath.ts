// How the soldiers drawn round a marching army find their own way. The core moves the army as one body along the unified path network; each soldier, knight and siege engine follows the very line the
// army's centre took (the network's own line), a little to one side of it, and never leaves the free ground: every sideways offset is cut short by the core's own blocking check (`World.member_reach`),
// every step goes through `World.member_step`, and a soldier who still gets stuck asks the core for a route of its own along the network (`World.member_route`).
// This file is the pure part (no game, no drawing), tested under plain node (tests/memberpath.test.mjs).

/** The core's side of the checks (see crates/game-core/src/members.rs). `lvl` 3 is the engine width layer, used for knights and siege engines. */
export interface Walker {
  blocked(x: number, z: number, lvl: number): boolean;
  /** One step towards a goal: [x, z, how] with how 0 straight, 1 round something, 2 could not move. */
  step(x: number, z: number, tx: number, tz: number, dist: number, lvl: number): ArrayLike<number>;
  /** How far one may be offset in direction (dx, dz), at most `want`. */
  reach(x: number, z: number, dx: number, dz: number, want: number, lvl: number): number;
  /** A soldier's own route along the path network: [x, z, ...] (empty if none). */
  route(sx: number, sz: number, tx: number, tz: number, lvl: number): ArrayLike<number>;
}

/** The layer a kind of soldier travels on: knights and siege engines (catapults 4, rams 5) need the engine width, the foot soldiers do not. */
export const levelOf = (kind: number): number => (kind === 3 || kind === 4 || kind === 5 ? 3 : 0);

/** A number in [0, 1) that depends only on its arguments (the same every time, on every machine). */
export function hash01(a: number, b = 0, c = 0): number {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b) ^ Math.imul(c | 0, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0; h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export interface Traits {
  /** Direction and distance of its place in the loose crowd round the army's centre when it stands. */
  angle: number; spread: number;
  /** How far to the side of the path it likes to walk (negative: left), within what the core finds free. */
  lateral: number;
  /** How long after the army sets off before it does (seconds), so they do not all leave at one instant. */
  delay: number;
  /** How far behind the army's centre (along the path) it likes to be. */
  lead: number;
  /** Its pace compared with the others. */
  pace: number;
}
export function memberTraits(armyId: number, index: number, kind: number): Traits {
  const h = (k: number) => hash01(armyId, index * 7 + kind, k);
  return {
    angle: h(1) * Math.PI * 2, spread: 2 + Math.sqrt(index + 1) * 1.35,
    lateral: (h(2) - 0.5) * 9, delay: h(3) * 2.2, lead: 0.5 + h(4) * 8, pace: 0.92 + h(5) * 0.16,
  };
}

/** The sideways direction of a path at a point, from two points along it (the second further back). */
export function pathNormal(ax: number, az: number, bx: number, bz: number): [number, number] {
  const dx = ax - bx, dz = az - bz, l = Math.hypot(dx, dz);
  return l < 1e-6 ? [1, 0] : [-dz / l, dx / l];
}

/** A soldier is stuck when it wants to move but cannot (the core says 2) for a while; its stuck time builds up while it is blocked and drains quickly when it moves. */
export const STUCK_REROUTE = 0.8;
export function stuckUpdate(stuck: number, dt: number, how: number, wanted: boolean): number {
  if (how === 2 && wanted) return stuck + dt;
  return Math.max(0, stuck - dt * 2);
}

/** Where a soldier following its own route should head: the next point not yet reached. `reach` is how near counts as reached. */
export function routeTarget(route: ArrayLike<number>, ri: number, x: number, z: number, reach = 1.1): { ri: number; tx: number; tz: number; done: boolean } {
  let i = ri;
  while (i * 2 + 1 < route.length && Math.hypot(route[i * 2] - x, route[i * 2 + 1] - z) < reach) i++;
  if (i * 2 + 1 >= route.length) return { ri: i, tx: x, tz: z, done: true };
  return { ri: i, tx: route[i * 2], tz: route[i * 2 + 1], done: false };
}

/** Cut a wanted offset (dx, dz from a point) down to what is free, by asking `reach` how far the way goes in that direction. */
export function clampOffset(walker: Walker, x: number, z: number, dx: number, dz: number, lvl: number): [number, number] {
  const l = Math.hypot(dx, dz); if (l < 1e-6) return [0, 0];
  const r = walker.reach(x, z, dx, dz, l, lvl);
  return [dx / l * r, dz / l * r];
}
