import test from 'node:test';
import assert from 'node:assert/strict';
import { hash01, memberTraits, pathNormal, stuckUpdate, STUCK_REROUTE, routeTarget, clampOffset, levelOf } from '../src/memberpath.ts';

test('member traits are the same every time and differ between members', () => {
  const a = memberTraits(3, 5, 0), b = memberTraits(3, 5, 0), c = memberTraits(3, 6, 0);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  for (let i = 0; i < 200; i++) { const t = memberTraits(7, i, i % 4); assert.ok(t.delay >= 0 && t.delay < 2.2 && Math.abs(t.lateral) <= 4.5 && t.lead >= 0.5 && t.lead < 8.5 && t.pace >= 0.92 && t.pace < 1.08); }
});
test('members spread: different delays and sides, none in a line', () => {
  const ts = Array.from({ length: 40 }, (_, i) => memberTraits(1, i, 0));
  assert.ok(new Set(ts.map(t => t.delay.toFixed(2))).size > 30, 'start delays differ');
  assert.ok(ts.some(t => t.lateral < -1) && ts.some(t => t.lateral > 1), 'on both sides of the path');
  assert.ok(Math.max(...ts.map(t => t.delay)) - Math.min(...ts.map(t => t.delay)) > 1.5);
});
test('hash01 stays inside [0, 1)', () => { for (let i = 0; i < 1000; i++) { const h = hash01(i, i * 3, i * 5); assert.ok(h >= 0 && h < 1); } });
test('knights and engines use the engine width layer, foot soldiers the ordinary one', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(levelOf), [0, 0, 0, 3, 3, 3]);
});
test('the sideways direction is square to the path', () => {
  const [nx, nz] = pathNormal(10, 0, 0, 0); assert.ok(Math.abs(nx) < 1e-9 && Math.abs(Math.abs(nz) - 1) < 1e-9);
  assert.deepEqual(pathNormal(1, 1, 1, 1), [1, 0]);
});
test('a soldier that is blocked for a while counts as stuck, and gets over it when it moves again', () => {
  let s = 0; for (let i = 0; i < 10; i++) s = stuckUpdate(s, 0.1, 2, true);
  assert.ok(s >= STUCK_REROUTE - 1e-9);
  assert.equal(stuckUpdate(0.5, 0.1, 0, true), 0.3);
  assert.equal(stuckUpdate(0.5, 0.1, 2, false), 0.3, 'standing still on purpose is not being stuck');
});
test('a soldier following its own route heads for the next point it has not reached', () => {
  const route = [10, 0, 20, 0, 20, 10];
  let r = routeTarget(route, 0, 0, 0); assert.deepEqual([r.ri, r.tx, r.tz, r.done], [0, 10, 0, false]);
  r = routeTarget(route, 0, 9.5, 0); assert.deepEqual([r.ri, r.tx, r.tz], [1, 20, 0]);
  r = routeTarget(route, 2, 20, 9.9); assert.equal(r.done, true);
  assert.equal(routeTarget([], 0, 3, 4).done, true);
});
test('an offset is cut short where the core says the free ground ends', () => {
  const walker = { reach: (x, z, dx, dz, want) => Math.min(want, 2.5) };
  const [ox, oz] = clampOffset(walker, 0, 0, 6, 0, 0); assert.ok(Math.abs(ox - 2.5) < 1e-9 && oz === 0);
  const [px, pz] = clampOffset(walker, 0, 0, 0, -1, 0); assert.ok(Math.abs(px) < 1e-9 && Math.abs(pz + 1) < 1e-9, 'short offsets are kept');
  assert.deepEqual(clampOffset(walker, 0, 0, 0, 0, 0), [0, 0]);
});
