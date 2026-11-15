// Journeys with the real core: a procession sent by the owner is on the same road, at the same place, on every copy of the village, and arrives on the very tick its effect happens.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { applyCmd } from '../src/commands.ts';
import { parseJourneys, makeRoad, pointAt, progress, JK } from '../src/render/journey.ts';
const { World, warm_navigation } = createRequire(import.meta.url)('./.wasm/game_core.js');
const SEED = 1337n;
const fresh = () => { const w = new World(SEED, 0, 0); w.cheat(3, 0, 0); return w; };

/** Chain a path to a village and return where it is (the first of a few places that has a dry way). */
function chain(w) {
  for (const [x, z] of [[300, 40], [-280, 60], [60, 300], [250, -200], [-200, -250]]) if (w.link_village(x, z) === 0) return [x, z];
  throw new Error('no dry way to any village');
}
const length = (pts) => { let d = 0; for (let k = 2; k < pts.length; k += 2) d += Math.hypot(pts[k] - pts[k - 2], pts[k + 1] - pts[k - 1]); return d; };
/** How far from the polyline a point is. */
function offLine(pts, x, z) {
  let best = Infinity;
  for (let k = 2; k < pts.length; k += 2) {
    const ax = pts[k - 2], az = pts[k - 1], dx = pts[k] - ax, dz = pts[k + 1] - az, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)));
  }
  return best;
}

test('a journey walks the chained path, monotonically, and ends on the tick its effect happens', () => {
  warm_navigation(SEED);
  const w = fresh(), [tx, tz] = chain(w);
  const pts = Array.from(w.link_points(tx, tz)); assert.ok(pts.length >= 4, 'the path is there');
  assert.ok(Math.hypot(pts[0], pts[1]) < 40, 'it starts at our city'); assert.ok(Math.hypot(pts[pts.length - 2] - tx, pts[pts.length - 1] - tz) < 12, 'and ends at theirs');
  w.rel_add(7, 80);
  const dist = length(pts);
  for (const [kind, arg] of [[JK.PEACE, 30], [JK.TRADE, 30], [JK.ENVOY, 0], [JK.MARRIAGE, 0]]) assert.equal(w.journey_start(kind, 7, arg, dist), 0, `kind ${kind}`);
  assert.equal(w.caravan_send(0, 120, 7, dist, 0), 0);
  const list = parseJourneys(w.journeys_flat()); assert.equal(list.length, 5);
  const road = makeRoad(pts), last = new Map(), arrivedAt = new Map(), effectAt = new Map();
  for (let i = 0; i < 4000 && w.journeys_flat().length > 0; i++) {
    w.step(); const tick = Number(w.tick());
    for (const j of parseJourneys(w.journeys_flat())) {
      const p = progress(j, tick); assert.ok(p >= (last.get(j.kind) ?? -1), 'never goes back'); last.set(j.kind, p);
      const at = pointAt(road, p * road.len); assert.ok(offLine(pts, at.x, at.z) < 1e-6, 'on the path');
    }
    const a = w.take_arrivals(); for (let k = 0; k + 3 < a.length; k += 4) { arrivedAt.set(a[k], a[k + 3]); assert.equal(a[k + 3], tick); }
    if (w.has_treaty(7, 1) && !effectAt.has(1)) effectAt.set(1, tick);
    if (w.has_treaty(7, 0) && !effectAt.has(0)) effectAt.set(0, tick);
    if (w.married_to(7) && !effectAt.has(4)) effectAt.set(4, tick);
  }
  for (const j of list) if (j.kind !== JK.CARAVAN) { assert.equal(arrivedAt.get(j.kind), j.arrive, `kind ${j.kind} arrives on its tick`); if (j.kind !== JK.ENVOY) assert.equal(effectAt.get(j.kind), j.arrive, `kind ${j.kind}: the effect lands on arrival`); }
  assert.ok(w.has_treaty(7, 1) && w.has_treaty(7, 0) && w.married_to(7));
});

test('a replica replaying the commands shows the same journeys and agrees on every part of the state', () => {
  warm_navigation(SEED);
  const owner = fresh(), replica = fresh(); const log = [];
  const cmd = (c) => { const full = { ...c, tick: Number(owner.tick()), n: log.length }; applyCmd(owner, full); log.push(full); };
  const [tx, tz] = chain(fresh()); cmd({ op: 'link', x: tx, y: tz });   // (found on a scratch world: linking twice would reroute through the first link)
  owner.rel_add(7, 80); replica.rel_add(7, 80);   // (set directly in both copies: in the real game a relation comes from commands of the owner's history)
  cmd({ op: 'journey', kind: JK.PEACE, idx: 7, x: 30, y: 400 });
  for (let i = 0; i < 50; i++) owner.step();
  cmd({ op: 'journey', kind: JK.MARRIAGE, idx: 7, x: 0, y: 300 }); cmd({ op: 'caravan', kind: 1, x: 200, idx: 7, y: 350, ax: 1 });
  const seen = []; for (let i = 0; i < 700; i++) { owner.step(); seen.push([owner.state_hash().toString(), Array.from(owner.journeys_flat()).join()]); }
  let k = 0;
  for (let t = 0; t < 750; t++) {
    while (k < log.length && log[k].tick <= Number(replica.tick())) applyCmd(replica, log[k++]);
    replica.step();
    if (t >= 50) { const h = seen[t - 50]; assert.equal(replica.state_hash().toString(), h[0], `state differs at tick ${t + 1}`); assert.equal(Array.from(replica.journeys_flat()).join(), h[1], `journeys differ at tick ${t + 1}`); }
  }
  assert.ok(replica.married_to(7) && replica.has_treaty(7, 1));
});
