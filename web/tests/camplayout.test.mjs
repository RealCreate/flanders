import test from 'node:test';
import assert from 'node:assert/strict';
import { campLayout, tentsFor, guardsFor } from '../src/camplayout.ts';

const grid = (n, gap = 1.25) => Array.from({ length: n }, (_, i) => ({ x: (i % 5) * gap, z: Math.floor(i / 5) * gap }));

test('a camp has tents and guards in proportion to the army, and none for a lone soldier', () => {
  assert.equal(campLayout(grid(1)), null);
  assert.deepEqual([tentsFor(2), tentsFor(15), tentsFor(100)], [1, 3, 8]);
  assert.deepEqual([guardsFor(2), guardsFor(10), guardsFor(100)], [0, 2, 4]);
  const c = campLayout(grid(20));
  assert.equal(c.tents.length, tentsFor(20));
  assert.equal(c.guards.length, guardsFor(20));
});

test('tents and guards stand clear of the soldiers and of each other, outside them', () => {
  const slots = grid(30), c = campLayout(slots);
  for (const t of c.tents) {
    assert.ok(slots.every(s => Math.hypot(s.x - t.x, s.z - t.z) >= 2.6), 'a tent is not pitched on a soldier');
    assert.ok(Math.hypot(t.x - c.cx, t.z - c.cz) > c.radius, 'it is outside the soldiers');
  }
  for (const [i, t] of c.tents.entries()) assert.ok(c.tents.slice(0, i).every(u => Math.hypot(u.x - t.x, u.z - t.z) >= 4.4));
  for (const g of c.guards) assert.ok(c.tents.every(t => Math.hypot(t.x - g.x, t.z - g.z) >= 3.5), 'a guard does not stand in a tent');
});

test('the same army always gets the same camp', () => {
  assert.deepEqual(campLayout(grid(12)), campLayout(grid(12)));
});

test('a camp is found even for soldiers strung out along a road', () => {
  const road = Array.from({ length: 16 }, (_, i) => ({ x: i * 1.25, z: 0 }));
  assert.equal(campLayout(road).tents.length, 3);
});
