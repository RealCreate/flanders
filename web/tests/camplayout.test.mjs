import test from 'node:test';
import assert from 'node:assert/strict';
import { campLayout, patrolAt, tentsFor, guardsFor } from '../src/camplayout.ts';

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

test('a camp has tents and guards in proportion to the army, and starts with the first soldier', () => {
  assert.equal(campLayout(0, 0, 0, 0), null);
  assert.deepEqual([tentsFor(1), tentsFor(15), tentsFor(100)], [1, 3, 12]);
  assert.deepEqual([guardsFor(2), guardsFor(10), guardsFor(100)], [0, 2, 6]);
  const one = campLayout(0, 0, 0, 1);
  assert.equal(one.tents.length, 1);
  const c = campLayout(0, 0, 0, 20);
  assert.equal(c.tents.length, tentsFor(20));
  assert.equal(c.guards, guardsFor(20));
});

test('tents stand in small groups round a fire, not in a ring, and not on top of each other', () => {
  const c = campLayout(10, -5, 0.8, 40);
  assert.equal(c.fires.length, Math.ceil(c.tents.length / 3));
  for (const [i, t] of c.tents.entries()) {
    assert.ok(c.tents.slice(0, i).every(u => dist(u, t) >= 3.2), 'tents do not overlap');
    const fire = c.fires[Math.floor(i / 3)];
    assert.ok(dist(fire, t) < 2.6, 'a tent is beside its fire');
  }
  const mid = { x: c.tents.reduce((a, t) => a + t.x, 0) / c.tents.length, z: c.tents.reduce((a, t) => a + t.z, 0) / c.tents.length };
  assert.ok(c.tents.every(t => dist(t, mid) < 12), 'the camp is compact');
  assert.ok(Math.hypot(mid.x - 10, mid.z + 5) < 3, 'and centred on where the army stopped');
});

test('the fence of spiked logs goes round the tents and leaves a gate at the front', () => {
  const c = campLayout(0, 0, 0, 30);
  assert.ok(c.stakes.length > 20 && c.stakes.length <= 110);
  for (const t of c.tents) assert.ok(c.stakes.every(s => dist(s, t) > 2.2), 'no log in a tent');
  const front = Math.max(...c.stakes.map(s => s.z));   // yaw 0 faces +z
  assert.ok(c.stakes.filter(s => s.z > front - 0.1).every(s => Math.abs(s.x) >= 2.3), 'nothing blocks the gate');
  assert.ok(c.stakes.slice(0, 4).every(s => s.z > front - 0.5), 'the fence is built from the gate outward');
});

test('horses stand at a trough only when there are riders, and the engines are parked in rows outside the gate', () => {
  const none = campLayout(0, 0, 0, 10);
  assert.equal(none.trough, null);
  assert.equal(none.horses.length, 0);
  const c = campLayout(0, 0, 0, 20, 4, 6);
  assert.ok(c.trough);
  assert.equal(c.horses.length, 4);
  for (const h of c.horses) assert.ok(dist(h, c.trough) < 2.6 && c.horses.every(g => g === h || dist(g, h) > 1.2), 'a horse beside the trough, not on another');
  assert.equal(c.engines.length, 6);
  const fenceEdge = Math.max(...c.stakes.map(s => s.z));
  assert.ok(c.engines.every(e => e.z > fenceEdge), 'engines are outside');
  for (const [i, e] of c.engines.entries()) assert.ok(c.engines.slice(0, i).every(o => dist(o, e) >= 3.4), 'engines do not touch');
});

test('guards walk a loop inside the fence', () => {
  const c = campLayout(0, 0, 0.4, 30);
  const pts = Array.from({ length: 40 }, (_, i) => patrolAt(c, (i / 40) * c.loopLen));
  for (const p of pts) assert.ok(c.tents.every(t => dist(t, p) > 1.6), 'a guard does not walk through a tent');
  assert.ok(Math.abs(dist(patrolAt(c, 0), patrolAt(c, c.loopLen))) < 1e-6, 'it is a closed loop');
  assert.ok(Math.abs(dist(patrolAt(c, 1), patrolAt(c, 0)) - 1) < 1e-6, 'a metre along is a metre');
});

test('the same army always gets the same camp', () => {
  assert.deepEqual(campLayout(3, 4, 1, 12, 2, 1), campLayout(3, 4, 1, 12, 2, 1));
});
