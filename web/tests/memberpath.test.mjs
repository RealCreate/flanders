import test from 'node:test';
import assert from 'node:assert/strict';
import { marchPoint, marchSlot } from '../src/marchfile.ts';

const corner = [0, 0, 0, 0, 5, 0, 0, 5, 5, 7, 0, 12];
test('a march interpolates along both legs of a corner', () => {
  assert.deepEqual(marchPoint(corner, 4), { x: 4, z: 0, mode: 0, yaw: Math.PI / 2 });
  assert.deepEqual(marchPoint(corner, 6), { x: 5, z: 1, mode: 0, yaw: 0 });
});
test('soldiers leave one by one with a consistent gap along the line', () => {
  assert.equal(marchSlot(corner, 3, 2, 1.5), null);
  assert.equal(marchSlot(corner, 4, 2, 1.5).x, 1);
  assert.equal(marchSlot(corner, 8, 1, 1.5).z, 1.5);
  assert.equal(marchSlot(corner, 13.5, 1, 1.5), null);
  assert.equal(marchSlot(corner, 18, 0, 1.5).z, 7);
});
test('the mode belongs to the crossed segment, so each soldier boards independently', () => {
  const route = [0, 0, 0, 0, 2, 0, 0, 2, 6, 0, 2, 6, 8, 0, 0, 8];
  assert.equal(marchSlot(route, 7, 0, 2).mode, 0);
  assert.equal(marchSlot(route, 7, 1, 2).mode, 2);
  assert.equal(marchSlot(route, 7, 3, 2).mode, 0);
});
