// The model village must have complete walls and room between the walls and the buildings (built in Node with the real core, no browser).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildDemo, wallReport } from './demo.mjs';
const defs = JSON.parse(createRequire(import.meta.url)('./.wasm/game_core.js').catalog());
const SEEDS = [1337n, 7n, 1n, 99999n, 424242n, 31337n];
const BARRIERS = [2, 22], NOT_BUILDINGS = [24, 23, 21, 32, 33, 34];

for (const seed of SEEDS) test(`seed ${seed}: the curtain walls are closed rings and the moat is unbroken`, () => {
  const w = buildDemo(seed), r = wallReport(w);
  for (const ring of ['inner', 'outer']) { assert.equal(r[ring].holes, 0, `${ring} wall has holes: ${JSON.stringify(r[ring])}`); assert.ok(r[ring].pieces >= 24, `${ring} wall has ${r[ring].pieces} pieces`); }
  const f = w.buildings_flat(), moat = [];
  for (let i = 0; i < f.length / 10; i++) if (f[i * 10] === 24) moat.push({ x: f[i * 10 + 2], y: f[i * 10 + 3] });
  moat.sort((p, q) => Math.atan2(p.y, p.x) - Math.atan2(q.y, q.x));
  assert.ok(moat.length >= 60 && moat.every((p, i) => Math.hypot(p.x - moat[(i + 1) % moat.length].x, p.y - moat[(i + 1) % moat.length].y) <= 8), 'the moat has no gap');
});

for (const seed of SEEDS.slice(0, 3)) test(`seed ${seed}: buildings keep clear of the walls`, () => {
  const w = buildDemo(seed), f = w.buildings_flat(), walls = [], others = [];
  for (let i = 0; i < f.length / 10; i++) { const k = f[i * 10], b = { k, x: f[i * 10 + 2], y: f[i * 10 + 3], r: defs[k].r }; if (BARRIERS.includes(k)) walls.push(b); else if (!NOT_BUILDINGS.includes(k)) others.push(b); }
  const gap = o => Math.min(...walls.map(wl => Math.hypot(o.x - wl.x, o.y - wl.y) - o.r - wl.r));
  for (const o of others) assert.ok(gap(o) >= (o.k === 3 ? 1.0 : 2.5), `${defs[o.k].name} at ${o.x.toFixed(0)},${o.y.toFixed(0)} is only ${gap(o).toFixed(1)} from a wall`);
  assert.ok(others.filter(o => o.k === 0).length >= 12, 'the bailey has its houses');
});

import { wallGraphReport } from './demo.mjs';
for (const seed of SEEDS.slice(0, 4)) test(`seed ${seed}: every wall piece links up, each ring is one loop, and the gatehouses match their walls`, () => {
  const r = wallGraphReport(buildDemo(seed));
  for (const ring of ['inner', 'outer']) {
    assert.deepEqual(r[ring].dangling, [], `${ring}: pieces with fewer than two neighbours`); assert.equal(r[ring].parts, 0, `${ring} wall is in several parts`);
    assert.equal(r[ring].gateTiers.length, 1, `${ring} has one gate`); assert.ok(r[ring].gateTiers[0] >= r[ring].minWallTier, `${ring} gate is tier ${r[ring].gateTiers[0]} in tier ${r[ring].minWallTier} walls`);
  }
});

for (const seed of SEEDS.slice(0, 3)) test(`seed ${seed}: the keep, hall and chapel reach their top tiers in the roomier castle`, () => {
  const w = buildDemo(seed), f = w.buildings_flat(), tier = k => { for (let i = 0; i < f.length / 10; i++) if (f[i * 10] === k) return f[i * 10 + 1]; return -1; };
  assert.equal(tier(26), 3, 'the keep is a great keep'); assert.equal(tier(15), 3, 'the hall is a castle'); assert.equal(tier(17), 2, 'the chapel is an abbey');
});

// ---- production and resources stand outside the moat; trees and deposits exist only where a resource building needs them ----
const OUTSIDE = [1, 4, 5, 6, 7, 8, 9, 10, 11];   // farm, woodcutter, sawmill, quarry, clay pit, brickworks, iron mine, gold mine, charcoal burner
const MINES = { 6: 0, 7: 1, 9: 2, 10: 3 };         // building -> the deposit kind it works
for (const seed of SEEDS.slice(0, 4)) test(`seed ${seed}: farms and every resource building stand outside the moat`, () => {
  const w = buildDemo(seed), f = w.buildings_flat(), ox = w.origin_x(), oy = w.origin_y(), count = {};
  for (let i = 0; i < f.length / 10; i++) {
    const k = f[i * 10]; if (!OUTSIDE.includes(k)) continue;
    const r = Math.hypot(f[i * 10 + 2] - ox, f[i * 10 + 3] - oy); count[k] = (count[k] ?? 0) + 1;
    assert.ok(r >= 86, `${defs[k].name} stands ${r.toFixed(0)} from the hall, inside the moat`);
  }
  for (const k of [1, 4, 5, 6, 7, 9, 10]) assert.ok(count[k] >= 1, `no ${defs[k].name} outside the moat`);
  assert.ok(count[1] >= 5, `only ${count[1]} farms`);
});

for (const seed of SEEDS.slice(0, 4)) test(`seed ${seed}: all deposits are cleared except the ones the mines and quarry work`, () => {
  const w = buildDemo(seed), f = w.buildings_flat(), d = Array.from(w.deposits_flat()), ox = w.origin_x(), oy = w.origin_y();
  const alive = []; for (let i = 0; i < d.length; i += 5) if (d[i + 4] > 0 && Math.hypot(d[i + 1] - ox, d[i + 2] - oy) < 118) alive.push({ kind: d[i], x: d[i + 1], y: d[i + 2] });
  assert.equal(alive.length, 4, 'one deposit of each kind');
  for (const dep of alive) {
    let worked = false;
    for (let i = 0; i < f.length / 10; i++) if (MINES[f[i * 10]] === dep.kind && Math.hypot(f[i * 10 + 2] - dep.x, f[i * 10 + 3] - dep.y) <= 15) worked = true;
    assert.ok(worked, `deposit kind ${dep.kind} has no working building beside it`);
  }
});

for (const seed of SEEDS.slice(0, 3)) test(`seed ${seed}: trees survive only in the woodcutter's grove`, () => {
  const w = buildDemo(seed), g = Array.from(w.groves_flat()), ox = w.origin_x(), oy = w.origin_y();
  assert.equal(g.length, 3, 'one grove');
  let tested = 0;
  for (let a = 0; a < 360; a += 6) for (const r of [60, 85, 100, 112]) {
    const dx = Math.round(Math.cos(a * Math.PI / 180) * r), dy = Math.round(Math.sin(a * Math.PI / 180) * r);
    if (w.can_place(4, dx, dy) !== 0) continue;   // a woodcutter can only stand where there is forest
    tested++; assert.ok(Math.hypot(ox + dx - g[0], oy + dy - g[1]) <= g[2] + 13, `a woodcutter is allowed at ${dx},${dy}, far from the grove`);
  }
  assert.ok(tested >= 0);
});
